/**
 * The ship card: one finished ship, drawn once.
 *
 * `ship-card.tsx` is the verdict this plugin computed and the button that acts
 * on it. This is its other half, and the two are deliberately the same object
 * seen twice: same frame, same radius, same head row, same full-bleed rules,
 * same footer with the time in the corner. A reader who learned the verdict
 * card at the top of a turn already knows how to read this one at the bottom.
 *
 * Where they part is the action. A verdict offers a ship, so its head row is
 * built around a button and every measurement in it is tuned against that
 * button's height. Nothing here can be acted on: the commit is pushed or it is
 * not, and either way the moment has passed. So this card takes the geometry a
 * verdict card takes when it has no button to carry, and the slot the button
 * would have used holds the commit hash instead, which is the one thing a
 * reader comes back to this row to copy.
 *
 * Every length is drawn through `card-type.ts`, the same font, the same scale,
 * and the same three sizes the verdict card reads, because two cards in one
 * timeline set differently is worse than either setting. Slot for slot: the
 * title is `TITLE`, the subject and the checks are `BODY`, and everything a
 * reader only glances at is `META`. This card used to set all three a size or
 * two under the verdict card's, which made a shipped card read as a smaller,
 * lesser thing than the verdict it came from rather than its other half.
 */

import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { BODY, META, MONO_FONT_FAMILY, TITLE, useCardType } from "./card-type";
import { type ShipResult, shortSha } from "../shared/ship-report";

