/**
 * Turns the line `/ship` ends on into the card in `ship-result-card.tsx`.
 *
 * The source is the step 8 report, the last thing `/ship` does: the commit
 * hash, the subject, the branch and remote it landed on, and which checks ran
 * or why they were skipped. The agent writes it into an ordinary assistant
 * message, a token at a time, and this replaces that message with the card.
 *
 * A transformer runs on every streaming update, so the card takes the place of
 * the report while it is still being written rather than after. The `phase` the
 * host passes is no help in pacing that: Paseo reports `streaming` for a
 * loading thought and a running tool call, and `complete` for a message row
 * that is three tokens in. The parser reads the text instead.
 *
 * Only the message. A pi session with the ship extension prints the same result
 * through `ctx.ui.notify`, which lands as a `notification` row, and that row
 * cannot be transformed: the host takes `user_message`, `assistant_message`,
 * `reasoning`, `tool_call`, `todo`, `error`, and `compaction`, and rejects the
 * registration outright for anything else. `AgentTimelineItem` in the SDK is
 * wider than that list, so the mistake compiles and fails at load with
 * `invalid item type`. Under that extension the notice keeps its plain row and
 * the ship's own card is the verdict one above it.
 *
 * There is no filter on the agent, the workspace, or the provider. The parser
 * is the whole test: text that does not open a line by saying a commit was
 * shipped returns `undefined` here, and Paseo renders that message exactly as
 * it always did. That is every other message.
 */

import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SHIP_RESULT_KIND, SHIP_RESULT_VERSION, parseShipReport } from "../shared/ship-report";

export const SHIP_RESULT_TRANSFORMER_ID = "ship-result";

export function addShipResultTransformer(client: PluginClientContext): PluginCleanup {
  return client.addTimelineTransformer({
    id: SHIP_RESULT_TRANSFORMER_ID,
    query: { itemType: "assistant_message" },
    transform: ({ item }) => {
      const result = parseShipReport(item.text);
      if (!result) return undefined;
      return {
        items: [
          { type: "plugin", kind: SHIP_RESULT_KIND, version: SHIP_RESULT_VERSION, data: result },
        ],
      };
    },
  });
}
