/**
 * The timeline renderer for the daemon's ship row.
 *
 * One row, two states. While the verdict is what there is to say, this draws
 * the verdict card and its ship button. Once that ship happens, the daemon
 * writes the report back onto this same row, and the card becomes the report:
 * the thing the reader pressed turns into what the press did, in the place it
 * already occupied, rather than greying out while a second card appears below.
 *
 * Cards from earlier turns are untouched by that, so the history above a ship
 * still reads as history.
 *
 * Re-checking still belongs elsewhere. `/ship-check`, the Command Center item,
 * and the panel's Re-check all re-append this row, so it updates in place
 * without owning a second button.
 */

import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { ShipCard } from "./ship-card";
import { ShipResultCard } from "./ship-result-card";
import type { ShipRow } from "../shared/timeline";

export function ShipRowItem({
  item,
  theme,
  layout,
  agentId,
  timestamp,
}: PluginTimelineItemProps<ShipRow>) {
  const row = item.data;
  if (row.shipped) {
    return (
      <ShipResultCard
        result={row.shipped}
        theme={theme}
        compact={layout.compact}
        timestamp={timestamp}
      />
    );
  }
  return <ShipCard row={row} agentId={agentId} theme={theme} compact={layout.compact} />;
}
