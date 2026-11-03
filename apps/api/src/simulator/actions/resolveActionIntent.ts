import type { Intent } from "@aegis/shared/protocol/intents";
import type { SimulatorAction, SimulatorActionCandidate } from "#api/simulator/actions/SimulatorAction";

type Params = { action: SimulatorAction; choice?: readonly string[] };

type ResolvedIntent = { ok: true; intent: Intent } | { ok: false; message: string };

type FindCandidatesParams = { candidates: readonly SimulatorActionCandidate[]; choice: readonly string[] };

function findChosenCandidates({ candidates, choice }: FindCandidatesParams): SimulatorActionCandidate[] | string {
  const byKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const chosen: SimulatorActionCandidate[] = [];
  for (const key of choice) {
    const candidate = byKey.get(key);
    if (!candidate) {
      return `"${key}" is not one of the offered cards (${candidates.map((offered) => offered.key).join(", ")})`;
    }
    if (chosen.includes(candidate)) {
      return `"${key}" was chosen more than once`;
    }
    chosen.push(candidate);
  }
  return chosen;
}

export function resolveActionIntent({ action, choice = [] }: Params): ResolvedIntent {
  if (action.kind === "fixed") {
    if (choice.length > 0) {
      return { ok: false, message: `Action ${action.id} takes no card choice` };
    }
    return { ok: true, intent: action.intent };
  }
  const chosen = findChosenCandidates({ candidates: action.candidates, choice });
  if (typeof chosen === "string") {
    return { ok: false, message: chosen };
  }
  const instanceIds = chosen.map((candidate) => candidate.instanceId);
  if (action.kind === "pick") {
    if (chosen.length < action.min || chosen.length > action.max) {
      return { ok: false, message: `Choose between ${action.min} and ${action.max} cards, not ${chosen.length}` };
    }
    return {
      ok: true,
      intent: {
        type: "respondDecision",
        decisionId: action.decisionId,
        response: { kind: action.responseKind, instanceIds },
      },
    };
  }
  if (chosen.length !== action.candidates.length) {
    return { ok: false, message: `Order all ${action.candidates.length} cards, each exactly once` };
  }
  return {
    ok: true,
    intent: {
      type: "respondDecision",
      decisionId: action.decisionId,
      response: { kind: "orderCards", order: instanceIds },
    },
  };
}
