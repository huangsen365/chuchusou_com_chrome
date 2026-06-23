/**
 * Context Menu 构建器 + Cover-pin 同步 (TypeScript port)
 *
 * 抽自 background/menuBuilder.js 完整 990 行：
 * - createContextMenus orchestrator (~500 行)
 * - 4 个 populate{TopQuestions,FastAnswers,Optimized,Cover}Menus
 * - resolveCoverPinTarget / _readCoverPinStorage
 * - installCoverPinSync (chrome.storage.onChanged listener)
 *
 * 本文件由 src/background.ts 在 importScripts 完成后调用 attachMenuBuilder()，
 * 替代 legacy menuBuilder.js。所有 globalThis.X 依赖（MENU_DEFINITIONS /
 * FAST_QA_QUICK_ITEMS / OPTIMIZE_CATEGORY_TITLES / COVER_CATEGORY_TITLES /
 * loadXxxConfig / getMenuTitle / getEngineTitle / isMenuEnabled /
 * loadMenuToggleConfig / menuRegistry / refreshMenuTitle / updateMainMenuTitle /
 * keywordSyncManager / currentMenuState / applyMenuIcons / 等）在调用时 LAZY
 * 取，确保 Constants/TextUtils/config/icons 已加载。
 *
 * 等价 legacy 行为，包括所有 logMenuEvent、isStaleBuild 守护、Promise.allSettled
 * 收尾、菜单 build progress / pending 队列、cover-pin 顶层项动态标题。
 */
import {
  MENU_CONTEXTS_DEFAULT,
  extractErrorMessage,
  createMenuItem as tsCreateMenuItem,
  removeAllContextMenus as tsRemoveAllContextMenus,
  isStaleBuild as tsIsStaleBuild,
  type MenuBuilderDeps,
  type CreateMenuItemMeta
} from "./menuBuilderHelpers"

type G = Record<string, any> & { chrome?: any }

const MENU_CONTEXTS_WITH_EDITABLE: ReadonlyArray<chrome.contextMenus.ContextType> = [
  "selection",
  "page",
  "editable"
] as const

const MENU_GROUPS = Object.freeze({
  fastQaQuick: [] as string[],  // dynamic from FAST_QA_QUICK_ITEMS
  search: [{ id: "ccs-baidu" }, { id: "ccs-google" }, { id: "ccs-x" }],
  ai: [
    { id: "ccs-chatgpt" },
    { id: "ccs-claude" },
    { id: "ccs-grok" },
    { id: "ccs-yiyan" },
    { id: "ccs-google-ai-chat" }
  ],
  general: [
    { id: "ccs-zhihu" },
    { id: "ccs-weixin" },
    { id: "ccs-taobao" },
    { id: "ccs-jd" },
    { id: "ccs-sov2ex" },
    { id: "ccs-google-translate" },
    { id: "ccs-chuchusou" }
  ],
  tool: [{ id: "ccs-copy" }, { id: "ccs-base64" }, { id: "ccs-md5" }, { id: "ccs-url-encode" }],
  transform: [{ id: "ccs-upper" }, { id: "ccs-lower" }]
})

const COVER_PIN_MENU_ID = "ccs-cover-pinned"
const COVER_PIN_SEPARATOR_ID = "ccs-cover-pinned-separator"
const COVER_PIN_STORAGE_KEYS = {
  pin: "ccs_sidepanel_pinned_action",
  customLine: "ccs_cover_custom_selected_line",
  customPurpose: "ccs_cover_custom_purpose"
}
const COVER_PIN_DEFAULT_CATEGORY = "minimal"
const COVER_PIN_PREFERRED_ENGINE = "chatgpt-images"

function readCoverPinStorage(g: G): Promise<{ pin: any; customLine: string }> {
  return new Promise((resolve) => {
    try {
      g.chrome.storage.local.get(
        [COVER_PIN_STORAGE_KEYS.pin, COVER_PIN_STORAGE_KEYS.customLine, COVER_PIN_STORAGE_KEYS.customPurpose],
        (result: Record<string, unknown>) => {
          const pin = (result?.[COVER_PIN_STORAGE_KEYS.pin] as any) || null
          const customPurpose = result?.[COVER_PIN_STORAGE_KEYS.customPurpose]
          const fallbackLine = typeof customPurpose === "string"
            ? (customPurpose.split(/\r?\n/)[0] || "").trim()
            : ""
          const customLineRaw = result?.[COVER_PIN_STORAGE_KEYS.customLine]
          const customLine = (typeof customLineRaw === "string" ? customLineRaw : fallbackLine || "").trim()
          resolve({ pin, customLine })
        }
      )
    } catch {
      resolve({ pin: null, customLine: "" })
    }
  })
}

