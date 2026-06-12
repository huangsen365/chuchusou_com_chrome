/**
 * chrome.contextMenus.onClicked 监听器注册 (TypeScript port)
 *
 * 抽自 background/menuHandlers.js 完整 611 行主体。本文件由 src/background.ts
 * 在 importScripts(legacy) 之后调用，注册唯一一份 onClicked 监听器。
 *
 * 监听器内部完全使用 globalThis.X bridged 函数（setMenuState / KeywordService /
 * runAITaskByMenuId / buildTopQuestionsPrompt / loadXxxConfig / 等）—— 这些
 * 都已由 baseBridge.ts 或 legacy importScripts 提供。
 *
 * 等价 legacy menuHandlers.js 的 onClicked listener，行为完全一致。switch-case
 * fallback 全部保留（按 CLAUDE.md 强制要求："老 switch-case fallback 要保留"）。
 */

type G = Record<string, any> & { chrome?: typeof chrome }

const KEYWORD_INTENTS_DEFAULT = {
  CONTEXT_MENU_CLICK: "contextmenu-click",
  PAGE_CHANGED: "page-changed"
}

export async function hydrateContextMenuTab(tab: chrome.tabs.Tab | undefined, g: G = globalThis as unknown as G): Promise<chrome.tabs.Tab | undefined> {
  const tabId = tab?.id
  if (tabId == null || !g.chrome?.tabs?.get) return tab
  try {
    const freshTab = await g.chrome.tabs.get(tabId)
    if (!freshTab) return tab
    return {
      ...tab,
      ...freshTab,
      url: freshTab.url || freshTab.pendingUrl || tab?.url || "",
      title: freshTab.title || tab?.title || ""
    }
  } catch (error) {
    g.logMenuEvent?.("context-click-tab-hydrate-failed", {
      tabId,
      error: (error as Error)?.message || String(error)
    })
    return tab
  }
}

