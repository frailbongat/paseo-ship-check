/**
 * The blocker row the daemon drops into the agent timeline.
 *
 * The panel only exists while an app is on screen, so a turn that
 * ended with nobody watching left its verdict nowhere a person reads later.
 * The timeline is the one place that keeps history, so the same verdict is
 * published there as a row.
 *
 * Paseo replaces a re-appended row where it already sits rather than moving it
 * down, so one fixed id per agent meant one card frozen at the turn it first
 * appeared in, updating itself somewhere far up the scrollback. Ids are minted
 * per turn instead: a turn that has something to ship drops a fresh card under
 * that turn, and every card an earlier turn left is re-appended as `stale`,
 * which is how at most one card keeps a ship button. A re-check reuses the
 * current turn's id, so it still updates the card in place.
 */

import { z } from "zod";
import {
  ShipCheckSchema,
  type ShipVerdict,
  blockingChecks,
  branchLine,
  isReady,
  passedCount,
  verdictLine,
  warningChecks,
} from "./ship";

export const SHIP_ROW_KIND = "ship-blockers";
export const SHIP_ROW_VERSION = 1;
/** Every minted row id starts with this. `server/timeline.ts` mints them. */
export const SHIP_ROW_PREFIX = "ship-blockers";

export const ShipRowSchema = z.object({
  /** `Ready to ship`, `2 blockers`, or whatever the verdict says in one line. */
  headline: z.string(),
  /** `main → origin/main · 2 ahead`, the same line the panel shows. */
  branch: z.string(),
  /** Changed-file count plus `/ship`'s reason for the destination. */
  detail: z.string(),
  ready: z.boolean(),
  checkedAt: z.string(),
  blockers: z.array(ShipCheckSchema),
  warnings: z.array(ShipCheckSchema),
  passed: z.number(),
  /**
   * True once a later turn ended. The verdict stays on screen as that turn's
   * history; the ship button does not, because the tree it described has moved
   * on. Optional so cards appended before this field existed still parse; the
   * next turn end retires them like any other.
   */
  stale: z.boolean().default(false),
});

export type ShipRow = z.infer<typeof ShipRowSchema>;

/** The row's copy, built once on the daemon so the renderer only draws it. */
export function toShipRow(verdict: ShipVerdict): ShipRow {
  const files =
    verdict.changedFiles === 0
      ? "Nothing to ship"
      : `${verdict.changedFiles} changed file${verdict.changedFiles === 1 ? "" : "s"}`;

  return {
    headline: verdictLine(verdict),
    branch: branchLine(verdict),
    detail: verdict.destinationReason ? `${files} · ${verdict.destinationReason}` : files,
    ready: isReady(verdict),
    checkedAt: verdict.checkedAt,
    blockers: blockingChecks(verdict),
    warnings: warningChecks(verdict),
    passed: passedCount(verdict),
    stale: false,
  };
}
