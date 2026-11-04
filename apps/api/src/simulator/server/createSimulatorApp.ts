import { timingSafeEqual } from "node:crypto";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { getCardDefinition } from "@aegis/shared/cards/registry";
import type { Seat } from "@aegis/shared/schema/enums";
import type { SimulatorSession } from "#api/simulator/SimulatorSession";
import { waitForSeatTurn } from "#api/simulator/server/waitForSeatTurn";

type Params = {
  session: SimulatorSession;
  seatTokens: readonly [string, string];
  onActionAccepted?: () => void;
  maxWaitMs?: number;
};

type ActBody = { actionId: number; version: number; choice: string[] };

const DEFAULT_MAX_WAIT_MS = 60_000;
const DEFAULT_WAIT_MS = 30_000;
const MAX_CHOICE_LENGTH = 100;
const HEARTBEAT_MS = 15_000;

function isSameToken(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

function readToken(req: Request): string | undefined {
  const header = req.get("authorization");
  if (header?.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }
  return typeof req.query.token === "string" ? req.query.token : undefined;
}

function findSeatForToken(seatTokens: readonly [string, string], token: string | undefined): Seat | undefined {
  if (!token) {
    return undefined;
  }
  if (isSameToken(seatTokens[0], token)) {
    return 0;
  }
  if (isSameToken(seatTokens[1], token)) {
    return 1;
  }
  return undefined;
}

function readNonNegativeInteger(value: unknown, fallback: number): number | undefined {
  if (value === undefined) {
    return fallback;
  }
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function parseActBody(body: unknown): ActBody | string {
  if (body === null || typeof body !== "object") {
    return "Send a JSON body with actionId and version";
  }
  const { actionId, version, choice = [] } = body as Record<string, unknown>;
  if (!Number.isInteger(actionId) || !Number.isInteger(version)) {
    return "actionId and version must be integers";
  }
  if (!Array.isArray(choice) || choice.length > MAX_CHOICE_LENGTH || choice.some((key) => typeof key !== "string")) {
    return "choice must be a list of card keys";
  }
  return { actionId: actionId as number, version: version as number, choice: choice as string[] };
}

function getSeat(res: Response): Seat {
  return res.locals.seat as Seat;
}

export function createSimulatorApp({
  session,
  seatTokens,
  onActionAccepted,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
}: Params): Express {
  const app = express();
  app.use(express.json({ limit: "64kb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const seat = findSeatForToken(seatTokens, readToken(req));
    if (seat === undefined) {
      res.status(401).json({ error: "Send your seat token as 'Authorization: Bearer <token>'" });
      return;
    }
    res.locals.seat = seat;
    next();
  });

  app.get("/view", async (_req, res) => {
    await session.whenIdle();
    const seat = getSeat(res);
    res.json({ view: session.getSeatView(seat), seatToAct: session.getSeatToAct(), lastSeq: session.getLastSeq() });
  });

  app.get("/actions", async (_req, res) => {
    await session.whenIdle();
    res.json(session.getLegalActions(getSeat(res)));
  });

  app.post("/actions", async (req, res) => {
    const body = parseActBody(req.body);
    if (typeof body === "string") {
      res.status(400).json({ error: body });
      return;
    }
    const result = await session.actOnAction({ seat: getSeat(res), ...body });
    if (result.ok) {
      onActionAccepted?.();
    }
    res.json(result);
  });

  app.get("/events", async (req, res) => {
    const afterSeq = readNonNegativeInteger(req.query.after, 0);
    if (afterSeq === undefined) {
      res.status(400).json({ error: "after must be a non-negative integer" });
      return;
    }
    await session.whenIdle();
    res.json({ events: session.getEvents({ seat: getSeat(res), afterSeq }), lastSeq: session.getLastSeq() });
  });

  app.get("/events/stream", (req, res) => {
    const afterSeq = readNonNegativeInteger(req.query.after, 0);
    if (afterSeq === undefined) {
      res.status(400).json({ error: "after must be a non-negative integer" });
      return;
    }
    const seat = getSeat(res);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const send = (entry: { seq: number; event: unknown }) => {
      res.write(`id: ${entry.seq}\nevent: game\ndata: ${JSON.stringify(entry)}\n\n`);
    };
    for (const entry of session.getEvents({ seat, afterSeq })) {
      send(entry);
    }
    const unsubscribe = session.subscribe((entry) => {
      const [filtered] = session.getEvents({ seat, afterSeq: entry.seq - 1 });
      if (filtered) {
        send(filtered);
      }
    });
    const unsubscribeSettled = session.subscribeToSettled(() => {
      const settled = { seatToAct: session.getSeatToAct(), lastSeq: session.getLastSeq() };
      res.write(`event: settled\ndata: ${JSON.stringify(settled)}\n\n`);
    });
    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, HEARTBEAT_MS);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      unsubscribeSettled();
    });
  });

  app.get("/wait", async (req, res) => {
    const afterSeq = readNonNegativeInteger(req.query.after, 0);
    const timeoutMs = readNonNegativeInteger(req.query.timeoutMs, DEFAULT_WAIT_MS);
    if (afterSeq === undefined || timeoutMs === undefined) {
      res.status(400).json({ error: "after and timeoutMs must be non-negative integers" });
      return;
    }
    const abort = new AbortController();
    req.on("close", () => {
      abort.abort();
    });
    const result = await waitForSeatTurn({
      session,
      seat: getSeat(res),
      afterSeq,
      timeoutMs: Math.min(timeoutMs, maxWaitMs),
      signal: abort.signal,
    });
    if (!res.writableEnded) {
      res.json(result);
    }
  });

  app.get("/cards/:cardId", (req, res) => {
    const definition = getCardDefinition(req.params.cardId);
    if (!definition) {
      res.status(404).json({ error: `Unknown card ${req.params.cardId}` });
      return;
    }
    res.json({
      cardId: definition.cardId,
      name: definition.nameEn,
      kinds: definition.kinds,
      colors: definition.colors,
      level: definition.level,
      playCost: definition.playCost < 0 ? undefined : definition.playCost,
      dp: definition.dp > 0 ? definition.dp : undefined,
      evoCosts: definition.evoCosts,
      forms: definition.forms,
      attributes: definition.attributes,
      types: definition.types,
      effectText: definition.effectText,
      inheritedEffectText: definition.inheritedEffectText,
      securityEffectText: definition.securityEffectText,
    });
  });

  return app;
}
