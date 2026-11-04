import { describe, expect, it } from "vitest";
import { metaDeckByVersion } from "#api/bot/metaDecks/index";
import type { SimulatorAction } from "#api/simulator/actions/SimulatorAction";
import { SimulatorSession, type SimulatorDeck } from "#api/simulator/SimulatorSession";
import { renderActions } from "#api/simulator/text/renderActions";
import { renderSeatView } from "#api/simulator/text/renderSeatView";

function getMetaDeck(deckVersion: string): SimulatorDeck {
  const deck = metaDeckByVersion(deckVersion)!;
  return { mainDeck: [...deck.decklist.mainDeck], eggDeck: [...deck.decklist.eggDeck] };
}

async function startSession(): Promise<SimulatorSession> {
  const session = SimulatorSession.create({
    seed: 3,
    players: [
      { displayName: "Mateo", deck: getMetaDeck("bt5-shoutmon-dx@1") },
      { displayName: "Claude", deck: getMetaDeck("bt6-red-jesmon@1") },
    ],
  });
  await session.start();
  return session;
}

describe("renderSeatView", () => {
  it("shows the turn, the prompt, both players and the viewer's hand by name", async () => {
    const session = await startSession();
    const view = session.getSeatView(0);
    const text = renderSeatView(view);
    const lines = text.split("\n");
    expect(lines[0]).toBe("Setup (opening hands)");
    expect(lines[1]).toMatch(/must decide: /);
    expect(text).toContain("Opponent Claude: hand 5");
    expect(text).toContain("You (Mateo): hand 5");
    for (const card of view.you.hand) {
      expect(text).toContain(`${card.name} (${card.cardId})`);
    }
  });

  it("shows the turn number, whose turn it is and the phase once the game is under way", async () => {
    const session = await startSession();
    while (session.getState().turnCount === 0) {
      const seat = session.getSeatToAct()!;
      const { version } = session.getLegalActions(seat);
      await session.actOnAction({ seat, actionId: 1, version });
    }
    const turnSeat = session.getState().turnSeat;
    const [ownHeader] = renderSeatView(session.getSeatView(turnSeat)).split("\n");
    const [otherHeader] = renderSeatView(session.getSeatView(turnSeat === 0 ? 1 : 0)).split("\n");
    expect(ownHeader).toMatch(/^Turn 1 · Your turn · \w+ phase · Memory /);
    expect(otherHeader).toMatch(/^Turn 1 · (Mateo|Claude)'s turn · \w+ phase · Memory /);
  });
});

describe("renderActions", () => {
  it("numbers fixed actions", () => {
    const actions: SimulatorAction[] = [{ id: 1, kind: "fixed", label: "End your turn", intent: { type: "endPhase" } }];
    expect(renderActions(actions)).toBe("Your actions:\n  1. End your turn");
  });

  it("lists pick candidates with keys, rules and how to answer", () => {
    const actions: SimulatorAction[] = [
      {
        id: 2,
        kind: "pick",
        label: "Trash cards (choose 1 to 2)",
        decisionId: "d",
        responseKind: "selectCards",
        candidates: [
          { key: "a", instanceId: "i1", label: "Agumon (BT1-010)" },
          { key: "b", instanceId: "i2", label: "Tai Kamiya (BT1-085)" },
        ],
        min: 1,
        max: 2,
        rules: ["each card a different name"],
      },
    ];
    expect(renderActions(actions).split("\n")).toEqual([
      "Your actions:",
      "  2. Trash cards (choose 1 to 2)",
      "       a) Agumon (BT1-010)",
      "       b) Tai Kamiya (BT1-085)",
      "       rule: each card a different name",
      "       → do 2 <keys>, choosing 1 to 2",
    ]);
  });

  it("shows an order action's cards and a ready-to-type example", () => {
    const actions: SimulatorAction[] = [
      {
        id: 1,
        kind: "order",
        label: "Choose the card order",
        decisionId: "d",
        candidates: [
          { key: "a", instanceId: "i1", label: "Volcdramon (BT4-015)" },
          { key: "b", instanceId: "i2", label: "Agumon (ST1-03)" },
        ],
      },
    ];
    expect(renderActions(actions).split("\n").slice(-1)).toEqual([
      "       → do 1 followed by every key once in your order, e.g. do 1 a b",
    ]);
  });

  it("says when there is nothing to do", () => {
    expect(renderActions([])).toBe("No actions: it is not your move.");
  });
});
