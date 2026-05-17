export default [
  {
    files: ["**/*.js"],
    ignores: ["node_modules/**", "legacy/**", "build/**", ".plasmo/**"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        // Browser globals
        window: "readonly",
        document: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        fetch: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        btoa: "readonly",
        atob: "readonly",
        confirm: "readonly",
        alert: "readonly",
        MutationObserver: "readonly",
        ResizeObserver: "readonly",
        IntersectionObserver: "readonly",
        PerformanceObserver: "readonly",
        screen: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        getComputedStyle: "readonly",
        CustomEvent: "readonly",
        Event: "readonly",
        KeyboardEvent: "readonly",
        MouseEvent: "readonly",
        HTMLElement: "readonly",
        Element: "readonly",
        Node: "readonly",
        NodeList: "readonly",
        DOMParser: "readonly",
        XMLSerializer: "readonly",
        history: "readonly",
        location: "readonly",
        performance: "readonly",
        createImageBitmap: "readonly",
        OffscreenCanvas: "readonly",

        // Chrome Extension APIs
        chrome: "readonly",

        // Service Worker / Background
        importScripts: "readonly",
        globalThis: "writable",
        self: "readonly",
        clients: "readonly",

        // Custom extension globals - existing modules
        CCS: "writable",
        CCSModules: "writable",
        CCSPopup: "writable",

        // Background script globals
        StateManager: "writable",
        MenuManager: "writable",
        MenuBuilder: "writable",
        MenuUpdater: "writable",
        MenuHandlers: "writable",
        TabEventHandler: "writable",
        MessageEventHandler: "writable",
        MenuEventHandler: "writable",
        Logger: "writable",
        URLBuilder: "writable",
        MenuRegistry: "writable",
        KeywordSyncManager: "writable",

        // Constants.js exports
        LOG_PREFIX: "readonly",
        STORAGE_KEYS: "readonly",
        QUICK_RESULT_HOSTS: "readonly",
        MENU_DEFINITIONS: "writable",
        FAST_QA_QUICK_ITEMS: "readonly",
        OPTIMIZE_CATEGORY_TITLES: "readonly",
        OPTIMIZE_ENGINE_TITLES: "readonly",
        TOP_QUESTION_ENGINE_TITLES: "readonly",
        FAST_ANSWER_ENGINE_TITLES: "readonly",
        DYNAMIC_SEARCH_MENU_ITEMS: "readonly",
        FAST_QA_MENU_ITEMS: "readonly",
        MENU_TITLE_MAX_LENGTH: "readonly",
        KEYWORD_MAX_LENGTH: "readonly",
        TITLE_CLEANUP_SUFFIXES: "readonly",
        SEARCH_ENGINE_SUFFIXES: "readonly",
        CACHE_EXPIRY: "readonly",
        GENERIC_HOST_KEYWORDS: "readonly",
        BG_DEBUG: "writable",
        BG_DBG: "writable",
        MENU_ICON_SUPPORT_STORAGE_KEY: "readonly",
        menuIconSupportLoaded: "writable",
        menuIconUpdateSupported: "writable",
        menuIconConfig: "writable",
        menuIconImageCache: "writable",
        menuIconUpdateInProgress: "writable",
        menuBuildInProgress: "writable",
        menuBuildPending: "writable",
        menuBuildCounter: "writable",
        selectedTextByTab: "writable",
        fallbackKeywordByTab: "writable",
        latestTitleByTab: "writable",
        currentMenuState: "writable",
        optimizedPromptConfig: "writable",
        optimizedPromptTemplate: "writable",
        optimizedPromptMenuMap: "writable",
        topQuestionsConfig: "writable",
        topQuestionsTemplate: "writable",
        topQuestionsMenuMap: "writable",
        fastAnswersConfig: "writable",
        fastAnswersTemplate: "writable",
        fastAnswersMenuMap: "writable",
        menuToggleConfig: "writable",

        // TextUtils.js exports
        formatMenuTitle: "writable",
        normalizeSearchText: "writable",
        cleanupTitleKeyword: "writable",
        extractKeywordFromTitle: "writable",
        isGenericHostKeyword: "writable",
        getMenuDefinition: "writable",
        getMenuText: "writable",
        getMenuTitle: "writable",
        shouldPreserveMenuStateForUrl: "writable",
        shouldPreserveMenuStateForTab: "writable",
        pickFirstMeaningfulText: "writable",
        TextUtils: "writable",

        // Logger.js exports
        logMenuEvent: "writable",
        getLogger: "writable",
        loggers: "writable",

        // config.js exports
        loadOptimizedPromptConfig: "writable",
        loadTopQuestionsConfig: "writable",
        loadFastAnswersConfig: "writable",
        buildOptimizedPrompt: "writable",
        buildTopQuestionsPrompt: "writable",
        buildFastAnswersPrompt: "writable",
        loadUnifiedMenuConfig: "writable",
        loadMenuToggleConfig: "writable",
        isMenuEnabled: "writable",
        loadEnginesConfig: "writable",
        getEngine: "writable",
        getEngineUrlPattern: "writable",
        getEngineTitle: "writable",
        populateOptimizedMenuMap: "writable",
        populateCoverMenuMap: "writable",
        loadCoverPromptConfig: "writable",
        buildCoverPrompt: "writable",
        coverPromptTemplate: "writable",
        coverPromptConfig: "writable",
        COVER_CATEGORY_TITLES: "writable",
        loadMenuIconConfig: "writable",

        // utils/TextLimits.js exports
        applyTextLimit: "writable",
        enforceFinalUrlCap: "writable",
        TEXT_LIMITS_ENABLED: "readonly",

        // utils/Constants.js exports (URLBuilder SSoT shortcut)
        tryOpenMenuUrl: "writable",

        // tasks/AITaskHandler.js + AITaskRegistry.js exports
        AITaskRegistry: "writable",
        runAITask: "writable",
        runAITaskByMenuId: "writable",

        // base.js exports
        updateLatestTabTitle: "writable",
        ensureMenuIconSupportLoaded: "writable",
        copyTextInTab: "writable",
        getMenuDebugInfo: "writable",
        getPopupMenuStructure: "writable",
        refreshMenuTitle: "writable",
        refreshContextMenu: "writable",
        applyMenuTitle: "writable",
        updateMainMenuTitle: "writable",
        applyMenuIcons: "writable",
        snapshotMenuTitles: "writable",
        getLatestTabPageTitle: "writable",
        getLatestTabKeyword: "writable",
        updateLatestTabKeyword: "writable",
        initKeywordSyncSystem: "writable",
        setMenuState: "writable",
        getMenuState: "writable",
        createContextMenus: "writable",

        // events.js exports
        prefetchMenuState: "writable",
        syncSelectionFromTab: "writable",

        // keywords.js exports
        extractSearchKeywords: "writable",

        // keywordResolver.js exports
        computeSearchTextForTab: "writable",

        // KeywordService.js exports (C 档重构入口)
        KeywordService: "writable",
        KEYWORD_INTENTS: "writable",

        // shared/keywordClient.js exports
        CCSKeywordClient: "writable",

        // shared/menuStructureBuilder.js exports
        CCSMenuStructureBuilder: "writable",

        // MenuRegistry.js exports
        menuRegistry: "writable",

        // KeywordSyncManager.js exports (instance created in base.js)
        keywordSyncManager: "writable",

        // menuSystem.js exports
        MenuSystem: "writable",

        // Popup globals
        UNIFIED_CONFIG: "writable",
        MENU_CONFIG: "writable",
        menuToggles: "writable",
        CCS_CONSTANTS: "writable",

        // Legacy globals
        normalizeKeyword: "writable",
        getEffectiveKeyword: "writable",
        buildUrl: "writable",
        updateMenuTitlesForKeyword: "writable",
        extractKeywordsFromText: "writable",
        handleMenuClick: "writable",
        initMenuStates: "writable",
        loadConfig: "writable",
        initExtension: "writable",
        tabStates: "writable",
        currentTabId: "writable",
        lastActiveTabId: "writable",
        lastSelectionText: "writable",
        fastAnswersPrompts: "writable",
        topQuestionsPrompts: "writable",
        optimizedPrompts: "writable",

        // Content script globals
        ccs_panel: "writable",
        ccs_utils: "writable",
        ccs_toast: "writable",
        ccs_stateManager: "writable",
        ccs_settings: "writable",
        ccs_settingsPanel: "writable",
        ccs_blacklist: "writable",
        ccs_keywordExtractor: "writable",
        ccs_realtimeUpdate: "writable",
        ccs_recoveryPopover: "writable",
        ccs_buttonDefinitions: "writable",
        ccs_backgroundComm: "writable",
        ccs_selection: "writable",
        ccs_buttons: "writable",
        ccs_search: "writable",
        ccs_shortcuts: "writable",
        ccs_dragging: "writable",
        ccs_commands: "writable",
        ccs_textSync: "writable",
        ccs_positioning: "writable",
        ccs_domMonitor: "writable",
        ccs_dockbar: "writable",

        // Popup globals
        ToastHelper: "writable",
        MenuRenderer: "writable",
        SettingsManager: "writable",
      }
    },
    rules: {
      "no-undef": "error",
      // Most files are classic scripts that intentionally expose top-level symbols
      // for use across files via global scope.
      "no-unused-vars": ["warn", {
        "vars": "local",
        "args": "none",
        "caughtErrors": "none",
        "varsIgnorePattern": "^_"
      }],
      // The extension intentionally shares many globals across classic scripts.
      // Keep duplicate-local checks while ignoring "redeclare global" noise.
      "no-redeclare": ["error", { "builtinGlobals": false }],
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-empty": ["warn", { "allowEmptyCatch": true }],
      "no-extra-semi": "warn",
      "no-unreachable": "error",
      "valid-typeof": "error",
      "no-const-assign": "error",
      "no-dupe-args": "error",
      "no-func-assign": "error",
      "no-import-assign": "error",
      "no-self-assign": "error",
      "use-isnan": "error",
    }
  },
  {
    files: ["scripts/**/*.js"],
    languageOptions: {
      globals: {
        require: "readonly",
        module: "readonly",
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      }
    }
  }
];
