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
 * That card recedes in colour and keeps its frame. A timeline collects one of
 * these per turn, so an old verdict that keeps its red check rows competes with
 * the live one at full volume. History goes monochrome instead, which leaves
 * exactly one card in the stream carrying colour. The surface stays: a card
 * with no fill reads as a hole in the stream rather than as a quiet card.
 *
 * Every length here is drawn through `card-type.ts`, which is the reader's font
 * and size setting. A size is one scale over the whole card rather than a font
 * size per line, so the corrections below, the lifted headline and the trimmed
 * top padding, stay true at any size.
 *
 * Within that scale the card sets everything on the three sizes in
 * `card-type.ts` and no more. A title is a title at one size wherever it is
 * drawn.
 *
 * The button carries no ship icon. The card already wears one, in the title,
 * where it is drawn whatever the verdict says; the button is the only slot that
 * cannot promise that, since a blocked verdict has no button. See `ShipButton`.
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
import { BODY, META, TITLE, useCardType, type CardType } from "./card-type";
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

/**
 * Whether the card carries a button at all.
 *
 * A ready verdict gets one either way: live it ships, stale it is the disabled
 * twin. Everything else, a blocked verdict most of all, has nothing to offer,
 * and the head row is then a single line of text. Reading that off `ready`
 * anywhere else in the layout was what tipped the blocked card's headline out
 * of place: the optical corrections a 34pt button needs were being applied to a
 * row that had nothing in it but a line of text.
 */
function hasAction(row: ShipRow): boolean {
  return row.ready;
}

/** A disabled button never fires this, and `ActionButton` requires a handler. */
function noop(): void {}

