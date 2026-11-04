import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Seat } from "@aegis/shared/schema/enums";
import type { SimulatorAction } from "#api/simulator/actions/SimulatorAction";
import { createSimulatorHttpClient } from "#api/simulator/client/createSimulatorHttpClient";
import { runTerminalClient } from "#api/simulator/client/runTerminalClient";
import { resolveSimulatorDeck } from "#api/simulator/server/resolveSimulatorDeck";
import { startSimulatorServer, type SimulatorServer } from "#api/simulator/server/startSimulatorServer";
import { SimulatorSession } from "#api/simulator/SimulatorSession";

type Terminal = { input: PassThrough; read: () => string; done: Promise<void> };

type PlayOverHttpParams = { token: string; seat: Seat; isFinished: () => boolean };

const TOKENS = ["token-zero", "token-one"] as const;

const running: SimulatorServer[] = [];

async function startServer(seed: number): Promise<{ server: SimulatorServer; session: SimulatorSession }> {
  const session = SimulatorSession.create({
    seed,
    players: [
      { displayName: "Mateo", deck: resolveSimulatorDeck("bt5-shoutmon-dx@1") },
      { displayName: "Claude", deck: resolveSimulatorDeck("bt6-red-jesmon@1") },
    ],
  });
  await session.start();
  const server = await startSimulatorServer({ session, port: 0, seatTokens: TOKENS });
  running.push(server);
  return { server, session };
}

function openTerminal(server: SimulatorServer, token: string): Terminal {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = "";
  output.on("data", (chunk: Buffer) => {
    written += chunk.toString();
  });
  const done = runTerminalClient({ url: server.url, token, input, output, waitTimeoutMs: 2_000 });
  return { input, read: () => written, done };
}

function chooseCommand(action: SimulatorAction): string {
  if (action.kind === "fixed") {
    return `${action.id}`;
  }
  const keys = action.candidates.slice(0, action.kind === "pick" ? action.min : undefined).map((card) => card.key);
  return `${action.id} ${keys.join(" ")}`.trim();
}

function pickAction(actions: readonly SimulatorAction[], step: number): SimulatorAction | undefined {
  const playable = actions.filter((action) => action.kind !== "fixed" || action.intent.type !== "surrender");
  return playable[step % Math.max(1, playable.length)];
}

async function playOverHttp(server: SimulatorServer, { token, seat, isFinished }: PlayOverHttpParams): Promise<void> {
  const client = createSimulatorHttpClient({ url: server.url, token });
  let lastSeq = 0;
  for (let step = 0; !isFinished(); step++) {
    const waited = await client.wait({ after: lastSeq, timeoutMs: 1_000 });
    lastSeq = waited.lastSeq;
    if (waited.status === "game-over") {
      return;
    }
    if (waited.status !== "your-move") {
      continue;
    }
    const list = await client.getActions();
    const action = pickAction(list.actions, step + seat);
    if (!action) {
      continue;
    }
    const keys = action.kind === "fixed" ? [] : chooseCommand(action).split(" ").slice(1);
    await client.act({ actionId: action.id, version: list.version, choice: keys });
  }
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
});

describe("runTerminalClient", () => {
  it("greets the player, shows the board and answers commands", async () => {
    const { server } = await startServer(3);
    const terminal = openTerminal(server, TOKENS[0]);
    await vi.waitFor(() => {
      expect(terminal.read()).toContain("You are Mateo (seat 0) against Claude.");
    });
    expect(terminal.read()).toContain("You (Mateo): hand 5");
    terminal.input.write("help\n");
    await vi.waitFor(() => {
      expect(terminal.read()).toContain("Commands:");
    });
    terminal.input.write("card ex12-036\n");
    await vi.waitFor(() => {
      expect(terminal.read()).toContain("Ryugumon (EX12-036)");
    });
    terminal.input.write("dance\n");
    await vi.waitFor(() => {
      expect(terminal.read()).toContain('Unknown command "dance"');
    });
    terminal.input.write("quit\n");
    await terminal.done;
  });

  it("shows the move, takes an action by number and then waits for the opponent", async () => {
    const { server, session } = await startServer(3);
    const seat = session.getSeatToAct()!;
    const terminal = openTerminal(server, TOKENS[seat]);
    await vi.waitFor(() => {
      expect(terminal.read()).toContain("Your move.");
    });
    expect(terminal.read()).toContain("1. Keep your opening hand");
    terminal.input.write("1\n");
    await vi.waitFor(() => {
      expect(terminal.read()).toContain("Waiting for");
    });
    expect(session.getSeatToAct()).not.toBe(seat);
    terminal.input.write("quit\n");
    await terminal.done;
  });

  it("explains a refused choice without leaving the move", async () => {
    const { server, session } = await startServer(3);
    const seat = session.getSeatToAct()!;
    const terminal = openTerminal(server, TOKENS[seat]);
    await vi.waitFor(() => {
      expect(terminal.read()).toContain("Your move.");
    });
    terminal.input.write("1 a\n");
    await vi.waitFor(() => {
      expect(terminal.read()).toContain("Not done: Action 1 takes no card choice");
    });
    expect(session.getSeatToAct()).toBe(seat);
    terminal.input.write("quit\n");
    await terminal.done;
  });

  it("plays a whole game typed into the terminal against an HTTP opponent", async () => {
    const { server, session } = await startServer(11);
    const terminal = openTerminal(server, TOKENS[0]);
    const client = createSimulatorHttpClient({ url: server.url, token: TOKENS[0] });
    let finished = false;
    const opponent = playOverHttp(server, { token: TOKENS[1], seat: 1, isFinished: () => finished });
    let seenMoves = 0;
    let typed = 0;
    while (!finished) {
      const moves = terminal.read().split("Your move.").length - 1;
      if (moves > seenMoves) {
        seenMoves = moves;
        const list = await client.getActions();
        const action = pickAction(list.actions, typed);
        if (action) {
          terminal.input.write(`${chooseCommand(action)}\n`);
          typed++;
        }
      }
      finished = session.getResult() !== undefined;
      await new Promise((resolve) => setImmediate(resolve));
    }
    await terminal.done;
    await opponent;
    expect(typed).toBeGreaterThan(5);
    expect(terminal.read()).toContain("Game over:");
  }, 120_000);
});