export function attachMenuHandlers(): void {
  const g = globalThis as unknown as G
  const cm = g.chrome?.contextMenus
  if (!cm?.onClicked?.addListener) return

  const openPromptUrlPattern = async (urlPattern: string, prompt: string, meta: Record<string, any> = {}) => {
    const fallbackUrl = String(urlPattern || "").split("${PROMPT}").join(encodeURIComponent(prompt || ""))
    if (
      typeof g.ccsIsSupportedAIUrl === "function" &&
      typeof g.ccsPrepareAIPromptUrl === "function" &&
      typeof g.ccsOpenPreparedAIPromptUrl === "function" &&
      g.ccsIsSupportedAIUrl(fallbackUrl)
    ) {
      const preparedUrl = await g.ccsPrepareAIPromptUrl(urlPattern, prompt, meta)
      await g.ccsOpenPreparedAIPromptUrl(preparedUrl, { active: meta.active })
      return
    }
    g.chrome?.tabs?.create?.({ url: fallbackUrl, ...(meta.active !== undefined ? { active: meta.active } : {}) })
  }

  cm.onClicked.addListener(async (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
    tab = await hydrateContextMenuTab(tab, g)
    try { await g.loadMenuToggleConfig?.() } catch { /* ignore */ }
    try { await g.syncSelectionFromTab?.(tab, "context-click", { updateMenu: false }) } catch { /* ignore */ }

    const selectionText = typeof info.selectionText === "string" ? info.selectionText.trim() : ""
    if (!selectionText && tab?.id != null && g.selectedTextByTab) {
      delete g.selectedTextByTab[tab.id]
    }
    const fallbackEntry = tab?.id != null ? g.fallbackKeywordByTab?.[tab.id] : null
    const fallbackFresh = !!fallbackEntry && Date.now() - fallbackEntry.timestamp < 5000
    const shouldForceFallback =
      fallbackFresh &&
      (!selectionText ||
        selectionText.length <=
          Math.max(2, Math.min(6, (fallbackEntry.normalized?.length || fallbackEntry.raw?.length || 0) / 4)))

    if (selectionText) {
      g.setMenuState?.(selectionText, g.normalizeSearchText?.(selectionText) ?? selectionText, {
        tabId: tab?.id ?? null,
        url: tab?.url || ""
      })
    }
    g.logMenuEvent?.("context-click", {
      menuItemId: info.menuItemId,
      selectionText: info.selectionText,
      normalizedSelection: selectionText ? g.normalizeSearchText?.(selectionText) ?? "" : "",
      tabId: tab?.id ?? null,
      tabUrl: tab?.url || "",
      tabTitle: tab?.title || ""
    })

    const KS = g.KeywordService
    const INTENTS = g.KEYWORD_INTENTS ?? KEYWORD_INTENTS_DEFAULT
    const pageTitle = tab?.title || (tab?.id != null ? g.getLatestTabPageTitle?.(tab.id) || "" : "") || ""
    const ctxResult = await KS?.getKeyword?.({
      tabId: tab?.id,
      url: tab?.url,
      title: pageTitle,
      intent: INTENTS.CONTEXT_MENU_CLICK,
      selectionText: info.selectionText || ""
    }) ?? { raw: "", normalized: "" }
    const rawText = ctxResult.raw
    const normalizedText = ctxResult.normalized
    g.logMenuEvent?.("context-click-resolved", {
      tabId: tab?.id ?? null,
      menuItemId: info.menuItemId,
      rawText,
      normalizedText,
      tabUrl: tab?.url || "",
      tabTitle: tab?.title || ""
    })
    g.snapshotMenuTitles?.("context-click-resolved")

    let effectiveRaw = rawText
    let effectiveNormalized = normalizedText

    if (shouldForceFallback && fallbackEntry) {
      effectiveRaw = fallbackEntry.raw
      effectiveNormalized = fallbackEntry.normalized
      g.logMenuEvent?.("context-click-forced-fallback", {
        tabId: tab?.id ?? null,
        menuItemId: info.menuItemId,
        fallbackRaw: fallbackEntry.raw,
        fallbackNormalized: fallbackEntry.normalized
      })
    }

    if (!effectiveRaw && !effectiveNormalized) {
      try {
        const fallbackResult = await KS?.getKeyword?.({
          tabId: tab?.id,
          url: tab?.url,
          title: pageTitle,
          intent: INTENTS.PAGE_CHANGED,
          selectionText: ""
        })
        if (fallbackResult?.raw || fallbackResult?.normalized) {
          effectiveRaw = fallbackResult.raw
          effectiveNormalized = fallbackResult.normalized
          if (tab?.id != null && fallbackResult?.raw && g.selectedTextByTab) {
            g.selectedTextByTab[tab.id] = { text: fallbackResult.raw, url: tab?.url || "", timestamp: Date.now() }
          }
          g.logMenuEvent?.("context-click-fallback", {
            tabId: tab?.id ?? null,
            menuItemId: info.menuItemId,
            raw: fallbackResult.raw,
            normalized: fallbackResult.normalized
          })
        }
      } catch (error) {
        g.logMenuEvent?.("context-click-fallback-error", {
          tabId: tab?.id ?? null,
          error: (error as Error)?.message || String(error)
        })
      }
    }

    if (effectiveRaw || effectiveNormalized) {
      g.setMenuState?.(effectiveRaw, effectiveNormalized, {
        tabId: tab?.id ?? null,
        url: tab?.url || ""
      })
      if (tab?.id != null && g.fallbackKeywordByTab) {
        delete g.fallbackKeywordByTab[tab.id]
      }
    } else {
      const stored = tab?.id != null ? g.selectedTextByTab?.[tab.id] : null
      if (stored && typeof stored.text === "string" && stored.text.trim().length > 0) {
        g.setMenuState?.(stored.text, g.normalizeSearchText?.(stored.text) ?? stored.text, {
          tabId: tab?.id ?? null,
          url: tab?.url || stored?.url || ""
        })
      }
    }

    const finalRaw = effectiveRaw
    const finalNormalized = effectiveNormalized

    if (tab?.id != null) {
      const entry = g.latestTitleByTab?.[tab.id]
      const titleForCompare = (entry?.keyword || entry?.title || tab?.title || "").trim()
      const normalizedTitle = titleForCompare
        ? entry?.keywordNormalized || g.normalizeSearchText?.(titleForCompare) || ""
        : ""
      const keywordRawForCompare = (finalRaw || finalNormalized || "").trim()
      const normalizedKeyword = keywordRawForCompare ? g.normalizeSearchText?.(keywordRawForCompare) || "" : ""
      const matched = normalizedTitle && normalizedKeyword && normalizedTitle === normalizedKeyword
      const menuBase = finalRaw || finalNormalized || ""
      const menuDisplay = menuBase
        ? g.formatMenuTitle?.(finalNormalized || finalRaw) || menuBase
        : g.currentMenuState?.display || ""
      const menuRaw = menuBase || g.currentMenuState?.raw || ""
      g.logMenuEvent?.("context-click-title-check", {
        tabId: tab.id,
        title: titleForCompare,
        keyword: keywordRawForCompare,
        normalizedTitle,
        normalizedKeyword,
        menuDisplay,
        menuRaw,
        match: !!matched,
        forcedFallback: shouldForceFallback
      })
    }

    g.snapshotMenuTitles?.("context-click-final")
    const isTopQuestionsOpenAll = info.menuItemId === "ccs-top100-open-all"
    const isTopQuestionsMenu = typeof info.menuItemId === "string" && info.menuItemId.startsWith("ccs-top100-")
    const isTopQuestionsEngine = isTopQuestionsMenu && !isTopQuestionsOpenAll
    const isFastAnswersMenu = typeof info.menuItemId === "string" && info.menuItemId.startsWith("ccs-fastqa-")
    const isFastAnswersOpenAll = info.menuItemId === "ccs-fastqa-open-all"

    if (
      !finalNormalized &&
      !finalRaw &&
      info.menuItemId !== "ccs-show-popover" &&
      !g.topQuestionsMenuMap?.has?.(info.menuItemId) &&
      !isTopQuestionsOpenAll &&
      !g.fastAnswersMenuMap?.has?.(info.menuItemId) &&
      !isFastAnswersOpenAll &&
      !g.optimizedPromptMenuMap?.has?.(info.menuItemId) &&
      !(typeof info.menuItemId === "string" && info.menuItemId.startsWith("ccs-optimize-"))
    ) {
      g.chrome?.tabs?.sendMessage(tab?.id ?? -1, {
        action: "showToast",
        message: "没有选中文本或无法提取关键词"
      })?.catch?.(() => { /* ignore */ })
      return
    }

    // cover-pin → resolve 真实 leaf menuId
    let effectiveMenuItemId = info.menuItemId
    if (effectiveMenuItemId === g.COVER_PIN_MENU_ID && typeof g.resolveCoverPinTarget === "function") {
      try {
        const target = await g.resolveCoverPinTarget()
        if (target?.leafMenuId) effectiveMenuItemId = target.leafMenuId
      } catch (err) {
        g.BG_DBG?.("[menuHandlers] resolveCoverPinTarget error", (err as Error)?.message)
      }
    }

    // SSoT 快速通道：runAITaskByMenuId
    if (typeof g.runAITaskByMenuId === "function" && effectiveMenuItemId) {
      const rawKeyword = finalRaw || finalNormalized
      if (rawKeyword) {
        try {
          const r = await g.runAITaskByMenuId(effectiveMenuItemId, rawKeyword, { tabId: tab?.id })
          if (r.matched && r.success) return
        } catch (err) {
          g.BG_DBG?.("[menuHandlers] runAITaskByMenuId error", (err as Error)?.message)
        }
      }
    }

    // top100 分支
    if (isTopQuestionsOpenAll || isTopQuestionsEngine) {
      let effectiveInput = finalRaw || finalNormalized
      if (!effectiveInput) {
        g.chrome?.tabs?.sendMessage(tab?.id ?? -1, {
          action: "showToast", message: "没有选中文本，无法生成问题列表"
        })?.catch?.(() => {})
        return
      }
      if (typeof g.applyTextLimit === "function") {
        effectiveInput = g.applyTextLimit(info.menuItemId, effectiveInput, { tabId: tab?.id }).text
      }
      g.loadTopQuestionsConfig?.().then(async (config: any) => {
        if (!config) {
          g.chrome?.tabs?.sendMessage(tab?.id ?? -1, { action: "showToast", message: "触触搜百问模板加载失败" })?.catch?.(() => {})
          return
        }
        if (!g.topQuestionsTemplate) {
          g.topQuestionsTemplate = Array.isArray(config.templateLines)
            ? config.templateLines.join("\n")
            : config.template || ""
        }
        const prompt = g.buildTopQuestionsPrompt?.(effectiveInput)
        if (!prompt) {
          g.chrome?.tabs?.sendMessage(tab?.id ?? -1, { action: "showToast", message: "触触搜百问模板无效" })?.catch?.(() => {})
          return
        }
        if (isTopQuestionsOpenAll) {
          const engines = Array.isArray(config.engines) ? config.engines : []
          let openedCount = 0
          for (const engine of engines) {
            if (!engine || typeof engine.urlPattern !== "string" || !engine.urlPattern) continue
            const menuId = `ccs-top100-${engine.id}`
            if (!g.isMenuEnabled?.(menuId)) continue
            await openPromptUrlPattern(engine.urlPattern, prompt, {
              source: "top100-context-menu-open-all",
              menuId,
              engineId: engine.id || "",
              tabId: tab?.id,
              active: openedCount === 0
            })
            openedCount += 1
          }
        } else {
          const engineId = (info.menuItemId as string).replace("ccs-top100-", "")
          let menuTarget = g.topQuestionsMenuMap?.get?.(info.menuItemId)
          if (!menuTarget) {
            const engine = (config.engines || []).find((item: any) => item.id === engineId)
            if (engine) {
              menuTarget = { urlPattern: engine.urlPattern || "" }
              g.topQuestionsMenuMap?.set?.(info.menuItemId, menuTarget)
            }
          }
          if (!menuTarget || !menuTarget.urlPattern) {
            g.chrome?.tabs?.sendMessage(tab?.id ?? -1, { action: "showToast", message: "未找到对应的引擎配置" })?.catch?.(() => {})
            return
          }
          await openPromptUrlPattern(menuTarget.urlPattern, prompt, {
            source: "top100-context-menu",
            menuId: info.menuItemId,
            engineId,
            tabId: tab?.id
          })
        }
      }).catch(() => {
        g.chrome?.tabs?.sendMessage(tab?.id ?? -1, { action: "showToast", message: "触触搜百问模板加载失败" })?.catch?.(() => {})
      })
      return
    }

    // fastqa 分支
    if (isFastAnswersOpenAll || isFastAnswersMenu) {
      g.logMenuEvent?.("fastqa-click", { menuItemId: info.menuItemId, isOpenAll: isFastAnswersOpenAll })
      let effectiveInput = finalRaw || finalNormalized
      if (!effectiveInput) {
        g.chrome?.tabs?.sendMessage(tab?.id ?? -1, { action: "showToast", message: "没有选中文本，无法生成速答内容" })?.catch?.(() => {})
        return
      }
      if (typeof g.applyTextLimit === "function") {
        effectiveInput = g.applyTextLimit(info.menuItemId, effectiveInput, { tabId: tab?.id }).text
      }
      g.loadFastAnswersConfig?.().then(async (config: any) => {
        if (!config) {
          g.chrome?.tabs?.sendMessage(tab?.id ?? -1, { action: "showToast", message: "速答壹拾佰模板加载失败" })?.catch?.(() => {})
          return
        }
        if (!g.fastAnswersTemplate) {
          g.fastAnswersTemplate = Array.isArray(config.templateLines)
            ? config.templateLines.join("\n")
            : config.template || ""
        }
        const prompt = g.buildFastAnswersPrompt?.(effectiveInput)
        if (!prompt) {
          g.chrome?.tabs?.sendMessage(tab?.id ?? -1, { action: "showToast", message: "速答壹拾佰模板无效" })?.catch?.(() => {})
          return
        }
        if (isFastAnswersOpenAll) {
          const engines = Array.isArray(config.engines) ? config.engines : []
          let openedCount = 0
          for (const engine of engines) {
            if (!engine || typeof engine.urlPattern !== "string" || !engine.urlPattern) continue
            const menuId = `ccs-fastqa-${engine.id}`
            if (!g.isMenuEnabled?.(menuId)) continue
            const targetUrl = engine.urlPattern.split("${PROMPT}").join(encodeURIComponent(prompt))
            await openPromptUrlPattern(engine.urlPattern, prompt, {
              source: "fastqa-context-menu-open-all",
              menuId,
              engineId: engine.id || "",
              tabId: tab?.id,
              active: openedCount === 0
            })
            openedCount += 1
            g.logMenuEvent?.("fastqa-open-url", { targetUrl, menuId, index: openedCount })
          }
        } else {
          const quickItem = (g.FAST_QA_QUICK_ITEMS || []).find((item: any) => item.id === info.menuItemId)
          const engineId = quickItem ? quickItem.engineId : (info.menuItemId as string).replace("ccs-fastqa-", "").replace(/-(shortcut|quick)$/, "")
          let menuTarget = g.fastAnswersMenuMap?.get?.(info.menuItemId)
          if (!menuTarget) {
            const engine = (config.engines || []).find((item: any) => item.id === engineId)
            if (engine) {
              menuTarget = { urlPattern: engine.urlPattern || "" }
              g.fastAnswersMenuMap?.set?.(info.menuItemId, menuTarget)
            }
          }
          if (!menuTarget || !menuTarget.urlPattern) {
            g.chrome?.tabs?.sendMessage(tab?.id ?? -1, { action: "showToast", message: "未找到对应的速答配置" })?.catch?.(() => {})
            return
          }
          const url = menuTarget.urlPattern.split("${PROMPT}").join(encodeURIComponent(prompt))
          g.logMenuEvent?.("fastqa-open-url", { targetUrl: url, menuItemId: info.menuItemId, engineId })
          await openPromptUrlPattern(menuTarget.urlPattern, prompt, {
            source: "fastqa-context-menu",
            menuId: info.menuItemId,
            engineId,
            tabId: tab?.id
          })
        }
      }).catch(() => {
        g.chrome?.tabs?.sendMessage(tab?.id ?? -1, { action: "showToast", message: "速答壹拾佰模板加载失败" })?.catch?.(() => {})
      })
      return
    }

    // optimize 分支
    if (g.optimizedPromptMenuMap?.has?.(info.menuItemId) || (typeof info.menuItemId === "string" && info.menuItemId.startsWith("ccs-optimize-"))) {
      if (!finalRaw && !finalNormalized) {
        g.chrome?.tabs?.sendMessage(tab?.id ?? -1, { action: "showToast", message: "没有选中文本，无法生成优化后的提示词" })?.catch?.(() => {})
        return
      }
      g.loadOptimizedPromptConfig?.().then(async (fullConfig: any) => {
        if (!fullConfig) {
          g.chrome?.tabs?.sendMessage(tab?.id ?? -1, { action: "showToast", message: "提示词模板加载失败" })?.catch?.(() => {})
          return
        }
        if (!g.optimizedPromptMenuMap?.has?.(info.menuItemId)) {
          g.populateOptimizedMenuMap?.(fullConfig)
        }
        const menuTarget = g.optimizedPromptMenuMap?.get?.(info.menuItemId)
        if (!menuTarget || !menuTarget.urlPattern) {
          g.chrome?.tabs?.sendMessage(tab?.id ?? -1, { action: "showToast", message: "未找到对应的提示词配置" })?.catch?.(() => {})
          return
        }
        const baseInput = finalRaw || finalNormalized || ""
        const effectiveInput = typeof g.applyTextLimit === "function"
          ? g.applyTextLimit(info.menuItemId, baseInput, { tabId: tab?.id }).text
          : baseInput
        const prompt = g.buildOptimizedPrompt?.(menuTarget.purpose, effectiveInput)
        if (!prompt) {
          g.chrome?.tabs?.sendMessage(tab?.id ?? -1, { action: "showToast", message: "提示词模板加载失败" })?.catch?.(() => {})
          return
        }
        const encodedPrompt = encodeURIComponent(prompt)
        let url = menuTarget.urlPattern.split("${PROMPT}").join(encodedPrompt)
        if (typeof g.enforceFinalUrlCap === "function") url = g.enforceFinalUrlCap(url)
        if (
          typeof g.ccsIsSupportedAIUrl === "function" &&
          typeof g.ccsPrepareAIPromptUrl === "function" &&
          typeof g.ccsOpenPreparedAIPromptUrl === "function" &&
          g.ccsIsSupportedAIUrl(url)
        ) {
          const preparedUrl = await g.ccsPrepareAIPromptUrl(menuTarget.urlPattern, prompt, {
            source: "optimized-prompt-context-menu",
            menuId: info.menuItemId,
            engineId: menuTarget.engineId || ""
          })
          await g.ccsOpenPreparedAIPromptUrl(preparedUrl)
        } else if (typeof g.ccsOpenUrlWithRecovery === "function") {
          const record = typeof g.ccsCreateUrlRecoveryRecord === "function"
            ? g.ccsCreateUrlRecoveryRecord({
                kind: "regular",
                source: "optimized-prompt-context-menu",
                menuId: info.menuItemId,
                engineId: menuTarget.engineId || "",
                urlPattern: menuTarget.urlPattern || "",
                originalText: prompt,
                effectiveText: prompt,
                targetUrl: url,
                originalUrlLength: url.length,
                finalUrlLength: url.length,
                truncated: false
              })
            : null
          await g.ccsOpenUrlWithRecovery(url, record)
        } else {
          g.chrome?.tabs?.create({ url })
        }
      }).catch(() => {
        g.chrome?.tabs?.sendMessage(tab?.id ?? -1, { action: "showToast", message: "提示词模板加载失败" })?.catch?.(() => {})
      })
      return
    }

    // SSoT URL 快速通道
    if (finalNormalized && typeof g.tryOpenMenuUrl === "function") {
      if (g.tryOpenMenuUrl(info.menuItemId, finalNormalized, { tabId: tab?.id })) return
    }

    // legacy switch-case fallback（CLAUDE.md 强制保留）
    const enc = (s: string) => encodeURIComponent(s)
    const openIfHas = (url: string, urlPattern?: string) => {
      if (!finalNormalized) return
      if (
        typeof g.ccsIsSupportedAIUrl === "function" &&
        typeof g.ccsPrepareAIPromptUrl === "function" &&
        typeof g.ccsOpenPreparedAIPromptUrl === "function" &&
        g.ccsIsSupportedAIUrl(url)
      ) {
        g.ccsPrepareAIPromptUrl(urlPattern || url, finalNormalized, {
          source: "context-menu-fallback",
          menuId: info.menuItemId
        })
          .then((preparedUrl: string) => g.ccsOpenPreparedAIPromptUrl(preparedUrl))
          .catch(() => g.chrome?.tabs?.create({ url }))
        return
      }
      if (
        urlPattern &&
        typeof g.ccsPrepareRegularUrl === "function" &&
        typeof g.ccsOpenUrlWithRecovery === "function"
      ) {
        const prepared = g.ccsPrepareRegularUrl(urlPattern, finalNormalized, {
          source: "context-menu-fallback",
          menuId: info.menuItemId,
          tabId: tab?.id
        })
        g.ccsOpenUrlWithRecovery(prepared.url, prepared.record)
          .catch(() => g.chrome?.tabs?.create({ url: prepared.url }))
        return
      }
      g.chrome?.tabs?.create({ url })
    }
    switch (info.menuItemId) {
      case "ccs-baidu":
        openIfHas(`https://www.baidu.com/s?ie=utf-8&oe=utf-8&wd=${enc(finalNormalized)}`)
        break
      case "ccs-google":
        openIfHas(`https://www.google.com/search?q=${enc(finalNormalized)}`)
        break
      case "ccs-google-ai-chat":
        openIfHas(
          `https://www.google.com/search?udm=50&ie=UTF-8&oe=UTF-8&q=${enc(finalNormalized)}`,
          "https://www.google.com/search?udm=50&ie=UTF-8&oe=UTF-8&q=${KEYWORD}"
        )
        break
      case "ccs-yiyan":
        openIfHas(`https://yiyan.baidu.com/?q=${enc(finalNormalized)}`, "https://yiyan.baidu.com/?q=${KEYWORD}")
        break
      case "ccs-chatgpt":
        openIfHas(`https://chatgpt.com/?q=${enc(finalNormalized)}`, "https://chatgpt.com/?q=${KEYWORD}")
        break
      case "ccs-claude":
        openIfHas(`https://claude.ai/new?q=${enc(finalNormalized)}`, "https://claude.ai/new?q=${KEYWORD}")
        break
      case "ccs-grok":
        openIfHas(`https://grok.com/?q=${enc(finalNormalized)}`, "https://grok.com/?q=${KEYWORD}")
        break
      case "ccs-zhihu":
        openIfHas(`https://www.zhihu.com/search?q=${enc(finalNormalized)}`)
        break
      case "ccs-weixin":
        openIfHas(`https://search.weixin.qq.com/cgi-bin/newsearchweb/userclientjump?path=page/search/christmas_jump&query=${enc(finalNormalized)}`)
        break
      case "ccs-taobao":
        openIfHas(`https://s.taobao.com/search?q=${enc(finalNormalized)}`)
        break
      case "ccs-jd":
        openIfHas(`https://search.jd.com/Search?keyword=${enc(finalNormalized)}`)
        break
      case "ccs-sov2ex":
        openIfHas(`https://www.sov2ex.com/?q=${enc(finalNormalized)}`)
        break
      case "ccs-google-translate":
        openIfHas(`https://translate.google.com/?sl=auto&tl=zh-CN&text=${enc(finalNormalized)}`)
        break
      case "ccs-chuchusou":
        openIfHas(`https://chuchusou.com/?q=${enc(finalNormalized)}`)
        break
      case "ccs-copy":
        if (rawText) {
          const ok = await g.copyTextInTab?.(tab, rawText)
          if (!ok) {
            g.chrome?.tabs?.sendMessage(tab?.id ?? -1, { action: "showToast", message: "复制失败，请检查页面权限" })?.catch?.(() => {})
          }
        }
        break
      case "ccs-base64":
      case "ccs-md5":
      case "ccs-url-encode":
      case "ccs-upper":
      case "ccs-lower": {
        const cmdMap: Record<string, string> = {
          "ccs-base64": "base64",
          "ccs-md5": "md5",
          "ccs-url-encode": "url-encode",
          "ccs-upper": "upper",
          "ccs-lower": "lower"
        }
        if (rawText && tab?.id != null) {
          g.chrome?.tabs?.sendMessage(tab.id, { action: "processCommand", command: cmdMap[info.menuItemId as string], text: rawText })?.catch?.(() => {})
        }
        break
      }
      case "ccs-show-popover":
        if (tab?.id != null) {
          g.chrome?.tabs?.sendMessage(tab.id, { action: "showPopover", text: rawText || "" })?.catch?.(() => {})
        }
        break
    }
  })
}

export default attachMenuHandlers
