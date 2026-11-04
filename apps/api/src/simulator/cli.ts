import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

process.env.NODE_ENV = "test";
process.env.AEGIS_STRICT_EFFECTS ??= "0";
console.log =
  console.info =
  console.debug =
    (...values: unknown[]) => {
      console.error(...values);
    };

const USAGE = `Usage:
  pnpm sim serve --deck0 <deck> --deck1 <deck> [options]
  pnpm sim serve --load <game.json> [options]
  pnpm sim play --token <token> [--url http://127.0.0.1:7777]
  pnpm sim decks

A <deck> is a deck file (.json with mainDeck and eggDeck), a meta deck version, or a tournament deck version.

Options:
  --name0, --name1       Player names (default "Player 1", "Player 2")
  --seed <n>             Shuffle seed (default: random)
  --first-seat <0|1>     Who goes first (default: decided by the seed)
  --port <n>             Port to listen on (default 7777)
  --save <game.json>     Save the game after every accepted action
  --load <game.json>     Resume a saved game
  --token0, --token1     Fixed seat tokens (default: random each start)`;

const OPTIONS = {
  deck0: { type: "string" },
  deck1: { type: "string" },
  name0: { type: "string" },
  name1: { type: "string" },
  seed: { type: "string" },
  "first-seat": { type: "string" },
  port: { type: "string", default: "7777" },
  save: { type: "string" },
  load: { type: "string" },
  token0: { type: "string" },
  token1: { type: "string" },
  token: { type: "string" },
  url: { type: "string", default: "http://127.0.0.1:7777" },
} as const;

type ServeOptions = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>["values"];

function readInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`--${name} must be an integer`);
  }
  return parsed;
}

function readSeat(value: string | undefined): 0 | 1 | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value !== "0" && value !== "1") {
    throw new Error("--first-seat must be 0 or 1");
  }
  return value === "0" ? 0 : 1;
}

async function listDecks(): Promise<void> {
  const { ALL_META_DECKS } = await import("#api/bot/metaDecks/index");
  const { default: digilabDecks } = await import("#api/bot/evolution/digilab-decks.json", { with: { type: "json" } });
  process.stdout.write("Meta decks:\n");
  for (const deck of ALL_META_DECKS) {
    process.stdout.write(`  ${deck.deckVersion}\n`);
  }
  process.stdout.write("Tournament decks:\n");
  for (const deck of (digilabDecks as unknown as { decks: { deckVersion: string; name: string }[] }).decks) {
    process.stdout.write(`  ${deck.deckVersion}  (${deck.name})\n`);
  }
}

function resolveUserPath(path: string): string {
  return resolve(process.env.INIT_CWD ?? process.cwd(), path);
}

function resolveDeckSpec(spec: string): string {
  return spec.endsWith(".json") ? resolveUserPath(spec) : spec;
}

async function createSession(options: ServeOptions) {
  const names = [options.name0 ?? "Player 1", options.name1 ?? "Player 2"] as const;
  if (options.load) {
    const { loadSimulatorSession } = await import("#api/simulator/loadSimulatorSession");
    const record = JSON.parse(readFileSync(resolveUserPath(options.load), "utf8"));
    return loadSimulatorSession({ record, displayNames: names });
  }
  if (!options.deck0 || !options.deck1) {
    throw new Error("Give both decks with --deck0 and --deck1, or resume a game with --load");
  }
  const { resolveSimulatorDeck } = await import("#api/simulator/server/resolveSimulatorDeck");
  const { SimulatorSession } = await import("#api/simulator/SimulatorSession");
  const firstSeat = readSeat(options["first-seat"]);
  const session = SimulatorSession.create({
    seed: readInteger(options.seed, "seed") ?? Math.floor(Math.random() * 2 ** 31),
    ...(firstSeat === undefined ? {} : { firstSeat }),
    players: [
      { displayName: names[0], deck: resolveSimulatorDeck(resolveDeckSpec(options.deck0)) },
      { displayName: names[1], deck: resolveSimulatorDeck(resolveDeckSpec(options.deck1)) },
    ],
  });
  await session.start();
  return session;
}

async function serve(options: ServeOptions): Promise<void> {
  const session = await createSession(options);
  const { startSimulatorServer } = await import("#api/simulator/server/startSimulatorServer");
  const requestedSavePath = options.save ?? options.load;
  const savePath = requestedSavePath ? resolveUserPath(requestedSavePath) : undefined;
  const server = await startSimulatorServer({
    session,
    port: readInteger(options.port, "port") ?? 7777,
    ...(savePath ? { savePath } : {}),
    seatTokens: [options.token0, options.token1],
  });
  const view = session.getSeatView(0);
  process.stdout.write(
    [
      `Aegis simulator running at ${server.url}`,
      `  Seat 0 (${view.you.displayName}): token ${server.seatTokens[0]}`,
      `  Seat 1 (${view.opponent.displayName}): token ${server.seatTokens[1]}`,
      ...(savePath ? [`  Saving to ${savePath}`] : []),
      "Press Ctrl+C to stop.",
      "",
    ].join("\n"),
  );
  process.once("SIGINT", () => {
    void server.close().then(() => {
      process.exit(0);
    });
  });
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({ options: OPTIONS, allowPositionals: true });
  const [command] = positionals;
  if (command === "decks") {
    await listDecks();
    return 0;
  }
  if (command === "serve") {
    await serve(values);
    return 0;
  }
  if (command === "play") {
    if (!values.token) {
      throw new Error("Give your seat token with --token (the server prints one per seat)");
    }
    const { runTerminalClient } = await import("#api/simulator/client/runTerminalClient");
    await runTerminalClient({ url: values.url, token: values.token, input: process.stdin, output: process.stdout });
    return 0;
  }
  process.stderr.write(`${USAGE}\n`);
  return 2;
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}\n`);
  process.exitCode = 2;
}
