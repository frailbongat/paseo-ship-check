/**
 * The per-agent verdict, owned by the daemon.
 *
 * The client used to watch agent status, guess where a turn ended, and run a
 * 60s poll to catch what it missed. That only worked while an app was on
 * screen: a turn that finished with nobody watching left the card empty until
 * the next poll, so opening the tab meant a spinner and a wait.
 *
 * The daemon sees every turn end whether or not an app is connected, so it
 * computes the verdict there and parks it here. The client's job shrinks to
 * reading this map.
 */

import type { ShipVerdict } from "../shared/ship";
import { readShipVerdictHandler } from "./ship";

interface CachedVerdict {
  /** The directory the verdict was computed against. */
  readonly cwd: string;
  readonly verdict: ShipVerdict;
}

/**
 * Insertion-ordered, so the oldest agent is evicted first. Agents outlive the
 * app but not the daemon, and a verdict is worth a few kilobytes, so a cap this
 * size covers every agent a person has open.
 */
const MAX_AGENTS = 128;

const verdictsByAgent = new Map<string, CachedVerdict>();

/** One unforced computation per directory at a time. */
const inFlightByCwd = new Map<string, Promise<ShipVerdict>>();

function remember(agentId: string, cwd: string, verdict: ShipVerdict): void {
  // Delete first so a re-used agent moves to the end of the eviction order.
  verdictsByAgent.delete(agentId);
  verdictsByAgent.set(agentId, { cwd, verdict });
  while (verdictsByAgent.size > MAX_AGENTS) {
    const oldest = verdictsByAgent.keys().next();
    if (oldest.done) break;
    verdictsByAgent.delete(oldest.value);
  }
}

/**
 * Several agents can share one worktree, and a turn ending in each of them at
 * once would otherwise start the same git and lint work twice over.
 */
function computeShared(cwd: string): Promise<ShipVerdict> {
  const running = inFlightByCwd.get(cwd);
  if (running) return running;

  let pending: Promise<ShipVerdict>;
  pending = readShipVerdictHandler({ cwd }).finally(() => {
    if (inFlightByCwd.get(cwd) === pending) inFlightByCwd.delete(cwd);
  });
  inFlightByCwd.set(cwd, pending);
  return pending;
}

/** Computes a fresh verdict and stores it as this agent's cached one. */
export async function refreshAgentVerdict(
  agentId: string,
  cwd: string,
  force = false,
): Promise<ShipVerdict> {
  const verdict = force ? await readShipVerdictHandler({ cwd, force: true }) : await computeShared(cwd);
  remember(agentId, cwd, verdict);
  return verdict;
}

/** Milliseconds, or null when the timestamp is absent or unparseable. */
function instant(timestamp: string | undefined): number | null {
  if (!timestamp) return null;
  const value = Date.parse(timestamp);
  return Number.isNaN(value) ? null : value;
}

/**
 * The cached verdict, computing once on a miss.
 *
 * A stored verdict for another directory is a miss: an agent that moved is a
 * different tree, and answering with the old one would be a wrong card rather
 * than a slow one. A verdict older than `notBefore` is a miss too, which is
 * what makes the caller's ordering against the turn-end hook stop mattering:
 * whoever asks second joins the run the first one started.
 */
export async function readAgentVerdict(
  agentId: string,
  cwd: string,
  notBefore?: string,
): Promise<ShipVerdict> {
  const hit = verdictsByAgent.get(agentId);
  if (hit && hit.cwd === cwd) {
    const floor = instant(notBefore);
    const checkedAt = instant(hit.verdict.checkedAt);
    if (floor === null || checkedAt === null || checkedAt >= floor) return hit.verdict;
  }
  return refreshAgentVerdict(agentId, cwd);
}

/** Handler for `readShipVerdict`. Caches when the caller names an agent. */
export async function readShipVerdictRpc(input: {
  cwd: string;
  force?: boolean;
  agentId?: string;
}): Promise<ShipVerdict> {
  const { cwd, force = false, agentId } = input;
  if (!agentId) return readShipVerdictHandler({ cwd, force });
  return refreshAgentVerdict(agentId, cwd, force);
}

/** Handler for `readCachedShipVerdict`. */
export async function readCachedShipVerdictRpc(input: {
  agentId: string;
  cwd: string;
  notBefore?: string;
}): Promise<ShipVerdict> {
  return readAgentVerdict(input.agentId, input.cwd, input.notBefore);
}

export function clearAgentVerdicts(): void {
  verdictsByAgent.clear();
  inFlightByCwd.clear();
}
