# 触触搜 Chrome 插件 —— ChatGPT Images 2.0 封面生成器 / 多 AI 速答 / 提示词优化

**触触搜** —— 轻触即搜，一触即达。

> 🎨 **基于 ChatGPT Images 2.0 的封面生成器**：选中标题文本 → 一键调用 ChatGPT Images 2.0 渲染封面。内置「二次元可爱 / 小红书 / 椰树牌 / 极简留白」四种风格预设，覆盖小红书、公众号、视频号、抖音等多种比例。

> 💡 **名称由来**：「触触」代表着用鼠标轻触并选中文本的动作，「搜」则是搜索和处理的含义。我们希望用户只需轻轻一触，所有功能就能触手可及。

一个优雅的文本选择处理工具，让您通过鼠标轻触选中文本，即可快速搜索和处理；同时把 **ChatGPT Images 2.0** 封面生成、多 AI 速答、提示词优化集成在一个 Chrome 扩展里。无需右键菜单，无需记忆快捷键，一切功能围绕您的鼠标指尖展开。

## 功能特性

### 🎯 四种入口，覆盖所有使用场景

| 入口 | 触发 | 适用场景 |
|---|---|---|
| 🖱️ **悬浮浮窗** | 选中文字自动出现 | 快速操作，不打断阅读 |
| 🖱️ **右键菜单** | 选中后右键 | 需要全部功能时 |
| 🪟 **Popup 弹窗** | 点击扩展图标 | 没选中文字也能用（输入关键字 / 改设置） |
| 📑 **侧边栏** | Alt+S 或 popup 里"📑 打开侧边栏" | 长时间创作 / 反复用同一动作 |

四种入口共享同一菜单结构（SSoT 配置），保持体验一致。

### ⚡ AI 任务全家桶

- **速答壹拾佰**：选中主题 → 一键发送给 ChatGPT / Claude / Grok / 文心一言 / Google AI Mode 五家。**两步流程模板**：先输出"短篇（80 字内带标题感）+ 中篇（约 10 句）"，末尾追加 A/B 选项让用户决定是否续写长篇 / 把短中篇润色成更自然的真实表达。
- **触触搜百问**：同一主题一次性问遍所有主流 AI，多视角对比，避开单家模型的盲区偏见。
- **优化提示词**：八种场景模板（深度研究 / 普通对话 / 代码编写 / 内容创作 / 数据分析 / 问题解答 / 头脑风暴 / 描述润色），自动用提示工程最佳实践重写你的问题。
- **🎨 封面生成器（v1.2.0+）**：选中标题文本 → 一键调用 ChatGPT Images 2.0 → 渲染封面图。内置「二次元可爱 / 小红书风格 / 椰树牌风格 / 极简的留白」四种预设，**自定义风格预设库**支持多行（每行=一个预设），在侧边栏 dropdown 切换；**比例选择**覆盖 11 种主流平台规格（5:2 / 6:2 X (Twitter / 推特) Banner / 2.35:1 微信公众号 / 2:1 / 16:9 / 3:2 / 4:3 / 1:1 / 4:5 / 3:4 / 9:16）+ 用户自定义比例。

### 📑 侧边栏置顶（v1.2.0+）

把最常用的动作钉在侧边栏顶部，下次开侧边栏一键直达：

- 默认置顶：封面生成器 · 二次元可爱
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

装好扩展自动弹欢迎页（仅首次装弹，更新不打扰），介绍四种入口 + 主打功能 + 视频教程；"立即打开侧边栏"按钮一键体验，状态实时同步。

### ⚙️ 命令系统（输入框内）

- `/base64 文本` - Base64 编码 / `/base64 -d 编码文本` - 解码
- `/md5 文本` - 生成 MD5 哈希
- `/url 文本` - URL 编码 / `/url decode 编码文本` - 解码
- `/upper 文本` - 转换为大写 / `/lower 文本` - 转换为小写

## 安装方法

### 开发者模式安装
1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 开启右上角的"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择本项目文件夹
5. 插件安装完成！

## 使用说明

1. **轻触选中**: 用鼠标轻触并拖动选中网页文本，触触搜悬浮框会自动出现在您的光标旁
2. **一键操作**: 功能按钮就在选中文本旁边，轻点即可执行
3. **命令模式**: 在输入框输入 `/` 开头的命令，按回车执行
4. **自然关闭**: 点击 × 按钮、按 ESC 键或点击页面其他地方即可关闭

