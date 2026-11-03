import type { DecisionRequest } from "@aegis/shared/protocol/events";
import type { Seat } from "@aegis/shared/schema/enums";
import type { GameState } from "@aegis/shared/schema/GameState";
import { buildCombatWindowActions } from "#api/simulator/actions/buildCombatWindowActions";
import { buildDecisionActions } from "#api/simulator/actions/buildDecisionActions";
import { buildTurnActions } from "#api/simulator/actions/buildTurnActions";
import type { SimulatorAction, SimulatorActionDraft } from "#api/simulator/actions/SimulatorAction";
import { findSeatToAct } from "#api/simulator/findSeatToAct";

type Params = { state: GameState; seat: Seat; decisionRequest: DecisionRequest | undefined };

const SURRENDER: SimulatorActionDraft = { kind: "fixed", label: "Surrender", intent: { type: "surrender" } };

function buildSituationActions({ state, seat, decisionRequest }: Params): SimulatorActionDraft[] {
  if (state.pendingDecision) {
    if (!decisionRequest || decisionRequest.decisionId !== state.pendingDecision.decisionId) {
      return [];
    }
    return buildDecisionActions({ state, seat, request: decisionRequest });
  }
  if (state.combatWindow) {
    return buildCombatWindowActions({ state, seat, window: state.combatWindow });
  }
  return buildTurnActions({ state, seat });
}

export function buildLegalActions(params: Params): SimulatorAction[] {
  if (findSeatToAct(params.state) !== params.seat) {
    return [];
  }
  return [...buildSituationActions(params), SURRENDER].map((draft, index) => ({ ...draft, id: index + 1 }));
}
