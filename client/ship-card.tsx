/**
 * The ship card: one verdict, drawn once.
 *
 * The timeline row the daemon appends and the ship panel both render this, so
 * the two can never disagree about what a verdict looks like. The card also
 * carries the ship itself. That trigger used to be a composer pill, which put
 * the button at the bottom of the window and the reasons it was disabled
 * somewhere else entirely. Here the verdict and its one action are the same
 * object.
 *
 * A card whose turn has passed keeps its button and greys it out. The slot
 * stays filled, so the row reads the same everywhere and the difference between
 * history and the live card is a state rather than a different layout. It
 * cannot be pressed: the verdict is still true for that turn, but the tree it
 * described has moved on, so shipping from it would ship something the reader
 * never checked.
 *
 * The button draws no progress of its own. The command it sends starts an
 * ordinary turn, and Paseo already reports a running turn in the stream footer,
 * so a second spinner on the card would only be the same news twice. The button
 * goes inert instead: pressed once, disabled until that turn ends, back when
 * there is something to press it for again.
 */

import type { PluginTheme } from "@getpaseo/plugin";
import { useAgent, usePaseo } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { ActionButton } from "./action-button";
import { useShipSettings } from "./settings-store";
import type { ShipCheck } from "../shared/ship";
import type { ShipRow } from "../shared/timeline";

/** How long a sent command has to start a turn before the button comes back. */
const HANDOFF_GRACE_MS = 5_000;

function statusColor(row: ShipRow, theme: PluginTheme): string {
  // History recedes: one card in the stream carries colour, and it is the one
  // that can still be acted on.
  if (row.stale) return theme.colors.foregroundMuted;
  if (row.ready) return theme.colors.statusSuccess;
  return row.blockers.length > 0 ? theme.colors.statusDanger : theme.colors.foregroundMuted;
}

/** A disabled button never fires this, and `ActionButton` requires a handler. */
function noop(): void {}

