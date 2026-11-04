import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Seat } from "@aegis/shared/schema/enums";
import type { SimulatorAction, SimulatorActionList } from "#api/simulator/actions/SimulatorAction";
import { loadSimulatorSession } from "#api/simulator/loadSimulatorSession";
import { resolveSimulatorDeck } from "#api/simulator/server/resolveSimulatorDeck";
import { startSimulatorServer, type SimulatorServer } from "#api/simulator/server/startSimulatorServer";
import type { WaitResult } from "#api/simulator/server/waitForSeatTurn";
import { SimulatorSession, type ActResult } from "#api/simulator/SimulatorSession";
import type { SeatView } from "#api/simulator/view/SeatView";

type StartParams = { seed: number; savePath?: string };

type CallParams = { token?: string; path: string; body?: unknown };

type PlaySeatParams = { seat: Seat; maxSteps: number };

const TOKENS = ["token-zero", "token-one"] as const;

const running: SimulatorServer[] = [];

let server: SimulatorServer;
let session: SimulatorSession;

async function startServer({ seed, savePath }: StartParams): Promise<void> {
  session = SimulatorSession.create({
    seed,
    players: [
      { displayName: "Mateo", deck: resolveSimulatorDeck("bt5-shoutmon-dx@1") },
      { displayName: "Claude", deck: resolveSimulatorDeck("bt6-red-jesmon@1") },
    ],
  });
  await session.start();
  server = await startSimulatorServer({ session, port: 0, seatTokens: TOKENS, ...(savePath ? { savePath } : {}) });
  running.push(server);
}

