import { describe, expect, it } from "vitest";
import type { Intent } from "@aegis/shared/protocol/intents";
import type { Seat } from "@aegis/shared/schema/enums";
import { metaDeckByVersion } from "#api/bot/metaDecks/index";
import { createEvaluationPolicy, type BotPolicy } from "#api/bot/policy";
import { chooseBotIntent } from "#api/simulator/bots/chooseBotIntent";
import type { SimulatorAction } from "#api/simulator/actions/SimulatorAction";
import { SimulatorSession, type SimulatorDeck } from "#api/simulator/SimulatorSession";

type AcceptedMove = { seat: Seat; intent: Intent; offered: readonly SimulatorAction[] };

type PlayWithBotsParams = {
  session: SimulatorSession;
  policies: readonly [BotPolicy, BotPolicy];
  maxSteps: number;
  onAccepted?: (move: AcceptedMove) => void;
};

type PlayRandomlyParams = { session: SimulatorSession; seed: number; maxSteps: number };

const MATCHUPS: readonly (readonly [string, string])[] = [
  ["bt4-yellow-wargreymon@1", "bt5-lordknightmon@1"],
  ["bt5-shoutmon-dx@1", "bt6-red-jesmon@1"],
];

const MAX_CONSECUTIVE_REJECTIONS = 20;

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

async function playWithBots({ session, policies, maxSteps, onAccepted }: PlayWithBotsParams) {
  const counts = { accepted: 0, rejected: 0 };
  let consecutiveRejections = 0;
  let lastTurn = -1;
  for (let step = 0; step < maxSteps; step++) {
    const seat = session.getSeatToAct();
    if (seat === undefined) {
      return counts;
    }
    const state = session.getState();
    const policy = policies[seat];
    if (state.turnCount !== lastTurn) {
      lastTurn = state.turnCount;
      policies[0].onTurnStart();
      policies[1].onTurnStart();
    }
    const tooManyRejections = consecutiveRejections >= MAX_CONSECUTIVE_REJECTIONS;
    const intent: Intent = tooManyRejections ? { type: "endPhase" } : chooseBotIntent({ session, policy, seat });
    const offered = session.getLegalActions(seat).actions;
    const result = await session.act({ seat, intent });
    if (result.ok) {
      onAccepted?.({ seat, intent, offered });
      counts.accepted++;
      consecutiveRejections = 0;
      continue;
    }
    if (result.reason === "engine-error") {
      throw new Error(`Engine error on ${intent.type}: ${result.message}`);
    }
    if (tooManyRejections) {
      throw new Error(`Seat ${seat} is stuck: ${intent.type} was rejected with ${result.reason}`);
    }
    counts.rejected++;
    consecutiveRejections++;
    policy.noteRejected(intent);
  }
  throw new Error(`The game did not end within ${maxSteps} actions`);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortKeys(entry)]),
    );
  }
  return value;
}

function normalizeIntent(intent: Intent): string {
  return JSON.stringify(sortKeys(intent));
}

function isIntentOffered(actions: readonly SimulatorAction[], intent: Intent): boolean {
  const normalized = normalizeIntent(intent);
  return actions.some((action) => {
    if (action.kind === "fixed") {
      return normalizeIntent(action.intent) === normalized;
    }
    if (intent.type !== "respondDecision" || intent.decisionId !== action.decisionId) {
      return false;
    }
    const offeredIds = new Set(action.candidates.map((candidate) => candidate.instanceId));
    const { response } = intent;
    if (action.kind === "pick") {
      return response.kind === action.responseKind && response.instanceIds.every((id) => offeredIds.has(id));
    }
    return response.kind === "orderCards" && response.order.every((id) => offeredIds.has(id));
  });
}

function createRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap]!, shuffled[index]!];
  }
  return shuffled;
}

function chooseRandomKeys(action: SimulatorAction, random: () => number): string[] {
  if (action.kind === "fixed") {
    return [];
  }
  const keys = shuffle(
    action.candidates.map((candidate) => candidate.key),
    random,
  );
  if (action.kind === "order") {
    return keys;
  }
  const count = action.min + Math.floor(random() * (action.max - action.min + 1));
  return keys.slice(0, count);
}

