import type { DecisionRequest, ServerEvent } from "@aegis/shared/protocol/events";
import type { Intent, RejectReason } from "@aegis/shared/protocol/intents";
import type { Seat } from "@aegis/shared/schema/enums";
import { GameState } from "@aegis/shared/schema/GameState";
import { createMatchReplayRecorder } from "#api/bot/createMatchReplayRecorder";
import { GameEngine } from "#api/engine/GameEngine";
import type { ReplayRecord } from "#api/replays/inputs/types";
import { filterEventForSeat } from "#api/simulator/filterEventForSeat";
import { findSeatToAct } from "#api/simulator/findSeatToAct";
import "#api/cards/index";

export type SimulatorDeck = { mainDeck: string[]; eggDeck: string[] };

export type SimulatorPlayer = { displayName: string; deck: SimulatorDeck };

export type SimulatorEvent = { seq: number; event: ServerEvent };

type GameOverEvent = Extract<ServerEvent, { kind: "gameOver" }>;

export type SimulatorResult = GameOverEvent["result"] & { reason: GameOverEvent["reason"] };

export type SimulatorRejectReason = RejectReason | "not-seat-to-act" | "engine-error";

export type ActResult =
  | { ok: true; events: SimulatorEvent[]; seatToAct: Seat | undefined }
  | { ok: false; reason: SimulatorRejectReason; message?: string; events: SimulatorEvent[] };

export type SimulatorEventListener = (event: SimulatorEvent) => void;

type CreateParams = { seed: number; players: readonly [SimulatorPlayer, SimulatorPlayer]; firstSeat?: Seat };

type ActParams = { seat: Seat; intent: Intent };

type GetEventsParams = { seat: Seat; afterSeq: number };

type Recorder = ReturnType<typeof createMatchReplayRecorder>;

const SETTLE_QUIET_TICKS = 5;
const SETTLE_MAX_TICKS = 5_000;

function waitForNextTick(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

export class SimulatorSession {
  private readonly state = new GameState();
  private readonly engine: GameEngine;
  private readonly recorder: Recorder;
  private readonly log: SimulatorEvent[] = [];
  private readonly decisionRequests = new Map<Seat, DecisionRequest>();
  private readonly listeners = new Set<SimulatorEventListener>();
  private queue: Promise<unknown> = Promise.resolve();
  private result: SimulatorResult | undefined;
  private started = false;

  private constructor({ seed, players, firstSeat }: CreateParams) {
    this.recorder = createMatchReplayRecorder({ seed, firstSeat, state: this.state });
    this.engine = new GameEngine(this.state, {
      seed,
      firstSeat,
      emit: (event) => {
        this.recordEvent(event);
      },
      requestDecision: (seat, request) => {
        this.decisionRequests.set(seat, request);
      },
    });
    for (const seat of [0, 1] as const) {
      const player = players[seat];
      const deck = { mainDeck: [...player.deck.mainDeck], eggDeck: [...player.deck.eggDeck] };
      this.recorder.seatPlayer(seat, deck, () => {
        this.engine.seatPlayer(seat, `simulator-${seat}`, { displayName: player.displayName, deck });
      });
    }
  }

  static create(params: CreateParams): SimulatorSession {
    return new SimulatorSession(params);
  }

  start(): Promise<void> {
    return this.runExclusive(async () => {
      if (this.started) {
        throw new Error("The simulator session has already started");
      }
      this.started = true;
      this.recorder.startMatch(() => {
        this.engine.startMatch();
      });
      await this.settle();
    });
  }

  act({ seat, intent }: ActParams): Promise<ActResult> {
    return this.runExclusive(async () => {
      const afterSeq = this.log.length;
      if (!this.started || findSeatToAct(this.state) !== seat) {
        return { ok: false, reason: "not-seat-to-act", events: [] };
      }
      try {
        const result = this.recorder.applyIntent(seat, intent, () => this.engine.applyIntent(seat, intent));
        if (!result.ok) {
          return { ok: false, reason: result.reason, events: this.getEvents({ seat, afterSeq }) };
        }
      } catch (error) {
        return {
          ok: false,
          reason: "engine-error",
          message: error instanceof Error ? error.message : String(error),
          events: this.getEvents({ seat, afterSeq }),
        };
      }
      await this.settle();
      return { ok: true, events: this.getEvents({ seat, afterSeq }), seatToAct: findSeatToAct(this.state) };
    });
  }

  getSeatToAct(): Seat | undefined {
    return findSeatToAct(this.state);
  }

  getDecisionRequest(seat: Seat): DecisionRequest | undefined {
    const request = this.decisionRequests.get(seat);
    const pending = this.state.pendingDecision;
    if (request === undefined || pending === undefined) {
      return undefined;
    }
    if (pending.seat !== seat || pending.decisionId !== request.decisionId) {
      return undefined;
    }
    return request;
  }

  getEvents({ seat, afterSeq }: GetEventsParams): SimulatorEvent[] {
    return this.log
      .filter((entry) => entry.seq > afterSeq)
      .map((entry) => ({ seq: entry.seq, event: filterEventForSeat(entry.event, seat) }));
  }

  getLastSeq(): number {
    return this.log.length;
  }

  getResult(): SimulatorResult | undefined {
    return this.result;
  }

  getState(): GameState {
    return this.state;
  }

  getRecord(): ReplayRecord {
    return this.recorder.buildRecord();
  }

  subscribe(listener: SimulatorEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private recordEvent(event: ServerEvent): void {
    this.recorder.noteEvent();
    const entry = { seq: this.log.length + 1, event: structuredClone(event) };
    this.log.push(entry);
    if (event.kind === "gameOver") {
      this.result = { ...event.result, reason: event.reason };
    }
    for (const listener of this.listeners) {
      listener(entry);
    }
  }

  private async settle(): Promise<void> {
    let quietTicks = 0;
    let lastSeq = this.log.length;
    for (let tick = 0; tick < SETTLE_MAX_TICKS; tick++) {
      await waitForNextTick();
      const someoneMustAct = this.state.gameOver || findSeatToAct(this.state) !== undefined;
      if (this.log.length !== lastSeq || !someoneMustAct) {
        lastSeq = this.log.length;
        quietTicks = 0;
        continue;
      }
      quietTicks++;
      if (quietTicks >= SETTLE_QUIET_TICKS) {
        return;
      }
    }
    throw new Error(
      `The simulator stalled: nobody can act at turn ${this.state.turnCount} in phase ${this.state.phase}`,
    );
  }

  private runExclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
