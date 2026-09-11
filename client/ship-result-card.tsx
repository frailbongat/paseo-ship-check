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
 * Every length is drawn through `card-type.ts`, the same font and scale the
 * verdict card reads, because two cards in one timeline set differently is
 * worse than either setting.
 */

import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { MONO_FONT_FAMILY, useCardType } from "./card-type";
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
        fontSize: type.px(compact ? 15 : 16),
        lineHeight: type.px(compact ? 19 : 20),
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
        paddingVertical: type.px(3),
      },
      hashText: {
        color: theme.colors.foregroundMuted,
        fontSize: type.px(12),
        lineHeight: type.px(15),
        fontFamily: MONO_FONT_FAMILY,
      },
      subject: {
        color: theme.colors.foreground,
        fontSize: type.px(13),
        lineHeight: type.px(18),
        fontFamily: type.fontFamily,
      },
      detail: {
        color: theme.colors.foregroundMuted,
        fontSize: type.px(12),
        lineHeight: type.px(16),
        fontFamily: type.fontFamily,
      },
      checks: {
        flex: 1,
        fontSize: type.px(13),
        lineHeight: type.px(18),
        fontFamily: type.fontFamily,
      },
      note: {
        color: theme.colors.foregroundMuted,
        fontSize: type.px(12),
        lineHeight: type.px(16),
        fontFamily: type.fontFamily,
        marginTop: type.px(11),
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
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: type.px(10),
      },
      footnote: {
        color: theme.colors.foregroundMuted,
        fontSize: type.px(11),
        fontFamily: type.fontFamily,
      },
      time: {
        color: theme.colors.foregroundMuted,
        fontSize: type.px(11),
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
          <Icon name="Ship" size={type.px(16)} color={headline} />
          <Text style={[styles.headline, { color: headline }]} numberOfLines={1}>
            {result.pushed ? "Shipped" : "Committed, push failed"}
          </Text>
        </View>
        <View style={styles.hash}>
          <Text style={styles.hashText}>{shortSha(result.sha)}</Text>
        </View>
      </View>

      <View style={{ marginTop: type.px(10), gap: type.px(2) }}>
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
        <View style={{ paddingTop: type.px(2) }}>
          <Icon name="ListChecks" size={type.px(13)} color={theme.colors.foregroundMuted} />
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
            size={type.px(12)}
            color={result.pushed ? theme.colors.foregroundMuted : theme.colors.statusDanger}
          />
          <Text style={styles.footnote} numberOfLines={1}>
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
