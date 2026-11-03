import type { CardInstance } from "@aegis/shared/schema/CardInstance";
import type { Seat } from "@aegis/shared/schema/enums";
import type { GameState } from "@aegis/shared/schema/GameState";
import type { Permanent } from "@aegis/shared/schema/Permanent";
import { formatCardName } from "#api/simulator/actions/formatCardName";

type VisibleCard = { instanceId: string; cardId: string };

type Params = { state: GameState; seat: Seat; id: string; visibleCards?: readonly VisibleCard[] };

function findPermanentCardId(permanent: Permanent | undefined, id: string): string | undefined {
  if (!permanent) {
    return undefined;
  }
  if (permanent.permanentId === id || permanent.topCard?.instanceId === id) {
    return permanent.topCard?.cardId;
  }
  return [...permanent.stack, ...permanent.linked].find((card) => card.instanceId === id)?.cardId;
}

function findCardId(cards: Iterable<CardInstance>, id: string): string | undefined {
  for (const card of cards) {
    if (card.instanceId === id) {
      return card.cardId;
    }
  }
  return undefined;
}

export function getCardLabel({ state, seat, id, visibleCards = [] }: Params): string {
  const visible = visibleCards.find((card) => card.instanceId === id);
  if (visible) {
    return formatCardName(visible.cardId);
  }
  for (const player of state.players) {
    for (const permanent of [...player.battleArea, player.breeding]) {
      const cardId = findPermanentCardId(permanent, id);
      if (cardId) {
        return formatCardName(cardId);
      }
    }
    const publicCardId =
      findCardId(player.trash, id) ??
      findCardId(
        player.security.filter((card) => card.faceUp),
        id,
      );
    if (publicCardId) {
      return formatCardName(publicCardId);
    }
    if (player.seat === seat) {
      const handCardId = findCardId(player.hand, id);
      if (handCardId) {
        return formatCardName(handCardId);
      }
    }
  }
  return "a hidden card";
}
