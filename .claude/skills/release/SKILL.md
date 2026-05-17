---
name: release
description: 触触搜 Chrome 扩展发布流程 —— 版本号决策、bump 三处版本字段、写 CHANGELOG / 发布说明、跑 lint、./build.sh 打 zip、commit / tag / push。当用户提到 "release / 发版 / 发布新版本 / 打 zip / 上架商店 / 发个 patch / 发个 minor" 等时触发。
---

# 触触搜发布流程

按顺序执行，**每个阶段都跟用户确认**再进下一步——发版命令是上行操作（Chrome Web Store 拒绝降版本号），错了不好回滚。

## Step 0：搞清楚要发什么版本

读 `manifest.json` 拿当前版本号（这是权威源，Chrome 只看这个），然后 `git log <last_tag>..HEAD --oneline` 列出自上次发布以来的所有 commit。

**判断 semver 等级**（按 `MAJOR.MINOR.PATCH`）：

| commit 性质 | bump |
|------|------|
| 只有 `fix:` / `chore:` / `docs:` / 提示词模板调优 / CI 修复 | PATCH（X.Y.**Z+1**） |
| 有 `feat:` 但无破坏改动 | MINOR（X.**Y+1**.0） |
| API/UX 破坏改动、删菜单项、改存储 schema | MAJOR（**X+1**.0.0） |

**用户口头说的 "minor"、"小版本" 经常是指 PATCH**，不要直接当 semver MINOR 处理。把你的判断和理由报给用户确认（"自上次发布只有 N 个 fix + 模板调优，建议 1.2.0 → 1.2.1，你要 1.3.0 也可以"）。

## Step 1：bump 三处版本字段

确认版本号 `X.Y.Z` 后，**同步**改这三个文件（少改一个都会让人困惑或工具链报警）：

1. `manifest.json` 的 `"version"` —— **必改**，Chrome 读这个
2. `package.json` 的 `"version"` —— 保持一致，方便 `node --version`/CI/工具链识别
3. `package-lock.json` 的 **顶层** `"version"` 和 `packages.""` 下的 `"version"` 两处 —— 保持一致

> 历史教训：`package.json` 长期停留在 `1.0.0`，与 `manifest.json` 完全脱节。这次（v1.2.1）顺手对齐了。以后每次 release 都同步。

## Step 2：写 CHANGELOG.md

在文件顶部 `# 更新日志` 标题之后、上一版的 `## vX.Y.Z` 之前插入新版块。模板：

```markdown
## vX.Y.Z (YYYY-MM-DD)

### 🐛 修复
- ...（用户能感知的 bug 修复，写"什么坏了→现在好了"）

### 🔧 改进
- ...（提示词调优、UI 微调、文案对齐等用户能感知但不算 bug 的改动）

### 🛠 技术改动
- ...（CI / lint / 内部重构 / 依赖升级等用户感知不到但要留痕的）
```

**只写用户能看懂的** —— 跳过 commit message 里的实现细节，挑出"用户体验差异"。每条 1-3 句，可包含简短的"原因/做法"以便日后追溯。

## Step 3：写 releases/vX.Y.Z.md 发布说明

按 `releases/v1.2.0.md` 的格式（**已是事实标准，照抄结构**）：

```
# 触触搜 vX.Y.Z 发布说明
发布日期：YYYY-MM-DD
## 一句话总览
## 主要更新
  ### 🐛 修复 / ✨ 新功能 / 🔧 改进 / 🛠 技术改动
## 兼容性
## 已知限制
## 升级提示  ← 老用户从上一版升级会感知到什么
（feat 大版本可加）## 商店描述（300 字以内，上架直接用）
```

商店描述只在**含 feat 的 minor/major** 写；纯 patch 沿用上一版即可。

## Step 4：sanity check

```bash
npm test                                              # eslint 通过
node --check manifest.json 2>/dev/null || \
  node -e "JSON.parse(require('fs').readFileSync('manifest.json'))"  # JSON 合法
node -e "JSON.parse(require('fs').readFileSync('package.json'))"
node -e "JSON.parse(require('fs').readFileSync('package-lock.json'))"
```

