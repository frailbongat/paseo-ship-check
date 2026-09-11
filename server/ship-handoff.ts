/**
 * The report pi hands over instead of printing it.
 *
 * `server/ship-result.ts` reads the ship report off the timeline, where the pi
 * ship extension left it as a notice. That works, and it leaves the notice
 * sitting above the card saying the same thing, because no 0.8 API removes or
 * rewrites a row the provider wrote.
 *
 * So the extension stopped printing it. When it runs under Paseo, with this
 * plugin enabled in `config.json`, it writes the report to
 * `<paseo home>/plugin-data/paseo-ship-check/<agent id>.json` and prints
 * nothing; the card is then the only place the ship is reported. In a terminal,
 * or in a Paseo without this plugin, the extension prints as it always did and
 * this file is never written. `ship-handoff.ts` in the extension is the other
 * half of the contract.
 *
 * A handoff is consumed once: the file is deleted as it is read, so a report
 * cannot draw a second card on the next turn. It is also the only copy, which
 * is why deletion failing is not an error worth throwing over, and why a file
 * older than `MAX_AGE_MS` is dropped rather than published: a daemon that was
 * down when the turn ended should not post a card about yesterday's ship under
 * today's work.
 */

import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ShipResult, parseShipReport } from "../shared/ship-report";
import { SHIP_PLUGIN_ID } from "../shared/timeline";

/** The handoff shape this reader understands. */
const HANDOFF_VERSION = 1;

/** Past this the turn that shipped is long gone, and so is the card's place. */
const MAX_AGE_MS = 30 * 60 * 1000;

/** Paseo's state directory, the same one the extension resolves. */
function paseoHome(): string {
  const configured = process.env.PASEO_HOME?.trim();
  return configured ? configured : join(homedir(), ".paseo");
}

function handoffPath(agentId: string): string | null {
  if (!/^[A-Za-z0-9._-]+$/.test(agentId)) return null;
  return join(paseoHome(), "plugin-data", SHIP_PLUGIN_ID, `${agentId}.json`);
}

function reportText(raw: string): string | null {
  const handoff = JSON.parse(raw) as {
    version?: unknown;
    at?: unknown;
    text?: unknown;
  };
  if (handoff.version !== HANDOFF_VERSION) return null;
  if (typeof handoff.text !== "string" || !handoff.text.trim()) return null;
  const at = typeof handoff.at === "string" ? Date.parse(handoff.at) : Number.NaN;
  if (Number.isFinite(at) && Date.now() - at > MAX_AGE_MS) return null;
  return handoff.text;
}

/**
 * Take the report this agent's last ship left, if it left one.
 *
 * The file goes whatever the answer is. A handoff this reader cannot use is
 * still a handoff nobody else will come for.
 */
export async function takeHandedOffReport(agentId: string): Promise<ShipResult | null> {
  const path = handoffPath(agentId);
  if (!path) return null;

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    // The ordinary answer: this turn did not ship, or the extension printed the
    // report itself because Paseo was not the one running it.
    return null;
  }

  await rm(path, { force: true }).catch(() => {});

  try {
    const text = reportText(raw);
    return text ? parseShipReport(text) : null;
  } catch {
    return null;
  }
}
