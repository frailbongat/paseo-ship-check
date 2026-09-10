/**
 * The ship-readiness contract, shared by the daemon handler and the client.
 *
 * `kind` and `version` are part of the payload rather than implied by the RPC
 * name, so a client running an older bundle can refuse a verdict it does not
 * understand instead of rendering half of it. Bump `SHIP_VERDICT_VERSION` on
 * any breaking change to the shape below.
 */

import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const SHIP_VERDICT_KIND = "ship-verdict";
export const SHIP_VERDICT_VERSION = 1;

/**
 * `fail` blocks the ship. `warn` is something `/ship` handles by itself, such
 * as rebasing onto a trunk that moved, and is shown without blocking. `skip`
 * is a check that did not apply. Only `fail` and `warn` rows are ever printed.
 */
export const ShipCheckStatusSchema = z.enum(["pass", "warn", "fail", "skip"]);

export const ShipCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: ShipCheckStatusSchema,
  /** One line, present only for `warn` and `fail`. */
  reason: z.string().nullable(),
});

export type ShipCheck = z.infer<typeof ShipCheckSchema>;

export const ShipVerdictSchema = z.object({
  kind: z.literal(SHIP_VERDICT_KIND),
  version: z.literal(SHIP_VERDICT_VERSION),
  checkedAt: z.string(),
  cwd: z.string(),
  /** False when the directory is not inside a git work tree. Render nothing. */
  isRepo: z.boolean(),
  branch: z.string().nullable(),
  /** Where `/ship` would push, as `origin/<ref>`. */
  base: z.string().nullable(),
  destinationKind: z.enum(["trunk", "branch"]).nullable(),
  /** `/ship`'s own words for why it picked that destination. */
  destinationReason: z.string().nullable(),
  /** Commits on HEAD that `origin/<base>` does not have. */
  ahead: z.number(),
  /** Commits on `origin/<base>` that HEAD does not have. */
  behind: z.number(),
  /** Files `/ship` would stage. Zero means there is nothing to ship. */
  changedFiles: z.number(),
  checks: z.array(ShipCheckSchema),
  /** True when the quality rows were reused rather than re-run. */
  qualityFromCache: z.boolean(),
  error: z.string().nullable(),
});

export type ShipVerdict = z.infer<typeof ShipVerdictSchema>;

/**
 * Compute a verdict now. The manual re-check and the Command Center item use
 * this; nothing else should, because it pays for git and the quality tools.
 * Passing `agentId` also stores the result as that agent's cached verdict, so a
 * re-check moves the card and the panel together.
 */
export const readShipVerdict = defineRpc({
  name: "ship.verdict.read",
  input: z.object({
    cwd: z.string(),
    /** Bypass the quality cache. The manual re-check sets this. */
    force: z.boolean().optional(),
    /** Store the result as this agent's cached verdict. */
    agentId: z.string().optional(),
  }),
  output: ShipVerdictSchema,
});

/**
 * Read the verdict the daemon computed when this agent's last turn ended.
 *
 * The daemon owns the schedule, so this is a map lookup in the common case and
 * answers instantly however long the app was away. A miss, which is an agent
 * that has not finished a turn since the daemon started, computes once and
 * caches, so the first look still fills the card.
 *
 * `notBefore` is the agent's last activity. The daemon's turn-end hook and this
 * read race each other by nature, so rather than guess who won, the caller
 * states the moment its answer has to be newer than and the daemon either
 * serves a verdict that clears it, joins the run already in flight, or starts
 * one. That also covers a turn-end computation that failed.
 */
export const readCachedShipVerdict = defineRpc({
  name: "ship.verdict.cached",
  input: z.object({
    agentId: z.string(),
    cwd: z.string(),
    notBefore: z.string().optional(),
  }),
  output: ShipVerdictSchema,
});

export function blockingChecks(verdict: ShipVerdict): ShipCheck[] {
  return verdict.checks.filter((check) => check.status === "fail");
}

export function warningChecks(verdict: ShipVerdict): ShipCheck[] {
  return verdict.checks.filter((check) => check.status === "warn");
}

export function passedCount(verdict: ShipVerdict): number {
  return verdict.checks.filter((check) => check.status === "pass").length;
}

/**
 * Ready means every check `/ship` would run came back clean. A check that
 * could not be determined is recorded as a failure, never quietly dropped, so
 * this can only be true when the branch really would ship.
 */
export function isReady(verdict: ShipVerdict): boolean {
  return (
    verdict.isRepo &&
    verdict.error === null &&
    verdict.changedFiles > 0 &&
    blockingChecks(verdict).length === 0
  );
}

/** True when there is anything worth putting on screen at all. */
export function hasVerdict(verdict: ShipVerdict | null): verdict is ShipVerdict {
  return verdict !== null && verdict.isRepo && verdict.changedFiles > 0;
}

export function verdictLine(verdict: ShipVerdict): string {
  if (isReady(verdict)) return "Ready to ship";
  const count = blockingChecks(verdict).length;
  if (count > 0) return `${count} blocker${count === 1 ? "" : "s"}`;
  if (verdict.error) return verdict.error;
  return verdict.changedFiles === 0 ? "Nothing to ship" : "Not checked";
}

/** `main → origin/main · 2 ahead` for the panel's second line. */
export function branchLine(verdict: ShipVerdict): string {
  const parts: string[] = [];
  parts.push(verdict.branch ?? "detached HEAD");
  if (verdict.base) parts.push(`→ ${verdict.base}`);
  const counts: string[] = [];
  if (verdict.ahead > 0) counts.push(`${verdict.ahead} ahead`);
  if (verdict.behind > 0) counts.push(`${verdict.behind} behind`);
  const head = parts.join(" ");
  return counts.length > 0 ? `${head} · ${counts.join(", ")}` : head;
}
