import type { Seat } from "@aegis/shared/schema/enums";
import type { SimulatorEvent, SimulatorSession } from "#api/simulator/SimulatorSession";

type Params = { session: SimulatorSession; seat: Seat; afterSeq: number; timeoutMs: number; signal?: AbortSignal };

export type WaitStatus = "your-move" | "game-over" | "timeout";

export type WaitResult = {
  status: WaitStatus;
  seatToAct: Seat | undefined;
  events: SimulatorEvent[];
  lastSeq: number;
};

type ReadyParams = { session: SimulatorSession; seat: Seat };

function findReadyStatus({ session, seat }: ReadyParams): WaitStatus | undefined {
  if (session.getResult() !== undefined) {
    return "game-over";
  }
  if (session.getSeatToAct() === seat) {
    return "your-move";
  }
  return undefined;
}

export async function waitForSeatTurn({ session, seat, afterSeq, timeoutMs, signal }: Params): Promise<WaitResult> {
  await session.whenIdle();
  const buildResult = (status: WaitStatus): WaitResult => ({
    status,
    seatToAct: session.getSeatToAct(),
    events: session.getEvents({ seat, afterSeq }),
    lastSeq: session.getLastSeq(),
  });
  const ready = findReadyStatus({ session, seat });
  if (ready) {
    return buildResult(ready);
  }
  return new Promise<WaitResult>((resolve) => {
    let finished = false;
    const cleanups: (() => void)[] = [];
    const finish = (status: WaitStatus) => {
      if (finished) {
        return;
      }
      finished = true;
      for (const cleanup of cleanups) {
        cleanup();
      }
      resolve(buildResult(status));
    };
    const timer = setTimeout(() => {
      finish("timeout");
    }, timeoutMs);
    cleanups.push(() => {
      clearTimeout(timer);
    });
    const check = () => {
      void session.whenIdle().then(() => {
        const status = findReadyStatus({ session, seat });
        if (status) {
          finish(status);
        }
      });
    };
    cleanups.push(session.subscribe(check), session.subscribeToSettled(check));
    if (signal) {
      const onAbort = () => {
        finish("timeout");
      };
      signal.addEventListener("abort", onAbort, { once: true });
      cleanups.push(() => {
        signal.removeEventListener("abort", onAbort);
      });
    }
  });
}
