import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { BotDifficulty } from "@aegis/shared/bot/BotDifficulty";
import { BotStyle } from "@aegis/shared/bot/BotStyle";
import { isBotDifficulty } from "@aegis/shared/bot/isBotDifficulty";
import { isBotStyle } from "@aegis/shared/bot/isBotStyle";

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
  --host <address>       Address to listen on (default 127.0.0.1, this machine only;
                         0.0.0.0 lets other machines on your network connect)
  --save <game.json>     Save the game after every accepted action
  --load <game.json>     Resume a saved game
  --token0, --token1     Fixed seat tokens (default: random each start)
  --bot0, --bot1 <style> Let a bot play that seat: balanced, aggressive or defensive
  --bot0-level, --bot1-level <level>
                         The bot's level: beginner, casual or standard (default standard)
  --bot-delay <ms>       How long bots think before each move (default 600)`;

const OPTIONS = {
  deck0: { type: "string" },
  deck1: { type: "string" },
  name0: { type: "string" },
  name1: { type: "string" },
  seed: { type: "string" },
  "first-seat": { type: "string" },
  port: { type: "string", default: "7777" },
  host: { type: "string", default: "127.0.0.1" },
  save: { type: "string" },
  load: { type: "string" },
  token0: { type: "string" },
  token1: { type: "string" },
  token: { type: "string" },
  url: { type: "string", default: "http://127.0.0.1:7777" },
  bot0: { type: "string" },
  bot1: { type: "string" },
  "bot0-level": { type: "string" },
  "bot1-level": { type: "string" },
  "bot-delay": { type: "string" },
} as const;

type BotSetup = { style: BotStyle; difficulty: BotDifficulty };

const SEATS = [0, 1] as const;

const LOCAL_ONLY_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "::1"]);
const ALL_INTERFACE_HOSTS: ReadonlySet<string> = new Set(["0.0.0.0", "::"]);

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

function readBotSetup(options: ServeOptions, seat: 0 | 1): BotSetup | undefined {
  const style = seat === 0 ? options.bot0 : options.bot1;
  const level = (seat === 0 ? options["bot0-level"] : options["bot1-level"]) ?? BotDifficulty.STANDARD.value;
  if (style === undefined) {
    return undefined;
  }
  if (!isBotStyle(style)) {
    throw new Error(
      `--bot${seat} must be one of: ${Object.values(BotStyle)
        .map((entry) => entry.value)
        .join(", ")}`,
    );
  }
  if (!isBotDifficulty(level)) {
    throw new Error(`--bot${seat}-level must be a bot level such as ${BotDifficulty.STANDARD.value}`);
  }
  return { style, difficulty: level };
}

function getDefaultName(seat: 0 | 1, bot: BotSetup | undefined): string {
  if (bot) {
    return `Bot (${bot.style}, ${bot.difficulty})`;
  }
  return `Player ${seat + 1}`;
}

type RemoteAccessParams = { host: string; port: string };

function describeRemoteAccess({ host, port }: RemoteAccessParams): string[] {
  if (LOCAL_ONLY_HOSTS.has(host)) {
    return [];
  }
  const addresses = ALL_INTERFACE_HOSTS.has(host)
    ? Object.values(networkInterfaces())
        .flat()
        .filter((entry) => entry !== undefined && entry.family === "IPv4" && !entry.internal)
        .map((entry) => `http://${entry!.address}:${port}`)
    : [];
  return [
    ...(addresses.length > 0 ? [`  Other machines can connect to: ${addresses.join(", ")}`] : []),
    "  This server is reachable from other machines. Give each player only their own seat's token.",
  ];
}

function resolveUserPath(path: string): string {
  return resolve(process.env.INIT_CWD ?? process.cwd(), path);
}

function resolveDeckSpec(spec: string): string {
  return spec.endsWith(".json") ? resolveUserPath(spec) : spec;
}

async function createSession(options: ServeOptions, bots: readonly [BotSetup | undefined, BotSetup | undefined]) {
  const names = [options.name0 ?? getDefaultName(0, bots[0]), options.name1 ?? getDefaultName(1, bots[1])] as const;
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
  const bots = [readBotSetup(options, 0), readBotSetup(options, 1)] as const;
  const { createBasicBotPolicy } = await import("#api/simulator/bots/createBasicBotPolicy");
  const botSeed = readInteger(options.seed, "seed") ?? Math.floor(Math.random() * 2 ** 31);
  const policies = SEATS.map((seat) => {
    const bot = bots[seat];
    return bot ? createBasicBotPolicy({ ...bot, seed: botSeed + seat * 7919 }) : undefined;
  });
  const session = await createSession(options, bots);
  const { startSimulatorServer } = await import("#api/simulator/server/startSimulatorServer");
  const requestedSavePath = options.save ?? options.load;
  const savePath = requestedSavePath ? resolveUserPath(requestedSavePath) : undefined;
  const server = await startSimulatorServer({
    session,
    host: options.host,
    port: readInteger(options.port, "port") ?? 7777,
    ...(savePath ? { savePath } : {}),
    seatTokens: [options.token0, options.token1],
  });
  const { startBotSeat } = await import("#api/simulator/bots/startBotSeat");
  const thinkDelayMs = readInteger(options["bot-delay"], "bot-delay");
  for (const seat of SEATS) {
    const policy = policies[seat];
    if (policy) {
      startBotSeat({
        session,
        seat,
        policy,
        ...(thinkDelayMs === undefined ? {} : { thinkDelayMs }),
        onError: (error) => {
          process.stderr.write(`Seat ${seat} bot stopped: ${error instanceof Error ? error.message : String(error)}\n`);
        },
      });
    }
  }
  const names = [session.getSeatView(0).you.displayName, session.getSeatView(1).you.displayName];
  const describeSeat = (seat: 0 | 1) => {
    const bot = bots[seat];
    return bot ? `bot (${bot.style}, ${bot.difficulty})` : `token ${server.seatTokens[seat]}`;
  };
  process.stdout.write(
    [
      `Aegis simulator running at ${server.url}`,
      ...describeRemoteAccess({ host: options.host, port: server.url.split(":").at(-1) ?? "" }),
      `  Seat 0 (${names[0]}): ${describeSeat(0)}`,
      `  Seat 1 (${names[1]}): ${describeSeat(1)}`,
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
