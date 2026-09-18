/**
 * Client-only cache of the persisted settings document.
 *
 * The timeline transformer in `client/ship-echo.ts` has to answer
 * synchronously, and it runs outside React where no hook can be called, so the
 * document cannot be fetched at the moment it is needed. `client/settings-sync.ts`
 * reads it over the settings RPC and parks it here; the transformer reads this
 * store synchronously and the card reads it through `useShipSettings`.
 */

import { useSyncExternalStore } from "react";
import { DEFAULT_SHIP_SETTINGS, type ShipSettings } from "../shared/settings";

const listeners = new Set<() => void>();
let current: ShipSettings = DEFAULT_SHIP_SETTINGS;

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeToSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Never null: the schema defaults stand in until the first read lands. */
export function readSettings(): ShipSettings {
  return current;
}

function same(a: ShipSettings, b: ShipSettings): boolean {
  return (
    a.shipCommand === b.shipCommand &&
    a.cardFont === b.cardFont &&
    a.cardFontFamily === b.cardFontFamily &&
    a.cardTextSize === b.cardTextSize &&
    a.keepOpenButton === b.keepOpenButton
  );
}

/** Writing an unchanged document would wake every card and panel for nothing. */
export function writeSettings(next: ShipSettings): void {
  if (same(current, next)) return;
  current = next;
  notify();
}

export function resetSettingsCache(): void {
  if (same(current, DEFAULT_SHIP_SETTINGS)) return;
  current = DEFAULT_SHIP_SETTINGS;
  notify();
}

export function useShipSettings(): ShipSettings {
  return useSyncExternalStore(subscribeToSettings, readSettings, readSettings);
}