async function call<T>({ token, path, body }: CallParams): Promise<{ status: number; json: T }> {
  const response = await fetch(`${server.url}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, json: (await response.json()) as T };
}

function chooseKeys(action: SimulatorAction): string[] {
  if (action.kind === "fixed") {
    return [];
  }
  return action.candidates.slice(0, action.kind === "pick" ? action.min : undefined).map((card) => card.key);
}

async function playSeat({ seat, maxSteps }: PlaySeatParams): Promise<number> {
  const token = TOKENS[seat];
  let lastSeq = 0;
  let accepted = 0;
  for (let step = 0; step < maxSteps; step++) {
    const { json: waited } = await call<WaitResult>({ token, path: `/wait?after=${lastSeq}&timeoutMs=5000` });
    lastSeq = waited.lastSeq;
    if (waited.status === "game-over") {
      return accepted;
    }
    if (waited.status === "timeout") {
      continue;
    }
    const { json: list } = await call<SimulatorActionList>({ token, path: "/actions" });
    const playable = list.actions.filter((action) => action.kind !== "fixed" || action.intent.type !== "surrender");
    if (playable.length === 0) {
      continue;
    }
    const action = playable[(step + seat) % playable.length]!;
    const { json: result } = await call<ActResult>({
      token,
      path: "/actions",
      body: { actionId: action.id, version: list.version, choice: chooseKeys(action) },
    });
    if (result.ok) {
      accepted++;
    }
  }
  throw new Error(`Seat ${seat} did not see the game end within ${maxSteps} steps`);
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((started) => started.close()));
});

describe("startSimulatorServer", () => {
  it("answers health checks without a token and refuses game requests without a valid one", async () => {
    await startServer({ seed: 3 });
    expect((await call({ path: "/health" })).status).toBe(200);
    expect((await call({ path: "/view" })).status).toBe(401);
    expect((await call({ token: "wrong", path: "/view" })).status).toBe(401);
  });

  it("shows each seat its own view", async () => {
    await startServer({ seed: 3 });
    const { json: mine } = await call<{ view: SeatView }>({ token: TOKENS[0], path: "/view" });
    const { json: theirs } = await call<{ view: SeatView }>({ token: TOKENS[1], path: "/view" });
    expect(mine.view.seat).toBe(0);
    expect(mine.view.you.displayName).toBe("Mateo");
    expect(mine.view.you.hand.length).toBeGreaterThan(0);
    expect("hand" in mine.view.opponent).toBe(false);
    expect(theirs.view.seat).toBe(1);
    expect(theirs.view.you.displayName).toBe("Claude");
  });

  it("lists actions for the seat to act, applies a chosen one and refuses a stale list or a bad body", async () => {
    await startServer({ seed: 3 });
    const seat = session.getSeatToAct()!;
    const token = TOKENS[seat];
    const { json: list } = await call<SimulatorActionList>({ token, path: "/actions" });
    expect(list.actions.map((action) => action.label)).toContain("Keep your opening hand");
    const { json: other } = await call<SimulatorActionList>({ token: TOKENS[seat === 0 ? 1 : 0], path: "/actions" });
    expect(other.actions).toEqual([]);
    const { json: result } = await call<ActResult>({
      token,
      path: "/actions",
      body: { actionId: 1, version: list.version },
    });
    expect(result.ok).toBe(true);
    const { json: stale } = await call<ActResult>({
      token,
      path: "/actions",
      body: { actionId: 1, version: list.version },
    });
    expect(stale).toMatchObject({ ok: false, reason: "stale-actions" });
    const { status } = await call({ token, path: "/actions", body: { actionId: "one" } });
    expect(status).toBe(400);
  });

  it("returns from a wait at once for the seat to act and times out for the other", async () => {
    await startServer({ seed: 3 });
    const seat = session.getSeatToAct()!;
    const { json: mine } = await call<WaitResult>({ token: TOKENS[seat], path: "/wait?timeoutMs=5000" });
    expect(mine.status).toBe("your-move");
    const { json: theirs } = await call<WaitResult>({ token: TOKENS[seat === 0 ? 1 : 0], path: "/wait?timeoutMs=50" });
    expect(theirs.status).toBe("timeout");
  });

  it("wakes a waiting seat when the other seat's action passes it the move without emitting events", async () => {
    await startServer({ seed: 3 });
    const seat = session.getSeatToAct()!;
    const otherSeat: Seat = seat === 0 ? 1 : 0;
    const waiting = call<WaitResult>({ token: TOKENS[otherSeat], path: "/wait?timeoutMs=10000" });
    const { json: list } = await call<SimulatorActionList>({ token: TOKENS[seat], path: "/actions" });
    await call<ActResult>({ token: TOKENS[seat], path: "/actions", body: { actionId: 1, version: list.version } });
    const { json: woken } = await waiting;
    expect(woken.status).toBe("your-move");
    expect(woken.seatToAct).toBe(otherSeat);
  });

  it("streams events and settled notices to a connected seat", async () => {
    await startServer({ seed: 3 });
    const seat = session.getSeatToAct()!;
    const response = await fetch(`${server.url}/events/stream?after=0`, {
      headers: { authorization: `Bearer ${TOKENS[seat === 0 ? 1 : 0]}` },
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    const { json: list } = await call<SimulatorActionList>({ token: TOKENS[seat], path: "/actions" });
    await call<ActResult>({ token: TOKENS[seat], path: "/actions", body: { actionId: 1, version: list.version } });
    while (!received.includes("event: settled")) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      received += decoder.decode(value);
    }
    await reader.cancel();
    expect(received).toContain("event: game");
    expect(received).toContain("event: settled");
  });

  it("looks up card text and reports unknown cards", async () => {
    await startServer({ seed: 3 });
    const { status, json } = await call<{ name: string; effectText?: string }>({
      token: TOKENS[0],
      path: "/cards/EX12-036",
    });
    expect(status).toBe(200);
    expect(json.name).toBe("Ryugumon");
    expect(json.effectText).toContain("Barrier");
    expect((await call({ token: TOKENS[0], path: "/cards/NOPE-000" })).status).toBe(404);
  });

  it("plays a whole game with both seats acting concurrently over HTTP", async () => {
    await startServer({ seed: 11 });
    const [zero, one] = await Promise.all([
      playSeat({ seat: 0, maxSteps: 4_000 }),
      playSeat({ seat: 1, maxSteps: 4_000 }),
    ]);
    expect(zero + one).toBeGreaterThan(20);
    expect(session.getResult()?.outcome).toMatch(/^(win|draw)$/);
    const { json } = await call<{ view: SeatView }>({ token: TOKENS[0], path: "/view" });
    expect(json.view.result).toEqual(session.getResult());
  }, 120_000);

  it("saves the game after accepted actions so it can be resumed", async () => {
    const directory = mkdtempSync(join(tmpdir(), "aegis-sim-"));
    const savePath = join(directory, "game.json");
    try {
      await startServer({ seed: 3, savePath });
      const seat = session.getSeatToAct()!;
      const { json: list } = await call<SimulatorActionList>({ token: TOKENS[seat], path: "/actions" });
      await call<ActResult>({ token: TOKENS[seat], path: "/actions", body: { actionId: 1, version: list.version } });
      const resumed = await loadSimulatorSession({
        record: JSON.parse(readFileSync(savePath, "utf8")),
        displayNames: ["Mateo", "Claude"],
      });
      expect(resumed.getSeatView(0)).toEqual(session.getSeatView(0));
      expect(resumed.getSeatToAct()).toBe(session.getSeatToAct());
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses the same token for both seats", async () => {
    const duplicate = SimulatorSession.create({
      seed: 1,
      players: [
        { displayName: "A", deck: resolveSimulatorDeck("bt5-shoutmon-dx@1") },
        { displayName: "B", deck: resolveSimulatorDeck("bt6-red-jesmon@1") },
      ],
    });
    await expect(startSimulatorServer({ session: duplicate, port: 0, seatTokens: ["same", "same"] })).rejects.toThrow(
      "different tokens",
    );
  });
});