function describeActionKind(action: SimulatorAction): string {
  if (action.kind === "fixed") {
    return action.intent.type;
  }
  return action.kind;
}

async function playRandomly({ session, seed, maxSteps }: PlayRandomlyParams) {
  const random = createRandom(seed);
  const rejectionsByKind = new Map<string, number>();
  let consecutiveRejections = 0;
  for (let step = 0; step < maxSteps; step++) {
    const seat = session.getSeatToAct();
    if (seat === undefined) {
      return { steps: step, rejectionsByKind };
    }
    const { version, actions } = session.getLegalActions(seat);
    const playable = actions.filter((action) => action.kind !== "fixed" || action.intent.type !== "surrender");
    if (playable.length === 0) {
      throw new Error(`Seat ${seat} has nothing to do in phase ${session.getState().phase}`);
    }
    const action = playable[Math.floor(random() * playable.length)]!;
    const result = await session.actOnAction({
      seat,
      actionId: action.id,
      choice: chooseRandomKeys(action, random),
      version,
    });
    if (result.ok) {
      consecutiveRejections = 0;
      continue;
    }
    if (result.reason === "engine-error") {
      throw new Error(`Engine error on "${action.label}": ${result.message}`);
    }
    const kind = describeActionKind(action);
    rejectionsByKind.set(kind, (rejectionsByKind.get(kind) ?? 0) + 1);
    consecutiveRejections++;
    if (consecutiveRejections > MAX_CONSECUTIVE_REJECTIONS) {
      throw new Error(`Seat ${seat} is stuck: the last action "${action.label}" was rejected with ${result.reason}`);
    }
  }
  throw new Error(`The random game did not end within ${maxSteps} actions`);
}