function checkTime(checkedAt: string): string {
  return new Date(checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function CheckLine({
  check,
  theme,
  type,
  muted,
}: {
  check: ShipCheck;
  theme: PluginTheme;
  type: CardType;
  /** A card whose turn has passed. Shape still separates a fail from a warn. */
  muted: boolean;
}) {
  const failed = check.status === "fail";
  const color = muted
    ? theme.colors.foregroundMuted
    : failed
      ? theme.colors.statusDanger
      : theme.colors.statusWarning;

  return (
    <View style={{ flexDirection: "row", gap: type.px(8), alignItems: "flex-start" }}>
      {/* The icon centres on the label's first line, so it follows the leading
          that line is set on rather than sitting at a fixed drop. */}
      <View style={{ paddingTop: type.px(3) }}>
        <Icon name={failed ? "X" : "AlertTriangle"} size={type.px(14)} color={color} />
      </View>
      <View style={{ flex: 1, gap: type.px(2) }}>
        <Text
          style={{
            color: muted ? theme.colors.foregroundMuted : theme.colors.foreground,
            fontSize: type.px(BODY.size),
            lineHeight: type.px(BODY.leading),
            fontFamily: type.fontFamily,
          }}
        >
          {check.label}
        </Text>
        {check.reason ? (
          <Text
            style={{
              color: theme.colors.foregroundMuted,
              fontSize: type.px(META.size),
              lineHeight: type.px(META.leading),
              fontFamily: type.fontFamily,
            }}
          >
            {check.reason}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The ship, and nothing else: it sends the command or it says why it could not.
 * It is a label and no glyph: the ship mark belongs to the title, which is the
 * one slot every variant has, and a card that draws it twice spends its only
 * accent twice.
 * The card only renders it for a ready verdict, so what is left to guard is a
 * second press while the first is on the wire and an agent that started running
 * since the card was drawn.
 */
function ShipButton({
  agentId,
  theme,
  type,
  onError,
}: {
  agentId: string;
  theme: PluginTheme;
  type: CardType;
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
      label="Ship"
      scale={type.scale}
      fontFamily={type.fontFamily}
      accessibilityLabel={`Run ${command} now`}
      {...(down ? { accessibilityHint: "Available once the agent finishes its turn." } : {})}
      disabled={down}
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
  // The font and the scale the reader asked for, applied to every length below.
  const type = useCardType();
  const checks = [...row.blockers, ...row.warnings];
  const headline = statusColor(row, theme);
  const padding = type.px(compact ? 14 : 16);
  const action = hasAction(row);
  const stale = row.stale;
  /**
   * Where the button goes, which is the one thing the card's vertical spacing
   * has to know.
   *
   * Wide, it sits in the head row beside the headline, and the row's own height
   * is then the thing every measurement above and below is tuned against.
   * Narrow, it drops under the branch and file lines, after the sentence it
   * acts on rather than between that sentence's two halves, and stays its own
   * width: a button stretched across the card claims a weight this one action
   * does not need. That leaves the narrow head row a single line of text, which
   * is the same shape a blocked card has, so both take the plain geometry.
   */
  const buttonInHead = action && !compact;
  const buttonBelowMeta = action && compact;
  // The head row is 34pt tall around a 23pt line whenever it holds a button, so
  // part of the space under the headline is already paid for there, and the gap
  // under it only has to make up the rest.
  const metaGap = type.px(buttonInHead ? 8 : 11);

  const styles = useMemo(
    () => ({
      card: {
        borderRadius: type.px(14),
        borderWidth: 1,
        borderColor: theme.colors.border,
        // Every card keeps its surface, history included. What history gives up
        // is colour, which is enough to tell the two apart without punching a
        // hole in the stream where an old card used to be.
        backgroundColor: theme.colors.surface1,
        paddingHorizontal: padding,
        // A head row with a button in it is as tall as that button, so an even
        // top and bottom measure the same and read differently: the headline
        // looks pushed down into the card. The top is trimmed until it sits
        // where the eye puts it, level with the button's own label. A card with
        // no button has no such row and no correction to make, and wearing this
        // one anyway was what left the blocked card's headline floating.
        paddingTop: type.px(buttonInHead ? 12 : compact ? 12 : 14),
        paddingBottom: type.px(buttonInHead ? 15 : compact ? 12 : 14),
        overflow: "hidden" as const,
      },
      head: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: type.px(14),
      },
      title: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: type.px(8),
        flexShrink: 1,
        // Centring two texts of different sizes lines up their boxes, not their
        // letters, and the 18pt title reads low beside the 13pt button label.
        // The gap between their baselines is under two pixels at this size; the
        // lift doubles that, sitting the title high in the row on purpose, which
        // is what reads as level against a filled button. It was five when the
        // title was 20pt and would over-correct now. Whole pixels only, so a 1x
        // browser client does not render the row on a half pixel. No button, no
        // lift: there is nothing to be level with.
        ...(compact ? {} : { flexGrow: 1, flexBasis: 0 }),
        ...(buttonInHead ? { transform: [{ translateY: -type.px(4) }] as const } : {}),
      },
      // An explicit line height is what makes the centring honest. Left to its
      // default, a `Text` box carries leading the eye does not see, and the
      // headline centres that invisible box against the button instead of its
      // own letters.
      headline: {
        fontSize: type.px(TITLE.size),
        lineHeight: type.px(TITLE.leading),
        fontWeight: "600" as const,
        fontFamily: type.fontFamily,
        flexShrink: 1,
      },
      branch: {
        color: stale ? theme.colors.foregroundMuted : theme.colors.foreground,
        fontSize: type.px(BODY.size),
        lineHeight: type.px(BODY.leading),
        fontFamily: type.fontFamily,
      },
      detail: {
        color: theme.colors.foregroundMuted,
        fontSize: type.px(META.size),
        lineHeight: type.px(META.leading),
        fontFamily: type.fontFamily,
      },
      rule: {
        height: 1,
        backgroundColor: theme.colors.border,
        marginTop: type.px(13),
        marginHorizontal: -padding,
      },
      footer: {
        marginTop: type.px(12),
        flexDirection: "row" as const,
        // The footnote is allowed a second line, so the row hangs its two ends
        // from the same top edge rather than centring a two-line block against
        // a one-line time. Identical to centring while the footnote fits on one
        // line, which is most cards.
        alignItems: "flex-start" as const,
        justifyContent: "space-between" as const,
        gap: type.px(10),
      },
      // The footer is meta, and it is set at meta's size rather than under it.
      // A fourth size two points below the smallest text on the card was never
      // read as a rank, only as small print, and it is the line that says how
      // many checks passed.
      //
      // Meta's two extra points cost this line about sixty pixels, which a card
      // in a narrow panel does not have: every clause after the first was
      // landing in an ellipsis. The clauses are the cache note and the stale
      // note, which are the two things on the card a reader cannot work out
      // from anywhere else, so the line wraps rather than drops them. An
      // explicit leading is what keeps the wrapped pair evenly spaced.
      footnote: {
        color: theme.colors.foregroundMuted,
        fontSize: type.px(META.size),
        lineHeight: type.px(META.leading),
        fontFamily: type.fontFamily,
      },
      // Times in a stream of cards sit in the same corner card after card, and
      // proportional digits make that column jitter as the minutes change.
      time: {
        color: theme.colors.foregroundMuted,
        fontSize: type.px(META.size),
        lineHeight: type.px(META.leading),
        fontFamily: type.fontFamily,
        fontVariant: ["tabular-nums" as const],
      },
      failure: {
        color: theme.colors.statusDanger,
        fontSize: type.px(META.size),
        lineHeight: type.px(META.leading),
        fontFamily: type.fontFamily,
        marginTop: type.px(12),
      },
    }),
    [buttonInHead, compact, padding, stale, theme, type],
  );

  const shipControl = !action ? null : stale ? (
    <ActionButton
      theme={theme}
      tone="primary"
      label="Ship"
      scale={type.scale}
      fontFamily={type.fontFamily}
      accessibilityLabel="Ship"
      accessibilityHint="This check is no longer current."
      disabled
      onPress={noop}
    />
  ) : (
    <ShipButton agentId={agentId} theme={theme} type={type} onError={setFailure} />
  );

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.title}>
          <Icon name="Ship" size={type.px(TITLE.icon)} color={headline} />
          {/* Unclamped, because the four verdict lines are two or three words
              and never reach a second line, while the fifth headline a card can
              carry is git's own error text. A two-line clamp only ever bit that
              one, and what it cut was the half of the sentence naming the
              cause. A card that has to say `fatal: not a git repository` is
              already the card the reader stops at, so it is allowed the height.
              No button sits beside it either: an error verdict is never ready,
              so the head row's optical lift is not in play. */}
          <Text style={[styles.headline, { color: headline }]}>{row.headline}</Text>
        </View>
        {buttonInHead ? shipControl : null}
      </View>

      <View style={{ marginTop: metaGap, gap: type.px(2) }}>
        <Text style={styles.branch} numberOfLines={1}>
          {row.branch}
        </Text>
        <Text style={styles.detail}>{row.detail}</Text>
      </View>

      {buttonBelowMeta ? (
        <View style={{ marginTop: type.px(12), flexDirection: "row" }}>{shipControl}</View>
      ) : null}

      {checks.length > 0 ? (
        <>
          <View style={styles.rule} />
          <View style={{ marginTop: type.px(13), gap: type.px(11) }}>
            {checks.map((check) => (
              <CheckLine key={check.id} check={check} theme={theme} type={type} muted={stale} />
            ))}
          </View>
        </>
      ) : null}

      {failure ? <Text style={styles.failure}>{failure}</Text> : null}

      <View style={styles.rule} />
      <View style={styles.footer}>
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: type.px(6), flexShrink: 1 }}
        >
          <Icon name="Check" size={type.px(META.size)} color={theme.colors.foregroundMuted} />
          <Text style={styles.footnote} numberOfLines={2}>
            {row.passed} check{row.passed === 1 ? "" : "s"} passed
            {footnote ? ` · ${footnote}` : ""}
            {stale ? " · no longer current" : ""}
          </Text>
        </View>
        <Text style={styles.time}>{checkTime(row.checkedAt)}</Text>
      </View>
    </View>
  );
}
