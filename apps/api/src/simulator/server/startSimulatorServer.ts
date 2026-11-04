import { randomBytes } from "node:crypto";
import { renameSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { SimulatorSession } from "#api/simulator/SimulatorSession";
import { createSimulatorApp } from "#api/simulator/server/createSimulatorApp";

type Params = {
  session: SimulatorSession;
  port: number;
  host?: string;
  savePath?: string;
  seatTokens?: readonly [string | undefined, string | undefined];
};

export type SimulatorServer = { url: string; seatTokens: readonly [string, string]; close: () => Promise<void> };

const DEFAULT_HOST = "127.0.0.1";

function createSeatToken(): string {
  return randomBytes(16).toString("hex");
}

type SaveParams = { session: SimulatorSession; savePath: string };

function saveRecord({ session, savePath }: SaveParams): void {
  const temporaryPath = `${savePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(session.getRecord()));
  renameSync(temporaryPath, savePath);
}

export async function startSimulatorServer({
  session,
  port,
  host = DEFAULT_HOST,
  savePath,
  seatTokens: requestedTokens = [undefined, undefined],
}: Params): Promise<SimulatorServer> {
  const seatTokens = [requestedTokens[0] ?? createSeatToken(), requestedTokens[1] ?? createSeatToken()] as const;
  if (seatTokens[0] === seatTokens[1]) {
    throw new Error("The two seats need different tokens");
  }
  const app = createSimulatorApp({
    session,
    seatTokens,
    ...(savePath
      ? {
          onActionAccepted: () => {
            saveRecord({ session, savePath });
          },
        }
      : {}),
  });
  if (savePath) {
    saveRecord({ session, savePath });
  }
  const server = app.listen(port, host);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    url: `http://${host}:${address.port}`,
    seatTokens,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}
