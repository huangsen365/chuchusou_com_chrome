# Plasmo Migration Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 将当前 触触搜 Chrome MV3 扩展从手写 manifest + importScripts + 多 HTML/JS/CSS 结构，渐进迁移到 Plasmo 脚手架和构建体系，同时保持现有功能、版本发布流程和 Chrome Web Store 包结构稳定。

**Architecture:** 采用“兼容层先行、入口逐步替换”的迁移路线：先在独立迁移分支引入 Plasmo 工程骨架和构建验证，再把 background / popup / sidepanel / content / static pages 分阶段迁到 Plasmo entrypoints。每个阶段都必须能 build、能本地加载、能对照旧版关键路径回归；禁止一次性大爆炸重写。

**Tech Stack:** Plasmo 0.90.5, React 18, TypeScript 5, Chrome MV3, chrome.sidePanel, chrome.contextMenus, chrome.scripting, chrome.offscreen, ESLint 9。

---

## Non-negotiable Constraints

1. 功能不能回退：右键菜单、Popup、Side Panel、悬浮面板、欢迎页、封面生成器、语音 offscreen、提示词库、关键字提取都要保留。
2. 欢迎页仍然只能在 fresh install 打开；update 必须静默。
3. 三个 SSoT 继续保留：
   - URL 模板：`config/unifiedMenuConfig.json`
   - 引擎标题：`config/engines.json`
   - AI 任务定义：`background/tasks/AITaskRegistry.js` 的任务定义，迁移后应变成模块化 `src/background/tasks/AITaskRegistry.ts`
4. 不在 main 上直接大改；所有迁移工作在 `chore/plasmo-migration` 分支。
5. 每个阶段必须小 commit，能随时回滚。
6. 迁移期间旧 `./build.sh` 发布流程不删除，直到 Plasmo package 产物验收通过并替代它。
7. release 仍必须走 release skill；这个计划只做架构迁移，不直接发版。

## Current Project Snapshot

Current version observed: `1.6.16`.

Key current entrypoints:

- Manifest: `manifest.json`
- Background service worker: `background/index.js` using `importScripts(...)`
- Popup: `popup/popup.html`, `popup/popup.js`, `popup/popup.css`, `popup/modules/*.js`
- Side panel: `sidepanel/sidepanel.html`, `sidepanel/sidepanel.js`, `sidepanel/sidepanel.css`
- Content scripts: manifest loads `content/*.js`, `modules/*.js`, `dockbar.js`, `content.js`, plus `content.css`
- Static pages: `welcome/`, `members/`, `voice-permission/`, `offscreen/`, `privacy.html`
- Config and prompts: `config/*.json`, `prompts/*.json`
- Shared code: `shared/menuStructureBuilder.js`, `shared/keywordClient.js`
- Current build: `./build.sh` whitelist copies static files and zips parent directory output

## Target Plasmo Structure

Use this target layout after migration:

```text
src/
  background.ts
  popup.tsx
  popup.css
  sidepanel.tsx
  sidepanel.css
  contents/
    chuchusou.ts
    chuchusou.css
  background/
    config.ts
    events.ts
    init.ts
    base.ts
    keywordResolver.ts
    KeywordService.ts
    menuBuilder.ts
    menuHandlers.ts
    voiceOffscreenBridge.ts
    tasks/
      AITaskRegistry.ts
      AITaskHandler.ts
    utils/
      Constants.ts
      TextUtils.ts
      TextLimits.ts
  shared/
    menuStructureBuilder.ts
    keywordClient.ts
    types.ts
  pages/
    welcome.tsx
    members.tsx
    voice-permission.tsx
    offscreen-voice.ts
  assets-json/
    unifiedMenuConfig.json
    engines.json
    prompts/*.json
public/
  icons/
  assets/
```

Notes:

