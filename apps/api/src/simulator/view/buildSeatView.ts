import { getCardDefinition } from "@aegis/shared/cards/registry";
import type { CardInstance } from "@aegis/shared/schema/CardInstance";
import type { Seat } from "@aegis/shared/schema/enums";
import type { GameState } from "@aegis/shared/schema/GameState";
import type { Permanent } from "@aegis/shared/schema/Permanent";
import type { PlayerState } from "@aegis/shared/schema/PlayerState";
import { findSeatToAct } from "#api/simulator/findSeatToAct";
import type {
  CardView,
  OwnPlayerView,
  PermanentView,
  PlayerView,
  SeatPrompt,
  SeatView,
  SeatViewResult,
} from "#api/simulator/view/SeatView";

type Params = { state: GameState; seat: Seat; result?: SeatViewResult };

function buildCardView(card: CardInstance): CardView {
  const definition = getCardDefinition(card.cardId);
  if (!definition) {
    return { instanceId: card.instanceId, cardId: card.cardId, name: card.cardId, kinds: [], colors: [] };
  }
  return {
    instanceId: card.instanceId,
    cardId: card.cardId,
    name: definition.nameEn,
    kinds: [...definition.kinds],
    colors: [...definition.colors],
    ...(definition.level === undefined ? {} : { level: definition.level }),
    ...(definition.playCost < 0 ? {} : { playCost: definition.playCost }),
    ...(definition.dp > 0 ? { dp: definition.dp } : {}),
  };
}

function buildPermanentView(permanent: Permanent): PermanentView {
  return {
    permanentId: permanent.permanentId,
    card: buildCardView(permanent.topCard),
    dp: permanent.currentDP,
    suspended: permanent.isSuspended,
    digivolutionCards: [...permanent.stack].map(buildCardView),
    linkedCards: [...permanent.linked].map(buildCardView),
  };
}

function buildPlayerView(player: PlayerState): PlayerView {
  return {
    seat: player.seat,
    displayName: player.displayName,
    deckCount: player.deck.length,
    eggDeckCount: player.eggDeck.length,
    handCount: player.hand.length,
    securityCount: player.security.length,
    faceUpSecurity: [...player.security].filter((card) => card.faceUp).map(buildCardView),
    trash: [...player.trash].map(buildCardView),
    ...(player.breeding ? { breeding: buildPermanentView(player.breeding) } : {}),
    battleArea: [...player.battleArea].map(buildPermanentView),
  };
}

function buildOwnPlayerView(player: PlayerState): OwnPlayerView {
  return { ...buildPlayerView(player), hand: [...player.hand].map(buildCardView) };
}

function buildPrompt(state: GameState): SeatPrompt | undefined {
  const seat = findSeatToAct(state);
  if (seat === undefined) {
    return undefined;
  }
  if (state.pendingDecision) {
    return {
      kind: "decision",
      seat,
      decisionKind: state.pendingDecision.kind,
      text: state.pendingDecision.promptText,
    };
  }
  if (state.combatWindow) {
    return { kind: "combatWindow", seat, windowKind: state.combatWindow.kind };
  }
  return { kind: "turn", seat, phase: state.phase };
}

function getPlayer(state: GameState, seat: Seat): PlayerState {
  const player = state.players[seat];
  if (!player) {
    throw new Error(`Seat ${seat} has no player`);
  }
  return player;
}

export function buildSeatView({ state, seat, result }: Params): SeatView {
  const opponentSeat: Seat = seat === 0 ? 1 : 0;
  const isYourTurn = state.turnSeat === seat;
  const prompt = buildPrompt(state);
  return {
    seat,
    turnCount: state.turnCount,
    turnSeat: state.turnSeat,
    phase: state.phase,
    isYourTurn,
    memory: isYourTurn ? state.memory : -state.memory,
    ...(prompt ? { prompt } : {}),
    ...(result ? { result } : {}),
    you: buildOwnPlayerView(getPlayer(state, seat)),
    opponent: buildPlayerView(getPlayer(state, opponentSeat)),
  };
}
