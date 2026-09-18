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
 * The word the second button adds to that command.
 *
 * `/ship` writes `(closes #42)` on the commit subject and the ticket shuts when
 * the trunk takes it. `/ship refs` writes `(refs #42)` instead, which links the
 * work and leaves the ticket open, for the commit that moves a ticket forward
 * without finishing it. The ship extension parses its arguments in any order,
 * so appending the word is enough however the command is otherwise configured.
 */
export const KEEP_OPEN_ARGUMENT = "refs";

/**
 * Every spelling the ship extension accepts for that word, mirrored from its
 * own `KEEP_OPEN_WORDS`.
 *
 * It is here so the card can tell whether the configured command already keeps
 * the issue open. A reader who set the command to `/ship refs` wanted that as
 * the default, and the two buttons would then send the same thing under
 * different labels, so the second one is dropped instead.
 */
const KEEP_OPEN_WORDS = new Set([
  "refs",
  "ref",
  "--refs",
  "open",
  "keep-open",
  "keepopen",
  "no-close",
  "noclose",
  "wip",
]);

/**
 * Whether the configured command already asks for the issue to stay open.
 *
 * The first word is the command's own name and never counts, so a command
 * called `/open` is not read as a request to keep anything open.
 */
export function commandKeepsIssueOpen(shipCommand: string): boolean {
  return shipCommand
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .slice(1)
    .some((word) => KEEP_OPEN_WORDS.has(word));
}

/** The configured command, with the keep-open word added if it is missing. */
export function keepOpenCommand(shipCommand: string): string {
  const base = shipCommand.trim();
  return commandKeepsIssueOpen(base) ? base : `${base} ${KEEP_OPEN_ARGUMENT}`;
}

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
    /**
     * Whether a ready card offers the keep-open ship beside the plain one.
     * On by default, because a commit that only advances a ticket is common
     * enough to want one tap. A repository with no issue tracker never needs
     * it: `refs` with no issue in the session changes nothing, so the button
     * is a promise about something that is not there, and this turns it off.
     */
    keepOpenButton: z.boolean().default(true),
  }),
});

export type ShipSettings = z.output<typeof shipSettings.schema>;

/** Parsing `{}` produces the complete document, so this is the whole default. */
export const DEFAULT_SHIP_SETTINGS: ShipSettings = shipSettings.schema.parse({});

/**
 * Whether a ready card draws the keep-open ship at all.
 *
 * One answer, read by the live buttons and by the disabled twins a stale card
 * draws, so history cannot end up showing a button the live card never had.
 */
export function showsKeepOpen(settings: ShipSettings): boolean {
  return settings.keepOpenButton && !commandKeepsIssueOpen(settings.shipCommand);
}