- The exact Plasmo custom page naming must be validated during Phase 1. If Plasmo cannot emit the current static page paths exactly, use a controlled compatibility copy step before replacing `build.sh`.
- For the first successful Plasmo build, it is acceptable to keep some legacy JS modules under `src/legacy/` if they are imported explicitly and tested.
- Final state should remove `importScripts` and implicit global ordering from production background code.

---

## Phase 0: Safety Branch and Baseline

### Task 0.1: Confirm clean branch and baseline build

**Objective:** Establish a known-good baseline before introducing Plasmo.

**Files:** none.

**Steps:**

1. Run:
   ```bash
   git status --short
   git branch --show-current
   npm test
   ./build.sh
   ```
2. Expected:
   - `git status --short` empty
   - branch is `chore/plasmo-migration`
   - ESLint passes
   - zip builds successfully with required directories

**Commit:** none.

### Task 0.2: Save this migration plan

**Objective:** Commit the migration plan so implementation is reviewable.

**Files:**
- Create: `docs/plans/2026-05-17-plasmo-migration.md`

**Steps:**

1. Run:
   ```bash
   git add docs/plans/2026-05-17-plasmo-migration.md
   git commit -m "docs: plan Plasmo migration"
   ```

---

## Phase 1: Introduce Plasmo Scaffold Without Replacing Production Build

### Task 1.1: Add Plasmo dependencies and scripts

**Objective:** Install Plasmo toolchain while keeping current extension build intact.

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tsconfig.json`

**Steps:**

1. Install:
   ```bash
   npm install plasmo@0.90.5 react@18.2.0 react-dom@18.2.0
   npm install -D typescript@5.3.3 @types/chrome @types/node @types/react @types/react-dom prettier
   ```
2. Add scripts without deleting old scripts:
   ```json
   {
     "scripts": {
       "lint": "eslint .",
       "test": "npm run lint",
       "plasmo:dev": "plasmo dev --target=chrome-mv3",
       "plasmo:build": "plasmo build --target=chrome-mv3",
       "plasmo:package": "plasmo package --target=chrome-mv3"
     }
   }
   ```
3. Create `tsconfig.json`:
   ```json
   {
     "extends": "plasmo/templates/tsconfig.base",
     "exclude": ["node_modules", "build", ".plasmo"],
     "include": [".plasmo/index.d.ts", "src/**/*.ts", "src/**/*.tsx"],
     "compilerOptions": {
       "baseUrl": ".",
       "paths": {
         "~*": ["./src/*"]
       },
       "allowJs": true,
       "checkJs": false
     }
   }
   ```
4. Run:
   ```bash
   npm test
   ```

**Commit:**
```bash
git add package.json package-lock.json tsconfig.json
git commit -m "chore: add Plasmo toolchain"
```

### Task 1.2: Create minimal Plasmo entries that do not ship yet

**Objective:** Prove Plasmo can compile minimal popup/background/sidepanel entries before porting logic.

**Files:**
- Create: `src/popup.tsx`
- Create: `src/sidepanel.tsx`
- Create: `src/background.ts`

**Implementation:**

`src/popup.tsx`:
```tsx
export default function Popup() {
  return <div style={{ padding: 12 }}>触触搜 Plasmo migration smoke test</div>
}
```

`src/sidepanel.tsx`:
```tsx
export default function SidePanel() {
  return <div style={{ padding: 12 }}>触触搜 Side Panel migration smoke test</div>
}
```

`src/background.ts`:
```ts
console.log("[触触搜][Plasmo] background smoke test loaded")
```

**Verification:**

Run:
```bash
npm run plasmo:build
```

Expected:
- Plasmo creates a Chrome MV3 build directory.
- No production files are deleted or overwritten.

**Commit:**
```bash
git add src/popup.tsx src/sidepanel.tsx src/background.ts
git commit -m "chore: add Plasmo smoke-test entries"
```

### Task 1.3: Add manifest override parity

**Objective:** Configure Plasmo manifest metadata to match current permissions, host permissions, icons, action title, and side panel needs.

**Files:**
- Modify: `package.json`

**Manifest fields to preserve:**

```json
{
  "manifest": {
    "name": "触触搜 - ChatGPT Images 2.0 封面生成器 / 多 AI 速答 / 提示词优化",
    "description": "基于 ChatGPT Images 2.0 的封面生成器（二次元可爱 / 小红书 / 椰树牌 / 极简留白）+ 多 AI 速答 + 文本快速搜索处理",
    "permissions": [
      "activeTab",
      "tabs",
      "clipboardWrite",
      "clipboardRead",
      "storage",
      "contextMenus",
      "scripting",
      "sidePanel",
      "offscreen"
    ],
    "host_permissions": ["<all_urls>"],
    "action": {
      "default_title": "触触搜"
    },
    "icons": {
      "16": "icons/16x16.png",
      "48": "icons/48x48.png",
      "128": "icons/128x128.png"
    }
  }
}
```

**Verification:**

Run:
```bash
npm run plasmo:build
python3 - <<'PY'
import json, glob
paths = glob.glob('build/chrome-mv3-prod/manifest.json') + glob.glob('build/chrome-mv3-dev/manifest.json')
assert paths, 'No Plasmo manifest found'
for p in paths:
    m=json.load(open(p))
    assert 'sidePanel' in m.get('permissions', [])
    assert m.get('host_permissions') == ['<all_urls>']
    print(p, m.get('name'), m.get('version'))
