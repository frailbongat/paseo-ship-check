/**
 * The timeline renderer for the daemon's ship row.
 *
 * It draws the verdict card and its ship button, and nothing else: the report
 * `/ship` writes when the press lands is pi's own notice, printed on the
 * timeline by the provider, so this card stays a verdict from first append to
 * the turn that retires it.
 *
 * Re-checking belongs elsewhere. `/ship-check`, the Command Center item, and
 * the panel's Re-check all re-append this row, so it updates in place without
 * owning a second button.
 */

import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { ShipCard } from "./ship-card";
import type { ShipRow } from "../shared/timeline";

export function ShipRowItem({
  item,
  theme,
  layout,
  agentId,
}: PluginTimelineItemProps<ShipRow>) {
  return <ShipCard row={item.data} agentId={agentId} theme={theme} compact={layout.compact} />;
}
