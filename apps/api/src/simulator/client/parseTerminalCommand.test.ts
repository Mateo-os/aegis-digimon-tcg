import { describe, expect, it } from "vitest";
import { parseTerminalCommand } from "#api/simulator/client/parseTerminalCommand";

describe("parseTerminalCommand", () => {
  it("reads a bare number or do as an action with optional keys", () => {
    expect(parseTerminalCommand("3")).toEqual({ kind: "do", actionId: 3, choice: [] });
    expect(parseTerminalCommand("  do 4 A c ")).toEqual({ kind: "do", actionId: 4, choice: ["a", "c"] });
    expect(parseTerminalCommand("d 2")).toEqual({ kind: "do", actionId: 2, choice: [] });
  });

  it("refuses do without a valid action number", () => {
    expect(parseTerminalCommand("do")).toMatchObject({ kind: "invalid" });
    expect(parseTerminalCommand("do x")).toMatchObject({ kind: "invalid" });
    expect(parseTerminalCommand("do 0")).toMatchObject({ kind: "invalid" });
  });

  it("reads the short and long forms of each command", () => {
    expect(parseTerminalCommand("b")).toEqual({ kind: "board" });
    expect(parseTerminalCommand("BOARD")).toEqual({ kind: "board" });
    expect(parseTerminalCommand("a")).toEqual({ kind: "actions" });
    expect(parseTerminalCommand("card bt1-010")).toEqual({ kind: "card", cardId: "BT1-010" });
    expect(parseTerminalCommand("log")).toEqual({ kind: "log", count: 10 });
    expect(parseTerminalCommand("l 3")).toEqual({ kind: "log", count: 3 });
    expect(parseTerminalCommand("?")).toEqual({ kind: "help" });
    expect(parseTerminalCommand("exit")).toEqual({ kind: "quit" });
    expect(parseTerminalCommand("   ")).toEqual({ kind: "empty" });
  });

  it("explains unknown commands and missing arguments", () => {
    expect(parseTerminalCommand("dance")).toEqual({ kind: "invalid", message: 'Unknown command "dance". Type help.' });
    expect(parseTerminalCommand("card")).toMatchObject({ kind: "invalid" });
    expect(parseTerminalCommand("log -1")).toMatchObject({ kind: "invalid" });
  });
});