function checkTime(checkedAt: string): string {
  return new Date(checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function CheckLine({ check, theme }: { check: ShipCheck; theme: PluginTheme }) {
  const failed = check.status === "fail";
  const color = failed ? theme.colors.statusDanger : theme.colors.statusWarning;

  return (
    <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
      <View style={{ paddingTop: 2 }}>
        <Icon name={failed ? "X" : "AlertTriangle"} size={13} color={color} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 13, lineHeight: 18 }}>
          {check.label}
        </Text>
        {check.reason ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 16 }}>
            {check.reason}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The ship, and nothing else: it sends the command or it says why it could not.
 * The card only renders it for a ready verdict, so what is left to guard is a
 * second press while the first is on the wire and an agent that started running
 * since the card was drawn.
 */
function ShipButton({
  agentId,
  theme,
  stretch,
  onError,
}: {
  agentId: string;
  theme: PluginTheme;
  stretch: boolean;
  onError: (message: string | null) => void;
}) {
  const paseo = usePaseo();
  const command = useShipSettings().shipCommand;
  const status = useAgent(agentId, (agent) => agent.status);
  const [sent, setSent] = useState(false);
  /** Whether the turn this button started has actually begun. */
  const turnBegan = useRef(false);

  /**
   * A sent command is not a running turn yet, and the agent status cannot tell
   * those two apart: the gap before the agent picks the command up and the end
   * of the work itself both read as "not running". `turnBegan` is what
   * separates them, and it is why the button stays down across the handover
   * rather than flickering back for a beat.
   */
  useEffect(() => {
    if (!sent) {
      turnBegan.current = false;
      return;
    }
    if (status === "running") {
      turnBegan.current = true;
      return;
    }
    if (turnBegan.current) {
      setSent(false);
      return;
    }
    // A command that never produced a turn, which is what an agent that quietly
    // dropped it looks like. Hand the button back instead of holding it down.
    const timer = setTimeout(() => setSent(false), HANDOFF_GRACE_MS);
    return () => clearTimeout(timer);
  }, [sent, status]);

  // `null` is an agent this client has no snapshot for, which is not a reason
  // to refuse the press; the send reports its own failure.
  const agentBusy = status !== null && status !== "idle";

  const ship = useCallback(() => {
    if (sent) return;
    // Set before the first await, so a second press in the same frame sees it.
    setSent(true);
    onError(null);

    void (async () => {
      try {
        // Paseo submits a provider slash command as ordinary message text, so
        // this is exactly what typing the command into the composer does.
        await paseo.agents.ref(agentId).send(command);
      } catch (error) {
        console.error("[paseo-ship-check] ship command failed to send", error);
        const reason = error instanceof Error ? error.message : String(error);
        setSent(false);
        onError(`Could not send ${command}: ${reason}`);
      }
    })();
  }, [agentId, command, onError, paseo, sent]);

  const down = sent || agentBusy;

  return (
    <ActionButton
      theme={theme}
      tone="primary"
      icon="Ship"
      label="Ship"
      accessibilityLabel={`Run ${command} now`}
      {...(down ? { accessibilityHint: "Available once the agent finishes its turn." } : {})}
      disabled={down}
      stretch={stretch}
      onPress={ship}
    />
  );
}

export interface ShipCardProps {
  row: ShipRow;
  agentId: string;
  theme: PluginTheme;
  compact: boolean;
  /** One more muted footer clause. The panel uses it for the cache note. */
  footnote?: string | null;
}

export function ShipCard({ row, agentId, theme, compact, footnote = null }: ShipCardProps) {
  const [failure, setFailure] = useState<string | null>(null);
  const checks = [...row.blockers, ...row.warnings];
  const headline = statusColor(row, theme);
  const padding = compact ? 14 : 16;

  const styles = useMemo(
    () => ({
      card: {
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        paddingHorizontal: padding,
        // The head row is as tall as the button in it, so an even top and bottom
        // measure the same and read differently: the headline looks pushed down
        // into the card. The top is trimmed until the headline sits where the
        // eye puts it, level with the button's own label.
        paddingTop: compact ? 11 : 12,
        paddingBottom: compact ? 13 : 15,
        overflow: "hidden" as const,
      },
      head: {
        flexDirection: (compact ? "column" : "row") as "column" | "row",
        alignItems: (compact ? "stretch" : "center") as "stretch" | "center",
        gap: compact ? 12 : 14,
      },
      title: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        flexShrink: 1,
        // Centring two texts of different sizes lines up their boxes, not their
        // letters, and the 16pt headline reads low beside the 13pt button label.
        // Matching the baselines takes about a pixel; this lifts further than
        // that, sitting the headline high in the row on purpose, which is what
        // reads as level against a filled button. Whole pixels only, so a 1x
        // browser client does not render the row on a half pixel.
        ...(compact
          ? {}
          : { flexGrow: 1, flexBasis: 0, transform: [{ translateY: -4 }] as const }),
      },
      // An explicit line height is what makes the centring honest. Left to its
      // default, a `Text` box carries leading the eye does not see, and the
      // headline centres that invisible box against the button instead of its
      // own letters.
      headline: {
        fontSize: compact ? 15 : 16,
        lineHeight: compact ? 19 : 20,
        fontWeight: "600" as const,
        flexShrink: 1,
      },
      branch: { color: theme.colors.foreground, fontSize: 13, lineHeight: 18 },
      detail: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 16 },
      rule: {
        height: 1,
        backgroundColor: theme.colors.border,
        marginTop: 13,
        marginHorizontal: -padding,
      },
      footer: {
        marginTop: 12,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 10,
      },
      footnote: { color: theme.colors.foregroundMuted, fontSize: 11 },
      failure: {
        color: theme.colors.statusDanger,
        fontSize: 12,
        lineHeight: 16,
        marginTop: 12,
      },
    }),
    [compact, padding, theme],
  );

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.title}>
          <Icon name="Ship" size={16} color={headline} />
          <Text style={[styles.headline, { color: headline }]} numberOfLines={2}>
            {row.headline}
          </Text>
        </View>
        {!row.ready ? null : row.stale ? (
          <ActionButton
            theme={theme}
            tone="primary"
            icon="Ship"
            label="Ship"
            accessibilityLabel="Ship"
            accessibilityHint="This check is no longer current."
            disabled
            stretch={compact}
            onPress={noop}
          />
        ) : (
          <ShipButton agentId={agentId} theme={theme} stretch={compact} onError={setFailure} />
        )}
      </View>

      {/*
        On a wide card the head row is as tall as the button, so the headline
        already has half that height under it. The gap closes to match what the
        eye measures from the letters, and stays open when there is no button to
        borrow height from.
      */}
      <View style={{ marginTop: !compact && row.ready ? 6 : 10, gap: 2 }}>
        <Text style={styles.branch} numberOfLines={1}>
          {row.branch}
        </Text>
        <Text style={styles.detail}>{row.detail}</Text>
      </View>

      {checks.length > 0 ? (
        <>
          <View style={styles.rule} />
          <View style={{ marginTop: 13, gap: 11 }}>
            {checks.map((check) => (
              <CheckLine key={check.id} check={check} theme={theme} />
            ))}
          </View>
        </>
      ) : null}

      {failure ? <Text style={styles.failure}>{failure}</Text> : null}

      <View style={styles.rule} />
      <View style={styles.footer}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
          <Icon name="Check" size={12} color={theme.colors.foregroundMuted} />
          <Text style={styles.footnote} numberOfLines={1}>
            {row.passed} check{row.passed === 1 ? "" : "s"} passed
            {footnote ? ` · ${footnote}` : ""}
            {row.stale ? " · no longer current" : ""}
          </Text>
        </View>
        <Text style={styles.footnote}>{checkTime(row.checkedAt)}</Text>
      </View>
    </View>
  );
}
