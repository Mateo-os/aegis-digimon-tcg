import type { Intent } from "@aegis/shared/protocol/intents";
import { Phase, type Seat } from "@aegis/shared/schema/enums";
import type { GameState } from "@aegis/shared/schema/GameState";
import { breedingActions, mainActions, type TrainingAction } from "#api/bot/training/actions";
import type { GameEngine } from "#api/engine/GameEngine";
import { getCardLabel } from "#api/simulator/actions/getCardLabel";
import type { SimulatorActionDraft } from "#api/simulator/actions/SimulatorAction";

type Params = { engine: GameEngine; seat: Seat };

type DescribeParams = { state: GameState; seat: Seat; action: TrainingAction };

type DescribeIntentParams = DescribeParams & { intent: Intent };

function formatCost(action: TrainingAction): string {
  if (action.projectedCost === undefined) {
    return "";
  }
  return ` (cost ${action.projectedCost})`;
}

function describePlay({ state, seat, intent }: DescribeIntentParams): string {
  if (intent.type !== "playCard") {
    return "";
  }
  const card = getCardLabel({ state, seat, id: intent.instanceId });
  if (intent.assembly) {
    return `Play ${card} with Assembly`;
  }
  if (intent.digiXros) {
    return `Play ${card} with DigiXros`;
  }
  return `Play ${card}`;
}

function describeIntent(params: DescribeIntentParams): string {
  const { state, seat, action, intent } = params;
  const label = (id: string) => getCardLabel({ state, seat, id });
  switch (intent.type) {
    case "playCard":
      return describePlay(params);
    case "digivolve": {
      const route =
        intent.alternateRequirementIndex === undefined
          ? ""
          : ` using alternate route ${intent.alternateRequirementIndex}`;
      return `Digivolve ${label(intent.permanentId)} into ${label(intent.instanceId)}${route}`;
    }
    case "dnaDigivolve":
      return `DNA digivolve ${intent.materialPermanentIds.map(label).join(" + ")} into ${label(intent.instanceId)}`;
    case "appFusion":
      return `App Fusion ${label(intent.permanentId)} into ${label(intent.instanceId)} with ${label(intent.linkedInstanceId)}`;
    case "linkCard":
      return `Link ${label(intent.instanceId)} to ${label(intent.targetPermanentId)}`;
    case "attack":
      if (intent.target.kind === "player") {
        return `Attack the opponent with ${label(intent.attackerPermanentId)}`;
      }
      return `Attack ${label(intent.target.permanentId)} with ${label(intent.attackerPermanentId)}`;
    case "activateEffect":
      return `Activate ${label(intent.sourceInstanceId)}: ${action.label}`;
    case "hatchEgg":
      return "Hatch a Digi-Egg";
    case "moveFromBreeding":
      return `Move ${label(intent.permanentId)} to the battle area`;
    case "endPhase":
      return state.phase === Phase.Breeding ? "Skip the breeding phase" : "End your turn";
    default:
      return action.label;
  }
}

function describeAction(params: DescribeParams): string {
  return `${describeIntent({ ...params, intent: params.action.intent })}${formatCost(params.action)}`;
}

function listTrainingActions({ engine, seat }: Params): TrainingAction[] {
  if (engine.state.phase === Phase.Breeding) {
    return breedingActions(engine, seat);
  }
  if (engine.state.phase === Phase.Main) {
    return mainActions(engine, seat);
  }
  return [];
}

export function buildTurnActions(params: Params): SimulatorActionDraft[] {
  const state = params.engine.state;
  const seen = new Set<string>();
  const drafts: SimulatorActionDraft[] = [];
  for (const action of listTrainingActions(params)) {
    const key = JSON.stringify(action.intent);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    drafts.push({ kind: "fixed", label: describeAction({ state, seat: params.seat, action }), intent: action.intent });
  }
  return drafts;
}
