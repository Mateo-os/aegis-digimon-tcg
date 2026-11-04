import { describe, expect, it } from "vitest";
import { BotDifficulty } from "@aegis/shared/bot/BotDifficulty";
import { BotStyle } from "@aegis/shared/bot/BotStyle";
import { createBasicBotPolicy } from "#api/simulator/bots/createBasicBotPolicy";

const BASIC_LEVELS = [BotDifficulty.BEGINNER.value, BotDifficulty.CASUAL.value, BotDifficulty.STANDARD.value];
const SEARCH_LEVELS = [BotDifficulty.EXPERT.value, BotDifficulty.MASTER.value];

describe("createBasicBotPolicy", () => {
  it("builds every style at every level that does not search ahead", () => {
    for (const { value: style } of Object.values(BotStyle)) {
      for (const difficulty of BASIC_LEVELS) {
        expect(createBasicBotPolicy({ style, difficulty, seed: 1 }).name).toContain(style);
      }
    }
  });

  it("refuses levels that search ahead", () => {
    for (const difficulty of SEARCH_LEVELS) {
      expect(() => createBasicBotPolicy({ style: BotStyle.BALANCED.value, difficulty, seed: 1 })).toThrow(
        "searches ahead",
      );
    }
  });
});
