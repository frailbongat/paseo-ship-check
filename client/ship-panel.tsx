/**
 * The ship panel: the same card as the timeline row, plus the re-check.
 *
 * The panel draws no verdict of its own. It reads one, hands it to `ShipCard`,
 * and owns the one thing the card deliberately does not: paying for a fresh
 * run. The ship itself lives on the card, so it is the same button here as in
 * the timeline.
 */

import { type PluginAgentPanelProps, useAgent, useRpc } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { ActionButton } from "./action-button";
import { ShipCard } from "./ship-card";
import { readVerdict, useShipVerdict, writeVerdict } from "./ship-store";
import { readCachedShipVerdict, readShipVerdict } from "../shared/ship";
import { toShipRow } from "../shared/timeline";

export const SHIP_PANEL_ID = "ship";

export function ShipPanel({ theme, layout, agentId }: PluginAgentPanelProps) {
  const verdict = useShipVerdict(agentId);
  const cwd = useAgent(agentId, (agent) => agent.cwd);
  const status = useAgent(agentId, (agent) => agent.status);
  const lastActivityAt = useAgent(agentId, (agent) => agent.lastActivityAt);
  const readCached = useRpc(readCachedShipVerdict);
  const recheck = useRpc(readShipVerdict);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * The daemon recomputed this when the last turn ended, so opening the tab is
   * a read, not a run. Only a first look with nothing cached anywhere shows
   * pending, and even that is one round trip rather than a git and lint pass.
   */
  const load = useCallback(async () => {
    // A running agent is still writing to the tree, and its activity clock is
    // still moving, so asking now would buy a verdict that is wrong by the time
    // it lands. The daemon posts one when the turn ends and this runs again.
    if (!cwd || status === "running") return;
    const cold = readVerdict(agentId) === null;
    if (cold) setPending(true);
    setFailure(null);
    try {
      // The floor makes this correct however the daemon ordered the turn-end
      // computation against this read.
      const fresh = await readCached({
        agentId,
        cwd,
        ...(lastActivityAt ? { notBefore: lastActivityAt } : {}),
      });
      writeVerdict(agentId, fresh);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      if (cold) setPending(false);
    }
  }, [agentId, cwd, lastActivityAt, readCached, status]);

  /** The manual re-check, which is the only thing that pays for a fresh run. */
  const refresh = useCallback(async () => {
    if (!cwd) return;
    setPending(true);
    setFailure(null);
    try {
      // `agentId` stores the result as this agent's cached verdict, so the
      // timeline row moves with the panel instead of keeping the verdict this
      // replaced.
      writeVerdict(agentId, await recheck({ cwd, force: true, agentId }));
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }, [agentId, cwd, recheck]);

  useEffect(() => {
    void load();
  }, [load]);

  const padding = layout.compact ? 16 : 24;
  const muted = { color: theme.colors.foregroundMuted, fontSize: 14, lineHeight: 20 };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding, gap: layout.compact ? 14 : 18 }}
    >
      {verdict === null ? (
        <Text style={muted}>{pending ? "Checking…" : "No verdict yet."}</Text>
      ) : !verdict.isRepo ? (
        <Text style={muted}>This workspace is not a git repository.</Text>
      ) : (
        <ShipCard
          row={toShipRow(verdict)}
          agentId={agentId}
          theme={theme}
          compact={layout.compact}
          footnote={verdict.qualityFromCache ? "quality reused from cache" : null}
        />
      )}

      {failure ? (
        <Text style={{ color: theme.colors.statusDanger, fontSize: 13, lineHeight: 18 }}>
          {failure}
        </Text>
      ) : null}

      <ActionButton
        theme={theme}
        tone="quiet"
        icon="RefreshCw"
        label={pending ? "Checking…" : "Re-check"}
        accessibilityLabel="Re-check ship readiness"
        busy={pending}
        disabled={!cwd}
        stretch={layout.compact}
        onPress={() => void refresh()}
      />
    </ScrollView>
  );
}
