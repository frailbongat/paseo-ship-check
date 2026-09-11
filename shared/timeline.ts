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
import { ShipResultSchema } from "./ship-report";
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
/**
 * This plugin's own id, which must match `paseo-plugin.json`.
 *
 * The daemon stamps `pluginId` on every row it accepts and keys rows by that
 * plus the row id, so an append only replaces a row the same plugin wrote. A
 * second plugin publishing this `kind`, which is what an older build of this
 * code left behind when the ship check moved into its own plugin, owns a
 * parallel set of ids. Re-appending one of those ids from here retires nothing:
 * it writes a new row under this plugin's name, which is how one card per turn
 * became a screenful.
 */
export const SHIP_PLUGIN_ID = "paseo-ship-check";

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
  /**
   * The ship this card's own verdict led to, once it happened.
   *
   * A ready verdict and the ship it produced are one thing in two states, so
   * the second is written back onto the first rather than appended under it:
   * the card the reader pressed turns into the report of what that press did,
   * in place. Every earlier card stays where it is, so history still reads as
   * history. Absent on a card whose turn never shipped, which is most of them.
   */
  shipped: ShipResultSchema.nullish().transform((value) => value ?? null),
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
    shipped: null,
  };
}
