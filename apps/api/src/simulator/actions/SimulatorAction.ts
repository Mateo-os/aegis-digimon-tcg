import type { Intent } from "@aegis/shared/protocol/intents";

export type SimulatorActionCandidate = { key: string; instanceId: string; label: string };

export type SimulatorSelectionKind = "chooseTargets" | "selectCards";

export type SimulatorActionDraft =
  | { kind: "fixed"; label: string; intent: Intent }
  | {
      kind: "pick";
      label: string;
      decisionId: string;
      responseKind: SimulatorSelectionKind;
      candidates: SimulatorActionCandidate[];
      min: number;
      max: number;
      rules: string[];
    }
  | { kind: "order"; label: string; decisionId: string; candidates: SimulatorActionCandidate[] };

export type SimulatorAction = SimulatorActionDraft & { id: number };

export type SimulatorActionList = { version: number; actions: SimulatorAction[] };
