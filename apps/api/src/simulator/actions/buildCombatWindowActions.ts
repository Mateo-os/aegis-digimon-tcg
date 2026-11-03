import type { CounterChoice } from "@aegis/shared/protocol/CounterChoice";
import type { Seat } from "@aegis/shared/schema/enums";
import type { CombatWindow, GameState } from "@aegis/shared/schema/GameState";
import { getCardLabel } from "#api/simulator/actions/getCardLabel";
import type { SimulatorActionDraft } from "#api/simulator/actions/SimulatorAction";

type Params = { state: GameState; seat: Seat; window: CombatWindow };

function parseCounterChoices(json: string): CounterChoice[] {
  if (!json) {
    return [];
  }
  return JSON.parse(json) as CounterChoice[];
}

function buildBlockActions({ state, seat, window }: Params): SimulatorActionDraft[] {
  const blocks: SimulatorActionDraft[] = [...window.eligiblePermanentIds].map((blockerPermanentId) => ({
    kind: "fixed",
    label: `Block with ${getCardLabel({ state, seat, id: blockerPermanentId })}`,
    intent: { type: "declareBlock", blockerPermanentId },
  }));
  if (window.mustBlock) {
    return blocks;
  }
  return [...blocks, { kind: "fixed", label: "Don't block", intent: { type: "declineBlock" } }];
}

function buildCounterActions({ state, seat, window }: Params): SimulatorActionDraft[] {
  const counters: SimulatorActionDraft[] = parseCounterChoices(window.eligibleCountersJson).map((choice) => ({
    kind: "fixed",
    label: `Counter with ${getCardLabel({ state, seat, id: choice.instanceId })}: ${choice.description}`,
    intent: { type: "respondCounter", sourceInstanceId: choice.instanceId, effectKey: choice.effectKey },
  }));
  return [...counters, { kind: "fixed", label: "Don't counter", intent: { type: "respondCounter" } }];
}

function buildAllianceActions({ state, seat, window }: Params): SimulatorActionDraft[] {
  const allies: SimulatorActionDraft[] = [...window.eligiblePermanentIds].map((allyPermanentId) => ({
    kind: "fixed",
    label: `Use Alliance with ${getCardLabel({ state, seat, id: allyPermanentId })}`,
    intent: { type: "respondAlliance", allyPermanentId },
  }));
  return [...allies, { kind: "fixed", label: "Don't use Alliance", intent: { type: "respondAlliance" } }];
}

export function buildCombatWindowActions(params: Params): SimulatorActionDraft[] {
  const { state, seat, window } = params;
  const permanentId = window.permanentId;
  const permanentLabel = getCardLabel({ state, seat, id: permanentId });
  switch (window.kind) {
    case "block":
      return buildBlockActions(params);
    case "counter":
      return buildCounterActions(params);
    case "alliance":
      return buildAllianceActions(params);
    case "evade":
      return [
        {
          kind: "fixed",
          label: `Use Evade on ${permanentLabel}`,
          intent: { type: "respondEvade", permanentId, accept: true },
        },
        {
          kind: "fixed",
          label: `Don't use Evade on ${permanentLabel}`,
          intent: { type: "respondEvade", permanentId, accept: false },
        },
      ];
    case "barrier":
      return [
        {
          kind: "fixed",
          label: `Use Barrier on ${permanentLabel}`,
          intent: { type: "respondBarrier", permanentId, accept: true },
        },
        {
          kind: "fixed",
          label: `Don't use Barrier on ${permanentLabel}`,
          intent: { type: "respondBarrier", permanentId, accept: false },
        },
      ];
  }
}
