/**
 * Client-only store for the per-agent ship verdict.
 *
 * The panel reads it, the panel's Re-check and `/ship-check` write it, and the
 * client entrypoint clears it when an agent goes away. The timeline card does not
 * read it at all: the row the daemon appends already carries its own verdict,
 * and drawing anything else there would put a button on one verdict and its
 * blockers on another.
 */

import { useSyncExternalStore } from "react";
import type { ShipVerdict } from "../shared/ship";

const listeners = new Set<() => void>();
const verdicts = new Map<string, ShipVerdict>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeToVerdicts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readVerdict(agentId: string): ShipVerdict | null {
  return verdicts.get(agentId) ?? null;
}

export function writeVerdict(agentId: string, verdict: ShipVerdict): void {
  verdicts.set(agentId, verdict);
  notify();
}

export function clearVerdict(agentId: string): void {
  if (!verdicts.delete(agentId)) return;
  notify();
}

export function clearAllVerdicts(): void {
  if (verdicts.size === 0) return;
  verdicts.clear();
  notify();
}

export function useShipVerdict(agentId: string): ShipVerdict | null {
  return useSyncExternalStore(
    subscribeToVerdicts,
    () => readVerdict(agentId),
    () => readVerdict(agentId),
  );
}
