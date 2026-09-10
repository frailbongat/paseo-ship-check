/**
 * Hides the `/ship` echo from the agent timeline.
 *
 * Paseo submits a provider slash command as ordinary message text, so the ship
 * card's button and a hand-typed `/ship` both leave a user row reading `/ship`.
 * pi never
 * treats that text as conversation: the ship extension registers `ship` as a
 * command, so pi runs it and the turn carries the ship's own output. The row is
 * an echo of the keystroke and nothing else, which is why removing it removes
 * no information. What ship did is in the notices it posts and in the verdict
 * row `server/timeline.ts` appends.
 *
 * Removing it is also the only thing that can be removed. A client slash
 * command runs plugin code and sends nothing to the agent, but `/ship` lives
 * inside the pi session, so the send is how it is invoked at all.
 *
 * The cost of the echo going away is an agent with no ship extension, where
 * `/ship` arrives as an ordinary message and the model answers it. That agent
 * now shows an answer with no visible question. The README already calls the
 * extension a requirement for one-tap ship.
 */

import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { readSettings } from "./settings-store";

export const SHIP_ECHO_TRANSFORMER_ID = "ship-echo";

/**
 * The configured command can carry arguments (`/ship main`), and so can the
 * typed invocation, so both sides match on their first word.
 *
 * A message with a line break is prose that happens to open with the command,
 * never an invocation: pi reads a command off a single line.
 */
export function isShipInvocation(text: string, shipCommand: string): boolean {
  const name = shipCommand.trim().split(/\s+/, 1)[0];
  if (!name) return false;
  const trimmed = text.trim();
  if (trimmed.includes("\n")) return false;
  return trimmed.split(/\s+/, 1)[0] === name;
}

export function addShipEchoTransformer(client: PluginClientContext): PluginCleanup {
  return client.addTimelineTransformer({
    id: SHIP_ECHO_TRANSFORMER_ID,
    query: { itemType: "user_message" },
    // Synchronous and deterministic, as a transformer must be: `readSettings`
    // is the client-side cache, not a fetch.
    transform: ({ item }) =>
      isShipInvocation(item.text, readSettings().shipCommand) ? { items: [] } : undefined,
  });
}
