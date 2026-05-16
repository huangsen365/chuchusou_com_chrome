import unifiedMenuConfigJson from "../../config/unifiedMenuConfig.json"
import enginesConfigJson from "../../config/engines.json"
import fastAnswersPromptsJson from "../../prompts/fastAnswersPrompts.json"
import optimizedPromptsJson from "../../prompts/optimizedPrompts.json"
import topQuestionsPromptsJson from "../../prompts/topQuestionsPrompts.json"

import type {
  EngineDefinition,
  EnginesConfig,
  PromptConfig,
  UnifiedMenuConfig,
  UnifiedMenuGroup,
  UnifiedMenuItem
} from "./types"

export const unifiedMenuConfig = unifiedMenuConfigJson as UnifiedMenuConfig
export const enginesConfig = enginesConfigJson as EnginesConfig

export const promptConfigs = {
  fastAnswers: fastAnswersPromptsJson as PromptConfig,
  optimized: optimizedPromptsJson as PromptConfig,
  topQuestions: topQuestionsPromptsJson as PromptConfig
} as const

export type PromptConfigName = keyof typeof promptConfigs

export function getMenuGroups(): UnifiedMenuGroup[] {
  return unifiedMenuConfig.groups
}

export function flattenMenuItems(items: UnifiedMenuItem[]): UnifiedMenuItem[] {
  return items.flatMap((item) => [
    item,
    ...(item.children ? flattenMenuItems(item.children) : [])
  ])
}

export function getAllMenuItems(): UnifiedMenuItem[] {
  return unifiedMenuConfig.groups.flatMap((group) => flattenMenuItems(group.items))
}

export function getEnabledMenuItems(): UnifiedMenuItem[] {
  return getAllMenuItems().filter((item) => item.enabled !== false)
}

export function findMenuItem(menuItemId: string): UnifiedMenuItem | undefined {
  return getAllMenuItems().find((item) => item.id === menuItemId)
}

export function getEngine(engineId: string): EngineDefinition | undefined {
  return enginesConfig.engines[engineId]
}

export function getEngineTitle(engineId: string, fallback = engineId): string {
  return getEngine(engineId)?.label || fallback
}

export function getPromptConfig(name: PromptConfigName): PromptConfig {
  return promptConfigs[name]
}

function replaceToken(source: string, token: string, value: string): string {
  return source.split(token).join(value)
}

export function buildPrompt(config: PromptConfig, input: string): string {
  return replaceToken(config.templateLines.join("\n"), "${input}", input)
}

export function interpolateUrlPattern(
  urlPattern: string,
  values: { keyword?: string; prompt?: string }
): string {
  const keyword = encodeURIComponent(values.keyword || "")
  const prompt = encodeURIComponent(values.prompt || values.keyword || "")

  return [
    ["${KEYWORD}", keyword],
    ["${keyword}", keyword],
    ["${PROMPT}", prompt],
    ["${prompt}", prompt]
  ].reduce((result, [token, value]) => replaceToken(result, token, value), urlPattern)
}
