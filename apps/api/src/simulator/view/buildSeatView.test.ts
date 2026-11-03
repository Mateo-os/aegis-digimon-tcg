import { describe, expect, it } from "vitest";
import type { Seat } from "@aegis/shared/schema/enums";
import type { GameState } from "@aegis/shared/schema/GameState";
import { metaDeckByVersion } from "#api/bot/metaDecks/index";
import { SimulatorSession, type SimulatorDeck } from "#api/simulator/SimulatorSession";
import type { SeatView } from "#api/simulator/view/SeatView";

const MATCHUPS: readonly (readonly [string, string])[] = [
  ["bt4-yellow-wargreymon@1", "bt5-lordknightmon@1"],
  ["bt5-shoutmon-dx@1", "bt6-red-jesmon@1"],
];

function getMetaDeck(deckVersion: string): SimulatorDeck {
  const deck = metaDeckByVersion(deckVersion);
  if (!deck) {
    throw new Error(`Unknown meta deck ${deckVersion}`);
  }
  return { mainDeck: [...deck.decklist.mainDeck], eggDeck: [...deck.decklist.eggDeck] };
}

function createSession(seed: number, [left, right] = MATCHUPS[0]!): SimulatorSession {
  return SimulatorSession.create({
    seed,
    players: [
      { displayName: "Left", deck: getMetaDeck(left) },
      { displayName: "Right", deck: getMetaDeck(right) },
    ],
  });
}

function collectInstanceIds(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectInstanceIds(entry, found);
    }
    return found;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "instanceId" && typeof entry === "string") {
        found.add(entry);
      }
      collectInstanceIds(entry, found);
    }
  }
  return found;
}

function findHiddenInstanceIds(state: GameState, seat: Seat): Set<string> {
  const hidden = new Set<string>();
  for (const player of state.players) {
    for (const card of [...player.deck, ...player.eggDeck]) {
      hidden.add(card.instanceId);
    }
    for (const card of player.security) {
      if (!card.faceUp) {
        hidden.add(card.instanceId);
      }
    }
    if (player.seat !== seat) {
      for (const card of player.hand) {
        hidden.add(card.instanceId);
      }
    }
  }
  return hidden;
}

function findLeaks(view: SeatView, state: GameState): string[] {
  const hidden = findHiddenInstanceIds(state, view.seat);
  return [...collectInstanceIds(view)].filter((instanceId) => hidden.has(instanceId));
}

async function playWhileChecking(session: SimulatorSession, maxSteps: number): Promise<string[]> {
  const leaks: string[] = [];
  for (let step = 0; step < maxSteps; step++) {
    for (const seat of [0, 1] as const) {
      for (const leak of findLeaks(session.getSeatView(seat), session.getState())) {
        leaks.push(`seat ${seat} saw ${leak} at turn ${session.getState().turnCount}`);
      }
    }
    const seat = session.getSeatToAct();
    if (seat === undefined) {
      return leaks;
    }
    const { version, actions } = session.getLegalActions(seat);
    const playable = actions.filter((action) => action.kind !== "fixed" || action.intent.type !== "surrender");
    const action = playable[step % playable.length]!;
    const choice =
      action.kind === "fixed"
        ? []
        : action.candidates.slice(0, action.kind === "pick" ? action.min : undefined).map((card) => card.key);
    await session.actOnAction({ seat, actionId: action.id, choice, version });
  }
  throw new Error(`The game did not end within ${maxSteps} actions`);
}

describe("buildSeatView", () => {
  it("shows a seat its own opening hand and only the size of the opponent's", async () => {
    const session = createSession(3);
    await session.start();
    const view = session.getSeatView(0);
    const state = session.getState();
    expect(view.you.hand.map((card) => card.instanceId)).toEqual(
      [...state.players[0]!.hand].map((card) => card.instanceId),
    );
    expect(view.you.hand.length).toBeGreaterThan(0);
    expect(view.opponent.handCount).toBe(state.players[1]!.hand.length);
    expect("hand" in view.opponent).toBe(false);
    expect(view.you.securityCount).toBe(state.players[0]!.security.length);
    expect(view.you.faceUpSecurity).toEqual([]);
  });

  it("names cards from the card data", async () => {
    const session = createSession(3);
    await session.start();
    const [card] = session.getSeatView(0).you.hand;
    expect(card?.name).toBeTruthy();
    expect(card?.name).not.toBe(card?.cardId);
    expect(card?.kinds.length).toBeGreaterThan(0);
  });

  it("shows the decision prompt to both seats while one seat decides", async () => {
    const session = createSession(3);
    await session.start();
    const seat = session.getSeatToAct()!;
    const expected = { kind: "decision", seat, decisionKind: "mulligan" };
    expect(session.getSeatView(0).prompt).toMatchObject(expected);
    expect(session.getSeatView(1).prompt).toMatchObject(expected);
  });

  it("reports memory from each seat's side of the gauge", async () => {
    const session = createSession(3);
    await session.start();
    const state = session.getState();
    while (state.memory === 0) {
      const seat = session.getSeatToAct()!;
      const { version, actions } = session.getLegalActions(seat);
      await session.actOnAction({ seat, actionId: actions[0]!.id, version });
    }
    const turnSeat = state.turnSeat;
    const otherSeat: Seat = turnSeat === 0 ? 1 : 0;
    expect(session.getSeatView(turnSeat).memory).toBe(state.memory);
    expect(session.getSeatView(otherSeat).memory).toBe(-state.memory);
    expect(session.getSeatView(turnSeat).isYourTurn).toBe(true);
    expect(session.getSeatView(otherSeat).isYourTurn).toBe(false);
  });

  it("never shows a seat hidden cards at any point of full games, and reports the result", async () => {
    for (const matchup of MATCHUPS) {
      for (const seed of [1, 2]) {
        const session = createSession(seed, matchup);
        await session.start();
        const leaks = await playWhileChecking(session, 6_000);
        expect(leaks).toEqual([]);
        const result = session.getResult();
        expect(result).toBeDefined();
        expect(session.getSeatView(0).result).toEqual(result);
        expect(session.getSeatView(1).result).toEqual(result);
      }
    }
  }, 300_000);
});
