import { describe, expect, it } from "vitest";
import type { ServerEvent } from "@aegis/shared/protocol/events";
import { filterEventForSeat } from "#api/simulator/filterEventForSeat";

const COUNTER_WINDOW = {
  kind: "counterWindowOpened",
  attackerPermanentId: "attacker",
  defendingSeat: 1,
  eligibleCounters: [{ sourceInstanceId: "counter-card", effectKey: "counter" }],
} as unknown as ServerEvent;

describe("filterEventForSeat", () => {
  it("keeps the counter choices for the defending seat", () => {
    expect(filterEventForSeat(COUNTER_WINDOW, 1)).toEqual(COUNTER_WINDOW);
  });

  it("hides the counter choices from the attacking seat", () => {
    expect(filterEventForSeat(COUNTER_WINDOW, 0)).toEqual({ ...COUNTER_WINDOW, eligibleCounters: [] });
  });

  it("passes every other event through unchanged", () => {
    const event = { kind: "turnEnded", seat: 0 } as unknown as ServerEvent;
    expect(filterEventForSeat(event, 1)).toBe(event);
  });
});
