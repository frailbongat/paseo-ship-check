import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SettingsScreen } from "./client/settings-screen";
import { startSettingsSync } from "./client/settings-sync";
import { runShipCheck } from "./client/ship-actions";
import { addShipEchoTransformer } from "./client/ship-echo";
import { SHIP_PANEL_ID, ShipPanel } from "./client/ship-panel";
import { ShipRowItem } from "./client/ship-row";
import { clearAllVerdicts, clearVerdict } from "./client/ship-store";
import { SHIP_ROW_KIND, SHIP_ROW_VERSION, ShipRowSchema } from "./shared/timeline";

const SETTINGS_SCREEN_ID = "settings";

export default function contribute(client: PluginClientContext) {
  client.addSettingsScreen({
    id: SETTINGS_SCREEN_ID,
    title: "Ship check",
    icon: "SlidersHorizontal",
    Component: SettingsScreen,
  });
  client.addWorkspacePanel({
    id: SHIP_PANEL_ID,
    title: "Ship check",
    icon: "Ship",
    context: "agent",
    Component: ShipPanel,
  });
  // Draws the verdict card the daemon appends when a turn ends, which is also
  // where the ship button lives. Registered whether or not this client ever
  // runs a check, because the row can arrive from a turn that finished while
  // this app was closed.
  // Drops the `/ship` echo the send leaves behind. Registered next to the
  // renderer because the two are one story: the echo goes, the verdict row
  // stays.
  addShipEchoTransformer(client);
  client.addTimelineRenderer({
    kind: SHIP_ROW_KIND,
    version: SHIP_ROW_VERSION,
    schema: ShipRowSchema,
    Component: ShipRowItem,
  });
  client.addCommandCenterItem({
    id: "ship-recheck",
    title: "Re-check ship readiness",
    icon: "Ship",
    context: "agent",
    keywords: ["ship", "blockers", "lint", "git"],
    async onSelect(context) {
      // Force past the quality cache and store the result as this agent's
      // cached verdict, then let the panel render the result it just warmed.
      await runShipCheck(context, context.agent.id, context.agent.cwd);
      context.openPanel(SHIP_PANEL_ID);
    },
  });
  // The same re-check from the composer. The Command Center item opens the
  // panel because the user went looking for the verdict; this one is typed
  // mid-message, so it leaves the composer where it was and lets the timeline
  // card carry the answer.
  client.addSlashCommand({
    name: "ship-check",
    description: "Re-run the ship check for this agent",
    argumentHint: "[no arguments]",
    context: "agent",
    async onSubmit(context) {
      await runShipCheck(context, context.agent.id, context.agent.cwd);
    },
  });
  client.addCommandCenterItem({
    id: "ship-settings",
    title: "Ship check settings",
    icon: "SlidersHorizontal",
    context: "global",
    keywords: ["ship", "settings", "command"],
    onSelect({ openSettings }) {
      openSettings(SETTINGS_SCREEN_ID);
    },
  });

  const stopSettingsSync = startSettingsSync(client);

  // The verdict store is keyed by agent and nothing else prunes it: the panel
  // and `/ship-check` only ever write. An agent that goes away has to leave it.
  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "remove") clearVerdict(update.agentId);
  });

  return () => {
    stopSettingsSync();
    unsubscribe();
    clearAllVerdicts();
  };
}
