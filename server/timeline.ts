/**
 * Publishing the verdict as a timeline card.
 *
 * The daemon already computes a verdict when a turn ends, so this only has to
 * hand it to the agent's timeline. The rest of this file is about *where* it
 * lands: Paseo replaces a re-appended row at the index it already occupies, so
 * a single fixed id would leave one card parked at the turn it first appeared
 * in, quietly updating itself out of view.
 *
 * So a turn that has something to ship gets its own id, which puts a card under
 * the turn the reader is looking at. Every card an earlier turn left is
 * re-appended as `stale` first, which is what takes the ship button off it: two
 * cards offering to ship two different snapshots of the tree is the one thing
 * this must never do. A re-check reuses the current id, so it corrects the live
 * card in place rather than stacking another.
 *
 * The cards to retire come from the turn-end event's own timeline snapshot
 * rather than from anything remembered here. A plugin reload forgets its ids
 * while the daemon keeps the rows, so a map alone would strand a card with a
 * live button and no way to reach it.
 */

import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { type ShipVerdict, hasVerdict } from "../shared/ship";
import {
  SHIP_ROW_KIND,
  SHIP_ROW_PREFIX,
  SHIP_ROW_VERSION,
  type ShipRow,
  ShipRowSchema,
  toShipRow,
} from "../shared/timeline";

/** The SDK the daemon hands every handler and hook. */
type Paseo = PluginHandlerContext["paseo"];

interface ShipCard {
  id: string;
  data: ShipRow;
}

/** The card each agent's current turn is writing to, so a re-check can find it. */
const currentRowIds = new Map<string, string>();

/**
 * Ids must stay unique for the life of the daemon's timeline, which outlives
 * this plugin's process. A counter alone would restart at 1 after a reload and
 * silently overwrite a card from before it, so the mint carries the clock too.
 */
let minted = 0;
function mintRowId(): string {
  minted += 1;
  return `${SHIP_ROW_PREFIX}-${Date.now()}-${minted}`;
}

/**
 * Every ship card in this timeline that still offers a ship.
 *
 * Each append is its own row in the daemon's store and the app collapses them
 * by id, so one card can appear several times here. The last entry for an id is
 * the one on screen, which is why this keeps that one and judges `stale` from
 * it: retiring an already-retired card would cost an append on every turn.
 */
function liveShipCards(timeline: readonly unknown[]): ShipCard[] {
  const latest = new Map<string, ShipRow>();

  for (const entry of timeline) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as { type?: unknown; kind?: unknown; id?: unknown; data?: unknown };
    if (item.type !== "plugin" || item.kind !== SHIP_ROW_KIND) continue;
    if (typeof item.id !== "string" || !item.id.startsWith(SHIP_ROW_PREFIX)) continue;
    const parsed = ShipRowSchema.safeParse(item.data);
    if (!parsed.success) continue;
    latest.set(item.id, parsed.data);
  }

  return [...latest].filter(([, data]) => !data.stale).map(([id, data]) => ({ id, data }));
}

async function appendRow(
  paseo: Paseo,
  agentId: string,
  id: string,
  data: ShipRow,
): Promise<boolean> {
  try {
    await paseo.agents.ref(agentId).timeline.append({
      type: "plugin",
      id,
      kind: SHIP_ROW_KIND,
      version: SHIP_ROW_VERSION,
      data,
    });
    return true;
  } catch (error) {
    // A daemon without `features.pluginTimelineItems` refuses the append, and
    // that must not take the verdict itself down with it: the panel still works
    // on a host that cannot carry the card.
    console.error("[paseo-ship-check] could not append the ship card", error);
    return false;
  }
}

export interface PublishShipRowOptions {
  /**
   * True for a turn that just ended, which is the only thing allowed to retire
   * cards and start a new one. A re-check is a correction to the card already
   * on screen.
   */
  fresh: boolean;
  /** The turn-end timeline snapshot. The only place older cards can be found. */
  timeline?: readonly unknown[];
}

export async function publishShipRow(
  paseo: Paseo,
  agentId: string,
  verdict: ShipVerdict,
  { fresh, timeline = [] }: PublishShipRowOptions,
): Promise<void> {
  if (!verdict.isRepo) return;
  const row = toShipRow(verdict);

  if (fresh) {
    // Every card older than this turn goes read-only, whether or not this turn
    // publishes one of its own. A card that keeps its button after the tree
    // moved on is an offer to ship something nobody checked.
    for (const card of liveShipCards(timeline)) {
      await appendRow(paseo, agentId, card.id, { ...card.data, stale: true });
    }
    currentRowIds.delete(agentId);

    // A clean tree has nothing to report, so no card is published at all and
    // the turn passes in silence.
    if (!hasVerdict(verdict)) return;

    const id = mintRowId();
    if (await appendRow(paseo, agentId, id, row)) currentRowIds.set(agentId, id);
    return;
  }

  // A re-check, which belongs to the turn already on screen. It corrects that
  // card even when the answer is now `Nothing to ship`, because that card is
  // the present rather than history.
  const currentId = currentRowIds.get(agentId);
  if (!currentId && !hasVerdict(verdict)) return;
  const id = currentId ?? mintRowId();
  if (await appendRow(paseo, agentId, id, row)) currentRowIds.set(agentId, id);
}

export function clearPublishedRows(): void {
  currentRowIds.clear();
}
