import { describe, expect, it } from "vitest";
import type { ServerEvent } from "@aegis/shared/protocol/events";
import type { Intent } from "@aegis/shared/protocol/intents";
import { Phase, type Seat } from "@aegis/shared/schema/enums";
import { metaDeckByVersion } from "#api/bot/metaDecks/index";
import { createEvaluationPolicy, type BotPolicy } from "#api/bot/policy";
import { buildBotView, type BotView } from "#api/bot/view";
import { SimulatorSession, type SimulatorDeck } from "#api/simulator/SimulatorSession";

type PlayWithBotsParams = { session: SimulatorSession; policies: readonly [BotPolicy, BotPolicy]; maxSteps: number };

type ChooseIntentParams = { session: SimulatorSession; policy: BotPolicy; seat: Seat; view: BotView };

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

function findLatestEvent<K extends ServerEvent["kind"]>(session: SimulatorSession, seat: Seat, kind: K) {
  const events = session.getEvents({ seat, afterSeq: 0 });
  for (let index = events.length - 1; index >= 0; index--) {
    const { event } = events[index]!;
    if (event.kind === kind) {
      return event as Extract<ServerEvent, { kind: K }>;
    }
  }
  throw new Error(`No ${kind} event was emitted`);
}

function chooseIntent({ session, policy, seat, view }: ChooseIntentParams): Intent {
  const state = session.getState();
  const request = session.getDecisionRequest(seat);
  if (request) {
    return policy.answerDecision(view, request);
  }
  const window = state.combatWindow;
  if (window?.kind === "block") {
    const attack = findLatestEvent(session, seat, "attackDeclared");
    return policy.chooseBlockResponse(view, {
      attackerPermanentId: window.attackerPermanentId,
      eligibleBlockerIds: [...window.eligiblePermanentIds],
      mustBlock: window.mustBlock,
      targetsPlayer: attack.target.kind === "player",
      ...(attack.target.kind === "permanent" ? { targetPermanentId: attack.target.permanentId } : {}),
    });
  }
  if (window?.kind === "counter") {
    return policy.chooseCounterResponse(view, findLatestEvent(session, seat, "counterWindowOpened"));
  }
  if (window?.kind === "alliance") {
    return policy.chooseAllianceResponse(view, findLatestEvent(session, seat, "alliancePrompt"));
  }
  if (window?.kind === "evade") {
    return policy.chooseEvadeResponse(view, window.permanentId);
  }
  if (window?.kind === "barrier") {
    return policy.chooseBarrierResponse(view, window.permanentId);
  }
  if (state.phase === Phase.Breeding) {
    return policy.chooseBreedingAction(view);
  }
  return policy.chooseMainAction(view);
}

async function playWithBots({ session, policies, maxSteps }: PlayWithBotsParams) {
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
    const view = buildBotView(state, seat);
    if (!view) {
      throw new Error(`No bot view for seat ${seat}`);
    }
    const tooManyRejections = consecutiveRejections >= MAX_CONSECUTIVE_REJECTIONS;
    const intent: Intent = tooManyRejections ? { type: "endPhase" } : chooseIntent({ session, policy, seat, view });
    const result = await session.act({ seat, intent });
    if (result.ok) {
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
});
