/**
 * 提示词模板装载。
 *
 * prompts/*.json 只放元数据（引擎、分类、varietyPlan、配色表…），模板正文放在同目录的
 * Markdown 文件里，由 JSON 的 templateFile 字段指向（例如 "templateFile": "fastAnswers.md"）。
 * 装载时把正文展开回 config.templateLines，读 templateLines.join('\n') 的老代码不用改。
 *
 * Markdown 文件 = 模板正文 + 结尾一个换行；装载时去掉这一个结尾换行，并把 CRLF 统一成 LF。
 *
 * SW（importScripts）与内容脚本（manifest）都会加载本文件。
 */
(function (root) {
  'use strict';

  function markdownToTemplate(text) {
    const normalized = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    return normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  }

  function templateFilePath(jsonPath, templateFile) {
    const dir = jsonPath.slice(0, jsonPath.lastIndexOf('/') + 1);
    return dir + templateFile;
  }

  /**
   * 若 config.templateFile 存在，读取对应 Markdown 并写回 config.templateLines。
   * @param {Object} config  已解析的 prompts JSON
   * @param {string} jsonPath 该 JSON 的扩展内路径，例如 'prompts/fastAnswersPrompts.json'
   * @returns {Promise<Object>} 同一个 config 对象
   */
  async function resolveTemplateFile(config, jsonPath, options = {}) {
    if (!config || typeof config.templateFile !== 'string' || !config.templateFile) return config;
    const getURL = options.getURL || ((p) => root.chrome.runtime.getURL(p));
    const fetchImpl = options.fetch || ((url) => root.fetch(url));
    const path = templateFilePath(jsonPath, config.templateFile);
    const response = await fetchImpl(getURL(path));
    if (!response.ok) {
      throw new Error(`prompt-template-file-http-${response.status}: ${path}`);
    }
    config.templateLines = markdownToTemplate(await response.text()).split('\n');
    return config;
  }

  root.CCSPromptTemplate = { resolveTemplateFile, markdownToTemplate, templateFilePath };
})(typeof globalThis !== 'undefined' ? globalThis : this);
