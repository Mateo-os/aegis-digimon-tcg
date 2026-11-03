import { REPLAY_FORMAT, type ReplayInput, type ReplayRecord } from "#api/replays/inputs/types";
import { SimulatorSession, type ActResult } from "#api/simulator/SimulatorSession";

type Params = { record: ReplayRecord; displayNames?: readonly [string, string] };

type IntentInput = Extract<ReplayInput, { kind: "intent" }>;

type ReplayOutcome = "accepted" | "rejected" | "threw";

const DEFAULT_DISPLAY_NAMES: readonly [string, string] = ["Player 1", "Player 2"];

function getRecordedOutcome(input: IntentInput): ReplayOutcome {
  if (input.threw) {
    return "threw";
  }
  if (input.ok === false) {
    return "rejected";
  }
  return "accepted";
}

function getReplayedOutcome(result: ActResult): ReplayOutcome {
  if (result.ok) {
    return "accepted";
  }
  if (result.reason === "engine-error") {
    return "threw";
  }
  return "rejected";
}

export async function loadSimulatorSession({ record, displayNames = DEFAULT_DISPLAY_NAMES }: Params) {
  if (record.format !== REPLAY_FORMAT) {
    throw new Error(`Unsupported replay format: ${String(record.format)}`);
  }
  const session = SimulatorSession.create({
    seed: record.seed,
    ...(record.firstSeat === undefined ? {} : { firstSeat: record.firstSeat }),
    players: [
      {
        displayName: displayNames[0],
        deck: { mainDeck: [...record.seats[0].deck.mainDeck], eggDeck: [...record.seats[0].deck.eggDeck] },
      },
      {
        displayName: displayNames[1],
        deck: { mainDeck: [...record.seats[1].deck.mainDeck], eggDeck: [...record.seats[1].deck.eggDeck] },
      },
    ],
  });
  for (const [index, input] of record.inputs.entries()) {
    if (input.kind === "seat") {
      continue;
    }
    if (input.kind === "startMatch") {
      await session.start();
      continue;
    }
    if (input.kind !== "intent") {
      throw new Error(`Input ${index} is a "${input.kind}" input, which the simulator cannot replay`);
    }
    const expected = getRecordedOutcome(input);
    const actual = getReplayedOutcome(await session.act({ seat: input.seat, intent: input.intent }));
    if (actual !== expected) {
      throw new Error(
        `The replay diverged at input ${index}: seat ${input.seat}'s ${input.intent.type} was ${expected} when recorded but ${actual} when replayed`,
      );
    }
  }
  return session;
}
