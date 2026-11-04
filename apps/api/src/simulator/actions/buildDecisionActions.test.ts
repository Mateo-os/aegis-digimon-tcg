import { describe, expect, it } from "vitest";
import type { DecisionRequest } from "@aegis/shared/protocol/events";
import { GameState } from "@aegis/shared/schema/GameState";
import { buildDecisionActions } from "#api/simulator/actions/buildDecisionActions";

const VISIBLE_CARDS = [
  { instanceId: "card-a", cardId: "BT1-010" },
  { instanceId: "card-b", cardId: "BT1-011" },
  { instanceId: "card-c", cardId: "BT1-085" },
];

function buildRequest(kind: DecisionRequest["kind"], options: DecisionRequest["options"] = {}): DecisionRequest {
  return { decisionId: "decision-1", seat: 0, kind, promptText: "Choose", options };
}

function buildActions(request: DecisionRequest) {
  return buildDecisionActions({ state: new GameState(), seat: 0, request });
}

describe("buildDecisionActions", () => {
  it("offers keeping or redrawing the opening hand", () => {
    expect(buildActions(buildRequest("mulligan"))).toEqual([
      { kind: "fixed", label: "Keep your opening hand", intent: { type: "mulligan", keep: true } },
      { kind: "fixed", label: "Redraw your opening hand", intent: { type: "mulligan", keep: false } },
    ]);
  });

  it("offers using or skipping an optional effect", () => {
    const intents = buildActions(buildRequest("optional")).map((action) => action.kind === "fixed" && action.intent);
    expect(intents).toEqual([
      { type: "respondDecision", decisionId: "decision-1", response: { kind: "optional", accept: true } },
      { type: "respondDecision", decisionId: "decision-1", response: { kind: "optional", accept: false } },
    ]);
  });

  it("offers one action per modal choice", () => {
    const actions = buildActions(buildRequest("chooseOption", { choices: ["Draw 1", "Gain 1 memory"] }));
    expect(actions.map((action) => action.label)).toEqual(["Choose: Draw 1", "Choose: Gain 1 memory"]);
    expect(actions[1]).toMatchObject({ intent: { response: { kind: "chooseOption", optionIndex: 1 } } });
  });

  it("offers resolving each pending trigger next", () => {
    const actions = buildActions(
      buildRequest("orderTriggers", {
        triggerKeys: ["first", "second"],
        triggerCardIds: ["BT1-010", "BT1-085"],
        triggerDescriptions: ["[On Play] Draw 1", "[Start of Your Turn] Gain 1 memory"],
      }),
    );
    expect(actions.map((action) => action.label)).toEqual([
      "Resolve next: Agumon (BT1-010) - [On Play] Draw 1",
      "Resolve next: Tai Kamiya (BT1-085) - [Start of Your Turn] Gain 1 memory",
    ]);
    expect(actions[1]).toMatchObject({ intent: { response: { kind: "orderTriggers", order: ["second"] } } });
  });

  it("offers one action per card for a single required target", () => {
    const actions = buildActions(
      buildRequest("chooseTargets", {
        candidateInstanceIds: ["card-a", "card-b"],
        visibleCards: VISIBLE_CARDS,
        min: 1,
        max: 1,
      }),
    );
    expect(actions.map((action) => action.label)).toEqual([
      "Choose: Agumon (BT1-010)",
      "Choose: Agumon Expert (BT1-011)",
    ]);
    expect(actions[0]).toMatchObject({
      intent: { response: { kind: "chooseTargets", instanceIds: ["card-a"] } },
    });
  });

  it("adds choosing nothing when a single target is optional", () => {
    const actions = buildActions(
      buildRequest("selectCards", { candidateInstanceIds: ["card-a"], visibleCards: VISIBLE_CARDS, min: 0, max: 1 }),
    );
    expect(actions.map((action) => action.label)).toEqual(["Choose: Agumon (BT1-010)", "Choose: nothing"]);
    expect(actions[1]).toMatchObject({ intent: { response: { kind: "selectCards", instanceIds: [] } } });
  });

  it("offers each allowed target combination the engine lists", () => {
    const actions = buildActions(
      buildRequest("chooseTargets", {
        candidateInstanceIds: ["card-a", "card-b", "card-c"],
        visibleCards: VISIBLE_CARDS,
        allowedTargetCombinations: [["card-a", "card-c"], ["card-b"]],
      }),
    );
    expect(actions.map((action) => action.label)).toEqual([
      "Choose: Agumon (BT1-010), Tai Kamiya (BT1-085)",
      "Choose: Agumon Expert (BT1-011)",
    ]);
  });

  it("offers one pick action with keyed candidates and rules for a multi-card choice", () => {
    const [action] = buildActions(
      buildRequest("selectCards", {
        candidateInstanceIds: ["card-a", "card-b", "card-c"],
        visibleCards: VISIBLE_CARDS,
        min: 1,
        max: 2,
        maxTotalPlayCost: 5,
        distinctNames: true,
      }),
    );
    expect(action).toEqual({
      kind: "pick",
      label: "Choose (choose 1 to 2)",
      decisionId: "decision-1",
      responseKind: "selectCards",
      candidates: [
        { key: "a", instanceId: "card-a", label: "Agumon (BT1-010)" },
        { key: "b", instanceId: "card-b", label: "Agumon Expert (BT1-011)" },
        { key: "c", instanceId: "card-c", label: "Tai Kamiya (BT1-085)" },
      ],
      min: 1,
      max: 2,
      rules: ["total play cost at most 5", "each card a different name"],
    });
  });

  it("offers one order action for arranging cards", () => {
    const [action] = buildActions(
      buildRequest("orderCards", {
        candidateInstanceIds: ["card-a", "card-b"],
        visibleCards: VISIBLE_CARDS,
        orderDestination: "deckTop",
      }),
    );
    expect(action).toMatchObject({
      kind: "order",
      label: "Choose (the first card you list ends up on top)",
      candidates: [
        { key: "a", instanceId: "card-a" },
        { key: "b", instanceId: "card-b" },
      ],
    });
  });

  it("explains that the last listed card goes to the very bottom of the deck", () => {
    const [action] = buildActions(
      buildRequest("orderCards", { candidateInstanceIds: ["card-a", "card-b"], orderDestination: "deckBottom" }),
    );
    expect(action?.label).toBe(
      "Choose (these go to the bottom of the deck: the first card you list ends up highest, the last one at the very bottom)",
    );
  });

  it("names cards it cannot see as hidden", () => {
    const actions = buildActions(buildRequest("chooseTargets", { candidateInstanceIds: ["unknown"], min: 1, max: 1 }));
    expect(actions[0]?.label).toBe("Choose: a hidden card");
  });
});