describe("SimulatorSession", () => {
  it("opens with a mulligan decision once started", async () => {
    const session = createSession(3);
    expect(session.getSeatToAct()).toBeUndefined();
    await session.start();
    const seat = session.getSeatToAct();
    expect(seat).toBeDefined();
    expect(session.getDecisionRequest(seat!)?.kind).toBe("mulligan");
    expect(session.getState().pendingDecision?.kind).toBe("mulligan");
  });

  it("refuses to start twice", async () => {
    const session = createSession(3);
    await session.start();
    await expect(session.start()).rejects.toThrow("already started");
  });

  it("rejects a move from a seat that is not the one to act without reaching the engine", async () => {
    const session = createSession(3);
    await session.start();
    const seat = session.getSeatToAct()!;
    const otherSeat: Seat = seat === 0 ? 1 : 0;
    const seqBefore = session.getLastSeq();
    const inputsBefore = session.getRecord().inputs.length;
    const result = await session.act({ seat: otherSeat, intent: { type: "mulligan", keep: true } });
    expect(result).toEqual({ ok: false, reason: "not-seat-to-act", events: [] });
    expect(session.getLastSeq()).toBe(seqBefore);
    expect(session.getRecord().inputs).toHaveLength(inputsBefore);
  });

  it("reports the engine's reason when it refuses a move and keeps the same seat to act", async () => {
    const session = createSession(3);
    await session.start();
    const seat = session.getSeatToAct()!;
    const decisionId = session.getState().pendingDecision?.decisionId;
    const result = await session.act({ seat, intent: { type: "endPhase" } });
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.reason).not.toBe("not-seat-to-act");
    expect(session.getSeatToAct()).toBe(seat);
    expect(session.getState().pendingDecision?.decisionId).toBe(decisionId);
  });

  it("numbers events without gaps and returns only the ones after a sequence number", async () => {
    const session = createSession(3);
    await session.start();
    const seat = session.getSeatToAct()!;
    const seqBefore = session.getLastSeq();
    const result = await session.act({ seat, intent: { type: "mulligan", keep: true } });
    expect(result.ok).toBe(true);
    const all = session.getEvents({ seat, afterSeq: 0 });
    expect(all.map((entry) => entry.seq)).toEqual(all.map((_, index) => index + 1));
    expect(result.events.map((entry) => entry.seq)).toEqual(
      all.filter((entry) => entry.seq > seqBefore).map((entry) => entry.seq),
    );
  });

  it("notifies subscribers of each new event until they unsubscribe", async () => {
    const session = createSession(3);
    const received: number[] = [];
    const unsubscribe = session.subscribe((entry) => {
      received.push(entry.seq);
    });
    await session.start();
    expect(received.length).toBeGreaterThan(0);
    expect(received).toEqual(session.getEvents({ seat: 0, afterSeq: 0 }).map((entry) => entry.seq));
    unsubscribe();
    const countAfterUnsubscribe = received.length;
    const seat = session.getSeatToAct()!;
    await session.act({ seat, intent: { type: "mulligan", keep: true } });
    expect(received).toHaveLength(countAfterUnsubscribe);
  });

  it("plays full games to the end when bots act only through the session", async () => {
    for (const matchup of MATCHUPS) {
      for (const seed of [1, 2]) {
        const session = createSession(seed, matchup);
        await session.start();
        const counts = await playWithBots({
          session,
          policies: [createEvaluationPolicy({ seed }), createEvaluationPolicy({ seed: seed + 9 })],
          maxSteps: 3_000,
        });
        expect(session.getResult()?.outcome).toMatch(/^(win|draw)$/);
        expect(session.getSeatToAct()).toBeUndefined();
        expect(counts.accepted).toBeGreaterThan(20);
        expect(session.getRecord().inputs.length).toBeGreaterThan(counts.accepted);
      }
    }
  }, 300_000);

  it("lists numbered actions only for the seat that must act", async () => {
    const session = createSession(3);
    await session.start();
    const seat = session.getSeatToAct()!;
    const otherSeat: Seat = seat === 0 ? 1 : 0;
    const { actions } = session.getLegalActions(seat);
    expect(actions.map((action) => action.label)).toEqual([
      "Keep your opening hand",
      "Redraw your opening hand",
      "Surrender",
    ]);
    expect(actions.map((action) => action.id)).toEqual([1, 2, 3]);
    expect(session.getLegalActions(otherSeat).actions).toEqual([]);
  });

  it("acts on a listed action and moves the list version on", async () => {
    const session = createSession(3);
    await session.start();
    const seat = session.getSeatToAct()!;
    const { version } = session.getLegalActions(seat);
    const result = await session.actOnAction({ seat, actionId: 1, version });
    expect(result.ok).toBe(true);
    expect(session.getLegalActions(seat).version).toBe(version + 1);
  });

  it("refuses an action from a stale list, an unknown action and an invalid choice", async () => {
    const session = createSession(3);
    await session.start();
    const seat = session.getSeatToAct()!;
    const { version } = session.getLegalActions(seat);
    expect(await session.actOnAction({ seat, actionId: 1, version: version + 1 })).toMatchObject({
      ok: false,
      reason: "stale-actions",
    });
    expect(await session.actOnAction({ seat, actionId: 99, version })).toMatchObject({
      ok: false,
      reason: "unknown-action",
    });
    expect(await session.actOnAction({ seat, actionId: 1, choice: ["a"], version })).toMatchObject({
      ok: false,
      reason: "invalid-choice",
    });
    expect(session.getLegalActions(seat).version).toBe(version);
  });

  it("offers every move the bots make and the engine accepts", async () => {
    const gaps = new Set<string>();
    for (const matchup of MATCHUPS) {
      for (const seed of [1, 2]) {
        const session = createSession(seed, matchup);
        await session.start();
        await playWithBots({
          session,
          policies: [createEvaluationPolicy({ seed }), createEvaluationPolicy({ seed: seed + 9 })],
          maxSteps: 3_000,
          onAccepted: ({ intent, offered }) => {
            if (!isIntentOffered(offered, intent)) {
              gaps.add(JSON.stringify(intent));
            }
          },
        });
      }
    }
    expect([...gaps]).toEqual([]);
  }, 300_000);

  it("finishes random games that pick only from the listed actions", async () => {
    for (const matchup of MATCHUPS) {
      for (const seed of [5, 6]) {
        const session = createSession(seed, matchup);
        await session.start();
        await playRandomly({ session, seed, maxSteps: 6_000 });
        expect(session.getResult()?.outcome).toMatch(/^(win|draw)$/);
      }
    }
  }, 300_000);
});