async function resolveCoverPinTarget(g: G): Promise<{ leafMenuId: string; label: string; title: string } | null> {
  if (typeof g.loadCoverPromptConfig !== "function") return null
  const config = await g.loadCoverPromptConfig()
  if (!config || !Array.isArray(config.categories) || config.categories.length === 0) return null
  const { pin, customLine } = await readCoverPinStorage(g)
  let categoryId =
    pin && pin.taskId === "cover" && typeof pin.categoryId === "string"
      ? pin.categoryId
      : COVER_PIN_DEFAULT_CATEGORY
  let category = config.categories.find((c: any) => c.id === categoryId)
  if (category && category.id === "custom" && !customLine) {
    categoryId = COVER_PIN_DEFAULT_CATEGORY
    category = config.categories.find((c: any) => c.id === categoryId)
  }
  if (!category) return null
  const engines = Array.isArray(category.engines) ? category.engines : []
  const engine = engines.find((e: any) => e.id === COVER_PIN_PREFERRED_ENGINE) || engines[0]
  if (!engine) return null
  const rawLabel = category.id === "custom"
    ? `🖌️ ${customLine.length > 15 ? customLine.slice(0, 15) + "…" : customLine}`
    : category.label || category.id
  return {
    leafMenuId: `ccs-cover-${category.id}-${engine.id}`,
    label: rawLabel,
    title: `🎨 封面生成器 · ${rawLabel}`
  }
}

function buildBuilderDeps(g: G): MenuBuilderDeps {
  return {
    contextMenus: g.chrome?.contextMenus,
    runtime: g.chrome?.runtime
  }
}

function buildMeta(g: G, stage: string, extra?: Partial<CreateMenuItemMeta>): CreateMenuItemMeta {
  return {
    failureLogStage: stage,
    logMenuEvent: g.logMenuEvent as any,
    ...(extra || {})
  }
}

const SEL_SUFFIX = "--sel"

/**
 * 选区孪生树的标题：关键字位用 Chrome 原生 %s（绘制瞬间代入当前选区，
 * 零管道零竞速 —— 视觉取证 L3/L4 截图证实 SW 冻结下依然精准）。
 * 哪些项带关键字位：主项 / 各 *-label / 动态搜索与 AI 直达项 / 速答快捷项。
 */
function selTwinTitle(g: G, options: chrome.contextMenus.CreateProperties): string | undefined {
  const id = String(options.id || "")
  if (!options.title) return options.title
  if (id === "ccs-main") return '🔍 搜："%s"'
  const keywordIds = new Set<string>([
    ...MENU_GROUPS.search.map((i) => i.id),
    ...MENU_GROUPS.ai.map((i) => i.id),
    ...(((g.FAST_QA_QUICK_ITEMS || []) as Array<{ id: string }>).map((i) => i.id))
  ])
  if (id.endsWith("-label") || keywordIds.has(id)) return `${options.title}: "%s"`
  return options.title
}

/**
 * 双树创建：页面树（动态标题，page/editable 上下文）+ 选区孪生树
 * （--sel 后缀，selection 上下文，标题静态含 %s）。
 *
 * 背景（2026-06 视觉取证，截图 L1-L4）：
 *  - 扩展有 ≥2 个"当前上下文匹配"的顶层项时，Chrome 会折叠成以扩展名命名的
 *    父项 —— 任何关键字标题都看不见了；
 *  - 单根 + contextMenus.update 动态标题：SW 冷启动/忙碌时更新晚于菜单绘制
 *    （实测选区 t+417ms 到达 vs 绘制 t+251ms），且原生菜单绘制后不重绘 ——
 *    "第一次右键看不到关键字"物理上无法靠更新解决；
 *  - 唯一两全：上下文互斥的孪生根。selection 时只有 ccs-main-live 匹配
 *    （%s 原生代入，第一次必对）；无选区时只有 ccs-main 匹配（页面关键词
 *    动态标题机制原样保留）。
 */
async function createMenuItem(
  g: G,
  options: chrome.contextMenus.CreateProperties,
  meta: CreateMenuItemMeta = {}
) {
  const result = await tsCreateMenuItem(options, meta, buildBuilderDeps(g))
  const id = String(options.id || "")
  if (result.ok && id && !id.endsWith(SEL_SUFFIX) && id !== "ccs-main-live") {
    const twin: chrome.contextMenus.CreateProperties = {
      ...options,
      id: id === "ccs-main" ? "ccs-main-live" : id + SEL_SUFFIX,
      contexts: ["selection"]
    }
    if (options.parentId != null) {
      const pid = String(options.parentId)
      twin.parentId = pid === "ccs-main" ? "ccs-main-live" : pid + SEL_SUFFIX
    }
    const twinTitle = selTwinTitle(g, options)
    if (twinTitle !== undefined) twin.title = twinTitle
    await tsCreateMenuItem(twin, {
      ...meta,
      failureLogStage: meta.failureLogStage ? `${meta.failureLogStage}-sel` : undefined
    }, buildBuilderDeps(g))
  }
  return result
}

