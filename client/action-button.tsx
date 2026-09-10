/**
 * The button chrome the ship card and the ship panel share.
 *
 * Both surfaces draw their own buttons now, so they draw the same one: same
 * height, same radius, same icon slot, and the same rule that a busy button
 * swaps its icon for the spinner rather than growing or moving. `busy` and
 * `disabled` are separate on purpose. Busy is work this button started and
 * keeps its colour; disabled is a button that cannot act yet and goes quiet.
 *
 * Reach for `busy` only when nothing else on screen reports the work. The
 * re-check qualifies: it is an RPC nobody else can see. The ship does not, and
 * uses `disabled` while its turn runs, because Paseo's own stream footer is
 * already spinning for it.
 */

import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Pressable, Text } from "react-native";
import { Spinner } from "./spinner";

export interface ActionButtonProps {
  theme: PluginTheme;
  /** `primary` is the one action a surface wants pressed; `quiet` is the rest. */
  tone: "primary" | "quiet";
  /** Lucide icon name, replaced by the spinner while the button is busy. */
  icon: string;
  label: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
  busy?: boolean;
  disabled?: boolean;
  /** Fill the row, which is what the card wants once it stacks on a phone. */
  stretch?: boolean;
  onPress: () => void;
}

export function ActionButton({
  theme,
  tone,
  icon,
  label,
  accessibilityLabel,
  accessibilityHint,
  busy = false,
  disabled = false,
  stretch = false,
  onPress,
}: ActionButtonProps) {
  const inert = disabled || busy;
  // A busy primary button keeps the accent: the work is running, not refused.
  const filled = tone === "primary" && !(disabled && !busy);
  const quiet = disabled && !busy;

  const background = filled ? theme.colors.accent : theme.colors.surface2;
  const foreground = filled
    ? theme.colors.accentForeground
    : quiet
      ? theme.colors.foregroundMuted
      : theme.colors.foreground;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      accessibilityState={{ disabled: inert, busy }}
      disabled={inert}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        minHeight: 34,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: filled ? theme.colors.accent : theme.colors.border,
        backgroundColor: background,
        alignSelf: stretch ? "stretch" : "flex-start",
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {busy ? (
        <Spinner color={foreground} trackColor={background} size={14} />
      ) : (
        <Icon name={icon} size={14} color={foreground} />
      )}
      <Text style={{ color: foreground, fontSize: 13, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}
