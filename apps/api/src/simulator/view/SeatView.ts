import type { Phase, Seat } from "@aegis/shared/schema/enums";

export type CardView = {
  instanceId: string;
  cardId: string;
  name: string;
  kinds: string[];
  colors: string[];
  level?: number;
  playCost?: number;
  dp?: number;
};

export type PermanentView = {
  permanentId: string;
  card: CardView;
  dp: number;
  suspended: boolean;
  digivolutionCards: CardView[];
  linkedCards: CardView[];
};

export type PlayerView = {
  seat: Seat;
  displayName: string;
  deckCount: number;
  eggDeckCount: number;
  handCount: number;
  securityCount: number;
  faceUpSecurity: CardView[];
  trash: CardView[];
  breeding?: PermanentView;
  battleArea: PermanentView[];
};

export type OwnPlayerView = PlayerView & { hand: CardView[] };

export type SeatPrompt =
  | { kind: "decision"; seat: Seat; decisionKind: string; text: string }
  | { kind: "combatWindow"; seat: Seat; windowKind: string }
  | { kind: "turn"; seat: Seat; phase: Phase };

export type SeatViewResult = { outcome: "win"; winnerSeat: Seat; reason: string } | { outcome: "draw"; reason: string };

export type SeatView = {
  seat: Seat;
  turnCount: number;
  turnSeat: Seat;
  phase: Phase;
  isYourTurn: boolean;
  memory: number;
  prompt?: SeatPrompt;
  result?: SeatViewResult;
  you: OwnPlayerView;
  opponent: PlayerView;
};
