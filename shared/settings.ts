/**
 * The plugin's persisted settings document.
 *
 * One setting, because one thing about the ship is a preference: what the
 * card's button sends. Everything else the card shows is a fact about the tree.
 *
 * This used to live in `paseo-composer-pills` alongside the limits poll. The
 * default is unchanged, so a fresh install of this plugin behaves exactly like
 * that one did.
 */

import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** What the ship card's button sends into the composer. */
export const DEFAULT_SHIP_COMMAND = "/ship";

export const shipSettings = defineSettings({
  id: "ship",
  scope: "host",
  version: 1,
  schema: z.object({
    shipCommand: z.string().trim().min(1).max(200).default(DEFAULT_SHIP_COMMAND),
  }),
});

export type ShipSettings = z.output<typeof shipSettings.schema>;

/** Parsing `{}` produces the complete document, so this is the whole default. */
export const DEFAULT_SHIP_SETTINGS: ShipSettings = shipSettings.schema.parse({});
