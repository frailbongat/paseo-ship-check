/**
 * The forced re-check, in one place.
 *
 * The Command Center item and the `/ship-check` slash command are two ways to
 * ask the same question, so they share the call and the write into the verdict
 * store. Whoever asks, the panel and the timeline card move together: the store
 * wakes the panel, and the daemon re-appends the row under the same id.
 */

import type { PluginCommandCapabilities } from "@getpaseo/plugin/client";
import { writeVerdict } from "./ship-store";
import { type ShipVerdict, readShipVerdict } from "../shared/ship";

/**
 * `caps` is anything carrying Paseo's `rpc`: the client context outside React,
 * or the callback context a command or slash command receives. It is passed
 * whole rather than as a bare method so the call keeps its receiver.
 */
export async function runShipCheck(
  caps: PluginCommandCapabilities,
  agentId: string,
  cwd: string,
): Promise<ShipVerdict> {
  // `force` skips the quality cache and `agentId` stores the answer as this
  // agent's cached verdict, so the next panel read sees this run.
  const verdict = await caps.rpc(readShipVerdict, { cwd, force: true, agentId });
  writeVerdict(agentId, verdict);
  return verdict;
}
