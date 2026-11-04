import { describe, expect, it } from "vitest";
import type { ServerEvent } from "@aegis/shared/protocol/events";
import { createEventNarrator } from "#api/simulator/text/createEventNarrator";

function narrate(events: readonly object[]): (string | undefined)[] {
  const narrator = createEventNarrator({ viewerSeat: 0, playerNames: ["Mateo", "Claude"] });
  return events.map((event) => narrator.describe(event as ServerEvent));
}

describe("createEventNarrator", () => {
  it("names the viewer as You and the opponent by name", () => {
    expect(
      narrate([
        { kind: "cardPlayed", seat: 0, cardId: "BT1-010", permanentId: "p1" },
        { kind: "cardPlayed", seat: 1, cardId: "BT1-085", permanentId: "p2" },
      ]),
    ).toEqual(["You played Agumon (BT1-010)", "Claude played Tai Kamiya (BT1-085)"]);
  });

  it("remembers which card each Digimon is so later events can name it", () => {
    expect(
      narrate([
        { kind: "hatched", seat: 1, permanentId: "p9", cardId: "BT1-010" },
        { kind: "blocked", blockerPermanentId: "p9" },
        { kind: "evadeResolved", permanentId: "p9", accepted: true },
        { kind: "blocked", blockerPermanentId: "unknown" },
      ]),
    ).toEqual([
      "Claude hatched Agumon (BT1-010)",
      "Blocked by Agumon (BT1-010)",
      "Agumon (BT1-010) used Evade",
      "Blocked by a Digimon",
    ]);
  });

  it("describes attacks, deletions and the end of the game", () => {
    expect(
      narrate([
        {
          kind: "attackDeclared",
          seat: 1,
          attackerPermanentId: "p3",
          attackerCardId: "BT1-011",
          target: { kind: "player" },
        },
        {
          kind: "cardsMoved",
          deletedPermanents: [{ permanentId: "p1", instanceId: "i1", cardId: "BT1-010", seat: 0 }],
        },
        { kind: "gameOver", result: { outcome: "win", winnerSeat: 1 }, reason: "security" },
      ]),
    ).toEqual([
      "Claude attacked the player with Agumon Expert (BT1-011)",
      "Agumon (BT1-010) was deleted",
      "Game over: Claude wins (security)",
    ]);
  });

  it("only narrates the breeding and main phases and skips quiet events", () => {
    expect(
      narrate([
        { kind: "phaseChanged", phase: "Main", turnSeat: 0, turnCount: 2 },
        { kind: "phaseChanged", phase: "Draw", turnSeat: 0, turnCount: 2 },
        { kind: "deckShuffled", seat: 0, deck: "deck" },
        { kind: "evadeResolved", permanentId: "p1", accepted: false },
      ]),
    ).toEqual(["— Turn 2: You · Main phase —", undefined, undefined, undefined]);
  });

  it("shortens long effect text", () => {
    const [line] = narrate([
      { kind: "effectTriggered", seat: 1, sourceCardId: "BT1-085", effectKey: "k", description: "x".repeat(300) },
    ]);
    expect(line?.startsWith("Claude's Tai Kamiya (BT1-085): ")).toBe(true);
    expect(line?.endsWith("…")).toBe(true);
    expect(line!.length).toBeLessThan(160);
  });
});
