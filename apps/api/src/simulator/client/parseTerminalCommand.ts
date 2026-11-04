export type TerminalCommand =
  | { kind: "do"; actionId: number; choice: string[] }
  | { kind: "board" }
  | { kind: "actions" }
  | { kind: "card"; cardId: string }
  | { kind: "log"; count: number }
  | { kind: "help" }
  | { kind: "quit" }
  | { kind: "empty" }
  | { kind: "invalid"; message: string };

const DEFAULT_LOG_COUNT = 10;

function parseDo(words: readonly string[]): TerminalCommand {
  const [first, ...choice] = words;
  const actionId = Number(first);
  if (!first || !Number.isInteger(actionId) || actionId < 1) {
    return { kind: "invalid", message: "Give an action number, for example: do 3" };
  }
  return { kind: "do", actionId, choice: choice.map((key) => key.toLowerCase()) };
}

export function parseTerminalCommand(line: string): TerminalCommand {
  const words = line
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const [command, ...rest] = words;
  if (!command) {
    return { kind: "empty" };
  }
  if (/^\d+$/.test(command)) {
    return parseDo(words);
  }
  switch (command.toLowerCase()) {
    case "do":
    case "d":
      return parseDo(rest);
    case "board":
    case "b":
      return { kind: "board" };
    case "actions":
    case "a":
      return { kind: "actions" };
    case "card":
    case "c":
      return rest[0]
        ? { kind: "card", cardId: rest[0].toUpperCase() }
        : { kind: "invalid", message: "Give a card id, for example: card BT1-010" };
    case "log":
    case "l": {
      const count = rest[0] === undefined ? DEFAULT_LOG_COUNT : Number(rest[0]);
      return Number.isInteger(count) && count > 0
        ? { kind: "log", count }
        : { kind: "invalid", message: "log takes a positive number" };
    }
    case "help":
    case "h":
    case "?":
      return { kind: "help" };
    case "quit":
    case "q":
    case "exit":
      return { kind: "quit" };
    default:
      return { kind: "invalid", message: `Unknown command "${command}". Type help.` };
  }
}
