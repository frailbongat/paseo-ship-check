/**
 * Hides the `/ship` echo from the agent timeline.
 *
 * Paseo submits a provider slash command as ordinary message text, so the ship
 * card's button and a hand-typed `/ship` both leave a user row reading `/ship`.
 * Claude Code never treats that text as conversation: `ship` is a skill in
 * `~/.claude/skills/ship`, so Claude Code runs it and the turn carries the
 * ship's own output. The row is an echo of the keystroke and nothing else,
 * which is why removing it removes no information. What ship did is in the
 * agent's closing reply and in the verdict row `server/timeline.ts` appends.
 *
 * Removing it is also the only thing that can be removed. A client slash
 * command runs plugin code and sends nothing to the agent, but `/ship` lives
 * inside the Claude Code session, so the send is how it is invoked at all.
 *
 * The cost of the echo going away is an agent with no ship skill, where
 * `/ship` arrives as an ordinary message and the model answers it. That agent
 * now shows an answer with no visible question. The README already calls the
 * skill a requirement for one-tap ship.
 */

import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { readSettings } from "./settings-store";

export const SHIP_ECHO_TRANSFORMER_ID = "ship-echo";

/**
 * The configured command can carry arguments (`/ship main`), and so can the
 * typed invocation, so both sides match on their first word. That is also what
 * covers the card's keep-open button: it sends the configured command with
 * `refs` appended, which is the same first word and so the same echo.
 *
 * A message with a line break is read as prose that happens to open with the
 * command, and stays. Both buttons send a single line, so this never hides a
 * question typed under the command.
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
