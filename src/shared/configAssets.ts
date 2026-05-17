import unifiedMenuConfigJson from "../assets-json/config/unifiedMenuConfig.json"
import enginesConfigJson from "../assets-json/config/engines.json"
import coverPromptsJson from "../assets-json/prompts/coverPrompts.json"
import fastAnswersPromptsJson from "../assets-json/prompts/fastAnswersPrompts.json"
import optimizedPromptsJson from "../assets-json/prompts/optimizedPrompts.json"
import topQuestionsPromptsJson from "../assets-json/prompts/topQuestionsPrompts.json"

import type { EnginesConfig, PromptConfig, UnifiedMenuConfig } from "./types"

export const unifiedMenuConfigAsset = unifiedMenuConfigJson as UnifiedMenuConfig
export const enginesConfigAsset = enginesConfigJson as EnginesConfig

export const promptConfigAssets = {
  cover: coverPromptsJson as PromptConfig,
  fastAnswers: fastAnswersPromptsJson as PromptConfig,
  optimized: optimizedPromptsJson as PromptConfig,
  topQuestions: topQuestionsPromptsJson as PromptConfig
} as const

export type PromptConfigAssetName = keyof typeof promptConfigAssets
