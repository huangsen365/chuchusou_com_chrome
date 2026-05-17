/**
 * Popup 菜单结构生成 (TypeScript port)
 *
 * 抽自 background/base.js 行 846-866 的 getPopupMenuStructure()。
 *
 * 等价：并行加载 6 个 config (unified / top100 / fastqa / optimize / cover / engines)
 * → 调 CCSMenuStructureBuilder.build(...) 拿到 popup/sidepanel 渲染数据。
 *
 * 性能护栏：6 个 config 通过 Promise.all 并行加载（cold start ~10-15ms），
 * 不要改成串行 await。
 *
 * 与 legacy 共存：deps.loaders 可传 ConfigLoader 实例（src/background/config.ts），
 * 也可直接用 globalThis.load*Config 走 legacy 路径。
 */
import {
  CCSMenuStructureBuilder,
  type MenuStructure,
  type BuildOptions
} from "../shared/menuStructureBuilder"

export interface PopupMenuLoaders {
  loadUnifiedMenuConfig: () => Promise<unknown>
  loadTopQuestionsConfig: () => Promise<unknown>
  loadFastAnswersConfig: () => Promise<unknown>
  loadOptimizedPromptConfig: () => Promise<unknown>
  loadCoverPromptConfig: () => Promise<unknown>
  loadEnginesConfig: () => Promise<unknown>
}

function getGlobalLoaders(): Partial<PopupMenuLoaders> {
  const g = globalThis as unknown as Partial<PopupMenuLoaders>
  return {
    loadUnifiedMenuConfig: g.loadUnifiedMenuConfig,
    loadTopQuestionsConfig: g.loadTopQuestionsConfig,
    loadFastAnswersConfig: g.loadFastAnswersConfig,
    loadOptimizedPromptConfig: g.loadOptimizedPromptConfig,
    loadCoverPromptConfig: g.loadCoverPromptConfig,
    loadEnginesConfig: g.loadEnginesConfig
  }
}

async function safeLoad<T>(fn: (() => Promise<T>) | undefined): Promise<T | null> {
  if (typeof fn !== "function") return null
  try {
    return await fn()
  } catch {
    return null
  }
}

/**
 * 等价 base.js getPopupMenuStructure().
 *
 * 默认用 globalThis 上的 6 个 load*Config（兼容 legacy）；
 * 如需测试或注入，传 deps.loaders。
 */
export async function getPopupMenuStructure(
  deps: { loaders?: Partial<PopupMenuLoaders> } = {}
): Promise<MenuStructure> {
  const loaders = { ...getGlobalLoaders(), ...(deps.loaders || {}) }

  const [
    unifiedConfig,
    top100Config,
    fastqaConfig,
    optimizeConfig,
    coverConfig,
    enginesConfig
  ] = await Promise.all([
    safeLoad(loaders.loadUnifiedMenuConfig),
    safeLoad(loaders.loadTopQuestionsConfig),
    safeLoad(loaders.loadFastAnswersConfig),
    safeLoad(loaders.loadOptimizedPromptConfig),
    safeLoad(loaders.loadCoverPromptConfig),
    safeLoad(loaders.loadEnginesConfig)
  ])

  return CCSMenuStructureBuilder.build({
    unifiedConfig,
    enginesConfig,
    top100Config,
    fastqaConfig,
    optimizeConfig,
    coverConfig
  } as BuildOptions)
}

export default { getPopupMenuStructure }
