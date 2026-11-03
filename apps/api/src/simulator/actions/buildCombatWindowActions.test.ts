import { describe, expect, it } from "vitest";
import { ArraySchema } from "@colyseus/schema";
import { CombatWindow, GameState, type CombatWindowKind } from "@aegis/shared/schema/GameState";
import { buildCombatWindowActions } from "#api/simulator/actions/buildCombatWindowActions";

type BuildWindowParams = {
  kind: CombatWindowKind;
  eligiblePermanentIds?: string[];
  permanentId?: string;
  mustBlock?: boolean;
  eligibleCountersJson?: string;
};

function buildWindow({
  kind,
  eligiblePermanentIds = [],
  permanentId = "",
  mustBlock = false,
  eligibleCountersJson = "",
}: BuildWindowParams) {
  const window = new CombatWindow();
  window.kind = kind;
  window.seat = 1;
  window.permanentId = permanentId;
  window.eligiblePermanentIds = new ArraySchema<string>(...eligiblePermanentIds);
  window.mustBlock = mustBlock;
  window.eligibleCountersJson = eligibleCountersJson;
  return window;
}

function buildIntents(params: BuildWindowParams) {
  return buildCombatWindowActions({ state: new GameState(), seat: 1, window: buildWindow(params) }).map(
    (action) => action.kind === "fixed" && action.intent,
  );
}

describe("buildCombatWindowActions", () => {
  it("offers each blocker and declining when blocking is optional", () => {
    expect(buildIntents({ kind: "block", eligiblePermanentIds: ["p1", "p2"] })).toEqual([
      { type: "declareBlock", blockerPermanentId: "p1" },
      { type: "declareBlock", blockerPermanentId: "p2" },
      { type: "declineBlock" },
    ]);
  });

  it("does not offer declining a forced block", () => {
    expect(buildIntents({ kind: "block", eligiblePermanentIds: ["p1"], mustBlock: true })).toEqual([
      { type: "declareBlock", blockerPermanentId: "p1" },
    ]);
  });

  it("offers each eligible counter and passing", () => {
    const eligibleCountersJson = JSON.stringify([
      { instanceId: "c1", effectKey: "counter", description: "[Counter] Blast Digivolve" },
    ]);
    const actions = buildCombatWindowActions({
      state: new GameState(),
      seat: 1,
      window: buildWindow({ kind: "counter", eligibleCountersJson }),
    });
    expect(actions.map((action) => action.label)).toEqual([
      "Counter with a hidden card: [Counter] Blast Digivolve",
      "Don't counter",
    ]);
    expect(buildIntents({ kind: "counter", eligibleCountersJson })).toEqual([
      { type: "respondCounter", sourceInstanceId: "c1", effectKey: "counter" },
      { type: "respondCounter" },
    ]);
  });

  it("offers each ally and passing for Alliance", () => {
    expect(buildIntents({ kind: "alliance", eligiblePermanentIds: ["ally"] })).toEqual([
      { type: "respondAlliance", allyPermanentId: "ally" },
      { type: "respondAlliance" },
    ]);
  });

  it("offers accepting or declining Evade and Barrier for the prompted Digimon", () => {
    expect(buildIntents({ kind: "evade", permanentId: "p1" })).toEqual([
      { type: "respondEvade", permanentId: "p1", accept: true },
      { type: "respondEvade", permanentId: "p1", accept: false },
    ]);
    expect(buildIntents({ kind: "barrier", permanentId: "p1" })).toEqual([
      { type: "respondBarrier", permanentId: "p1", accept: true },
      { type: "respondBarrier", permanentId: "p1", accept: false },
    ]);
  });
});
