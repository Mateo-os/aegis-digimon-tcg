import type { BotDifficulty } from "@aegis/shared/bot/BotDifficulty";
import type { BotStyle } from "@aegis/shared/bot/BotStyle";
import { createLevelProfile } from "#api/bot/levels/createLevelProfile";
import { resolveLevelConfig } from "#api/bot/levels/resolveLevelConfig";
import { createEvaluationPolicy, type BotPolicy } from "#api/bot/policy";

type Params = { style: BotStyle; difficulty: BotDifficulty; seed: number };

export function createBasicBotPolicy({ style, difficulty, seed }: Params): BotPolicy {
  const config = resolveLevelConfig({ difficulty, style });
  if (config.searchSimulations > 0 || config.usesResidual) {
    throw new Error(`The ${difficulty} bot searches ahead, which the simulator does not support yet`);
  }
  return createEvaluationPolicy({
    profile: createLevelProfile({ difficulty, style }),
    seed,
    temperature: config.temperature,
    topK: config.topK,
  });
}
