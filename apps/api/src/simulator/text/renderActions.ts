import type { SimulatorAction } from "#api/simulator/actions/SimulatorAction";

function renderAction(action: SimulatorAction): string[] {
  const lines = [`  ${action.id}. ${action.label}`];
  if (action.kind === "fixed") {
    return lines;
  }
  for (const candidate of action.candidates) {
    lines.push(`       ${candidate.key}) ${candidate.label}`);
  }
  if (action.kind === "pick") {
    for (const rule of action.rules) {
      lines.push(`       rule: ${rule}`);
    }
    lines.push(`       → do ${action.id} <keys>, choosing ${action.min} to ${action.max}`);
    return lines;
  }
  const keys = action.candidates.map((candidate) => candidate.key).join(" ");
  lines.push(`       → do ${action.id} followed by every key once in your order, e.g. do ${action.id} ${keys}`);
  return lines;
}

export function renderActions(actions: readonly SimulatorAction[]): string {
  if (actions.length === 0) {
    return "No actions: it is not your move.";
  }
  return ["Your actions:", ...actions.flatMap(renderAction)].join("\n");
}
