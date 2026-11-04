import type { DecisionRequest } from "@aegis/shared/protocol/events";
import type { DecisionResponse, Intent } from "@aegis/shared/protocol/intents";
import type { Seat } from "@aegis/shared/schema/enums";
import type { GameState } from "@aegis/shared/schema/GameState";
import { formatCardName } from "#api/simulator/actions/formatCardName";
import { getCardLabel } from "#api/simulator/actions/getCardLabel";
import type {
  SimulatorActionCandidate,
  SimulatorActionDraft,
  SimulatorSelectionKind,
} from "#api/simulator/actions/SimulatorAction";

type Params = { state: GameState; seat: Seat; request: DecisionRequest };

type SelectionParams = Params & { responseKind: SimulatorSelectionKind };

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

function getCandidateKey(index: number): string {
  if (index < ALPHABET.length) {
    return ALPHABET[index]!;
  }
  return `${getCandidateKey(Math.floor(index / ALPHABET.length) - 1)}${ALPHABET[index % ALPHABET.length]}`;
}

function buildRespondIntent(request: DecisionRequest, response: DecisionResponse): Intent {
  return { type: "respondDecision", decisionId: request.decisionId, response };
}

function buildCandidates({ state, seat, request }: Params): SimulatorActionCandidate[] {
  const visibleCards = request.options?.visibleCards ?? [];
  return (request.options?.candidateInstanceIds ?? []).map((instanceId, index) => ({
    key: getCandidateKey(index),
    instanceId,
    label: getCardLabel({ state, seat, id: instanceId, visibleCards }),
  }));
}

function buildSelectionRules(request: DecisionRequest): string[] {
  const options = request.options ?? {};
  const rules: string[] = [];
  if (options.maxTotalPlayCost !== undefined) {
    rules.push(`total play cost at most ${options.maxTotalPlayCost}`);
  }
  if (options.maxTotalDP !== undefined) {
    rules.push(`total DP at most ${options.maxTotalDP}`);
  }
  if (options.differentColors) {
    rules.push("each card a different color");
  }
  if (options.distinctCardIds) {
    rules.push("each card a different card number");
  }
  if (options.distinctNames) {
    rules.push("each card a different name");
  }
  return rules;
}

function describeSelection(labels: readonly string[]): string {
  if (labels.length === 0) {
    return "nothing";
  }
  return labels.join(", ");
}

function buildSelectionActions(params: SelectionParams): SimulatorActionDraft[] {
  const { state, seat, request, responseKind } = params;
  const candidates = buildCandidates(params);
  const min = request.options?.min ?? 0;
  const max = request.options?.max ?? candidates.length;
  const combinations = request.options?.allowedTargetCombinations;
  const visibleCards = request.options?.visibleCards ?? [];
  if (combinations !== undefined) {
    return combinations.map((instanceIds) => ({
      kind: "fixed",
      label: `${request.promptText}: ${describeSelection(instanceIds.map((id) => getCardLabel({ state, seat, id, visibleCards })))}`,
      intent: buildRespondIntent(request, { kind: responseKind, instanceIds }),
    }));
  }
  if (max <= 1) {
    const singles: SimulatorActionDraft[] = candidates.map((candidate) => ({
      kind: "fixed",
      label: `${request.promptText}: ${candidate.label}`,
      intent: buildRespondIntent(request, { kind: responseKind, instanceIds: [candidate.instanceId] }),
    }));
    if (min > 0) {
      return singles;
    }
    return [
      ...singles,
      {
        kind: "fixed",
        label: `${request.promptText}: nothing`,
        intent: buildRespondIntent(request, { kind: responseKind, instanceIds: [] }),
      },
    ];
  }
  return [
    {
      kind: "pick",
      label: `${request.promptText} (choose ${min} to ${max})`,
      decisionId: request.decisionId,
      responseKind,
      candidates,
      min,
      max,
      rules: buildSelectionRules(request),
    },
  ];
}

function formatTriggerSource(cardId: string | undefined): string {
  if (!cardId) {
    return "";
  }
  return `${formatCardName(cardId)} - `;
}

function buildTriggerOrderActions({ request }: Params): SimulatorActionDraft[] {
  const options = request.options ?? {};
  return (options.triggerKeys ?? []).map((key, index) => {
    const source = formatTriggerSource(options.triggerCardIds?.[index]);
    const description = options.triggerDescriptions?.[index] ?? key;
    return {
      kind: "fixed",
      label: `Resolve next: ${source}${description}`,
      intent: buildRespondIntent(request, { kind: "orderTriggers", order: [key] }),
    };
  });
}

type OrderDestination = NonNullable<NonNullable<DecisionRequest["options"]>["orderDestination"]>;

function describeOrderDestination(destination: OrderDestination | undefined): string {
  switch (destination) {
    case "deckBottom":
      return "these go to the bottom of the deck: the first card you list ends up highest, the last one at the very bottom";
    case "stackTop":
      return "the first card you list sits directly under the top card";
    case "stackBottom":
      return "the first card you list becomes the bottom card of the stack";
    case "deckTop":
    case undefined:
      return "the first card you list ends up on top";
  }
}

export function buildDecisionActions(params: Params): SimulatorActionDraft[] {
  const { request } = params;
  switch (request.kind) {
    case "mulligan":
      return [
        { kind: "fixed", label: "Keep your opening hand", intent: { type: "mulligan", keep: true } },
        { kind: "fixed", label: "Redraw your opening hand", intent: { type: "mulligan", keep: false } },
      ];
    case "optional":
      return [
        {
          kind: "fixed",
          label: `Use: ${request.promptText}`,
          intent: buildRespondIntent(request, { kind: "optional", accept: true }),
        },
        {
          kind: "fixed",
          label: `Skip: ${request.promptText}`,
          intent: buildRespondIntent(request, { kind: "optional", accept: false }),
        },
      ];
    case "chooseOption":
      return (request.options?.choices ?? []).map((choice, optionIndex) => ({
        kind: "fixed",
        label: `${request.promptText}: ${choice}`,
        intent: buildRespondIntent(request, { kind: "chooseOption", optionIndex }),
      }));
    case "orderTriggers":
      return buildTriggerOrderActions(params);
    case "chooseTargets":
    case "selectCards":
      return buildSelectionActions({ ...params, responseKind: request.kind });
    case "orderCards": {
      return [
        {
          kind: "order",
          label: `${request.promptText} (${describeOrderDestination(request.options?.orderDestination)})`,
          decisionId: request.decisionId,
          candidates: buildCandidates(params),
        },
      ];
    }
  }
}
