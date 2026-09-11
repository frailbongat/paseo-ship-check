/**
 * The card's type settings, turned into the two things a style needs: a font
 * family and a scale.
 *
 * Every number in `ship-card.tsx` is tuned against the others. The head row is
 * as tall as the button in it, the headline is lifted off centre by five
 * pixels to read level against that button's label, and the card's top padding
 * is trimmed to match. Exposing a font size per line would break all of that
 * the first time someone raised one line and not its neighbours.
 *
 * So a size is a scale, and it multiplies every length the card draws: text,
 * leading, padding, gaps, icons, and the button itself. The proportions the
 * card was tuned at survive, and a large card is the same card seen closer.
 *
 * Rounding happens once, at the point of use, so a length is always a whole
 * pixel. A browser client at 1x otherwise renders a rule or a baseline on a
 * half pixel and blurs it.
 */

import { useMemo } from "react";
import { Platform } from "react-native";
import { useShipSettings } from "./settings-store";
import type { CardFont, CardTextSize, ShipSettings } from "../shared/settings";

/**
 * Per platform, because the fallbacks differ: a CSS stack on the web, and a
 * face that actually ships on the device everywhere else. React Native resolves
 * an unknown family to the platform default, so a miss is a plain card rather
 * than a broken one.
 */
const FONT_FAMILIES: Record<CardFont, string | undefined> = {
  // The client's own text, which is what the rest of the timeline is set in.
  system: undefined,
  serif: Platform.select({
    web: "Georgia, 'Times New Roman', Times, serif",
    android: "serif",
    default: "Georgia",
  }),
  mono: Platform.select({
    web: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    android: "monospace",
    default: "Menlo",
  }),
};

/**
 * The monospace face on its own, for the one run of text that is set in it
 * whatever the reader chose: a commit hash, which is not words.
 */
export const MONO_FONT_FAMILY = FONT_FAMILIES.mono;

/**
 * Small enough to fit more history on screen, large enough to read across a
 * room, and neither far enough from 1 to turn the card into something else.
 */
const SCALES: Record<CardTextSize, number> = {
  small: 0.88,
  default: 1,
  large: 1.15,
};

/**
 * The three sizes the card sets its text on, before the reader's scale is
 * applied to them.
 *
 * One scale, one place: a slot that is set at one size in the timeline and
 * another in the panel reads as two different components rather than as one
 * card drawn twice.
 *
 * `TITLE` is the line that names the card, `BODY` is the lines a reader
 * actually reads, and `META` is the ones they only glance at. Body and meta
 * used to sit a point apart, which is a difference the eye reads as an
 * accident rather than as rank; two points and a colour apart is a hierarchy.
 *
 * The title is one size at every width. It was 20pt beside
 * a ship button and 18 on a phone, which bought the branch line two points of
 * width on the narrow card and cost every card a title that changed size when
 * the panel did. 18 everywhere buys that width everywhere, and it still clears
 * body by three points, which is the gap that makes it findable without
 * looking for it.
 *
 * `icon` is the glyph that sits before the title. A hair under the text, so it
 * reads as set with the line rather than stamped on it.
 */
export const TITLE = { size: 18, leading: 23, icon: 16 } as const;
export const BODY = { size: 15, leading: 21 } as const;
export const META = { size: 13, leading: 18 } as const;

export interface CardType {
  /** `undefined` is the client's own text, which is the default. */
  fontFamily: string | undefined;
  scale: number;
  /** A tuned length, scaled and rounded to a whole pixel. */
  px(length: number): number;
}

export function cardType(settings: ShipSettings): CardType {
  const custom = settings.cardFontFamily.trim();
  const scale = SCALES[settings.cardTextSize];

  return {
    fontFamily: custom.length > 0 ? custom : FONT_FAMILIES[settings.cardFont],
    scale,
    // A 1pt hairline stays a hairline: it is a rule, not a measurement.
    px: (length) => (length <= 1 ? length : Math.max(1, Math.round(length * scale))),
  };
}

export function useCardType(): CardType {
  const settings = useShipSettings();
  return useMemo(() => cardType(settings), [settings]);
}
