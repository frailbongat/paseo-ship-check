/**
 * The timeline renderer for the daemon's ship row.
 *
 * The daemon appends one row per agent under a fixed id, so the row on screen
 * is always the current verdict rather than a log of old ones. That is what
 * makes it the right place for the ship button: the card states what would
 * happen and offers the one action that makes it happen.
 *
 * Re-checking still belongs elsewhere. `/ship-check`, the Command Center item,
 * and the panel's Re-check all re-append this row, so it updates in place
 * without owning a second button.
 */

import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { ShipCard } from "./ship-card";
import type { ShipRow } from "../shared/timeline";

export function ShipRowItem({ item, theme, layout, agentId }: PluginTimelineItemProps<ShipRow>) {
  return <ShipCard row={item.data} agentId={agentId} theme={theme} compact={layout.compact} />;
}
