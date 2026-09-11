/**
 * The plugin's persisted settings document.
 *
 * Two kinds of preference live here: what the card's button sends, and how the
 * card is set. Everything else the card shows is a fact about the tree.
 *
 * The card's own measurements are tuned against each other, so the type
 * settings are deliberately coarse. A size is a scale applied to every number
 * in the card at once rather than a font size for one line, which is what keeps
 * the headline level with the button at any size. See `client/card-type.ts`.
 *
 * The shape only ever grows by fields that carry a default, so a document
 * written by an older build still parses into the complete current one and the
 * version stays where it is: there is nothing for a migration to do.
 */

import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** What the ship card's button sends into the composer. */
export const DEFAULT_SHIP_COMMAND = "/ship";

/**
 * The card's typeface, as a choice rather than a font name.
 *
 * Each one resolves on every client Paseo runs on, which a font name typed by
 * hand cannot promise. `cardFontFamily` is there for when that is what you
 * want.
 */
export const CARD_FONTS = ["system", "serif", "mono"] as const;
export type CardFont = (typeof CARD_FONTS)[number];

/** How big the card is drawn. A scale over the whole card, not one font size. */
export const CARD_TEXT_SIZES = ["small", "default", "large"] as const;
export type CardTextSize = (typeof CARD_TEXT_SIZES)[number];

export const DEFAULT_CARD_FONT: CardFont = "system";
export const DEFAULT_CARD_TEXT_SIZE: CardTextSize = "default";

export const shipSettings = defineSettings({
  id: "ship",
  scope: "host",
  version: 1,
  schema: z.object({
    shipCommand: z.string().trim().min(1).max(200).default(DEFAULT_SHIP_COMMAND),
    cardFont: z.enum(CARD_FONTS).default(DEFAULT_CARD_FONT),
    /**
     * A font family of your own, which wins over `cardFont` when it is set.
     * Empty is the normal state and means the choice above decides. A name no
     * client can resolve falls back to that client's default text, so the worst
     * case is a card that looks like `system`.
     */
    cardFontFamily: z.string().trim().max(120).default(""),
    cardTextSize: z.enum(CARD_TEXT_SIZES).default(DEFAULT_CARD_TEXT_SIZE),
  }),
});

export type ShipSettings = z.output<typeof shipSettings.schema>;

/** Parsing `{}` produces the complete document, so this is the whole default. */
export const DEFAULT_SHIP_SETTINGS: ShipSettings = shipSettings.schema.parse({});
