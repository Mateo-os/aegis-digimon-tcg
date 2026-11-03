import type { DecisionRequest } from "@aegis/shared/protocol/events";
import type { Seat } from "@aegis/shared/schema/enums";
import type { GameEngine } from "#api/engine/GameEngine";
import { buildCombatWindowActions } from "#api/simulator/actions/buildCombatWindowActions";
import { buildDecisionActions } from "#api/simulator/actions/buildDecisionActions";
import { buildTurnActions } from "#api/simulator/actions/buildTurnActions";
import type { SimulatorAction, SimulatorActionDraft } from "#api/simulator/actions/SimulatorAction";
import { findSeatToAct } from "#api/simulator/findSeatToAct";

type Params = { engine: GameEngine; seat: Seat; decisionRequest: DecisionRequest | undefined };

const SURRENDER: SimulatorActionDraft = { kind: "fixed", label: "Surrender", intent: { type: "surrender" } };

function buildSituationActions({ engine, seat, decisionRequest }: Params): SimulatorActionDraft[] {
  const state = engine.state;
  if (state.pendingDecision) {
    if (!decisionRequest || decisionRequest.decisionId !== state.pendingDecision.decisionId) {
      return [];
    }
    return buildDecisionActions({ state, seat, request: decisionRequest });
  }
  if (state.combatWindow) {
    return buildCombatWindowActions({ state, seat, window: state.combatWindow });
  }
  return buildTurnActions({ engine, seat });
}

export function buildLegalActions(params: Params): SimulatorAction[] {
  if (findSeatToAct(params.engine.state) !== params.seat) {
    return [];
  }
  return [...buildSituationActions(params), SURRENDER].map((draft, index) => ({ ...draft, id: index + 1 }));
}