async function createMenuItemsGroup(
  g: G,
  {
    parentId,
    menuItems,
    contexts = MENU_CONTEXTS_DEFAULT,
    failureStage
  }: {
    parentId: string
    menuItems: Array<string | { id?: string }>
    contexts?: ReadonlyArray<chrome.contextMenus.ContextType>
    failureStage?: string
  }
): Promise<void> {
  const normalizedItems = Array.isArray(menuItems) ? menuItems : []
  for (const item of normalizedItems) {
    const menuId = typeof item === "string" ? item : item?.id
    if (!menuId) continue
    if (!g.isMenuEnabled?.(menuId)) continue
    await createMenuItem(g, {
      id: menuId,
      parentId,
      title: g.getMenuTitle?.(menuId) ?? menuId,
      contexts: [...contexts]
    }, {
      onError: (error) => {
        if (failureStage) {
          g.logMenuEvent?.(failureStage, { id: menuId, error: extractErrorMessage(error) })
        }
      }
    })
  }
}

async function createQuickMenuItems(g: G, quickEnabledMap: Map<string, boolean>): Promise<void> {
  const quickItems = g.FAST_QA_QUICK_ITEMS || []
  for (const item of quickItems) {
    if (!quickEnabledMap.get(item.id)) continue
    await createMenuItem(g, {
      id: item.id,
      parentId: "ccs-main",
      title: g.getMenuTitle?.(item.id) ?? item.id,
      contexts: [...MENU_CONTEXTS_WITH_EDITABLE]
    }, {
      onError: (error) => {
        g.logMenuEvent?.("fastqa-quick-child-create-failed", {
          id: item.id, error: extractErrorMessage(error)
        })
      }
    })
  }
}

function isStaleBuild(buildId: number, g: G): boolean {
  return tsIsStaleBuild(buildId, g.menuBuildCounter || 0)
}

async function populateTopQuestionsMenus(g: G, { buildId }: { buildId: number }): Promise<void> {
  try {
    const config = await g.loadTopQuestionsConfig?.()
    if (!config || isStaleBuild(buildId, g)) return
    ;(config.engines || []).forEach((engine: any) => {
      const menuId = `ccs-top100-${engine.id}`
      if (!g.isMenuEnabled?.(menuId)) return
      g.topQuestionsMenuMap?.set?.(menuId, { urlPattern: engine.urlPattern || "" })
    })
    for (const engine of config.engines || []) {
      const menuId = `ccs-top100-${engine.id}`
      if (!g.isMenuEnabled?.(menuId)) continue
      if (isStaleBuild(buildId, g)) return
      const engineTitle = g.getEngineTitle?.(engine.id, engine.label) ?? engine.label
      await createMenuItem(g, {
        id: menuId, parentId: "ccs-top100-root", title: engineTitle, contexts: [...MENU_CONTEXTS_DEFAULT]
      }, buildMeta(g, "top100-child-create-failed"))
    }
  } catch (error) {
    console.warn("[触触搜][BG] 无法构建触触搜百问菜单:", error)
  }
}

async function populateFastAnswersMenus(
  g: G,
  { buildId, fastQaRootEnabled, quickEnabledMap }: { buildId: number; fastQaRootEnabled: boolean; quickEnabledMap: Map<string, boolean> }
): Promise<void> {
  try {
    const config = await g.loadFastAnswersConfig?.()
    if (!config || isStaleBuild(buildId, g)) return
    const quickItems = g.FAST_QA_QUICK_ITEMS || []

    g.logMenuEvent?.("fastqa-config-loaded", {
      engines: (config.engines || []).map((engine: any) => ({
        id: engine?.id,
        enabled: g.isMenuEnabled?.(`ccs-fastqa-${engine?.id}`),
        quickTargets: quickItems
          .filter((item: any) => item.engineId === engine?.id && quickEnabledMap.get(item.id))
          .map((item: any) => item.id)
      }))
    })

    for (const engine of config.engines || []) {
      const menuId = `ccs-fastqa-${engine.id}`
      const urlPattern = engine.urlPattern || ""
      if (fastQaRootEnabled && g.isMenuEnabled?.(menuId)) {
        if (isStaleBuild(buildId, g)) return
        const engineTitle = g.getEngineTitle?.(engine.id, engine.label) ?? engine.label
        await createMenuItem(g, {
          id: menuId, parentId: "ccs-fastqa-root", title: engineTitle, contexts: [...MENU_CONTEXTS_DEFAULT]
        }, buildMeta(g, "fastqa-child-create-failed"))
        g.fastAnswersMenuMap?.set?.(menuId, { urlPattern })
      }
      quickItems.forEach((item: any) => {
        if (item.engineId !== engine.id) return
        if (!quickEnabledMap.get(item.id)) return
        g.fastAnswersMenuMap?.set?.(item.id, { urlPattern })
        g.logMenuEvent?.("fastqa-quick-url-ready", { id: item.id, urlPattern })
      })
    }
  } catch (error) {
    console.warn("[触触搜][BG] 无法构建速答壹拾佰菜单:", error)
    g.logMenuEvent?.("fastqa-config-error", { error: extractErrorMessage(error) })
  }
}

