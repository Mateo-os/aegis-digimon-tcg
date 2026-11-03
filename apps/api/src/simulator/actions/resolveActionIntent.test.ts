import { describe, expect, it } from "vitest";
import type { SimulatorAction } from "#api/simulator/actions/SimulatorAction";
import { resolveActionIntent } from "#api/simulator/actions/resolveActionIntent";

const CANDIDATES = [
  { key: "a", instanceId: "card-a", label: "A" },
  { key: "b", instanceId: "card-b", label: "B" },
  { key: "c", instanceId: "card-c", label: "C" },
];

const FIXED: SimulatorAction = { id: 1, kind: "fixed", label: "End your turn", intent: { type: "endPhase" } };

const PICK: SimulatorAction = {
  id: 2,
  kind: "pick",
  label: "Trash cards",
  decisionId: "decision-1",
  responseKind: "selectCards",
  candidates: CANDIDATES,
  min: 1,
  max: 2,
  rules: [],
};

const ORDER: SimulatorAction = {
  id: 3,
  kind: "order",
  label: "Order",
  decisionId: "decision-1",
  candidates: CANDIDATES,
};

describe("resolveActionIntent", () => {
  it("returns a fixed action's intent and refuses a card choice for it", () => {
    expect(resolveActionIntent({ action: FIXED })).toEqual({ ok: true, intent: { type: "endPhase" } });
    expect(resolveActionIntent({ action: FIXED, choice: ["a"] })).toMatchObject({ ok: false });
  });

  it("turns picked keys into the decision response", () => {
    expect(resolveActionIntent({ action: PICK, choice: ["c", "a"] })).toEqual({
      ok: true,
      intent: {
        type: "respondDecision",
        decisionId: "decision-1",
        response: { kind: "selectCards", instanceIds: ["card-c", "card-a"] },
      },
    });
  });

  it("refuses a pick outside the allowed count", () => {
    expect(resolveActionIntent({ action: PICK, choice: [] })).toEqual({
      ok: false,
      message: "Choose between 1 and 2 cards, not 0",
    });
    expect(resolveActionIntent({ action: PICK, choice: ["a", "b", "c"] })).toMatchObject({ ok: false });
  });

  it("refuses unknown and repeated keys", () => {
    expect(resolveActionIntent({ action: PICK, choice: ["z"] })).toEqual({
      ok: false,
      message: '"z" is not one of the offered cards (a, b, c)',
    });
    expect(resolveActionIntent({ action: PICK, choice: ["a", "a"] })).toEqual({
      ok: false,
      message: '"a" was chosen more than once',
    });
  });

  it("turns a complete order into the decision response and refuses a partial one", () => {
    expect(resolveActionIntent({ action: ORDER, choice: ["b", "c", "a"] })).toMatchObject({
      ok: true,
      intent: { response: { kind: "orderCards", order: ["card-b", "card-c", "card-a"] } },
    });
    expect(resolveActionIntent({ action: ORDER, choice: ["b", "c"] })).toEqual({
      ok: false,
      message: "Order all 3 cards, each exactly once",
    });
  });
});
