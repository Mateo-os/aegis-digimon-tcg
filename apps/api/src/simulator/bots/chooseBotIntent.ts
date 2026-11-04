import type { ServerEvent } from "@aegis/shared/protocol/events";
import type { Intent } from "@aegis/shared/protocol/intents";
import { Phase, type Seat } from "@aegis/shared/schema/enums";
import type { BotPolicy } from "#api/bot/policy";
import { buildBotView } from "#api/bot/view";
import type { SimulatorSession } from "#api/simulator/SimulatorSession";

type Params = { session: SimulatorSession; policy: BotPolicy; seat: Seat };

type FindEventParams<K extends ServerEvent["kind"]> = { session: SimulatorSession; seat: Seat; kind: K };

function findLatestEvent<K extends ServerEvent["kind"]>({ session, seat, kind }: FindEventParams<K>) {
  const events = session.getEvents({ seat, afterSeq: 0 });
  for (let index = events.length - 1; index >= 0; index--) {
    const { event } = events[index]!;
    if (event.kind === kind) {
      return event as Extract<ServerEvent, { kind: K }>;
    }
  }
  throw new Error(`No ${kind} event was emitted`);
}

export function chooseBotIntent({ session, policy, seat }: Params): Intent {
  const state = session.getState();
  const view = buildBotView(state, seat);
  if (!view) {
    throw new Error(`Seat ${seat} has no player`);
  }
  const request = session.getDecisionRequest(seat);
  if (request) {
    return policy.answerDecision(view, request);
  }
  const window = state.combatWindow;
  if (window?.kind === "block") {
    const attack = findLatestEvent({ session, seat, kind: "attackDeclared" });
    return policy.chooseBlockResponse(view, {
      attackerPermanentId: window.attackerPermanentId,
      eligibleBlockerIds: [...window.eligiblePermanentIds],
      mustBlock: window.mustBlock,
      targetsPlayer: attack.target.kind === "player",
      ...(attack.target.kind === "permanent" ? { targetPermanentId: attack.target.permanentId } : {}),
    });
  }
  if (window?.kind === "counter") {
    return policy.chooseCounterResponse(view, findLatestEvent({ session, seat, kind: "counterWindowOpened" }));
  }
  if (window?.kind === "alliance") {
    return policy.chooseAllianceResponse(view, findLatestEvent({ session, seat, kind: "alliancePrompt" }));
  }
  if (window?.kind === "evade") {
    return policy.chooseEvadeResponse(view, window.permanentId);
  }
  if (window?.kind === "barrier") {
    return policy.chooseBarrierResponse(view, window.permanentId);
  }
  if (state.phase === Phase.Breeding) {
    return policy.chooseBreedingAction(view);
  }
  return policy.chooseMainAction(view);
}