PY
```

**Commit:**
```bash
git add package.json package-lock.json
git commit -m "chore: mirror extension manifest in Plasmo"
```

---

## Phase 2: Migrate Shared Data and Pure Utilities

### Task 2.1: Move JSON config into importable assets

**Objective:** Make config and prompt JSON available to Plasmo-bundled modules without relying on ad-hoc fetch paths.

**Files:**
- Create: `src/assets-json/config/unifiedMenuConfig.json`
- Create: `src/assets-json/config/engines.json`
- Create: `src/assets-json/prompts/*.json`

**Steps:**

1. Copy from current `config/` and `prompts/`.
2. Add TypeScript JSON import support if not already inherited from Plasmo tsconfig.
3. Create `src/shared/configAssets.ts` that exports typed constants.

**Verification:**

Run:
```bash
npm run plasmo:build
```

**Commit:**
```bash
git add src/assets-json src/shared/configAssets.ts
git commit -m "refactor: expose config assets for Plasmo"
```

### Task 2.2: Convert pure shared builders

**Objective:** Convert shared pure JS to TypeScript modules first, because popup/background/sidepanel all depend on them.

**Files:**
- Create: `src/shared/menuStructureBuilder.ts` from `shared/menuStructureBuilder.js`
- Create: `src/shared/keywordClient.ts` from `shared/keywordClient.js`
- Create: `src/shared/types.ts`

**Rules:**

- No `globalThis` exports in new files.
- Explicit named exports only.
- Keep legacy files untouched until consumers migrate.

**Verification:**

Run:
```bash
npm run plasmo:build
npm test
```

**Commit:**
```bash
git add src/shared
git commit -m "refactor: convert shared helpers to modules"
```

---

## Phase 3: Migrate Background to Explicit Modules

### Task 3.1: Port constants and utilities

**Objective:** Remove dependency on import order for core constants and utility functions.

**Files:**
- Create: `src/background/utils/Constants.ts`
- Create: `src/background/utils/TextUtils.ts`
- Create: `src/background/utils/TextLimits.ts`
- Create: `src/background/Logger.ts`

**Rules:**

- Replace `globalThis.X = X` with `export { X }`.
- Keep values byte-for-byte compatible where possible.
- Add small smoke tests via a Node-compatible script if utilities are pure.

**Verification:**

Run:
```bash
npm run plasmo:build
npm test
```

**Commit:**
```bash
git add src/background/utils src/background/Logger.ts
git commit -m "refactor: port background utilities to modules"
```

### Task 3.2: Port config and URL builder

**Objective:** Move config loading and URL template resolution into TypeScript modules.

**Files:**
- Create: `src/background/config.ts`
- Create: `src/background/URLBuilder.ts`

**Acceptance criteria:**

- `getEngineTitle(engineId, fallback)` returns same labels as legacy.
- `tryOpenMenuUrl()` opens same URLs for representative menu IDs.
- URL templates still originate from unified menu config.

**Verification:**

Create a temporary smoke script or unit script that checks:
- `ccs-google` -> Google search URL
- `ccs-chatgpt` -> ChatGPT URL
- `ccs-google-ai-chat` -> Google AI mode URL

**Commit:**
```bash
git add src/background/config.ts src/background/URLBuilder.ts
git commit -m "refactor: port config and URL builder"
```

### Task 3.3: Port AI task registry and handlers

**Objective:** Keep AI tasks declarative and preserve prompt generation.

**Files:**
- Create: `src/background/tasks/AITaskRegistry.ts`
- Create: `src/background/tasks/AITaskHandler.ts`

**Acceptance criteria:**

- Fast answer, top questions, optimize, and cover prompt tasks build the same prompt text as legacy for sample keywords.
- Cover ratio and custom style storage keys remain compatible.

**Verification:**

Run:
```bash
npm run plasmo:build
```

**Commit:**
```bash
git add src/background/tasks
git commit -m "refactor: port AI task registry"
```

### Task 3.4: Port event handlers and init

**Objective:** Replace `background/index.js importScripts(...)` with `src/background.ts` importing explicit modules.

**Files:**
- Modify: `src/background.ts`
- Create: `src/background/events.ts`
- Create: `src/background/init.ts`
- Create: other needed background modules under `src/background/`

**Critical behavior:**

- `chrome.runtime.onInstalled` opens welcome page only when `details.reason === 'install'`.
- Updates remain silent.
- Context menus are created/recreated as before.
- Side panel behavior remains intact.
- Offscreen voice bridge still works.

**Verification:**

Run:
```bash
npm run plasmo:build
```

Then load unpacked Plasmo build in Chrome and manually test:
- fresh install opens welcome page
- update/reload does not open welcome page
- right-click menus exist
- one search menu opens expected URL
- fastqa opens expected AI task URL

**Commit:**
```bash
git add src/background.ts src/background
git commit -m "refactor: migrate background to Plasmo modules"
```

---

## Phase 4: Migrate Popup

### Task 4.1: Preserve current zero-JS first paint strategy

**Objective:** Keep current v1.6.16 performance win: core popup menu must be visible before async background/storage work finishes.

**Files:**
- Create/Modify: `src/popup.tsx`
- Create/Modify: `src/popup.css`
- Port from: `popup/popup.html`, `popup/popup.js`, `popup/popup.css`, `popup/modules/*.js`

**Implementation notes:**

- React component should render the same static core menu immediately.
- Enhancements (keyword, pin card, settings, prompt library) hydrate after mount.
- Do not regress first paint by making menu wait on background messages.

**Verification:**

Manual:
- Open popup on cold browser start; core menu appears immediately.
- Keyword appears after refresh.
- Copy keyword button works.
- Settings panel works.
- Prompt library works.
- Open sidepanel button works.

**Commit:**
```bash
git add src/popup.tsx src/popup.css src/popup
git commit -m "refactor: migrate popup to Plasmo React"
```

### Task 4.2: Remove legacy popup entry only after parity

**Objective:** Delete old popup files from production path after Plasmo popup parity is verified.

**Files:**
- Remove or move to `legacy/plasmo-migration/popup/`: old `popup/`

**Verification:**

Run:
```bash
npm run plasmo:build
npm test
```

Manual popup parity checklist from Task 4.1.

**Commit:**
```bash
git add -A popup legacy/plasmo-migration/popup src/popup.tsx src/popup.css
git commit -m "chore: archive legacy popup implementation"
```

---

## Phase 5: Migrate Side Panel

### Task 5.1: Port sidepanel UI to React

**Objective:** Move sidepanel HTML/JS/CSS into Plasmo React while preserving sticky layout and cover generator UX.

**Files:**
- Create/Modify: `src/sidepanel.tsx`
- Create/Modify: `src/sidepanel.css`
- Create supporting modules under `src/sidepanel/`

**Acceptance criteria:**

- Header stable; no jitter.
- Keyword badge and copy button work.
- Voice button appears only when enabled and keyword exists.
- Clipboard fallback works on restricted pages.
- Cover generator pin card, picker, ratio, custom style, and info popover all work.
- Menu click behavior matches legacy.

**Verification:**

Manual pages:
- Normal web page with selected text
- `chrome://extensions/` or another restricted page using clipboard fallback
- Long multi-line clipboard text
- Cover generator with built-in style
- Cover generator with custom style
- Voice feature disabled and enabled

**Commit:**
```bash
git add src/sidepanel.tsx src/sidepanel.css src/sidepanel
git commit -m "refactor: migrate side panel to Plasmo React"
```

---

## Phase 6: Migrate Content Script and Floating Panel

### Task 6.1: Convert content script chain into one Plasmo content entry

**Objective:** Replace manifest-ordered script list with explicit imports and preserve current behavior.

**Files:**
- Create: `src/contents/chuchusou.ts`
- Create: `src/contents/chuchusou.css`
- Port from: `content/*.js`, `modules/*.js`, `dockbar.js`, `content.js`, `content.css`

**Plasmo config target:**

```ts
export const config = {
  matches: ["<all_urls>"],
  run_at: "document_start",
  all_frames: true
}
```

**Rules:**

- Preserve exact initialization order by explicit imports.
- Prefer modules over globals where practical.
- Do not move UI into Shadow DOM in the first pass unless necessary; behavior parity first.

**Verification:**

Manual:
- Select text on a normal page; floating panel appears.
- Shortcuts work.
- Blacklist works.
- Recovery popover works.
- Dock behavior works.
- Text sync to background works.

**Commit:**
```bash
git add src/contents src/content src/modules
git commit -m "refactor: migrate content script to Plasmo"
```

---

## Phase 7: Migrate Static Pages and Offscreen Voice

### Task 7.1: Migrate welcome page

**Objective:** Convert welcome page to Plasmo-compatible page without changing install/update behavior.

**Files:**
- Create: `src/pages/welcome.tsx` or Plasmo-supported custom page equivalent
- Port from: `welcome/welcome.html`, `welcome/welcome.css`, `welcome/welcome.js`

**Verification:**

- Fresh install opens welcome page.
- Update/reload does not open welcome page.
- “Open sidepanel” button still syncs state.

**Commit:**
```bash
git add src/pages/welcome.tsx src/pages/welcome.css
git commit -m "refactor: migrate welcome page"
```

### Task 7.2: Migrate offscreen voice and permission page

**Objective:** Preserve microphone permission flow and offscreen recognition bridge.

**Files:**
- Create Plasmo-compatible page/asset for offscreen document
- Create Plasmo-compatible permission page
- Port from: `offscreen/voice.html`, `offscreen/voice.js`, `voice-permission/permission.html`, `voice-permission/permission.js`

**Verification:**

Manual:
- Voice disabled: no microphone UI.
- Enable voice.
- Click voice button.
- First consent page appears.
- Browser microphone permission appears on user gesture.
- Recognition returns candidates.
- Denied permission shows recovery guidance.

**Commit:**
```bash
git add src/pages src/background/voiceOffscreenBridge.ts
git commit -m "refactor: migrate voice offscreen pages"
```

### Task 7.3: Migrate members and privacy pages

**Objective:** Preserve all auxiliary pages used by sidepanel and store listing.

**Files:**
- Create Plasmo-compatible members page
- Preserve/copy `privacy.html`

**Verification:**

Manual:
- Members page opens from sidepanel hidden entries when enabled.
- JSON member group loading works.
- Privacy page remains included in final package.

**Commit:**
```bash
git add src/pages/members.tsx public/privacy.html
git commit -m "refactor: migrate auxiliary pages"
```

---

## Phase 8: Replace Build and Release Packaging

### Task 8.1: Add Plasmo package validation script

**Objective:** Recreate the old `build.sh` safety checks for Plasmo output.

**Files:**
- Create: `scripts/validate-plasmo-package.js`
- Modify: `package.json`

**Validation checks:**

- Manifest version equals `package.json` version.
- Required permissions present.
- Required static pages present.
- Required assets/icons present.
- Content script config matches `<all_urls>`, `document_start`, `all_frames`.
- Side panel default path exists.
- Background service worker exists.

**Package script:**

```json
{
  "scripts": {
    "plasmo:verify": "npm run plasmo:build && node scripts/validate-plasmo-package.js"
  }
}
```

**Commit:**
```bash
git add scripts/validate-plasmo-package.js package.json package-lock.json
git commit -m "test: validate Plasmo package output"
```

### Task 8.2: Compare legacy zip and Plasmo zip

**Objective:** Ensure Plasmo package contains everything Chrome Web Store needs before retiring `build.sh`.

**Steps:**

1. Run legacy build:
   ```bash
   ./build.sh
   ```
2. Run Plasmo package:
   ```bash
   npm run plasmo:package
   npm run plasmo:verify
   ```
3. Compare manifests and file inventory.
4. Load unpacked Plasmo build into Chrome and run full manual regression.

**Acceptance criteria:**

- Plasmo package can replace legacy zip for Chrome Web Store.
- Manual regression passes.
- No welcome page on updates.

**Commit:** none unless validation files changed.

### Task 8.3: Archive legacy build pipeline

**Objective:** Replace release packaging with Plasmo only after successful parity.

**Files:**
- Modify: `build.sh` or archive it to `legacy/plasmo-migration/build.sh`
- Modify: `CLAUDE.md` release section after validation
- Modify: release skill only if project-specific release docs reference legacy script

**Commit:**
```bash
git add -A build.sh legacy/plasmo-migration CLAUDE.md
git commit -m "chore: switch release packaging to Plasmo"
```

---

## Final Regression Checklist

Before merging `chore/plasmo-migration` back to `main`:

1. `npm test` passes.
2. `npm run plasmo:verify` passes.
3. Load unpacked Plasmo build in Chrome.
4. Fresh install opens welcome page exactly once.
5. Extension update/reload does not open welcome page.
6. Right-click menus render and execute.
7. Popup opens instantly and core menu is visible without waiting on service worker.
8. Popup keyword, copy, settings, prompt library work.
9. Side panel keyword, clipboard fallback, voice, cover generator picker, ratio, custom style work.
10. Floating panel appears on text selection and actions work.
11. Restricted pages use clipboard fallback.
12. Long multi-line keyword respects current text-limit behavior.
13. Plasmo package zip contains required directories/assets/pages.
14. No legacy `importScripts` production path remains.
15. Git history is small phased commits, not one giant commit.

## Rollback Strategy

- Until Phase 8 completes, `main` and legacy `./build.sh` remain the production path.
- If any Plasmo stage fails, stop on the migration branch and keep shipping from main.
- Do not tag or release migration work until manual Chrome regression passes.

## Recommended First Execution Batch

Start with only these tasks:

1. Task 0.1 baseline build
2. Task 0.2 commit this plan
3. Task 1.1 install Plasmo toolchain
4. Task 1.2 smoke-test Plasmo entries
5. Task 1.3 manifest parity

Stop after Phase 1 and manually inspect generated Plasmo manifest before porting real functionality.