async function populateOptimizedMenus(g: G, { buildId }: { buildId: number }): Promise<void> {
  try {
    const config = await g.loadOptimizedPromptConfig?.()
    if (!config || isStaleBuild(buildId, g)) return
    g.populateOptimizedMenuMap?.(config)

    for (const category of config.categories || []) {
      const categoryId = `ccs-optimize-${category.id}`
      if (!g.isMenuEnabled?.(categoryId)) continue
      if (isStaleBuild(buildId, g)) return
      const categoryTitle = g.OPTIMIZE_CATEGORY_TITLES?.[category.id] || category.label
      await createMenuItem(g, {
        id: categoryId, parentId: "ccs-optimize-root", title: categoryTitle, contexts: [...MENU_CONTEXTS_DEFAULT]
      }, buildMeta(g, "optimize-category-create-failed"))

      const catOpenAllId = `${categoryId}-open-all`
      if (g.isMenuEnabled?.(catOpenAllId)) {
        await createMenuItem(g, {
          id: catOpenAllId, parentId: categoryId, title: "🚀 打开以下全部", contexts: [...MENU_CONTEXTS_DEFAULT]
        }, buildMeta(g, "optimize-category-open-all-create-failed"))
        await createMenuItem(g, {
          id: `${catOpenAllId}-separator`, parentId: categoryId, type: "separator", contexts: [...MENU_CONTEXTS_DEFAULT]
        }, buildMeta(g, "optimize-category-open-all-separator-create-failed"))
      }

      const labelId = `${categoryId}-label`
      const labelResult = await createMenuItem(g, {
        id: labelId, parentId: categoryId, title: "🔍 触触搜", enabled: false, contexts: [...MENU_CONTEXTS_DEFAULT]
      }, buildMeta(g, "optimize-category-label-create-failed"))

      if (labelResult.ok) {
        if (g.menuRegistry) {
          g.menuRegistry.register({
            id: labelId, parentId: categoryId, title: "触触搜", icon: "🔍",
            titleTemplate: "${icon} ${title}: \"${keyword}\"", syncGroup: "labels", autoSync: true
          })
          g.logMenuEvent?.("optimize-label-registered-to-registry", { labelId, syncGroup: "labels" })
        }
      } else {
        g.logMenuEvent?.("optimize-label-creation-failed", {
          labelId, categoryId, reason: "labelResult.ok is false",
          error: (labelResult.error as Error)?.message || "unknown"
        })
      }

      const separatorResult = await createMenuItem(g, {
        id: `${categoryId}-label-separator`, parentId: categoryId, type: "separator", contexts: [...MENU_CONTEXTS_DEFAULT]
      }, buildMeta(g, "optimize-category-label-separator-create-failed"))

      if (!separatorResult.ok) {
        g.logMenuEvent?.("optimize-separator-creation-failed", {
          categoryId, error: (separatorResult.error as Error)?.message || "unknown"
        })
      }

      for (const engine of category.engines || []) {
        const menuId = `ccs-optimize-${category.id}-${engine.id}`
        if (!g.isMenuEnabled?.(menuId)) continue
        if (isStaleBuild(buildId, g)) return
        const engineTitle = g.getEngineTitle?.(engine.id, engine.label) ?? engine.label
        await createMenuItem(g, {
          id: menuId, parentId: categoryId, title: engineTitle, contexts: [...MENU_CONTEXTS_DEFAULT]
        }, buildMeta(g, "optimize-engine-create-failed"))
        g.BG_DBG?.("[触触搜][BG][MENU] optimize submenu created", { menuId })
      }
    }
  } catch (error) {
    console.warn("[触触搜][BG] 无法构建优化提示词菜单:", error)
  }
}

