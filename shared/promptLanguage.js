(function() {
  'use strict';

  /**
   * AI 提示词目标语言的 legacy 运行时单一来源。
   *
   * 当前固定回退为简体中文。未来设置页支持选择语言后，应由设置读取层把语言
   * 传给 resolve()/apply()；提示词模板继续只使用 ${outputLanguage} 占位符。
   */
  const PLACEHOLDER = '${outputLanguage}';
  const DEFAULT_OUTPUT_LANGUAGE = '简体中文';

  function resolve(language) {
    const normalized = typeof language === 'string' ? language.trim() : '';
    return normalized || DEFAULT_OUTPUT_LANGUAGE;
  }

  function apply(template, language) {
    return String(template || '').split(PLACEHOLDER).join(resolve(language));
  }

  globalThis.CCSPromptLanguage = Object.freeze({
    PLACEHOLDER,
    DEFAULT_OUTPUT_LANGUAGE,
    resolve,
    apply
  });
})();
