/**
 * Keeps `settings-store` in step with the daemon's document.
 *
 * The store has to be warm before anything reads it, because the timeline
 * transformer answers synchronously and the ship button sends whatever text is
 * in the store at the moment it is pressed. So the document is read once at
 * startup and re-read on a slow beat, which is what carries a change saved on
 * another client over to this one without a plugin reload. Saving in this
 * client's own settings screen writes the store directly, so that change lands
 * on the same tap.
 *
 * A read that fails leaves the store on its last good values, which are the
 * schema defaults until the first read lands. A settings RPC that never answers
 * therefore behaves like the hardcoded `/ship` this setting replaced.
 */

import { settingsRpc } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { resetSettingsCache, writeSettings } from "./settings-store";
import { shipSettings } from "../shared/settings";

/** Slow on purpose: this is a fallback for edits made elsewhere, not a poll. */
const SETTINGS_POLL_INTERVAL_MS = 60_000;

/** The read/write contracts the daemon registers for `shipSettings`. */
const settingsIo = settingsRpc(shipSettings.id);

export function startSettingsSync(client: PluginClientContext): () => void {
  let disposed = false;

  async function load(): Promise<void> {
    try {
      const result = await client.rpc(settingsIo.read, {});
      if (disposed || result.status !== "ready") return;
      const parsed = shipSettings.schema.safeParse(result.values);
      if (parsed.success) writeSettings(parsed.data);
    } catch (error) {
      console.error("[paseo-ship-check] failed to read settings", error);
    }
  }

  void load();
  const poll = setInterval(() => void load(), SETTINGS_POLL_INTERVAL_MS);

  return () => {
    disposed = true;
    clearInterval(poll);
    resetSettingsCache();
  };
}
