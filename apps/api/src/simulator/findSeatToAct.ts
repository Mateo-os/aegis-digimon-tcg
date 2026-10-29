import type { GameState } from "@aegis/shared/schema/GameState";
import { Phase, type Seat } from "@aegis/shared/schema/enums";

const TURN_PLAYER_PHASES: ReadonlySet<Phase> = new Set([Phase.Breeding, Phase.Main]);

export function findSeatToAct(state: GameState): Seat | undefined {
  if (state.gameOver) {
    return undefined;
  }
  if (state.pendingDecision) {
    return state.pendingDecision.seat;
  }
  if (state.combatWindow) {
    return state.combatWindow.seat;
  }
  if (TURN_PLAYER_PHASES.has(state.phase)) {
    return state.turnSeat;
  }
  return undefined;
}
