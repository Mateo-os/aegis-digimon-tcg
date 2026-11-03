import { Phase, type Seat } from "@aegis/shared/schema/enums";
import type { GameState } from "@aegis/shared/schema/GameState";
import { enumerateMainPhaseCandidates, type Candidate } from "#api/bot/candidates";
import { buildBotView, type BotUnit, type BotView } from "#api/bot/view";
import { formatCardName } from "#api/simulator/actions/formatCardName";
import type { SimulatorActionDraft } from "#api/simulator/actions/SimulatorAction";

type Params = { state: GameState; seat: Seat };

type DescribeCandidateParams = { view: BotView; candidate: Candidate };

const MIN_LEVEL_TO_LEAVE_BREEDING = 3;

function formatUnit(unit: BotUnit | undefined): string {
  return formatCardName(unit?.cardId);
}

function findEffectDescription({ view, candidate }: DescribeCandidateParams): string {
  if (candidate.intent.type !== "activateEffect") {
    return "";
  }
  const { sourceInstanceId, effectKey } = candidate.intent;
  const effects = [...view.hand, ...view.board, ...(view.breeding ? [view.breeding] : [])].flatMap(
    (card) => card.activatableEffects,
  );
  return (
    effects.find((effect) => effect.instanceId === sourceInstanceId && effect.effectKey === effectKey)?.description ??
    effectKey
  );
}

function findActivationSource({ view, candidate }: DescribeCandidateParams): string {
  if (candidate.intent.type !== "activateEffect") {
    return "";
  }
  const { sourceInstanceId } = candidate.intent;
  const handCard = view.hand.find((card) => card.instanceId === sourceInstanceId);
  if (handCard) {
    return formatCardName(handCard.cardId);
  }
  const unit = [...view.board, ...(view.breeding ? [view.breeding] : [])].find(
    (candidateUnit) =>
      candidateUnit.topCardInstanceId === sourceInstanceId || candidateUnit.permanentId === sourceInstanceId,
  );
  return formatUnit(unit);
}

function describeCandidate(params: DescribeCandidateParams): string {
  const { candidate } = params;
  const cardName = formatCardName(candidate.definition?.cardId);
  switch (candidate.kind) {
    case "attackPlayer":
      return `Attack the opponent with ${formatUnit(candidate.attacker)}`;
    case "attackDigimon":
      return `Attack ${formatUnit(candidate.target)} with ${formatUnit(candidate.attacker)}`;
    case "digivolve":
      return `Digivolve ${formatUnit(candidate.base)} into ${cardName} (cost ${candidate.cost})`;
    case "dnaDigivolve":
      return `DNA digivolve into ${cardName} (cost ${candidate.cost})`;
    case "linkCard":
      return `Link ${cardName} to ${formatUnit(candidate.base)}`;
    case "playDigimon":
    case "playTamer":
    case "playOption":
      return `Play ${cardName} (cost ${candidate.cost})`;
    case "activateEffect":
      return `Activate ${findActivationSource(params)}: ${findEffectDescription(params)}`;
    case "endPhase":
      return "End your turn";
  }
}

function buildBreedingActions(view: BotView): SimulatorActionDraft[] {
  const actions: SimulatorActionDraft[] = [];
  if (!view.breeding && view.eggDeckCount > 0) {
    actions.push({ kind: "fixed", label: "Hatch a Digi-Egg", intent: { type: "hatchEgg" } });
  }
  if (view.breeding && view.breeding.level >= MIN_LEVEL_TO_LEAVE_BREEDING) {
    actions.push({
      kind: "fixed",
      label: `Move ${formatUnit(view.breeding)} to the battle area`,
      intent: { type: "moveFromBreeding", permanentId: view.breeding.permanentId },
    });
  }
  actions.push({ kind: "fixed", label: "Skip the breeding phase", intent: { type: "endPhase" } });
  return actions;
}

export function buildTurnActions({ state, seat }: Params): SimulatorActionDraft[] {
  const view = buildBotView(state, seat);
  if (!view) {
    return [];
  }
  if (state.phase === Phase.Breeding) {
    return buildBreedingActions(view);
  }
  if (state.phase === Phase.Main) {
    return enumerateMainPhaseCandidates(view).map((candidate) => ({
      kind: "fixed",
      label: describeCandidate({ view, candidate }),
      intent: candidate.intent,
    }));
  }
  return [];
}
