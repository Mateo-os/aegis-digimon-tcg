import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { Seat } from "@aegis/shared/schema/enums";
import {
  createSimulatorHttpClient,
  type ActionsResponse,
  type CardResponse,
} from "#api/simulator/client/createSimulatorHttpClient";
import { parseTerminalCommand, type TerminalCommand } from "#api/simulator/client/parseTerminalCommand";
import type { SimulatorEvent } from "#api/simulator/SimulatorSession";
import { createEventNarrator } from "#api/simulator/text/createEventNarrator";

type Params = { url: string; token: string; input: Readable; output: Writable; waitTimeoutMs?: number };

const DEFAULT_WAIT_TIMEOUT_MS = 25_000;

const HELP = `Commands:
  <n> [keys]      take action n (same as: do <n> [keys]), e.g. 3 or 4 a c
  b, board        show the board
  a, actions      show your actions
  c, card <id>    show a card's full text, e.g. card BT1-010
  l, log [n]      show the last n events (default 10)
  h, help         show this help
  q, quit         leave (the game keeps running on the server)`;

function formatCardText(card: CardResponse): string {
  const header = [
    `${card.name} (${card.cardId})`,
    card.kinds.join("/"),
    card.colors.join("/"),
    card.level === undefined ? undefined : `Lv${card.level}`,
    card.playCost === undefined ? undefined : `cost ${card.playCost}`,
    card.dp === undefined ? undefined : `DP ${card.dp}`,
  ].filter((part) => part !== undefined && part !== "");
  return [
    header.join(" · "),
    ...(card.types?.length ? [`Traits: ${card.types.join(", ")}`] : []),
    ...(card.effectText ? [card.effectText] : []),
    ...(card.inheritedEffectText ? [`Inherited: ${card.inheritedEffectText}`] : []),
    ...(card.securityEffectText ? [`Security: ${card.securityEffectText}`] : []),
  ].join("\n");
}

export async function runTerminalClient({
  url,
  token,
  input,
  output,
  waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
}: Params): Promise<void> {
  const client = createSimulatorHttpClient({ url, token });
  const first = await client.getView();
  const seat: Seat = first.view.seat;
  const opponentName = first.view.opponent.displayName;
  const narrator = createEventNarrator({
    viewerSeat: seat,
    playerNames: seat === 0 ? [first.view.you.displayName, opponentName] : [opponentName, first.view.you.displayName],
  });
  for (const entry of (await client.getEvents(0)).events) {
    narrator.describe(entry.event);
  }
  const readline = createInterface({ input, output, prompt: "> " });
  const abort = new AbortController();
  let lastSeq = first.lastSeq;
  let latestActions: ActionsResponse | undefined;
  let lastBoardTurn = -1;
  let stopped = false;
  let releaseMove: (() => void) | undefined;

  const print = (text: string) => {
    output.write(`${text}\n`);
    if (!stopped) {
      readline.prompt(true);
    }
  };

  const printEvents = (events: readonly SimulatorEvent[]) => {
    const lines: string[] = [];
    for (const entry of events) {
      if (entry.seq <= lastSeq) {
        continue;
      }
      lastSeq = entry.seq;
      const line = narrator.describe(entry.event);
      if (line) {
        lines.push(`  ${line.replaceAll("\n", "\n  ")}`);
      }
    }
    if (lines.length > 0) {
      print(lines.join("\n"));
    }
  };

  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    abort.abort();
    releaseMove?.();
    readline.close();
  };

  const showMove = async () => {
    const { view, text } = await client.getView();
    latestActions = await client.getActions();
    const boardText = view.turnCount === lastBoardTurn ? text.split("\n").slice(0, 2).join("\n") : text;
    lastBoardTurn = view.turnCount;
    print(`\n${boardText}\n\n${latestActions.text}\nYour move.`);
  };

  const isRunning = () => !stopped;

  const followGame = async () => {
    while (isRunning()) {
      const waited = await client.wait({ after: lastSeq, timeoutMs: waitTimeoutMs, signal: abort.signal });
      printEvents(waited.events);
      if (waited.status === "game-over") {
        const { text } = await client.getView();
        print(`\n${text}`);
        stop();
        return;
      }
      if (waited.status === "your-move") {
        await new Promise<void>((resolve) => {
          releaseMove = resolve;
          void showMove().catch((error: unknown) => {
            print(`Could not load your move: ${String(error)}`);
          });
        });
      }
    }
  };

  const takeAction = async (command: Extract<TerminalCommand, { kind: "do" }>) => {
    latestActions ??= await client.getActions();
    const result = await client.act({
      actionId: command.actionId,
      version: latestActions.version,
      choice: command.choice,
    });
    if (!result.ok) {
      print(`Not done: ${result.message ?? result.reason}`);
      if (result.reason === "stale-actions") {
        latestActions = await client.getActions();
        print(latestActions.text);
      }
      return;
    }
    latestActions = undefined;
    printEvents(result.events);
    if (result.seatToAct !== seat) {
      print(`Waiting for ${opponentName}…`);
    }
    const release = releaseMove;
    releaseMove = undefined;
    release?.();
  };

  const runCommand = async (command: TerminalCommand) => {
    switch (command.kind) {
      case "empty":
        return;
      case "invalid":
        print(command.message);
        return;
      case "help":
        print(HELP);
        return;
      case "quit":
        stop();
        return;
      case "board":
        print((await client.getView()).text);
        return;
      case "actions":
        latestActions = await client.getActions();
        print(latestActions.text);
        return;
      case "card":
        print(formatCardText(await client.getCard(command.cardId)));
        return;
      case "log": {
        const { events } = await client.getEvents(Math.max(0, lastSeq - command.count));
        const lines = events.map((entry) => narrator.describe(entry.event)).filter((line) => line !== undefined);
        print(lines.length > 0 ? lines.join("\n") : "Nothing to show.");
        return;
      }
      case "do":
        await takeAction(command);
        return;
    }
  };

  print(`You are ${first.view.you.displayName} (seat ${seat}) against ${opponentName}. Type help for commands.`);
  print(first.text);
  lastBoardTurn = first.view.turnCount;
  readline.on("line", (line) => {
    void runCommand(parseTerminalCommand(line)).catch((error: unknown) => {
      print(`Error: ${error instanceof Error ? error.message : String(error)}`);
    });
  });
  readline.on("close", stop);
  readline.prompt();
  await followGame().catch((error: unknown) => {
    if (!stopped) {
      output.write(`Lost the connection: ${error instanceof Error ? error.message : String(error)}\n`);
      stop();
    }
  });
}
