import type { Seat } from "@aegis/shared/schema/enums";
import type { SimulatorActionList } from "#api/simulator/actions/SimulatorAction";
import type { WaitResult } from "#api/simulator/server/waitForSeatTurn";
import type { ActResult, SimulatorEvent } from "#api/simulator/SimulatorSession";
import type { SeatView } from "#api/simulator/view/SeatView";

type Params = { url: string; token: string };

type ActBody = { actionId: number; version: number; choice: readonly string[] };

type WaitParams = { after: number; timeoutMs: number; signal?: AbortSignal };

type RequestParams = { path: string; body?: unknown; signal?: AbortSignal };

export type ViewResponse = { view: SeatView; seatToAct: Seat | undefined; lastSeq: number; text: string };

export type ActionsResponse = SimulatorActionList & { text: string };

export type EventsResponse = { events: SimulatorEvent[]; lastSeq: number };

export type CardResponse = {
  cardId: string;
  name: string;
  kinds: string[];
  colors: string[];
  level?: number;
  playCost?: number;
  dp?: number;
  types?: string[];
  effectText?: string;
  inheritedEffectText?: string;
  securityEffectText?: string;
};

export function createSimulatorHttpClient({ url, token }: Params) {
  const baseUrl = url.replace(/\/+$/, "");

  async function request<T>({ path, body, signal }: RequestParams): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
    const json = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      throw new Error(json.error ?? `The simulator answered ${response.status}`);
    }
    return json;
  }

  return {
    getView: () => request<ViewResponse>({ path: "/view" }),
    getActions: () => request<ActionsResponse>({ path: "/actions" }),
    act: (body: ActBody) => request<ActResult>({ path: "/actions", body }),
    getEvents: (after: number) => request<EventsResponse>({ path: `/events?after=${after}` }),
    wait: ({ after, timeoutMs, signal }: WaitParams) =>
      request<WaitResult>({ path: `/wait?after=${after}&timeoutMs=${timeoutMs}`, ...(signal ? { signal } : {}) }),
    getCard: (cardId: string) => request<CardResponse>({ path: `/cards/${encodeURIComponent(cardId)}` }),
  };
}

export type SimulatorHttpClient = ReturnType<typeof createSimulatorHttpClient>;
