import { describe, expect, it } from "vitest";
import { BotDifficulty } from "@aegis/shared/bot/BotDifficulty";
import { BotStyle } from "@aegis/shared/bot/BotStyle";
import type { Seat } from "@aegis/shared/schema/enums";
import { createBasicBotPolicy } from "#api/simulator/bots/createBasicBotPolicy";
import { startBotSeat } from "#api/simulator/bots/startBotSeat";
import { resolveSimulatorDeck } from "#api/simulator/server/resolveSimulatorDeck";
import { SimulatorSession } from "#api/simulator/SimulatorSession";

type CreateBotParams = { seat: Seat; style: BotStyle; difficulty: BotDifficulty; errors: unknown[] };

type PlayAsHumanParams = { seat: Seat; maxSteps: number };

let session: SimulatorSession;

async function startSession(seed: number): Promise<void> {
  session = SimulatorSession.create({
    seed,
    players: [
      { displayName: "Mateo", deck: resolveSimulatorDeck("bt5-shoutmon-dx@1") },
      { displayName: "Bot", deck: resolveSimulatorDeck("bt6-red-jesmon@1") },
    ],
  });
  await session.start();
}

function startBot({ seat, style, difficulty, errors }: CreateBotParams) {
  return startBotSeat({
    session,
    seat,
    policy: createBasicBotPolicy({ style, difficulty, seed: 40 + seat }),
    thinkDelayMs: 0,
    onError: (error) => {
      errors.push(error);
    },
  });
}

function waitForGameOver(timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (session.getResult()) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("The game did not end in time"));
    }, timeoutMs);
    const unsubscribe = session.subscribe(({ event }) => {
      if (event.kind === "gameOver") {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

async function playAsHuman({ seat, maxSteps }: PlayAsHumanParams): Promise<void> {
  for (let step = 0; step < maxSteps; step++) {
    await session.whenIdle();
    if (session.getResult()) {
      return;
    }
    if (session.getSeatToAct() !== seat) {
      await new Promise((resolve) => setImmediate(resolve));
      continue;
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
  throw new Error(`The human seat did not see the game end within ${maxSteps} steps`);
}

describe("startBotSeat", () => {
  it("lets two bots of each style play a whole game against each other", async () => {
    for (const [index, { value: style }] of Object.values(BotStyle).entries()) {
      await startSession(20 + index);
      const errors: unknown[] = [];
      const bots = [
        startBot({ seat: 0, style, difficulty: BotDifficulty.STANDARD.value, errors }),
        startBot({ seat: 1, style, difficulty: BotDifficulty.BEGINNER.value, errors }),
      ];
      await waitForGameOver(60_000);
      for (const bot of bots) {
        bot.stop();
      }
      expect(errors).toEqual([]);
      expect(session.getResult()?.outcome).toMatch(/^(win|draw)$/);
    }
  }, 180_000);

  it("plays its seat against a human seat until the game ends", async () => {
    await startSession(31);
    const errors: unknown[] = [];
    const bot = startBot({ seat: 1, style: BotStyle.AGGRESSIVE.value, difficulty: BotDifficulty.CASUAL.value, errors });
    await playAsHuman({ seat: 0, maxSteps: 50_000 });
    bot.stop();
    expect(errors).toEqual([]);
    expect(session.getResult()).toBeDefined();
  }, 120_000);

  it("never moves once stopped", async () => {
    await startSession(3);
    const seat = session.getSeatToAct()!;
    const errors: unknown[] = [];
    const bot = startBot({ seat, style: BotStyle.BALANCED.value, difficulty: BotDifficulty.STANDARD.value, errors });
    bot.stop();
    const { version } = session.getLegalActions(seat);
    for (let tick = 0; tick < 20; tick++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    await session.whenIdle();
    expect(session.getLegalActions(seat).version).toBe(version);
    expect(session.getSeatToAct()).toBe(seat);
    expect(errors).toEqual([]);
  });
});
