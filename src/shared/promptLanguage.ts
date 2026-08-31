/**
 * AI 提示词的目标输出语言单一来源。
 *
 * 当前产品只面向简体中文用户，因此默认值固定为“简体中文”。未来增加国际化
 * 设置时，由设置读取层把用户选择的语言传给 resolvePromptOutputLanguage()；模板
 * 和各业务入口继续只使用 ${outputLanguage} 占位符，无需逐个改写提示词。
 */
export const PROMPT_OUTPUT_LANGUAGE_PLACEHOLDER = "${outputLanguage}"
export const DEFAULT_PROMPT_OUTPUT_LANGUAGE = "简体中文"

export function resolvePromptOutputLanguage(language?: string | null): string {
  const normalized = typeof language === "string" ? language.trim() : ""
  return normalized || DEFAULT_PROMPT_OUTPUT_LANGUAGE
}

export function applyPromptOutputLanguage(
  template: string,
  language?: string | null
): string {
  return template
    .split(PROMPT_OUTPUT_LANGUAGE_PLACEHOLDER)
    .join(resolvePromptOutputLanguage(language))
}

