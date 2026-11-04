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
      case "securityChecked":
        return `Security check: ${formatCardName(event.revealedCardId)} (${event.resolution})`;
      case "deletionPrevented":
        remember(event.permanentId, event.cardId);
        return `${namePermanent(event.permanentId)} was saved by ${event.keyword}`;
      case "evadeResolved":
        return event.accepted ? `${namePermanent(event.permanentId)} used Evade` : undefined;
      case "barrierResolved":
        return event.accepted ? `${namePermanent(event.permanentId)} used Barrier` : undefined;
      case "cardsMoved": {
        const lines = [
          ...(event.deletedPermanents ?? []).map((gone) => `${formatCardName(gone.cardId)} was deleted`),
          ...(event.returnedPermanents ?? []).map((gone) => `${formatCardName(gone.cardId)} was returned`),
        ];
        return lines.length > 0 ? lines.join("\n") : undefined;
      }
      case "securityRecovered":
        return `${nameSeat(event.seat)} added ${event.amount} card(s) to security`;
      case "effectTriggered":
        return `${nameSeat(event.seat)}'s ${formatCardName(event.sourceCardId)}: ${shorten(event.description)}`;
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
