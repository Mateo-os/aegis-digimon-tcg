import type { Seat } from "@aegis/shared/schema/enums";
import type { BotPolicy } from "#api/bot/policy";
import { chooseBotIntent } from "#api/simulator/bots/chooseBotIntent";
import { filterEventForSeat } from "#api/simulator/filterEventForSeat";
import type { SimulatorSession } from "#api/simulator/SimulatorSession";

type Params = {
  session: SimulatorSession;
  seat: Seat;
  policy: BotPolicy;
  thinkDelayMs?: number;
  onError?: (error: unknown) => void;
};

export type BotSeat = { stop: () => void };

const DEFAULT_THINK_DELAY_MS = 600;
const MAX_POLICY_REJECTIONS = 10;
const MAX_TOTAL_REJECTIONS = 30;

function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

type FallbackParams = { session: SimulatorSession; seat: Seat };

async function playFirstListedAction({ session, seat }: FallbackParams) {
  const { version, actions } = session.getLegalActions(seat);
  const action = actions.find((candidate) => candidate.kind !== "fixed" || candidate.intent.type !== "surrender");
  if (!action) {
    return { ok: false as const };
  }
  const choice =
    action.kind === "fixed"
      ? []
      : action.candidates.slice(0, action.kind === "pick" ? action.min : undefined).map((card) => card.key);
  return session.actOnAction({ seat, actionId: action.id, choice, version });
}

export function startBotSeat({
  session,
  seat,
  policy,
  thinkDelayMs = DEFAULT_THINK_DELAY_MS,
  onError,
}: Params): BotSeat {
  let stopped = false;
  let running = false;
  let wakeAgain = false;
  let lastTurn = -1;
  let rejections = 0;

  const isBotToAct = () => !stopped && session.getResult() === undefined && session.getSeatToAct() === seat;
  const shouldRunAgain = () => wakeAgain && !stopped;

  const actOnce = async () => {
    const turn = session.getState().turnCount;
    if (turn !== lastTurn) {
      lastTurn = turn;
      policy.onTurnStart();
    }
    if (rejections >= MAX_POLICY_REJECTIONS) {
      const fallback = await playFirstListedAction({ session, seat });
      rejections = fallback.ok ? 0 : rejections + 1;
      return;
    }
    const intent = chooseBotIntent({ session, policy, seat });
    const result = await session.act({ seat, intent });
    if (result.ok) {
      rejections = 0;
      return;
    }
    rejections++;
    policy.noteRejected(intent);
  };

  const run = async () => {
    if (running) {
      wakeAgain = true;
      return;
    }
    running = true;
    try {
      do {
        wakeAgain = false;
        await session.whenIdle();
        while (isBotToAct()) {
          if (rejections >= MAX_TOTAL_REJECTIONS) {
            throw new Error(`The seat ${seat} bot is stuck: none of its moves are accepted`);
          }
          if (thinkDelayMs > 0) {
            await waitFor(thinkDelayMs);
          }
          await session.whenIdle();
          if (!isBotToAct()) {
            break;
          }
          await actOnce();
        }
      } while (shouldRunAgain());
    } catch (error) {
      onError?.(error);
    } finally {
      running = false;
    }
  };

  const unsubscribeSettled = session.subscribeToSettled(() => {
    void run();
  });
  const unsubscribeEvents = session.subscribe(({ event }) => {
    policy.observeEvent?.(filterEventForSeat(event, seat));
  });
  void run();

  return {
    stop: () => {
      stopped = true;
      unsubscribeSettled();
      unsubscribeEvents();
    },
  };
}
