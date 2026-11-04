import type { CardView, PermanentView, PlayerView, SeatPrompt, SeatView } from "#api/simulator/view/SeatView";

function formatMemory(memory: number): string {
  if (memory > 0) {
    return `${memory} on your side`;
  }
  if (memory < 0) {
    return `${-memory} on your opponent's side`;
  }
  return "0";
}

function formatCard(card: CardView): string {
  const details = [
    card.kinds.join("/"),
    card.level === undefined ? undefined : `Lv${card.level}`,
    card.playCost === undefined ? undefined : `cost ${card.playCost}`,
    card.dp === undefined ? undefined : `DP ${card.dp}`,
  ].filter((detail) => detail !== undefined && detail !== "");
  return `${card.name} (${card.cardId})${details.length > 0 ? ` · ${details.join(" · ")}` : ""}`;
}

function formatPermanent(permanent: PermanentView): string {
  const parts = [`${permanent.card.name} (${permanent.card.cardId})`];
  if (permanent.card.level !== undefined) {
    parts.push(`Lv${permanent.card.level}`);
  }
  if (permanent.dp > 0) {
    parts.push(`DP ${permanent.dp}`);
  }
  if (permanent.suspended) {
    parts.push("suspended");
  }
  if (permanent.digivolutionCards.length > 0) {
    parts.push(`${permanent.digivolutionCards.length} digivolution cards`);
  }
  if (permanent.linkedCards.length > 0) {
    parts.push(`linked: ${permanent.linkedCards.map((card) => card.name).join(", ")}`);
  }
  return parts.join(" · ");
}

function renderPlayer(player: PlayerView, title: string): string[] {
  const lines = [
    `${title}: hand ${player.handCount} · deck ${player.deckCount} · eggs ${player.eggDeckCount} · security ${player.securityCount} · trash ${player.trash.length}`,
  ];
  if (player.faceUpSecurity.length > 0) {
    lines.push(`  Face-up security: ${player.faceUpSecurity.map((card) => card.name).join(", ")}`);
  }
  lines.push(`  Breeding: ${player.breeding ? formatPermanent(player.breeding) : "empty"}`);
  if (player.battleArea.length === 0) {
    lines.push("  Battle area: empty");
  } else {
    lines.push("  Battle area:");
    for (const permanent of player.battleArea) {
      lines.push(`    - ${formatPermanent(permanent)}`);
    }
  }
  return lines;
}

function formatPrompt(view: SeatView, prompt: SeatPrompt): string {
  const who = prompt.seat === view.seat ? "You" : view.opponent.displayName;
  switch (prompt.kind) {
    case "decision":
      return `${who} must decide: ${prompt.text || prompt.decisionKind}`;
    case "combatWindow":
      return `${who} must answer a ${prompt.windowKind} window`;
    case "turn":
      return `${who} to act (${prompt.phase} phase)`;
  }
}

function formatResult(view: SeatView): string | undefined {
  const result = view.result;
  if (!result) {
    return undefined;
  }
  if (result.outcome === "draw") {
    return `Game over: draw (${result.reason})`;
  }
  const winner = result.winnerSeat === view.seat ? "You win" : `${view.opponent.displayName} wins`;
  return `Game over: ${winner} (${result.reason})`;
}

function formatHeader(view: SeatView): string {
  if (view.turnCount === 0) {
    return "Setup (opening hands)";
  }
  const turnOwner = view.isYourTurn ? "Your turn" : `${view.opponent.displayName}'s turn`;
  return `Turn ${view.turnCount} · ${turnOwner} · ${view.phase} phase · Memory ${formatMemory(view.memory)}`;
}

export function renderSeatView(view: SeatView): string {
  const lines = [formatHeader(view)];
  const result = formatResult(view);
  if (result) {
    lines.push(result);
  } else if (view.prompt) {
    lines.push(formatPrompt(view, view.prompt));
  }
  lines.push("", ...renderPlayer(view.opponent, `Opponent ${view.opponent.displayName}`), "");
  lines.push(...renderPlayer(view.you, `You (${view.you.displayName})`));
  lines.push(`  Hand:`);
  for (const card of view.you.hand) {
    lines.push(`    - ${formatCard(card)}`);
  }
  return lines.join("\n");
}
