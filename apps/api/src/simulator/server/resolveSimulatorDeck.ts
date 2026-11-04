import { existsSync, readFileSync } from "node:fs";
import digilabDecks from "#api/bot/evolution/digilab-decks.json" with { type: "json" };
import { metaDeckByVersion } from "#api/bot/metaDecks/index";
import type { SimulatorDeck } from "#api/simulator/SimulatorSession";

type DigilabDeck = { deckVersion: string; decklist: SimulatorDeck };

function isCardList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((cardId) => typeof cardId === "string");
}

function readDeckFile(path: string): SimulatorDeck {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const { mainDeck, eggDeck } = (parsed ?? {}) as Record<string, unknown>;
  if (!isCardList(mainDeck) || !isCardList(eggDeck)) {
    throw new Error(`${path} must contain { "mainDeck": [card ids], "eggDeck": [card ids] }`);
  }
  return { mainDeck: [...mainDeck], eggDeck: [...eggDeck] };
}

export function resolveSimulatorDeck(spec: string): SimulatorDeck {
  if (spec.endsWith(".json") && existsSync(spec)) {
    return readDeckFile(spec);
  }
  const meta = metaDeckByVersion(spec);
  if (meta) {
    return { mainDeck: [...meta.decklist.mainDeck], eggDeck: [...meta.decklist.eggDeck] };
  }
  const digilab = (digilabDecks as unknown as { decks: DigilabDeck[] }).decks.find((deck) => deck.deckVersion === spec);
  if (digilab) {
    return { mainDeck: [...digilab.decklist.mainDeck], eggDeck: [...digilab.decklist.eggDeck] };
  }
  throw new Error(
    `Unknown deck "${spec}". Use a deck file (.json), a meta deck version, or a tournament deck version.`,
  );
}
