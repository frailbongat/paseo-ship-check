/**
 * Settings → Plugins → Ship check.
 *
 * Paseo owns the header, the scroll, and the centered column, so this renders
 * sections and rows and nothing else. Every successful save is also written
 * into `settings-store`, so the card already on screen sends the new command on
 * the same tap instead of on the next reload.
 *
 * The type settings carry a sample card under them, because a font and a size
 * are only worth choosing by eye. The sample is a real `ShipCard` reading the
 * same store the timeline reads, so what it shows is what the timeline will
 * show and not a second drawing that can drift from it. Its verdict is blocked,
 * which is the one shape that carries no button and therefore no agent to
 * press it against.
 */

import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsSection,
  SettingsSelect,
} from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { writeSettings } from "./settings-store";
import { ShipCard } from "./ship-card";
import {
  DEFAULT_SHIP_COMMAND,
  shipSettings,
  type CardFont,
  type CardTextSize,
  type ShipSettings,
} from "../shared/settings";
import type { ShipRow } from "../shared/timeline";

const FONT_OPTIONS: readonly { label: string; value: CardFont }[] = [
  { label: "System", value: "system" },
  { label: "Serif", value: "serif" },
  { label: "Monospace", value: "mono" },
];

const TEXT_SIZE_OPTIONS: readonly { label: string; value: CardTextSize }[] = [
  { label: "Small", value: "small" },
  { label: "Default", value: "default" },
  { label: "Large", value: "large" },
];

/** A blocked verdict, which is the card shape with no button in it. */
const SAMPLE_ROW: ShipRow = {
  headline: "1 blocker",
  branch: "main → origin/main · 2 ahead",
  detail: "3 changed files · tracking branch",
  ready: false,
  checkedAt: new Date().toISOString(),
  blockers: [
    { id: "sample-lint", label: "Lint failed", reason: "2 errors in src/ship.ts", status: "fail" },
  ],
  warnings: [
    {
      id: "sample-tests",
      label: "Tests not run since the last edit",
      reason: null,
      status: "warn",
    },
  ],
  passed: 4,
  stale: false,
};

export function SettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(shipSettings);
  const saved = settings.status === "ready" ? settings.values : null;

  // Each input owns its in-progress text, so the drafts live here and only
  // reach the document when their Save is pressed. The selects have no draft:
  // picking an option is the whole edit, so it saves on the spot.
  const [commandDraft, setCommandDraft] = useState<string | null>(null);
  const [fontDraft, setFontDraft] = useState<string | null>(null);

  const command = commandDraft ?? saved?.shipCommand ?? DEFAULT_SHIP_COMMAND;
  const trimmedCommand = command.trim();
  const commandError = trimmedCommand.length === 0 ? "The command cannot be empty." : null;
  const commandDirty = saved !== null && trimmedCommand !== saved.shipCommand;

  const fontFamily = fontDraft ?? saved?.cardFontFamily ?? "";
  const trimmedFontFamily = fontFamily.trim();
  const fontFamilyError =
    trimmedFontFamily.length > 120 ? "Keep the font family under 120 characters." : null;
  const fontFamilyDirty = saved !== null && trimmedFontFamily !== saved.cardFontFamily;

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

  /**
   * One field at a time, against the revision this client last read. `save`
   * never throws; a false return leaves `saveError` on the state, and the store
   * keeps the values the card is actually running with.
   */
  async function commit(patch: Partial<ShipSettings>): Promise<boolean> {
    if (settings.status !== "ready") return false;
    const next = { ...settings.values, ...patch };
    if (!(await settings.save(next, settings.revision))) return false;
    writeSettings(next);
    return true;
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
            onChangeText={setCommandDraft}
          />
          <SettingsAction
            label="Save ship command"
            actionLabel={settings.saving ? "Saving…" : "Save"}
            disabled={settings.saving || commandError !== null || !commandDirty}
            onPress={() => {
              void commit({ shipCommand: trimmedCommand }).then(() => setCommandDraft(null));
            }}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Card">
        <SettingsCard>
          <SettingsSelect
            label="Font"
            hint="How the verdict card is set, in the timeline and in the panel."
            value={settings.values.cardFont}
            options={FONT_OPTIONS}
            disabled={settings.saving || trimmedFontFamily.length > 0}
            onValueChange={(cardFont) => void commit({ cardFont })}
          />
          <SettingsInput
            label="Custom font family"
            hint="Overrides the choice above. A name no client can resolve falls back to its own text."
            placeholder="Leave empty to use the font above"
            initialValue={settings.values.cardFontFamily}
            error={fontFamilyError}
            disabled={settings.saving}
            onChangeText={setFontDraft}
          />
          <SettingsAction
            label="Save custom font family"
            actionLabel={settings.saving ? "Saving…" : "Save"}
            disabled={settings.saving || fontFamilyError !== null || !fontFamilyDirty}
            onPress={() => {
              void commit({ cardFontFamily: trimmedFontFamily }).then(() => setFontDraft(null));
            }}
          />
          <SettingsSelect
            label="Text size"
            hint="Scales the whole card at once, so its spacing stays in step with its text."
            value={settings.values.cardTextSize}
            options={TEXT_SIZE_OPTIONS}
            disabled={settings.saving}
            onValueChange={(cardTextSize) => void commit({ cardTextSize })}
          />
        </SettingsCard>

        <View style={{ paddingTop: 12, gap: 8 }}>
          <Text style={muted}>Preview</Text>
          <ShipCard row={SAMPLE_ROW} agentId="" theme={theme} compact={false} />
        </View>
      </SettingsSection>

      {settings.saveError ? (
        <Text style={{ color: theme.colors.statusDanger, fontSize: 13, paddingHorizontal: 4 }}>
          {settings.saveError}
        </Text>
      ) : null}
    </View>
  );
}
