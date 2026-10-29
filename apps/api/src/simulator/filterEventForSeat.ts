import type { ServerEvent } from "@aegis/shared/protocol/events";
import type { Seat } from "@aegis/shared/schema/enums";

export function filterEventForSeat(event: ServerEvent, seat: Seat): ServerEvent {
  if (event.kind === "counterWindowOpened" && event.defendingSeat !== seat) {
    return { ...event, eligibleCounters: [] };
  }
  return event;
}