async function populateCoverMenus(g: G, { buildId }: { buildId: number }): Promise<void> {
  try {
    const config = await g.loadCoverPromptConfig?.()
    if (!config || isStaleBuild(buildId, g)) return
    g.populateCoverMenuMap?.(config)

    const presetCount = (config.categories || []).filter((c: any) => c && c.id && c.id !== "custom" && (c.engines || [])[0]).length
    const openAllEnabled = presetCount >= 2 && g.isMenuEnabled?.("ccs-cover-open-all")
    if (openAllEnabled) {
      if (isStaleBuild(buildId, g)) return
      await createMenuItem(g, {
        id: "ccs-cover-open-all", parentId: "ccs-cover-root",
        title: "🚀 " + (g.MENU_DEFINITIONS?.["ccs-cover-open-all"]?.text || "打开以下全部预设风格"),
        contexts: [...MENU_CONTEXTS_DEFAULT]
      }, buildMeta(g, "cover-open-all-create-failed"))
      await createMenuItem(g, {
        id: "ccs-cover-open-all-separator", parentId: "ccs-cover-root", type: "separator",
        contexts: [...MENU_CONTEXTS_DEFAULT]
      }, buildMeta(g, "cover-open-all-separator-create-failed"))
    }

    for (const category of config.categories || []) {
      if (category.id === "custom") continue
      const engine = (category.engines || [])[0]
      if (!engine) continue
      const leafId = `ccs-cover-${category.id}-${engine.id}`
      if (!g.isMenuEnabled?.(leafId)) continue
      if (isStaleBuild(buildId, g)) return
      const leafTitle = g.COVER_CATEGORY_TITLES?.[category.id] || category.label
      await createMenuItem(g, {
        id: leafId, parentId: "ccs-cover-root", title: leafTitle, contexts: [...MENU_CONTEXTS_DEFAULT]
      }, buildMeta(g, "cover-leaf-create-failed"))
      g.BG_DBG?.("[触触搜][BG][MENU] cover leaf created", { leafId })
    }
  } catch (error) {
    console.warn("[触触搜][BG] 无法构建封面生成器菜单:", error)
  }
}

