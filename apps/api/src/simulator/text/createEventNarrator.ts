import type { ServerEvent } from "@aegis/shared/protocol/events";
import type { Seat } from "@aegis/shared/schema/enums";
import { formatCardName } from "#api/simulator/actions/formatCardName";

type Params = { viewerSeat: Seat; playerNames: readonly [string, string] };

const MAX_EFFECT_TEXT = 100;
const NARRATED_PHASES: ReadonlySet<string> = new Set(["Breeding", "Main"]);

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_EFFECT_TEXT ? `${flat.slice(0, MAX_EFFECT_TEXT - 1)}…` : flat;
}

function formatPlayMechanic(mechanic: string | undefined): string {
  if (mechanic === "digiXros") {
    return " with DigiXros";
  }
  if (mechanic === "dna") {
    return " with DNA";
  }
  return "";
}

export function createEventNarrator({ viewerSeat, playerNames }: Params) {
  const permanentNames = new Map<string, string>();
  const nameSeat = (seat: Seat) => (seat === viewerSeat ? "You" : playerNames[seat]);
  const remember = (permanentId: string | undefined, cardId: string | undefined) => {
    if (permanentId && cardId) {
      permanentNames.set(permanentId, formatCardName(cardId));
    }
  };
  const namePermanent = (permanentId: string) => permanentNames.get(permanentId) ?? "a Digimon";
  const nameOwner = (seat: Seat) => (seat === viewerSeat ? "Your" : `${playerNames[seat]}'s`);
  let securityAttacker = "the attacker";

  const describeSecurityReveal = (event: Extract<ServerEvent, { kind: "securityRevealed" }>) => {
    securityAttacker = namePermanent(event.attackerPermanentId);
    const left = event.securityCountBefore === undefined ? "" : `, ${event.securityCountBefore - 1} left`;
    const header = `Security check (${nameOwner(event.seat)} security${left}): ${formatCardName(event.revealedCardId)}`;
    if (event.securityCardDP === undefined || event.attackerDP === undefined) {
      return header;
    }
    return `${header} ${event.securityCardDP} DP vs ${securityAttacker} ${event.attackerDP} DP`;
  };

  const describeSecurityResult = (event: Extract<ServerEvent, { kind: "securityChecked" }>) => {
    const card = formatCardName(event.revealedCardId);
    if (event.resolution === "trashed") {
      return `${card} was trashed`;
    }
    if (event.resolution === "effect" || !event.battle) {
      return `${card}'s security effect resolved`;
    }
    const { attackerDeleted, securityDigimonDeleted } = event.battle;
    if (attackerDeleted && securityDigimonDeleted) {
      return `Security battle: both ${securityAttacker} and ${card} were deleted`;
    }
    if (attackerDeleted) {
      return `Security battle: ${securityAttacker} lost and was deleted`;
    }
    if (securityDigimonDeleted) {
      return `Security battle: ${securityAttacker} won`;
    }
    return "Security battle: no one was deleted";
  };

  const describeBattle = (event: Extract<ServerEvent, { kind: "battleCompared" }>) => {
    if (event.effectBattle) {
      remember(event.attackerPermanentId, event.effectBattle.attackerCardId);
      remember(event.defenderPermanentId, event.effectBattle.defenderCardId);
    }
    const label = event.effectBattle ? "Effect battle" : "Battle";
    const attacker = namePermanent(event.attackerPermanentId);
    const defender = namePermanent(event.defenderPermanentId);
    const losers = new Set(event.loserPermanentIds);
    const attackerLost = losers.has(event.attackerPermanentId);
    const defenderLost = losers.has(event.defenderPermanentId);
    if (attackerLost && defenderLost) {
      return `${label}: ${attacker} vs ${defender}, both lost`;
    }
    if (attackerLost) {
      return `${label}: ${attacker} vs ${defender}, ${defender} won`;
    }
    if (defenderLost) {
      return `${label}: ${attacker} vs ${defender}, ${attacker} won`;
    }
    return `${label}: ${attacker} vs ${defender}, no one lost`;
  };

  function describe(event: ServerEvent): string | undefined {
    switch (event.kind) {
      case "matchStarted":
        return `${nameSeat(event.firstSeat)} ${event.firstSeat === viewerSeat ? "go" : "goes"} first`;
      case "phaseChanged":
        return NARRATED_PHASES.has(event.phase)
          ? `— Turn ${event.turnCount}: ${nameSeat(event.turnSeat)} · ${event.phase} phase —`
          : undefined;
      case "turnEnded":
        return `${nameSeat(event.endingSeat)} ended the turn`;
      case "cardPlayed": {
        remember(event.permanentId, event.cardId);
        const how = formatPlayMechanic(event.mechanic);
        const from = event.fromZone === "digivolutionCards" ? " from digivolution cards" : "";
        return `${nameSeat(event.seat)} played ${formatCardName(event.cardId)}${how}${from}`;
      }
      case "digivolved":
        remember(event.permanentId, event.cardId);
        return `${nameSeat(event.seat)} digivolved into ${formatCardName(event.cardId)}`;
      case "hatched":
        remember(event.permanentId, event.cardId);
        return `${nameSeat(event.seat)} hatched ${formatCardName(event.cardId)}`;
      case "movedFromBreeding":
        remember(event.permanentId, event.cardId);
        return `${nameSeat(event.seat)} moved ${formatCardName(event.cardId)} to the battle area`;
      case "attackDeclared": {
        remember(event.attackerPermanentId, event.attackerCardId);
        if (event.target.kind === "permanent") {
          remember(event.target.permanentId, event.targetCardId);
        }
        const target = event.target.kind === "player" ? "the player" : namePermanent(event.target.permanentId);
        return `${nameSeat(event.seat)} attacked ${target} with ${formatCardName(event.attackerCardId)}`;
      }
      case "blocked":
        return `Blocked by ${namePermanent(event.blockerPermanentId)}`;
      case "blockDeclined":
        return "No block";
      case "securityRevealed":
        return describeSecurityReveal(event);
      case "securityChecked":
        return describeSecurityResult(event);
      case "battleCompared":
        return describeBattle(event);
      case "deletionPrevented":
        remember(event.permanentId, event.cardId);
        return `${namePermanent(event.permanentId)} was saved by ${event.keyword}`;
      case "evadeResolved":
        return event.accepted ? `${namePermanent(event.permanentId)} used Evade` : undefined;
      case "barrierResolved":
        return event.accepted ? `${namePermanent(event.permanentId)} used Barrier` : undefined;
      case "cardsMoved": {
        const lines = [
          ...(event.deletedPermanents ?? []).map(
            (gone) =>
              `${nameOwner(gone.seat)} ${formatCardName(gone.cardId)} was deleted${event.battleDeletion ? " in battle" : ""}`,
          ),
          ...(event.returnedPermanents ?? []).map((gone) => `${formatCardName(gone.cardId)} was returned`),
        ];
        return lines.length > 0 ? lines.join("\n") : undefined;
      }
      case "securityRecovered":
        return `${nameSeat(event.seat)} added ${event.amount} card(s) to security`;
      case "effectTriggered":
        return `${nameOwner(event.seat)} ${formatCardName(event.sourceCardId)}: ${shorten(event.description)}`;
      case "actionRejected":
        return `Action rejected: ${event.reason}`;
      case "gameOver":
        if (event.result.outcome === "draw") {
          return `Game over: draw (${event.reason})`;
        }
        return `Game over: ${event.result.winnerSeat === viewerSeat ? "you win" : `${playerNames[event.result.winnerSeat]} wins`} (${event.reason})`;
      default:
        return undefined;
    }
  }

  return { describe };
}
