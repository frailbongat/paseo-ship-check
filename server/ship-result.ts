/**
 * The ship report the daemon has to fetch, because the client cannot reach it.
 *
 * `client/ship-result.ts` replaces the step 8 report where the agent wrote it
 * as a message. Under the pi ship extension there is no such message: `/ship`
 * reports through `ctx.ui.notify`, which lands as a `notification` row, and a
 * timeline transformer may not select one. The app takes `user_message`,
 * `assistant_message`, `reasoning`, `tool_call`, `todo`, `error`, and
 * `compaction`, and rejects the registration outright for anything else.
 *
 * The daemon is not held to that list. A turn-end hook already receives the
 * agent's timeline, notices and all, so the report is read there and published
 * as a plugin row through the same renderer the message path uses.
 *
 * What this cannot do is take the notice away. No 0.8 API removes or rewrites a
 * row the provider wrote, so a printed report keeps its plain line and the card
 * lands beneath it. The extension's answer is not to print one: under Paseo,
 * with this plugin enabled, it writes the report to a file instead, and
 * `ship-handoff.ts` reads it here. That file is checked first, because when it
 * exists there is no notice on the timeline to find.
 *
 * One card per commit, ever. The hook's snapshot carries every notice the
 * conversation has collected, so the row id is minted from the hash and a hash
 * already on the timeline is left alone: an agent that ships five times gets
 * five cards, each once, rather than five more on every turn that follows.
 */

import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { takeHandedOffReport } from "./ship-handoff";
import {
  SHIP_RESULT_KIND,
  SHIP_RESULT_VERSION,
  type ShipResult,
  parseShipReport,
} from "../shared/ship-report";
import { SHIP_PLUGIN_ID } from "../shared/timeline";

type Paseo = PluginHandlerContext["paseo"];

/** `ship-result-fcbee6b`, which is the commit and therefore the card. */
function resultRowId(result: ShipResult): string {
  return `${SHIP_RESULT_KIND}-${result.sha}`;
}

/**
 * The text of every row `/ship` could have reported through.
 *
 * A notice is the ordinary ending. An error row is the one where the push
 * failed, which is the run whose hash a reader most needs, and it is worth the
 * same card. Nothing else is read: an assistant message that carries the report
 * is the client transformer's, and publishing it here too would draw the card
 * twice.
 */
function reportedText(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const row = item as { type?: unknown; level?: unknown; message?: unknown };
  if (row.type === "notification" && row.level === "info" && typeof row.message === "string") {
    return row.message;
  }
  if (row.type === "error" && typeof row.message === "string") return row.message;
  return null;
}

/** Cards this plugin has already published into this timeline. */
function publishedResults(timeline: readonly unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of timeline) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as { type?: unknown; kind?: unknown; id?: unknown; pluginId?: unknown };
    if (item.type !== "plugin" || item.kind !== SHIP_RESULT_KIND) continue;
    // A row another plugin owns cannot be replaced from here, so counting it as
    // published is the only way not to stack a duplicate under this name.
    if (typeof item.pluginId === "string" && item.pluginId !== SHIP_PLUGIN_ID) continue;
    if (typeof item.id === "string") ids.add(item.id);
  }
  return ids;
}

/**
 * Publish a card for the ship this turn reported, if it reported one.
 *
 * Only the newest report in the snapshot is considered. An older one belongs to
 * a turn that has scrolled by, and a card for it would land at the bottom of
 * the timeline under work it has nothing to do with.
 */
export async function publishShipResult(
  paseo: Paseo,
  agentId: string,
  timeline: readonly unknown[],
): Promise<void> {
  // The handed-off report is this turn's by construction, and it is consumed as
  // it is read, so an unchanged timeline cannot replay it on the next turn.
  const handedOff = await takeHandedOffReport(agentId);
  let newest: ShipResult | null = handedOff;
  for (const entry of handedOff ? [] : timeline) {
    const text = reportedText(entry);
    if (!text) continue;
    // A notice is posted in one piece, so nothing here is half-written and the
    // parser's own patience over a growing message costs nothing.
    const parsed = parseShipReport(text);
    if (parsed) newest = parsed;
  }
  if (!newest) return;

  const id = resultRowId(newest);
  if (publishedResults(timeline).has(id)) return;

  try {
    await paseo.agents.ref(agentId).timeline.append({
      type: "plugin",
      id,
      kind: SHIP_RESULT_KIND,
      version: SHIP_RESULT_VERSION,
      data: newest,
    });
  } catch (error) {
    // A daemon without `features.pluginTimelineItems` refuses the append. The
    // verdict card published next must still get its turn.
    console.error("[paseo-ship-check] could not append the ship result card", error);
  }
}
