import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  clearAgentVerdicts,
  readCachedShipVerdictRpc,
  readShipVerdictRpc,
  refreshAgentVerdict,
} from "./server/ship-cache";
import { clearQualityCache } from "./server/ship";
import { publishShipResult } from "./server/ship-result";
import { clearPublishedRows, publishShipRow } from "./server/timeline";
import { clearShipRowRestores, restoreShipRow } from "./server/timeline-restore";
import { shipSettings } from "./shared/settings";
import { readCachedShipVerdict, readShipVerdict, verdictLine } from "./shared/ship";

export default function contribute(server: PluginServerContext) {
  // Registers the daemon-side document plus its read/write/reset RPCs, which is
  // what `useSettings` in the screen and `settingsRpc` in `settings-sync` both
  // talk to.
  server.registerSettings(shipSettings);

  // A named agent is a re-check the user asked for, from the panel, the Command
  // Center, or `/ship-check`, so its result also refreshes that agent's
  // timeline row.
  server.handle(readShipVerdict, async (input, context) => {
    const verdict = await readShipVerdictRpc(input);
    // Never `fresh`: a re-check corrects the card the current turn published
    // instead of dropping a second one below it.
    if (input.agentId) {
      await publishShipRow(context.paseo, input.agentId, verdict, { fresh: false });
    }
    return verdict;
  });
  server.handle(readCachedShipVerdict, (input) => readCachedShipVerdictRpc(input));

  // The end of a turn is the moment the tree stops moving, and the daemon sees
  // it whether or not an app is connected. Computing here is what lets the card
  // and the panel show a finished verdict the instant they are on screen.
  const stopWatchingTurns = server.on("agent.turn_ended", async (event, context) => {
    const { id, cwd } = event.agent;
    if (!cwd.trim()) return;
    try {
      // What `/ship` said it did, before what the tree says is left. The report
      // is a row the client cannot transform, so the card for it is published
      // from here; a turn that shipped nothing finds nothing to publish.
      await publishShipResult(context.paseo, id, event.timeline);
      // Never forced: the quality cache key already carries the tree's dirty
      // state, so a turn that changed nothing reuses the previous run.
      const verdict = await refreshAgentVerdict(id, cwd);
      if (verdict.isRepo) console.log(`[ship] ${id}: ${verdictLine(verdict)}`);
      // The card lands under the turn that just finished, and every card an
      // earlier turn left goes read-only, so at most one card offers a ship.
      // `event.timeline` is where those older cards are found: this process may
      // never have appended them.
      await publishShipRow(context.paseo, id, verdict, {
        fresh: true,
        timeline: event.timeline,
      });
    } catch (error) {
      console.error("[paseo-ship-check] turn-end ship verdict failed", error);
    }
  });

  // Opening an agent the daemon has unloaded, and reloading one it still has,
  // both rebuild the timeline out of the provider's own history and drop every
  // plugin row with it. Nothing reports that, so the card is republished off the
  // session open that causes it.
  const stopWatchingOpens = server.before("agent.session_open", ({ request }, context) => {
    // An archived agent is opened for reading, and a created one has no card to
    // lose: its first turn end publishes one.
    if (request.purpose !== "interactive") return;
    if (request.reason !== "resume" && request.reason !== "refresh") return;
    // Deliberately not awaited. The session is held open until this hook
    // returns, and the rebuild it is waiting on has not started yet.
    void restoreShipRow(context.paseo, request.agentId, request.cwd);
  });

  return () => {
    stopWatchingTurns();
    stopWatchingOpens();
    clearShipRowRestores();
    clearPublishedRows();
    clearAgentVerdicts();
    clearQualityCache();
  };
}