### 快捷键
- Alt+S: 切换打开/关闭悬浮面板（Toggle）
- ESC: 关闭悬浮面板
- 快捷键可在设置中自定义

提示：当你继续用键盘扩展选择（如 Shift+→），面板会实时更新所选文本；将鼠标悬停在功能按钮上，会显示“功能名: 全文”的完整提示。

智能定位：当你滚动到页面很深处后，若面板仍停留在旧位置，按下 Alt+S 会将面板重新定位到可视区域（优先靠近当前选区，否则在视口居中上方），确保始终可见。

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
├── manifest.json              # Manifest V3 配置
├── CLAUDE.md                  # 开发指南（给 Claude Code 用）
├── README.md                  # 项目说明文档
├── eslint.config.mjs          # ESLint 配置
├── package.json               # NPM 依赖配置
├── background/                # Service Worker 后台脚本
│   ├── index.js              # 入口点（importScripts 加载顺序）
│   ├── utils/                # 工具模块
│   │   ├── Constants.js      # 常量定义（全局变量集中管理）
│   │   └── TextUtils.js      # 文本处理函数
│   ├── menu/                 # 新架构菜单模块
│   │   ├── MenuBuilder.js    # 菜单构建工具类
│   │   ├── MenuUpdater.js    # 动态标题更新
│   │   └── MenuHandlers.js   # 点击处理逻辑
│   ├── events/               # 新架构事件模块
│   │   ├── TabEvents.js      # 标签页事件处理
│   │   ├── MessageEvents.js  # 消息事件处理
│   │   └── MenuEvents.js     # 菜单事件处理
│   ├── base.js               # 核心状态与函数（逐步迁移中）
│   ├── events.js             # 消息处理、事件监听（兼容模式）
│   ├── menuBuilder.js        # 右键菜单构建
│   ├── menuHandlers.js       # 菜单点击处理
│   ├── config.js             # 配置加载
│   ├── StateManager.js       # 状态管理器
│   ├── MenuRegistry.js       # 菜单注册表
│   └── KeywordSyncManager.js # 关键字同步管理
├── content/                   # 内容脚本模块
│   ├── SelectionManager.js   # 选区管理器
│   ├── TextEncoder.js        # 文本编码工具
│   ├── ToastUI.js            # Toast 通知组件
│   └── ClipboardHelper.js    # 剪贴板助手
├── content.js                 # 主内容脚本
├── content.css                # 悬浮面板样式
├── popup/                     # Popup 菜单（点击扩展图标）
│   ├── popup.html
│   ├── popup.js              # 从 background 获取菜单结构
│   ├── popup.css
│   └── modules/              # Popup 模块
│       ├── MenuRenderer.js   # 菜单渲染器
│       ├── SettingsManager.js# 设置管理器
│       └── ToastHelper.js    # Toast 助手
├── modules/                   # 共享模块
├── config/                    # 配置文件
│   ├── unifiedMenuConfig.json # 统一菜单配置（含开关）
│   └── engines.json          # 引擎配置
├── prompts/                   # 提示词模板
│   ├── topQuestionsPrompts.json
│   ├── fastAnswersPrompts.json
│   └── optimizedPrompts.json
├── scripts/                   # 开发工具脚本
│   ├── analyze-errors.js     # ESLint 错误分析工具
│   └── log-menu-icons.js     # 菜单图标日志工具
└── icons/                     # 插件图标
    ├── 16x16.png
    ├── 48x48.png
    └── 128x128.png
```

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
node --check background/base.js

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

- **v1.5.1**（2026-05-01）：剪贴板兜底 chrome:// 等不支持选区页面 / Windows 滚动文字修复 / 多项体验改进
- **v1.4.0**（2026-04-30）：首次安装欢迎页 / AI 检测规避双层引导 / 启发式关键字兜底
- **v1.2.0**（2026-04-29）：封面生成器 / 侧边栏置顶 / 速答两步流程模板
- **v1.0.0**（2025-08）：MVP，悬浮浮窗 + 10 个快捷按钮 + 命令系统

## 开发计划

待实现的提案归档在 [docs/TO-BE-IMPLEMENTED/](./docs/TO-BE-IMPLEMENTED/)，已知问题在 [docs/KNOWN_ISSUES.md](./docs/KNOWN_ISSUES.md)。

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT License

## 联系方式

更多功能 敬请期待...
