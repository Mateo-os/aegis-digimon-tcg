import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSimulatorDeck } from "#api/simulator/server/resolveSimulatorDeck";

function withDeckFile(contents: unknown, run: (path: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "aegis-deck-"));
  const path = join(directory, "deck.json");
  writeFileSync(path, JSON.stringify(contents));
  try {
    run(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("resolveSimulatorDeck", () => {
  it("resolves a meta deck version", () => {
    const deck = resolveSimulatorDeck("bt5-shoutmon-dx@1");
    expect(deck.mainDeck).toHaveLength(50);
    expect(deck.eggDeck.length).toBeGreaterThan(0);
  });

  it("resolves a tournament deck version", () => {
    expect(resolveSimulatorDeck("digilab-ex13-120207@1").mainDeck).toContain("EX12-036");
  });

  it("reads a deck file", () => {
    withDeckFile({ mainDeck: ["BT1-010"], eggDeck: ["BT1-001"] }, (path) => {
      expect(resolveSimulatorDeck(path)).toEqual({ mainDeck: ["BT1-010"], eggDeck: ["BT1-001"] });
    });
  });

  it("refuses a deck file without card lists", () => {
    withDeckFile({ mainDeck: "BT1-010" }, (path) => {
      expect(() => resolveSimulatorDeck(path)).toThrow("must contain");
    });
  });

  it("refuses an unknown deck name", () => {
    expect(() => resolveSimulatorDeck("no-such-deck")).toThrow('Unknown deck "no-such-deck"');
  });
});
