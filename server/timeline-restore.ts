/**
 * Putting the card back after Paseo rebuilds a timeline.
 *
 * A plugin row lives in the daemon's in-memory timeline and nowhere else.
 * Reloading an agent, and opening one the daemon has since unloaded, both throw
 * that store away and re-stream the provider's own history in its place: user
 * messages, assistant messages, tool calls, notices. The ship card is in none of
 * that, so a reloaded chat comes back without it and the next turn end is the
 * earliest anything would draw it again.
 *
 * Nothing announces the rebuild. `agent.timeline.replacement` is minted by
 * rewind alone, and a resume or a reload says nothing at all. What the daemon
 * does offer is `agent.session_open`, which fires for every reason a session is
 * opened, so the card is republished off the open that causes the rebuild.
 *
 * The waiting is the whole difficulty. That hook runs *before* the wipe, so a
 * fetch taken at that moment answers with the timeline that is about to be
 * discarded, and a card appended there goes down with it. Two consecutive
 * fetches that agree on epoch and last sequence mean the rebuild has stopped
 * moving, which is as close to a finish signal as this gets. The append is
 * checked afterwards regardless: a wipe that landed late takes the card, and the
 * card is then published once more.
 */

import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { refreshAgentVerdict } from "./ship-cache";
import { publishShipRow } from "./timeline";
import { SHIP_ROW_KIND } from "../shared/timeline";

/** The SDK the daemon hands every handler and hook. */
type Paseo = PluginHandlerContext["paseo"];

/** How often the rebuild is looked at, and how long it is given to finish. */
const POLL_MS = 750;
const SETTLE_TIMEOUT_MS = 30_000;
/** The grace a late wipe gets to eat the card before it is published again. */
const VERIFY_DELAY_MS = 4_000;
/** Cards live at the tail, and one page of it is more than enough to find them. */
const PAGE_LIMIT = 200;

/** Agents with a restore already running, so one open does the work once. */
const restoring = new Set<string>();

/**
 * Bumped on unload. A restore spends most of its life asleep, so the flag is
 * what stops a poll loop from outliving the plugin that started it.
 */
let generation = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface TimelinePage {
  epoch: string;
  lastSeq: number;
  items: readonly unknown[];
}

async function readTimeline(paseo: Paseo, agentId: string): Promise<TimelinePage | null> {
  try {
    const page = await paseo.agents.ref(agentId).timeline.refetch({
      direction: "tail",
      limit: PAGE_LIMIT,
    });
    return {
      epoch: page.epoch,
      lastSeq: page.window.maxSeq,
      items: page.entries.map((entry) => entry.item),
    };
  } catch {
    // An agent still opening, or one that went away while this waited. Neither
    // is worth a log line on a poll that runs twice a second.
    return null;
  }
}

/**
 * The timeline once it stops changing, or `null` if it never does.
 *
 * A failed read resets the comparison rather than ending it: the agent is
 * mid-open, which is the state this is waiting out.
 */
async function settledTimeline(paseo: Paseo, agentId: string): Promise<TimelinePage | null> {
  const mine = generation;
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let previous: TimelinePage | null = null;

  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    if (generation !== mine) return null;
    const page = await readTimeline(paseo, agentId);
    if (!page) {
      previous = null;
      continue;
    }
    if (previous && previous.epoch === page.epoch && previous.lastSeq === page.lastSeq) return page;
    previous = page;
  }
  return null;
}

function hasRow(items: readonly unknown[], rowId: string): boolean {
  return items.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as { type?: unknown; kind?: unknown; id?: unknown };
    return item.type === "plugin" && item.kind === SHIP_ROW_KIND && item.id === rowId;
  });
}

/**
 * Republish this agent's verdict card once its timeline has been rebuilt.
 *
 * The verdict is computed fresh rather than read from the cache, because the
 * tree can have moved while the daemon was not watching, and a card that offers
 * to ship a state nobody checked is the one thing this plugin must not draw. The
 * quality cache keys on the tree's own dirty state, so an unchanged worktree
 * pays for git and nothing else.
 */
export async function restoreShipRow(paseo: Paseo, agentId: string, cwd: string): Promise<void> {
  if (!cwd.trim() || restoring.has(agentId)) return;
  restoring.add(agentId);
  const mine = generation;

  try {
    const settled = await settledTimeline(paseo, agentId);
    if (!settled || generation !== mine) return;

    const verdict = await refreshAgentVerdict(agentId, cwd);
    // `fresh`, so the card lands at the bottom of the rebuilt timeline and any
    // card that did survive is retired: one ship button, on the newest verdict.
    const rowId = await publishShipRow(paseo, agentId, verdict, {
      fresh: true,
      timeline: settled.items,
    });
    // Nothing to ship, so nothing was published and nothing is missing.
    if (!rowId) return;
    console.log(`[ship] ${agentId}: card restored after the timeline was rebuilt`);

    await sleep(VERIFY_DELAY_MS);
    if (generation !== mine) return;
    const after = await readTimeline(paseo, agentId);
    // A read that failed says nothing about the card, and a card that is there
    // needs no help. Only a timeline that came back without it gets a second
    // append.
    if (!after || hasRow(after.items, rowId)) return;
    await publishShipRow(paseo, agentId, verdict, { fresh: true, timeline: after.items });
  } catch (error) {
    console.error("[paseo-ship-check] could not restore the ship card", error);
  } finally {
    restoring.delete(agentId);
  }
}

export function clearShipRowRestores(): void {
  generation += 1;
  restoring.clear();
}
