/**
 * Settings → Plugins → Ship check.
 *
 * Paseo owns the header, the scroll, and the centered column, so this renders
 * sections and rows and nothing else. Every successful save is also written
 * into `settings-store`, so the card already on screen sends the new command on
 * the same tap instead of on the next reload.
 */

import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { writeSettings } from "./settings-store";
import { DEFAULT_SHIP_COMMAND, shipSettings } from "../shared/settings";

export function SettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(shipSettings);
  const saved = settings.status === "ready" ? settings.values : null;

  // The input owns its in-progress text, so the draft lives here and only
  // reaches the document when Save is pressed.
  const [draft, setDraft] = useState<string | null>(null);
  const command = draft ?? saved?.shipCommand ?? DEFAULT_SHIP_COMMAND;
  const trimmed = command.trim();
  const commandError = trimmed.length === 0 ? "The command cannot be empty." : null;
  const commandDirty = saved !== null && trimmed !== saved.shipCommand;

  // A document changed on another client arrives here, so the store follows it
  // whenever this screen is open.
  useEffect(() => {
    if (saved) writeSettings(saved);
  }, [saved]);

  const muted = { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 18 };

  if (settings.status !== "ready") {
    return (
      <View style={{ gap: 12, paddingVertical: 12 }}>
        <Text style={muted}>
          {settings.status === "loading"
            ? "Loading settings…"
            : `Settings unavailable: ${settings.error}`}
        </Text>
        {settings.status === "invalid" || settings.status === "error" ? (
          <SettingsCard>
            <SettingsAction
              label="Restore defaults"
              hint="Replaces the stored document with the values this plugin shipped with."
              actionLabel="Reset"
              disabled={settings.saving}
              onPress={() => void settings.reset()}
            />
          </SettingsCard>
        ) : null}
      </View>
    );
  }

  async function save(): Promise<void> {
    if (settings.status !== "ready") return;
    const next = { ...settings.values, shipCommand: trimmed };
    // `save` never throws; a false return leaves `saveError` on the state, and
    // the store keeps the value the card is actually running with.
    if (await settings.save(next, settings.revision)) writeSettings(next);
    setDraft(null);
  }

  return (
    <View style={{ gap: 4 }}>
      <SettingsSection title="Ship">
        <SettingsCard>
          <SettingsInput
            label="Ship command"
            hint="Sent to the agent as ordinary message text when you press Ship on the timeline card."
            placeholder={DEFAULT_SHIP_COMMAND}
            initialValue={settings.values.shipCommand}
            error={commandError}
            disabled={settings.saving}
            onChangeText={setDraft}
          />
          <SettingsAction
            label="Save ship command"
            actionLabel={settings.saving ? "Saving…" : "Save"}
            disabled={settings.saving || commandError !== null || !commandDirty}
            onPress={() => void save()}
          />
        </SettingsCard>
      </SettingsSection>

      {settings.saveError ? (
        <Text style={{ color: theme.colors.statusDanger, fontSize: 13, paddingHorizontal: 4 }}>
          {settings.saveError}
        </Text>
      ) : null}
    </View>
  );
}
