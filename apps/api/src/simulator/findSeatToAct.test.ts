import { describe, expect, it } from "vitest";
import { CombatWindow, GameState, PendingDecision } from "@aegis/shared/schema/GameState";
import { Phase, type Seat } from "@aegis/shared/schema/enums";
import type { Intent } from "@aegis/shared/protocol/intents";
import type { BotPolicy } from "#api/bot/policy";
import { createEvaluationPolicy } from "#api/bot/policy";
import { runBotMatch } from "#api/bot/matchHarness";
import type { GameEngine } from "#api/engine/GameEngine";
import type { Decklist } from "#api/engine/testDecks";
import { metaDeckByVersion } from "#api/bot/metaDecks/index";
import { findSeatToAct } from "#api/simulator/findSeatToAct";

type BuildStateParams = {
  phase?: Phase;
  turnSeat?: Seat;
  decisionSeat?: Seat;
  combatSeat?: Seat;
  gameOver?: boolean;
};

type BuildCheckingPolicyParams = {
  engine: GameEngine;
  seat: Seat;
  seed: number;
  mismatches: string[];
  checkedKinds: Map<string, number>;
};

const POLICY_CHOICE_METHODS: ReadonlySet<string> = new Set([
  "chooseBreedingAction",
  "chooseMainAction",
  "chooseBlockResponse",
  "chooseCounterResponse",
  "chooseAllianceResponse",
  "chooseEvadeResponse",
  "chooseBarrierResponse",
  "answerDecision",
]);

const MATCHUPS_WITH_BLOCKS: readonly (readonly [string, string])[] = [
  ["bt4-yellow-wargreymon@1", "bt5-lordknightmon@1"],
  ["bt5-shoutmon-dx@1", "bt6-red-jesmon@1"],
];

function getMetaDecklist(deckVersion: string): Decklist {
  const deck = metaDeckByVersion(deckVersion);
  if (!deck) {
    throw new Error(`Unknown meta deck ${deckVersion}`);
  }
  return { mainDeck: [...deck.decklist.mainDeck], eggDeck: [...deck.decklist.eggDeck] };
}

function buildState({
  phase = Phase.Main,
  turnSeat = 0,
  decisionSeat,
  combatSeat,
  gameOver = false,
}: BuildStateParams) {
  const state = new GameState();
  state.phase = phase;
  state.turnSeat = turnSeat;
  state.gameOver = gameOver;
  if (decisionSeat !== undefined) {
    const decision = new PendingDecision();
    decision.decisionId = "decision";
    decision.kind = "optional";
    decision.seat = decisionSeat;
    state.pendingDecision = decision;
  }
  if (combatSeat !== undefined) {
    const window = new CombatWindow();
    window.kind = "block";
    window.seat = combatSeat;
    state.combatWindow = window;
  }
  return state;
}

function buildCheckingPolicy({ engine, seat, seed, mismatches, checkedKinds }: BuildCheckingPolicyParams) {
  const policy = createEvaluationPolicy({ seed });
  return new Proxy(policy, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, receiver);
      if (typeof member !== "function" || typeof property !== "string" || !POLICY_CHOICE_METHODS.has(property)) {
        return member;
      }
      return (...args: unknown[]) => {
        checkedKinds.set(property, (checkedKinds.get(property) ?? 0) + 1);
        const expected = findSeatToAct(engine.state);
        if (expected !== seat) {
          mismatches.push(
            `${property} asked seat ${seat} but findSeatToAct returned ${String(expected)} (turn ${engine.state.turnCount}, phase ${engine.state.phase})`,
          );
        }
        return member.apply(target, args);
      };
    },
  }) as BotPolicy<Intent | Promise<Intent>>;
}

describe("findSeatToAct", () => {
  it("returns nobody once the game is over, even with an open decision", () => {
    expect(findSeatToAct(buildState({ gameOver: true, decisionSeat: 1 }))).toBeUndefined();
  });

  it("returns the deciding seat while an effect waits on a choice", () => {
    expect(findSeatToAct(buildState({ turnSeat: 0, decisionSeat: 1 }))).toBe(1);
  });

  it("prefers the pending decision over an open combat window", () => {
    expect(findSeatToAct(buildState({ turnSeat: 0, decisionSeat: 0, combatSeat: 1 }))).toBe(0);
  });

  it("returns the answering seat while a combat window is open", () => {
    expect(findSeatToAct(buildState({ turnSeat: 0, combatSeat: 1 }))).toBe(1);
  });

  it("returns the turn player in their breeding and main phases", () => {
    expect(findSeatToAct(buildState({ phase: Phase.Breeding, turnSeat: 1 }))).toBe(1);
    expect(findSeatToAct(buildState({ phase: Phase.Main, turnSeat: 0 }))).toBe(0);
  });

  it("returns nobody while the engine runs a phase without player input", () => {
    for (const phase of [Phase.None, Phase.Active, Phase.Draw, Phase.End]) {
      expect(findSeatToAct(buildState({ phase }))).toBeUndefined();
    }
  });

  it("names the seat a bot is asked to act for at every point of full matches", async () => {
    const checkedKinds = new Map<string, number>();
    for (const [left, right] of MATCHUPS_WITH_BLOCKS) {
      for (const seed of [1, 2]) {
        const mismatches: string[] = [];
        const result = await runBotMatch({
          seed,
          turnLimit: 40,
          seats: [
            {
              deck: getMetaDecklist(left),
              policyFactory: (engine, seat) => buildCheckingPolicy({ engine, seat, seed, mismatches, checkedKinds }),
            },
            {
              deck: getMetaDecklist(right),
              policyFactory: (engine, seat) =>
                buildCheckingPolicy({ engine, seat, seed: seed + 9, mismatches, checkedKinds }),
            },
          ],
        });
        expect(result.errors).toEqual([]);
        expect(result.reason).not.toBe("unfinished");
        expect(mismatches).toEqual([]);
      }
    }
    for (const kind of ["chooseBreedingAction", "chooseMainAction", "chooseBlockResponse", "answerDecision"]) {
      expect(checkedKinds.get(kind) ?? 0).toBeGreaterThan(0);
    }
  }, 300_000);
});