任一失败 → 修了再继续，**不要带着红 lint 发版**（之前 CI 红 5 个 commit 就是这个原因）。

## Step 5：打 zip（基于 Plasmo）

```bash
./build.sh
```

**v1.6.18 起 build.sh 是 Plasmo 的 thin wrapper**：
1. 调 `npm run plasmo:build`（Plasmo 编译 src/* + compat postbuild 复制 legacy + verify 33 个 manifest-ref 文件齐全）
2. 把 build/chrome-mv3-prod/manifest.json 的 version 字段写为目标版本
3. 把整个 build/chrome-mv3-prod/ 打成 zip 到 `../chuchusou_chrome_extension_vX.Y.Z.zip`

**与旧脚本的关键差异**：旧 build.sh 直接 rsync 源目录，完全绕过 Plasmo；新版完全走 Plasmo build。这意味着任何 src/ 改动通过 npm run plasmo:build 编译后都会进入 zip，跟测试链一致。

**验收检查**（眼看输出）：
- 文件数 ~130 个（v1.6.18+ 含 Plasmo bundle 比 v1.6.17 多 40 个）
- ZIP 大小 ~450K（v1.6.18+ 含 Plasmo bundle 比 v1.6.17 大约多 250K）
- 顶层目录齐全：`background/ config/ content/ icons/ modules/ popup/ prompts/ sidepanel/ assets/ static/`
- Plasmo 物证：根 `popup.html` / `sidepanel.html` / `content.{hash}.js` / `static/background/index.js`
- 关键 legacy 根文件：`manifest.json content.js content.css dockbar.js privacy.html`

如果 verify-plasmo-compat-build 失败（33 个 manifest-referenced 文件缺一）→ build.sh 会立刻退出。

## Step 6：本地装一下试（强烈建议）

把 zip 拖到 `chrome://extensions/`（开发者模式），验证：
- 当前版本对应的关键修复确实生效（用 release notes 里的"升级提示"做 checklist）
- service worker 没有报错（Inspect background）
- 边栏 / popup / 右键菜单 三个入口都能选中文字 → 关键字正确显示

**没装过的版本不要发**——上架后只能发新版覆盖，不能回滚。

## Step 7：commit

```bash
git add manifest.json package.json package-lock.json CHANGELOG.md releases/vX.Y.Z.md
git commit -m "release(vX.Y.Z): <一句话总览>"
```

如有其它待发版的修改，**前面已经独立 commit**（参考最近的工作流：每个改动独立 commit，发版 commit 只动 5 个版本/文档文件）。**不要在 release commit 里塞新代码**。

## Step 8：tag

```bash
git tag -a vX.Y.Z -m "vX.Y.Z: <一句话总览>"
```

> 历史问题：v1.2.0 没打 tag，导致 `git log v1.2.0..HEAD` 拿不到，只能数 commit。从今天开始每个 release 都打 tag。

## Step 9：push（**操作前问用户**）

```bash
git push           # 主干
git push --tags    # 推 tag
```

push 是公开操作，按系统规则**必须用户明确同意**才执行。即使在 auto mode 也不要默认 push。

## Step 10：上架商店

把 zip 上传到 [Chrome Web Store devconsole](https://chrome.google.com/webstore/devconsole)，更新说明从 `releases/vX.Y.Z.md` 复制（如有「商店描述」段直接用）。

---

## 通用准则

- **每步前回报当前进度**给用户（"manifest 已 bump 到 X.Y.Z，要继续写 CHANGELOG 吗"），让用户能在任意点 abort
- **决策点不要默认拍板**：版本号等级、是否 push、是否打 tag —— 都问
- **错了能原地退**：commit 之前所有改动都在 working tree，user 可 `git restore .`；commit 之后用 `git reset --soft HEAD~1` 回到 working tree
- **永远不要用 `git push --force` 推已发布的 tag**——商店认 zip 的 hash，强推 tag 没意义还危险
