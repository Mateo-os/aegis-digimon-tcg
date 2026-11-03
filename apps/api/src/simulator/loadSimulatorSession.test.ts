import { describe, expect, it } from "vitest";
import { metaDeckByVersion } from "#api/bot/metaDecks/index";
import type { ReplayRecord } from "#api/replays/inputs/types";
import { loadSimulatorSession } from "#api/simulator/loadSimulatorSession";
import { SimulatorSession, type SimulatorDeck } from "#api/simulator/SimulatorSession";

type PlayParams = { session: SimulatorSession; fromStep: number; steps: number };

function getMetaDeck(deckVersion: string): SimulatorDeck {
  const deck = metaDeckByVersion(deckVersion);
  if (!deck) {
    throw new Error(`Unknown meta deck ${deckVersion}`);
  }
  return { mainDeck: [...deck.decklist.mainDeck], eggDeck: [...deck.decklist.eggDeck] };
}

async function startSession(seed: number): Promise<SimulatorSession> {
  const session = SimulatorSession.create({
    seed,
    players: [
      { displayName: "Player 1", deck: getMetaDeck("bt5-shoutmon-dx@1") },
      { displayName: "Player 2", deck: getMetaDeck("bt6-red-jesmon@1") },
    ],
  });
  await session.start();
  return session;
}

async function play({ session, fromStep, steps }: PlayParams): Promise<void> {
  for (let step = fromStep; step < fromStep + steps; step++) {
    const seat = session.getSeatToAct();
    if (seat === undefined) {
      return;
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
}

function saveThroughJson(session: SimulatorSession): ReplayRecord {
  return JSON.parse(JSON.stringify(session.getRecord())) as ReplayRecord;
}

function describeSession(session: SimulatorSession) {
  return {
    seatToAct: session.getSeatToAct(),
    views: [session.getSeatView(0), session.getSeatView(1)],
    actions: [0, 1].map((seat) => session.getLegalActions(seat as 0 | 1).actions.map((action) => action.label)),
    events: session.getEvents({ seat: 0, afterSeq: 0 }).map((entry) => entry.event.kind),
    result: session.getResult(),
  };
}

describe("loadSimulatorSession", () => {
  it("rebuilds a game saved partway through so it looks exactly the same", async () => {
    const original = await startSession(7);
    await play({ session: original, fromStep: 0, steps: 60 });
    const loaded = await loadSimulatorSession({ record: saveThroughJson(original) });
    expect(original.getState().turnCount).toBeGreaterThan(1);
    expect(describeSession(loaded)).toEqual(describeSession(original));
    expect(loaded.getRecord()).toEqual(original.getRecord());
  });

  it("plays on identically after loading until the game ends", async () => {
    const original = await startSession(8);
    await play({ session: original, fromStep: 0, steps: 40 });
    const loaded = await loadSimulatorSession({ record: saveThroughJson(original) });
    await play({ session: original, fromStep: 40, steps: 6_000 });
    await play({ session: loaded, fromStep: 40, steps: 6_000 });
    expect(original.getResult()).toBeDefined();
    expect(describeSession(loaded)).toEqual(describeSession(original));
  }, 120_000);

  it("uses the display names it is given", async () => {
    const original = await startSession(7);
    const loaded = await loadSimulatorSession({ record: saveThroughJson(original), displayNames: ["Mateo", "Claude"] });
    expect(loaded.getSeatView(0).you.displayName).toBe("Mateo");
    expect(loaded.getSeatView(0).opponent.displayName).toBe("Claude");
  });

  it("refuses a record whose replay no longer matches what was recorded", async () => {
    const original = await startSession(7);
    await play({ session: original, fromStep: 0, steps: 10 });
    const record = saveThroughJson(original);
    const accepted = record.inputs.find((input) => input.kind === "intent" && input.ok === true);
    if (accepted?.kind !== "intent") {
      throw new Error("Expected an accepted intent in the record");
    }
    accepted.ok = false;
    await expect(loadSimulatorSession({ record })).rejects.toThrow("The replay diverged at input");
  });

  it("refuses an unknown format and inputs the simulator cannot replay", async () => {
    const original = await startSession(7);
    const record = saveThroughJson(original);
    await expect(
      loadSimulatorSession({ record: { ...record, format: "other" as ReplayRecord["format"] } }),
    ).rejects.toThrow("Unsupported replay format");
    const withRoomInput: ReplayRecord = {
      ...record,
      inputs: [...record.inputs, { kind: "expireCombatWindow", stateVersion: 0, engineEvents: 0 }],
    };
    await expect(loadSimulatorSession({ record: withRoomInput })).rejects.toThrow("cannot replay");
  });
});
