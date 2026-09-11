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
