# 触触搜 Chrome 插件 —— ChatGPT Images 2.5 封面生成器 / 多 AI 速答 / 提示词优化

**触触搜** —— 轻触即搜，一触即达。

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/kipfgodiangoljcbecenccdoehgokodg?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/kipfgodiangoljcbecenccdoehgokodg)
[![Users](https://img.shields.io/chrome-web-store/users/kipfgodiangoljcbecenccdoehgokodg?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/kipfgodiangoljcbecenccdoehgokodg)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![X @yunbiyun](https://img.shields.io/badge/X-%40yunbiyun-000000?logo=x&logoColor=white)](https://x.com/yunbiyun)
[![YouTube @yunbiyun](https://img.shields.io/badge/YouTube-%40yunbiyun-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@yunbiyun)

> 🧩 **安装**：[Chrome 应用商店一键安装](https://chromewebstore.google.com/detail/kipfgodiangoljcbecenccdoehgokodg) —— 打开后点「添加至 Chrome」即可。想跑最新源码见下方[安装方法](#安装方法)。

<p align="center">
  <a href="https://www.youtube.com/watch?v=PEzAcg_frIA">
    <img src="https://img.youtube.com/vi/PEzAcg_frIA/maxresdefault.jpg" alt="视频教程：使用触触搜，点几下就能轻松创作长篇文章和封面" width="640">
  </a>
  <br>
  <sub>📺 <b>使用教程</b>：<a href="https://www.youtube.com/watch?v=PEzAcg_frIA">使用触触搜，点几下就能轻松创作长篇文章和封面</a>（点封面跳到 YouTube 观看）</sub>
</p>

> 🎨 **基于 ChatGPT Images 2.5 的封面生成器**：选中标题文本 → 一键调用 ChatGPT Images 2.5 渲染封面。内置「二次元可爱 / 小红书 / 椰树牌 / 极简留白 / 墨清」五种风格预设（墨清风格由 [@zzqgz7326](https://x.com/zzqgz7326) 设计），覆盖小红书、公众号、视频号、抖音等多种比例。

> 💡 **名称由来**：「触触」代表着用鼠标轻触并选中文本的动作，「搜」则是搜索和处理的含义。我们希望用户只需轻轻一触，所有功能就能触手可及。

一个优雅的文本选择处理工具，让您通过鼠标轻触选中文本，即可快速搜索和处理；同时把 **ChatGPT Images 2.5** 封面生成、多 AI 速答、提示词优化集成在一个 Chrome 扩展里。无需右键菜单，无需记忆快捷键，一切功能围绕您的鼠标指尖展开。

## 功能特性

### 🎯 三种入口，覆盖所有使用场景

| 入口 | 触发 | 适用场景 |
|---|---|---|
| 🖱️ **右键菜单** | 选中后右键 | 需要全部功能时 |
| 🪟 **Popup 弹窗** | 点击扩展图标 | 没选中文字也能用（输入关键字 / 改设置） |
| 📑 **侧边栏** | popup 里"📑 打开侧边栏" | 长时间创作 / 反复用同一动作 |

三种入口共享同一菜单结构（SSoT 配置），保持体验一致。

> ℹ️ 早期版本的"悬浮浮窗"和底部 dock 栏在当前版本**暂时关闭**（选中文本的捕获与关键字同步仍在后台工作，右键菜单 / popup / 侧边栏照常实时拿到选中内容）；旧浮窗逻辑保留在 `legacy/content.panel-legacy.js`，未来可能以新形态回归。

### ⚡ AI 任务全家桶

- **速答壹拾佰**：选中主题 → 一键发送给 ChatGPT / Claude / Grok / 文心一言 / Google AI Mode 五家。**两步流程模板**：先输出"短篇（80 字内带标题感）+ 中篇（约 10 句）"，末尾追加 A/B 选项让用户决定是否续写长篇 / 把短中篇润色成更自然的真实表达。
- **触触搜百问**：同一主题一次性问遍所有主流 AI，多视角对比，避开单家模型的盲区偏见。
- **优化提示词**：八种场景模板（深度研究 / 普通对话 / 代码编写 / 内容创作 / 数据分析 / 问题解答 / 头脑风暴 / 描述润色），自动用提示工程最佳实践重写你的问题。
- **🎨 封面生成器（v1.2.0+）**：选中标题文本 → 一键调用 ChatGPT Images 2.5 → 渲染封面图。内置「二次元可爱 / 小红书风格 / 椰树牌风格 / 极简的留白 / 墨清风格」五种预设（**墨清风格**：三行大标题 + 右侧竖排副标题 + 底部横排副标题的版式，由 [@zzqgz7326](https://x.com/zzqgz7326) 设计），**自定义风格预设库**支持多行（每行=一个预设），在侧边栏 dropdown 切换；**比例选择**覆盖 11 种主流平台规格（5:2 / 6:2 X (Twitter / 推特) Banner / 2.35:1 微信公众号 / 2:1 / 16:9 / 3:2 / 4:3 / 1:1 / 4:5 / 3:4 / 9:16）+ 用户自定义比例。

### 📑 侧边栏置顶（v1.2.0+）

把最常用的动作钉在侧边栏顶部，下次开侧边栏一键直达：

- 默认置顶：封面生成器 · 墨清风格（v1.13.3 起；老用户已保存的置顶不受影响）
- "✏️ 修改"按钮可切换风格 + 比例 + 自定义预设
- 所有偏好走 `chrome.storage.local`，跨会话持久化

### 🛡️ 内容平台合规提示（v1.4.0+）

封面生成器配套的"AI 检测规避提示"贯穿四端：欢迎页 / 侧边栏 banner（横向滚动文字）/ 提示词尾部，详解元数据指纹机制 + 截图另存的工作原理 + 平台后果（限流 · 降权 · 强制 AI 水印）。

### 📋 剪贴板兜底（v1.5.1+）

`chrome://`、扩展商店等不允许 content script 注入的页面，侧边栏顶部自动显示"📋 从剪贴板读取关键字"按钮 —— 复制文字后点一下即可走通完整流程。

### 🔍 搜索引擎一键达

自动从选中文本 / URL / 标题智能提取关键词，一键跳转：

- 综合：百度、Google、知乎、微信搜一搜、V2EX
- 电商：淘宝、京东
- 翻译：百度翻译、Google 翻译
- AI：ChatGPT、Claude、Grok、文心一言、Google AI Mode

**未硬编码搜索引擎也能拿关键字**（v1.4.0+）：启发式参数提取兜底，新搜索站点不用改代码也能命中。

### 👋 首次安装欢迎页（v1.4.0+）

装好扩展自动弹欢迎页（仅首次装弹，更新不打扰），介绍各入口 + 主打功能 + 视频教程；"立即打开侧边栏"按钮一键体验，状态实时同步。

### ⚙️ 命令系统（浮窗输入框内，随浮窗暂时关闭；右键菜单的复制 / Base64 / 时间戳等工具项不受影响）

- `/base64 文本` - Base64 编码 / `/base64 -d 编码文本` - 解码
- `/md5 文本` - 生成 MD5 哈希
- `/url 文本` - URL 编码 / `/url decode 编码文本` - 解码
- `/upper 文本` - 转换为大写 / `/lower 文本` - 转换为小写

## 安装方法

### 方式一：Chrome 应用商店（推荐）

👉 **https://chromewebstore.google.com/detail/kipfgodiangoljcbecenccdoehgokodg**

打开后点「添加至 Chrome」即可，之后随商店自动更新。

### 方式二：从源码构建安装

```bash
npm install
npm run plasmo:build        # 产物在 build/chrome-mv3-prod/
```

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角的「开发者模式」
3. 点击「加载已解压的扩展程序」，选择 `build/chrome-mv3-prod/` 目录
4. 安装完成。改代码后重新 `npm run plasmo:build`，回到扩展页点「重新加载」

> 必须加载 `build/chrome-mv3-prod/`：Service Worker 入口 `static/background/index.js` 由 `src/background.ts` 编译生成，项目根目录本身不能直接作为扩展加载。

## 使用说明

> 📺 先看视频更直观：[使用触触搜点几下轻松创作长篇文章和封面](https://www.youtube.com/watch?v=PEzAcg_frIA)

1. **选中即取词**: 用鼠标选中网页文本，扩展后台立即捕获——右键菜单标题、popup、侧边栏的关键字徽章都会实时更新为选中内容
2. **右键直达**: 选中后右键，菜单里搜索 / AI 对话 / 速答 / 百问 / 优化 / 封面生成一键直达
3. **Popup / 侧边栏**: 没选中文字也能用——自动回退到页面标题或 URL 关键词；侧边栏还能把常用动作（如封面生成器）置顶
4. **AI 长文不截断**: 发往 ChatGPT / Claude 等的长提示词走后台中继，不受 URL 长度限制

💡 **小贴士**：「触触搜」的设计理念是让所有操作都在您的鼠标指尖完成，减少手部移动，提升操作效率。

## 技术特点

- **Manifest V3**: 符合最新的 Chrome 扩展标准
- **隐私保护**: 所有数据处理都在本地完成，不上传任何数据
- **Shadow DOM**: 样式完全隔离，不影响网页原有样式
- **轻量高效**: 无依赖，纯原生 JavaScript 实现

## 已知限制

- Chrome 当前仍未开放为 `chrome.contextMenus` 指定图标的能力，虽然我们在 `config/menuIcons.json` 中保留了本地与远程图标配置，实际渲染时浏览器会忽略这些图标。后续若官方支持，将可以直接复用该配置；目前可通过后台 Service Worker 日志中的 `[触触搜][MENU] icon-*` 事件进行排查。

## 调试与排查

- **开启调试模式**：在扩展设置中打开“调试日志”，后台会输出 `[触触搜][MENU]` 系列事件。
- **关键日志**：
  - `context-preview-title-check` / `context-click-title-check`：显示最新的 `keyword`/`title`、标准化结果以及菜单展示文本（`menuDisplay` / `menuRaw`），用于诊断菜单标题不同步的问题。
  - `selection-sync-error`：捕获内容脚本通信失败时的错误并自动触发脚本重新注入。
  - `context-onShown`：记录右键菜单被唤起时的上下文，便于确认菜单刷新流程是否完成。
  - `prefetch-menu-state`：在页面加载、激活或标题变更时提前抓取关键词，确保首次右键立即展示最新内容。
- **快速复现步骤**：
  1. 在页面选中文本，确认菜单标题即时更新。
  2. 清空选区后直接右键，应自动回退到 URL 关键词（如搜索结果页面的查询词）。
  3. 在 ChatGPT / Claude 等站点右键时，首次打开菜单即可看到最新标题，否则查看日志中的 `menuDisplay` 排查。

## 文件结构

```
chuchusou_com_chrome/
├── manifest.json              # Manifest V3 配置（源模板）
├── src/                       # TS 源码（Plasmo 编译；生产 SW 入口 src/background.ts）
├── background/                # legacy Service Worker 脚本（仍在运行时的部分）
├── shared/                    # 前后台共用 JS（keywordClient / runtimeClient / logger…）
├── content/ + modules/        # 内容脚本（选区捕获 / AI prompt 填充 / toast…）
├── content.js / dockbar.js    # 内容脚本入口
├── popup/  + popup-v2/        # Popup（生产 + 备用重写版）
├── sidepanel/ + sidepanel-v2/ # 侧边栏（生产 + 备用重写版）
├── offscreen/                 # 语音识别 offscreen 文档
├── config/                    # unifiedMenuConfig.json / engines.json（SSoT）
├── prompts/                   # 提示词模板（速答 / 百问 / 优化 / 封面）
├── scripts/                   # 构建 + 校验脚本（npm test 全链，含真 Chrome 冒烟回归）
├── legacy/                    # 退役代码（不进 build / zip）
├── docs/                      # 技术债审计 / 测试清单 / 归档
└── icons/                     # 扩展图标
```

> 完整架构细节（SW 双层桥接、模块加载顺序、SSoT 约定）见 [CLAUDE.md](./CLAUDE.md)。

## 开发指南

### 环境准备

```bash
# 安装依赖
npm install
```

### 代码检查

项目使用 ESLint 进行代码质量检查：

```bash
# 运行 ESLint
npx eslint .

# 使用错误分析工具（推荐）
node scripts/analyze-errors.js
```

`analyze-errors.js` 会将 ESLint 错误按规则和文件分组显示，特别适合快速定位问题：
- 按规则分组：显示每种错误的数量，`no-undef` 错误会列出所有未定义的变量名
- 按文件分组：显示每个文件的错误详情

### 语法检查

Service Worker 脚本可以使用 Node.js 快速检查语法：

```bash
# 检查单个文件
node --check background/events.js

# 批量检查
for f in background/*.js background/**/*.js; do node --check "$f"; done
```

### 注意事项

**Service Worker 共享作用域**：所有通过 `importScripts()` 加载的脚本共享同一个全局作用域，不能在多个文件中用 `let`/`const` 声明同名变量。解决方案：
1. 将变量集中到 `background/utils/Constants.js` 定义
2. 通过 `globalThis.VAR_NAME` 导出和访问

更多开发细节请参阅 [CLAUDE.md](./CLAUDE.md)。

## 版本历史

完整版本说明见 [CHANGELOG.md](./CHANGELOG.md)；每个版本独立 release notes 在 [releases/](./releases/) 目录。

近期里程碑：

- **v1.6.x**（2026-05~06）：SW 移植 TS（Plasmo 双层桥接）/ 封面生成器默认极简留白 / 冷启动关键字拉取修复 / npm test 全链含真 Chrome 冒烟回归
- **v1.5.1**（2026-05-01）：剪贴板兜底 chrome:// 等不支持选区页面 / Windows 滚动文字修复 / 多项体验改进
- **v1.4.0**（2026-04-30）：首次安装欢迎页 / AI 检测规避双层引导 / 启发式关键字兜底
- **v1.2.0**（2026-04-29）：封面生成器 / 侧边栏置顶 / 速答两步流程模板
- **v1.0.0**（2025-08）：MVP，悬浮浮窗 + 10 个快捷按钮 + 命令系统

## 开发计划

待实现的提案归档在 [docs/TO-BE-IMPLEMENTED/](./docs/TO-BE-IMPLEMENTED/)，已知问题在 [docs/KNOWN_ISSUES.md](./docs/KNOWN_ISSUES.md)。

## 贡献

欢迎提交 Issue 和 Pull Request！

## 致谢

- **墨清风格** 封面预设由 [朱墨清 @zzqgz7326](https://x.com/zzqgz7326) 设计 —— 三行醒目大标题 + 右侧竖排副标题 + 底部横排副标题的版式。如果你也有自己的封面风格想内置进来，欢迎提 Issue 或 PR。

## 许可证

MIT License

## 联系方式

- <picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.simpleicons.org/x/white"><img src="https://cdn.simpleicons.org/x/000000" width="14" alt="X"></picture> **X（Twitter）**：[@yunbiyun](https://x.com/yunbiyun) —— 日常更新、用法分享、复盘
- <img src="https://cdn.simpleicons.org/youtube/FF0000" width="14" alt="YouTube"> **YouTube**：[@yunbiyun](https://www.youtube.com/@yunbiyun) —— 视频教程
- 🌐 **官网**：[chuchusou.com](https://chuchusou.com)
- 🐛 **Bug / 建议**：[GitHub Issues](https://github.com/huangsen365/chuchusou_com_chrome/issues)