function shipTime(timestamp: Date): string {
  return timestamp.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** `origin/main`, or the branch alone when the report never named a remote. */
function destinationLine(result: ShipResult): string {
  return result.remote ? `→ ${result.remote}/${result.branch}` : `→ ${result.branch}`;
}

export interface ShipResultCardProps {
  result: ShipResult;
  theme: PluginTheme;
  compact: boolean;
  timestamp: Date;
}

export function ShipResultCard({ result, theme, compact, timestamp }: ShipResultCardProps) {
  const type = useCardType();
  const padding = type.px(compact ? 14 : 16);
  // A push that failed is not an error row, it is a ship that stopped one step
  // short, and the card says which one in the same place the verdict card says
  // how many blockers it found.
  const headline = result.pushed ? theme.colors.statusSuccess : theme.colors.statusDanger;

  const styles = useMemo(
    () => ({
      card: {
        borderRadius: type.px(14),
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        paddingHorizontal: padding,
        // The no-button geometry from the verdict card, for the same reason it
        // exists there: the optical corrections a 34pt button needs are wrong
        // for a head row that is a line of text and a small chip.
        paddingTop: type.px(compact ? 12 : 14),
        paddingBottom: type.px(compact ? 12 : 14),
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
        flexGrow: 1,
        flexBasis: 0,
        flexShrink: 1,
      },
      headline: {
        fontSize: type.px(TITLE.size),
        lineHeight: type.px(TITLE.leading),
        fontWeight: "600" as const,
        fontFamily: type.fontFamily,
        flexShrink: 1,
      },
      // The hash is the one run of text on the card nobody reads as words, so
      // it is the one set in a monospace whatever the card's own font is, and
      // the only thing carrying a fill of its own.
      hash: {
        backgroundColor: theme.colors.surface2,
        borderRadius: type.px(6),
        paddingHorizontal: type.px(7),
        // Two, not three: the chip is meta text at meta's leading now, and three
        // would stand it a pixel taller than the title line it sits beside and
        // set the height of the head row from the corner.
        paddingVertical: type.px(2),
      },
      hashText: {
        color: theme.colors.foregroundMuted,
        fontSize: type.px(META.size),
        lineHeight: type.px(META.leading),
        fontFamily: MONO_FONT_FAMILY,
      },
      // The commit subject is this card's branch line: the one sentence a reader
      // came for, set at body like the verdict card's.
      subject: {
        color: theme.colors.foreground,
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
      checks: {
        flex: 1,
        fontSize: type.px(BODY.size),
        lineHeight: type.px(BODY.leading),
        fontFamily: type.fontFamily,
      },
      note: {
        color: theme.colors.foregroundMuted,
        fontSize: type.px(META.size),
        lineHeight: type.px(META.leading),
        fontFamily: type.fontFamily,
        marginTop: type.px(12),
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
        // Hung from the same top edge as the verdict card's footer, so a
        // footnote that wraps grows downward rather than shifting the time.
        alignItems: "flex-start" as const,
        justifyContent: "space-between" as const,
        gap: type.px(10),
      },
      // Meta, like the verdict card's footer, rather than the two points under
      // it this card used to set. A fourth size below the smallest text on the
      // card never read as a rank, only as small print.
      footnote: {
        color: theme.colors.foregroundMuted,
        fontSize: type.px(META.size),
        lineHeight: type.px(META.leading),
        fontFamily: type.fontFamily,
      },
      time: {
        color: theme.colors.foregroundMuted,
        fontSize: type.px(META.size),
        lineHeight: type.px(META.leading),
        fontFamily: type.fontFamily,
        fontVariant: ["tabular-nums" as const],
      },
    }),
    [compact, padding, theme, type],
  );

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.title}>
          <Icon name="Ship" size={type.px(TITLE.icon)} color={headline} />
          <Text style={[styles.headline, { color: headline }]} numberOfLines={1}>
            {result.pushed ? "Shipped" : "Committed, push failed"}
          </Text>
        </View>
        <View style={styles.hash}>
          <Text style={styles.hashText}>{shortSha(result.sha)}</Text>
        </View>
      </View>

      <View style={{ marginTop: type.px(11), gap: type.px(2) }}>
        {result.subject ? (
          <Text style={styles.subject} numberOfLines={2}>
            {result.subject}
          </Text>
        ) : null}
        <Text style={styles.detail} numberOfLines={1}>
          {destinationLine(result)}
        </Text>
      </View>

      <View style={styles.rule} />
      <View
        style={{
          marginTop: type.px(13),
          flexDirection: "row",
          gap: type.px(8),
          alignItems: "flex-start",
        }}
      >
        {/* The check row of the verdict card, to the pixel: same icon size, same
            drop onto the first line's centre, same gap to the label. */}
        <View style={{ paddingTop: type.px(3) }}>
          <Icon name="ListChecks" size={type.px(14)} color={theme.colors.foregroundMuted} />
        </View>
        {/* A report that never mentioned its checks says so. The field is half
            the reason to read a ship card, and a card that simply omits it
            reads as a run that had no checks to run. */}
        <Text
          style={[
            styles.checks,
            { color: result.checks ? theme.colors.foreground : theme.colors.foregroundMuted },
          ]}
        >
          {result.checks ?? "Checks not reported"}
        </Text>
      </View>

      {result.note ? <Text style={styles.note}>{result.note}</Text> : null}

      <View style={styles.rule} />
      <View style={styles.footer}>
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: type.px(6), flexShrink: 1 }}
        >
          <Icon
            name={result.pushed ? "Check" : "AlertTriangle"}
            size={type.px(META.size)}
            color={result.pushed ? theme.colors.foregroundMuted : theme.colors.statusDanger}
          />
          <Text style={styles.footnote} numberOfLines={2}>
            {result.pushed
              ? result.remote
                ? `Pushed to ${result.remote}`
                : "Pushed"
              : "The commit is safe locally"}
          </Text>
        </View>
        <Text style={styles.time}>{shipTime(timestamp)}</Text>
      </View>
    </View>
  );
}

/** The timeline renderer, which only hands the parsed report to the card. */
export function ShipResultItem({ item, theme, layout, timestamp }: PluginTimelineItemProps<ShipResult>) {
  return (
    <ShipResultCard
      result={item.data}
      theme={theme}
      compact={layout.compact}
      timestamp={timestamp}
    />
  );
}
