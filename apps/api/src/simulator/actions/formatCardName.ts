import { getCardDefinition } from "@aegis/shared/cards/registry";

export function formatCardName(cardId: string | undefined): string {
  if (!cardId) {
    return "a hidden card";
  }
  const definition = getCardDefinition(cardId);
  if (!definition) {
    return cardId;
  }
  return `${definition.nameEn} (${cardId})`;
}