async function createContextMenus(g: G): Promise<void> {
  if (g.menuBuildInProgress) {
    g.menuBuildPending = true
    g.logMenuEvent?.("rebuild-queued", {})
    return
  }
  g.menuBuildInProgress = true
  const buildId = ++g.menuBuildCounter
  const finalizeMenuBuild = () => {
    if (!g.menuBuildInProgress) return
    g.menuBuildInProgress = false
    if (g.menuBuildPending) {
      g.menuBuildPending = false
      createContextMenus(g)
    }
  }

  try {
    await tsRemoveAllContextMenus(buildBuilderDeps(g))
  } catch (error) {
    g.logMenuEvent?.("remove-all-error", { error: extractErrorMessage(error) })
    finalizeMenuBuild()
    return
  }

  const asyncTasks: Promise<unknown>[] = []
  try {
    await g.loadMenuToggleConfig?.()
    g.BG_DBG?.("[触触搜][BG][MENU] rebuilding context menus", { buildId })
    g.optimizedPromptMenuMap?.clear?.()
    g.topQuestionsMenuMap?.clear?.()
    g.fastAnswersMenuMap?.clear?.()
    g.logMenuEvent?.("rebuild-start", { buildId })

    const top100RootEnabled = !!g.isMenuEnabled?.("ccs-top100-root")
    const top100OpenAllEnabled = top100RootEnabled && !!g.isMenuEnabled?.("ccs-top100-open-all")
    const fastQaRootEnabled = !!g.isMenuEnabled?.("ccs-fastqa-root")
    const fastQaOpenAllEnabled = fastQaRootEnabled && !!g.isMenuEnabled?.("ccs-fastqa-open-all")
    const optimizeRootEnabled = !!g.isMenuEnabled?.("ccs-optimize-root")
    const coverRootEnabled = !!g.isMenuEnabled?.("ccs-cover-root")
    const quickItems = g.FAST_QA_QUICK_ITEMS || []
    const quickEnabledMap: Map<string, boolean> = new Map(quickItems.map((item: any) => [item.id, !!g.isMenuEnabled?.(item.id)]))
    const hasAdvancedSections = top100RootEnabled || fastQaRootEnabled || optimizeRootEnabled || coverRootEnabled
    const needsFastAnswersConfig = fastQaRootEnabled || quickItems.some((item: any) => quickEnabledMap.get(item.id))

    g.logMenuEvent?.("toggle-status", {
      top100RootEnabled, top100OpenAllEnabled,
      quickEnabled: Object.fromEntries(quickEnabledMap.entries()),
      fastQaRootEnabled, fastQaOpenAllEnabled,
      optimizeRootEnabled, hasAdvancedSections, needsFastAnswersConfig
    })

    // ccs-main：仅 page 上下文。互斥必须**绝对** —— 'editable' 会在
    // "输入框内选中文字"时与孪生根的 'selection' 同时匹配（Chrome 的
    // editable 与 selection 上下文可共存），双根同屏即触发扩展名折叠
    //（F2 视觉取证实锤：用户"看不到文字但点击拿得到"正是此洞）。
    // 取舍：空输入框右键不再显示本扩展菜单（与多数扩展一致）；
    // 输入框内的**选区**完整归 %s 孪生树，第一次右键即显选中文字。
    const mainResult = await createMenuItem(g, {
      id: "ccs-main", title: g.getMenuTitle?.("ccs-main") ?? "触触搜", contexts: ["page"]
    }, buildMeta(g, "create-main-failed"))

    if (mainResult.ok && g.menuRegistry) {
      g.menuRegistry.register({
        id: "ccs-main", title: "触触搜", icon: "🔍",
        titleTemplate: "${icon} ${title}: \"${keyword}\"", syncGroup: "main", autoSync: true
      })
    }

    const searchLabelResult = await createMenuItem(g, {
      id: "ccs-search-label", parentId: "ccs-main", title: "🔍 触触搜", enabled: false,
      contexts: [...MENU_CONTEXTS_DEFAULT]
    }, buildMeta(g, "create-search-label-failed"))

    if (searchLabelResult.ok && g.menuRegistry) {
      g.menuRegistry.register({
        id: "ccs-search-label", parentId: "ccs-main", title: "触触搜", icon: "🔍",
        titleTemplate: "${icon} ${title}: \"${keyword}\"", syncGroup: "labels", autoSync: true
      })
    }

    await createMenuItem(g, {
      id: "ccs-search-label-separator", parentId: "ccs-main", type: "separator",
      contexts: [...MENU_CONTEXTS_DEFAULT]
    }, buildMeta(g, "create-search-label-separator-failed"))

    if (coverRootEnabled && g.isMenuEnabled?.(COVER_PIN_MENU_ID)) {
      try {
        const pinTarget = await resolveCoverPinTarget(g)
        if (pinTarget && !isStaleBuild(buildId, g)) {
          await createMenuItem(g, {
            id: COVER_PIN_MENU_ID, parentId: "ccs-main", title: pinTarget.title,
            contexts: [...MENU_CONTEXTS_DEFAULT]
          }, buildMeta(g, "cover-pinned-create-failed"))
          await createMenuItem(g, {
            id: COVER_PIN_SEPARATOR_ID, parentId: "ccs-main", type: "separator",
            contexts: [...MENU_CONTEXTS_DEFAULT]
          }, buildMeta(g, "cover-pinned-separator-create-failed"))
        }
      } catch (error) {
        console.warn("[触触搜][BG] 顶层置顶封面项创建失败:", error)
      }
    }

    await createQuickMenuItems(g, quickEnabledMap)

    await createMenuItem(g, {
      id: "ccs-separator-0", parentId: "ccs-main", type: "separator", contexts: [...MENU_CONTEXTS_DEFAULT]
    }, buildMeta(g, "create-separator-0-failed"))

    g.updateMainMenuTitle?.(g.currentMenuState?.display || "")

    await createMenuItemsGroup(g, {
      parentId: "ccs-main", menuItems: MENU_GROUPS.search as any,
      contexts: MENU_CONTEXTS_DEFAULT, failureStage: "search-menu-create-failed"
    })
    g.BG_DBG?.("[触触搜][BG][MENU] base search items created")

    await createMenuItem(g, {
      id: "ccs-separator-ai", parentId: "ccs-main", type: "separator", contexts: [...MENU_CONTEXTS_DEFAULT]
    }, buildMeta(g, "create-separator-ai-failed"))

    await createMenuItemsGroup(g, {
      parentId: "ccs-main", menuItems: MENU_GROUPS.ai as any,
      contexts: MENU_CONTEXTS_DEFAULT, failureStage: "ai-menu-create-failed"
    })

    await createMenuItem(g, {
      id: "ccs-separator-general", parentId: "ccs-main", type: "separator", contexts: [...MENU_CONTEXTS_DEFAULT]
    }, buildMeta(g, "create-separator-general-failed"))

    await createMenuItemsGroup(g, {
      parentId: "ccs-main", menuItems: MENU_GROUPS.general as any,
      contexts: MENU_CONTEXTS_DEFAULT, failureStage: "general-menu-create-failed"
    })

    if (hasAdvancedSections) {
      await createMenuItem(g, {
        id: "ccs-separator-optimized", parentId: "ccs-main", type: "separator", contexts: [...MENU_CONTEXTS_DEFAULT]
      }, buildMeta(g, "create-separator-optimized-failed"))
    }

    if (top100RootEnabled) {
      await createMenuItem(g, {
        id: "ccs-top100-root", parentId: "ccs-main",
        title: g.getMenuTitle?.("ccs-top100-root") ?? "ccs-top100-root", contexts: [...MENU_CONTEXTS_DEFAULT]
      }, buildMeta(g, "top100-root-create-failed"))

      if (top100OpenAllEnabled) {
        await createMenuItem(g, {
          id: "ccs-top100-open-all", parentId: "ccs-top100-root",
          title: g.getMenuTitle?.("ccs-top100-open-all") ?? "ccs-top100-open-all",
          contexts: [...MENU_CONTEXTS_DEFAULT]
        }, buildMeta(g, "top100-open-all-create-failed"))
      }

      const top100LabelResult = await createMenuItem(g, {
        id: "ccs-top100-label", parentId: "ccs-top100-root", title: "🔍 触触搜", enabled: false,
        contexts: [...MENU_CONTEXTS_DEFAULT]
      }, buildMeta(g, "top100-label-create-failed"))

      if (top100LabelResult.ok && g.menuRegistry) {
        g.menuRegistry.register({
          id: "ccs-top100-label", parentId: "ccs-top100-root", title: "触触搜", icon: "🔍",
          titleTemplate: "${icon} ${title}: \"${keyword}\"", syncGroup: "labels", autoSync: true
        })
      }

      await createMenuItem(g, {
        id: "ccs-top100-label-separator", parentId: "ccs-top100-root", type: "separator",
        contexts: [...MENU_CONTEXTS_DEFAULT]
      }, buildMeta(g, "top100-label-separator-create-failed"))

      asyncTasks.push(populateTopQuestionsMenus(g, { buildId }))
    }

    if (fastQaRootEnabled) {
      await createMenuItem(g, {
        id: "ccs-fastqa-root", parentId: "ccs-main",
        title: g.getMenuTitle?.("ccs-fastqa-root") ?? "ccs-fastqa-root",
        contexts: [...MENU_CONTEXTS_DEFAULT]
      }, buildMeta(g, "fastqa-root-create-failed"))

      if (fastQaOpenAllEnabled) {
        await createMenuItem(g, {
          id: "ccs-fastqa-open-all", parentId: "ccs-fastqa-root",
          title: g.getMenuTitle?.("ccs-fastqa-open-all") ?? "ccs-fastqa-open-all",
          contexts: [...MENU_CONTEXTS_DEFAULT]
        }, buildMeta(g, "fastqa-open-all-create-failed"))
      }

      const fastqaLabelResult = await createMenuItem(g, {
        id: "ccs-fastqa-label", parentId: "ccs-fastqa-root", title: "🔍 触触搜", enabled: false,
        contexts: [...MENU_CONTEXTS_DEFAULT]
      }, buildMeta(g, "fastqa-label-create-failed"))

      if (fastqaLabelResult.ok && g.menuRegistry) {
        g.menuRegistry.register({
          id: "ccs-fastqa-label", parentId: "ccs-fastqa-root", title: "触触搜", icon: "🔍",
          titleTemplate: "${icon} ${title}: \"${keyword}\"", syncGroup: "labels", autoSync: true
        })
      }

      await createMenuItem(g, {
        id: "ccs-fastqa-label-separator", parentId: "ccs-fastqa-root", type: "separator",
        contexts: [...MENU_CONTEXTS_DEFAULT]
      }, buildMeta(g, "fastqa-label-separator-create-failed"))
    }

    if (needsFastAnswersConfig) {
      asyncTasks.push(populateFastAnswersMenus(g, { buildId, fastQaRootEnabled, quickEnabledMap }))
    }

    if (optimizeRootEnabled) {
      await createMenuItem(g, {
        id: "ccs-optimize-root", parentId: "ccs-main",
        title: g.getMenuTitle?.("ccs-optimize-root") ?? "ccs-optimize-root",
        contexts: [...MENU_CONTEXTS_DEFAULT]
      }, buildMeta(g, "optimize-root-create-failed"))
      await populateOptimizedMenus(g, { buildId })
    }

    if (coverRootEnabled) {
      await createMenuItem(g, {
        id: "ccs-cover-root", parentId: "ccs-main",
        title: g.getMenuTitle?.("ccs-cover-root") ?? "ccs-cover-root",
        contexts: [...MENU_CONTEXTS_DEFAULT]
      }, buildMeta(g, "cover-root-create-failed"))
      await populateCoverMenus(g, { buildId })
    }

    const toolGroupEnabled = MENU_GROUPS.tool.some((item: any) => {
      const menuId = typeof item === "string" ? item : item?.id
      return menuId && g.isMenuEnabled?.(menuId)
    })
    const transformGroupEnabled = MENU_GROUPS.transform.some((item: any) => {
      const menuId = typeof item === "string" ? item : item?.id
      return menuId && g.isMenuEnabled?.(menuId)
    })

    if (toolGroupEnabled) {
      await createMenuItem(g, {
        id: "ccs-separator-1", parentId: "ccs-main", type: "separator", contexts: [...MENU_CONTEXTS_DEFAULT]
      }, buildMeta(g, "create-separator-1-failed"))
      await createMenuItemsGroup(g, {
        parentId: "ccs-main", menuItems: MENU_GROUPS.tool as any,
        contexts: MENU_CONTEXTS_DEFAULT, failureStage: "tool-menu-create-failed"
      })
    }

    if (transformGroupEnabled) {
      await createMenuItem(g, {
        id: "ccs-separator-2", parentId: "ccs-main", type: "separator", contexts: [...MENU_CONTEXTS_DEFAULT]
      }, buildMeta(g, "create-separator-2-failed"))
      await createMenuItemsGroup(g, {
        parentId: "ccs-main", menuItems: MENU_GROUPS.transform as any,
        contexts: MENU_CONTEXTS_DEFAULT, failureStage: "transform-menu-create-failed"
      })
    }

    if (g.isMenuEnabled?.("ccs-show-popover")) {
      await createMenuItem(g, {
        id: "ccs-separator-3", parentId: "ccs-main", type: "separator", contexts: [...MENU_CONTEXTS_DEFAULT]
      }, buildMeta(g, "create-separator-3-failed"))
      await createMenuItem(g, {
        id: "ccs-show-popover", parentId: "ccs-main",
        title: g.getMenuTitle?.("ccs-show-popover") ?? "ccs-show-popover",
        contexts: [...MENU_CONTEXTS_DEFAULT]
      }, buildMeta(g, "show-popover-create-failed"))
    }
  } catch (error) {
    console.warn("[触触搜][BG] 构建上下文菜单时发生错误:", error)
    g.logMenuEvent?.("rebuild-error", { buildId, error: extractErrorMessage(error) })
  }

  try {
    if (asyncTasks.length > 0) await Promise.allSettled(asyncTasks)
  } catch (error) {
    console.warn("[触触搜][BG] 等待菜单异步任务时发生错误:", error)
  }

  try {
    g.BG_DBG?.("[触触搜][BG][MENU] applying icons", { buildId })
    await g.applyMenuIcons?.(buildId)
  } catch (error) {
    console.warn("[触触搜][BG] 无法应用菜单图标:", error)
  }

  try {
    const tabs = await g.chrome?.tabs?.query({ active: true, currentWindow: true })
    const activeTab = Array.isArray(tabs) ? tabs[0] : null
    if (activeTab) await g.refreshMenuTitle?.(activeTab)
  } catch (error) {
    console.warn("[触触搜][BG] 初始化菜单标题失败:", error)
    g.logMenuEvent?.("initial-title-error", { error: extractErrorMessage(error) })
  }

  g.logMenuEvent?.("rebuild-complete", { buildId })

  if (g.keywordSyncManager && g.currentMenuState?.display) {
    try {
      const syncResult = await g.keywordSyncManager.syncMenus()
      g.logMenuEvent?.("menus-synced-after-rebuild-new-system", {
        buildId, display: g.currentMenuState.display, syncResult
      })
    } catch (error) {
      console.error("[触触搜][BG] 菜单创建后同步失败:", error)
      g.logMenuEvent?.("menus-sync-after-rebuild-failed", {
        buildId, error: extractErrorMessage(error)
      })
    }
  }

  finalizeMenuBuild()
}

function installCoverPinSync(g: G): void {
  const storage = g.chrome?.storage
  if (!storage?.onChanged?.addListener) return
  storage.onChanged.addListener(async (changes: Record<string, unknown>, area: string) => {
    if (area !== "local") return
    const watchedKeys = [
      COVER_PIN_STORAGE_KEYS.pin,
      COVER_PIN_STORAGE_KEYS.customLine,
      COVER_PIN_STORAGE_KEYS.customPurpose
    ]
    if (!watchedKeys.some((k) => k in changes)) return
    try {
      const target = await resolveCoverPinTarget(g)
      if (!target) return
      g.chrome.contextMenus.update(COVER_PIN_MENU_ID, { title: target.title }, () => {
        void g.chrome.runtime.lastError
      })
    } catch (error) {
      console.warn("[触触搜][BG] 封面 pin 同步失败:", error)
    }
  })
}

/**
 * 主入口：替代 legacy menuBuilder.js 的所有 globalThis 导出 + 模块顶层副作用。
 * 由 src/background.ts 在 importScripts 之后、其他 attachXxx 旁调用。
 */
export function attachMenuBuilder(): void {
  const g = globalThis as unknown as G
  g.createContextMenus = () => createContextMenus(g)
  g.resolveCoverPinTarget = () => resolveCoverPinTarget(g)
  g.COVER_PIN_MENU_ID = COVER_PIN_MENU_ID
  installCoverPinSync(g)
}

export default attachMenuBuilder
