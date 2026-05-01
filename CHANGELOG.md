# 更新日志

## v1.5.2 (2026-05-01)

封面生成器持续打磨：自定义风格升级为预设库、新增比例选择、若干 UX 细节修复。详细见 [releases/v1.5.2.md](./releases/v1.5.2.md)。

### ✨ 新功能

- **封面生成器 · 自定义风格预设库**：自定义风格升级为多行编辑——textarea 维护"风格预设库"，每行=一个独立预设；下方 dropdown 列出全部预设（前 15 字截断 + …），选哪行就用哪行；dropdown 自动跟随 textarea 实时变化（删了当前选中行回退第一行，没删则保持选择）。**新增行后自动跳转选中**——多行粘贴或末尾追加时立即指到最末新增项。
- **封面生成器 · 比例选择**：sidepanel 置顶 picker 内新增比例 dropdown，全局生效（适用所有封面调用——sidepanel / 右键 / popup）。10 个预设按"宽到窄"排序覆盖国内外主流自媒体平台：5:2 横幅 / 2.35:1 微信公众号 / 2:1 Twitter / 16:9 YouTube/B站 / 3:2 头条号 / 4:3 PPT / 1:1 Instagram/微博 / 4:5 / 3:4 小红书 / 9:16 抖音。支持自定义比例（W:H，最多 5 个滚动剔除）。
- **模板末尾「调整自定义风格」闭环提示**：ChatGPT 跳转后用户可读区追加一句"💡 如果生成图片效果不满意，请回到侧边栏调整「自定义风格」字眼后再试（风格关键词越具体，渲染越准）"。

### 🐛 修复

- **自定义风格的 purpose 没注入到 prompt**：之前选自定义风格时，模板里 `${purpose}` 会被 JSON 占位文本替代，用户实际填写的关键词丢失。根因是 events.js SSoT 通道没把 sidepanel 传过来的 `request.purpose` 透传给 `runAITask`。修复：加 `purposeOverride` 参数 + `buildTaskPrompt` 优先用 override。
- **置顶卡片副标题/dropdown 长文本挤爆容器**：超过 18 字的自定义风格行会把"✏️ 修改"按钮挤出可视区。根因是 `.sp-pin-action` 缺 `min-width: 0`，flex item 默认 `min-width: auto = content size`。修复：双层防御——应用层 truncate 统一 15 字 + CSS 给 `.sp-pin-action` 补 `min-width: 0`。
- **操作自定义编辑区不自动激活 custom 模式**：textarea oninput / dropdown onchange 都调 `activateCustomCategory()` 自动切 radio + 同步 UI；rebuild dropdown 末尾加 `sel.value = chosen` 防浏览器 selectedIndex 残留 quirk。

### 🔧 改进

- **置顶卡片图标** 📌 → 🎨：与 Constants.js MENU_DEFINITIONS / README / store-listing 全项目封面生成器统一标识对齐。

### 🛠 技术改动

- `coverPrompts.json` 模板硬编码 `5:2` → `${ratio}` 占位；新增 `custom` category。
- `AITaskRegistry.buildTaskPrompt` 加通用 `options.vars` 机制——未来加任意模板变量直接通过 `vars` 传入，无需改 schema。
- `AITaskHandler.runAITask` 抽 `collectTaskVars(taskId)`——cover task 自动从 storage 读 ratio，三端调用方零改动，**单一数据源**。
- 新 storage keys：`ccs_cover_aspect_ratio` / `ccs_cover_custom_ratios` / `ccs_cover_custom_selected_line`。
- README.md 功能特性段重写——完整反映 v1.2.0+ 至今所有新功能。
- `releases/store-listing.txt` 新建——长期单一文件，每次发版前覆盖式更新。

## v1.5.1 (2026-05-01)

### ✨ 新功能

- **侧边栏剪贴板读取按钮**：当关键字徽章为空时（说明当前页面无法识别选中文字，比如 `chrome://contextual-tasks/`、扩展商店等不允许 content script 注入的页面），侧边栏顶部会自动露出「📋 从剪贴板读取关键字」按钮。复制文字后点一下，立即把剪贴板内容写入关键字，菜单按钮可以正常跳转引擎。解决了 v1.4.0 之前 chrome:// 等"陌生协议页面"完全没法用的痛点。
- **欢迎页「立即打开侧边栏」按钮实时同步状态**：用户在欢迎页点开侧边栏后，如果不小心关掉，按钮会立即变回"打开"状态——不会让用户找不到入口。从 popup、浏览器右上侧边栏按钮等任意来源开关都同步。多窗口独立追踪。
- **popup 设置面板加「📖 查看欢迎页」入口**：用户首次安装的欢迎页关掉后想再看，可在 ⚙️ 设置 → 「📖 查看欢迎页」找回。

### 🐛 修复

- **Windows 上滚动文字失效**：侧边栏 ⚠️ 提醒条 + 欢迎页顶部横条的文字滚动在 Windows Chrome 上不工作，Mac 正常。原因是 CSS marquee 写法（`padding-left: 100%` 在 flex item + `min-width: 0` 子元素上）的百分比解析在 Windows 上有时序问题。修复：完全绕开 CSS animation，改用 `requestAnimationFrame` + 实测像素 + `transform: translateX(${px}px)` 手动驱动，跨平台像素一致。详见 `docs/archive/MARQUEE_SCROLL_WINDOWS.md`。
- **手动设的关键字会被 refresh 清空**：之前点剪贴板按钮设好关键字后，再点侧边栏菜单项时 `refresh()` 会重新自动提取关键字，chrome:// 页面拿不到就把手动设的关键字覆盖成空的，搜索引擎收到空字符串。修复：refresh 现在判断三种情况——URL 变了跟随新页 / URL 没变 + 用户手动设过 + 自动提取空 → 保留手动关键字 / 其它情况照常更新。
- **滚动时顶部提醒条 / 侧边栏置顶区微小 jitter**：从 `position: sticky` 改为 `position: fixed`，浏览器只用一次坐标计算，rock-solid 无浮动重绘。

### 🔧 改进

- **⚠️ 悬停浮层视觉强化**：原本浮层是纯白底 + 40% 透明 amber 边框，跟侧边栏白底反差太弱，用户感觉"里面没东西"。改成浅 amber 渐变底（`#fef3c7 → #fde68a`）+ 1.5px 实心 amber 边框 + amber 光晕阴影，跟侧边栏拉开明显对比，"这是一个独立的、有重要内容的卡片"。
- **AI 检测提醒文案加范围限定**：「图片生成后，建议截图另存新图...」→「**关于封面生成器**，图片生成后，建议截图另存新图...」。前缀让用户清楚这条提醒专属封面生成器，不会误以为是普通搜索的通用规则。同步改 4 处（侧边栏 banner / 欢迎页顶部横条 / 欢迎页警告卡片 / ChatGPT prompt 头条）。

### 🛠 技术改动

- 新增 `welcome-watcher` port 推送系统（`background/events.js`）：欢迎页连 port 上报 windowId，侧边栏 alive port 增减时自动广播给对应 window 的欢迎页订阅者。push-based 实时同步，0 延迟。SW 重启时欢迎页端 500ms 自动重连。
- 新增 `docs/TO-BE-IMPLEMENTED/` 目录归类待开发功能提案，与 `docs/archive/`（已解决）、`KNOWN_ISSUES.md`（已知 bug）形成语义对仗。
- 归档「智能截图功能」完整提案到 `docs/TO-BE-IMPLEMENTED/screenshot-feature.md`（含 3 路径评估、Chrome API 选型、6 大边界限制、6 个决策点、实施 checklist）。
- 剪贴板按钮的点击失败 / 状态卡死等边界场景已加 reset 兜底，按钮 DOM 状态总是保持干净。

## v1.4.0 (2026-04-30)

### ✨ 新功能

- **首次安装欢迎页**：装好扩展自动弹欢迎页（仅首次装弹，更新不打扰），介绍四种入口（侧边栏 / 悬浮面板 / 右键菜单 / Popup）+ 主打功能 + 视频教程 + 作者关注。其中"立即打开侧边栏"按钮一键体验侧边栏，解决新用户找不到侧边栏的痛点。
- **AI 检测规避提示双层引导**：欢迎页新增 ⚠️ 封面生成器使用提示 section（amber 卡片含闪耀光晕 + 斜向掠光动画），讲透"为什么生成图后要截图另存"——元数据指纹机制 / 平台后果（限流·降权·水印）/ 截图为何有效 + 截图快捷键。同时欢迎页顶部加 amber 滚动横条「图片生成后，建议截图另存新图再使用，避免被识别为AI产出 · 点击查看详情 →」，整条可点击平滑滚动跳到详细 section。
- **侧边栏 banner 文字横向滚动**：原静态文案改为 18 秒/loop 从右往左滚动（≈27px/秒，可读速度），鼠标悬停整行暂停方便读完。被动捕获用户视线。
- **未硬编码搜索引擎也能拿关键字**：`background/keywords.js` 加启发式参数提取兜底——20+ 个硬编码 hostname 全 fall-through 后，按"哪个 param 最像关键字"打分挑（命中常见 key 名 / 长度合理 / 含中文加分；像 URL / UUID / 纯数字大概率不是关键字 → 直接毙）。新搜索站点不用改代码也有不错的命中率。

### 🐛 修复

- **popup 底部 footer 短屏被滚走**：之前在分辨率低 / 浏览器窗口短的设备上，菜单内容超出 popup 高度时整个 popup 出现外层滚动条，「📑 打开侧边栏」按钮要滚到底部才能看到。改为 `position: fixed` 直接钉在 popup 视口底部，body 自身做 scroll container，跨设备稳定贴底。

### 🔧 改进

- **AI 检测提醒文案精简**：「图片生成后，建议截图成新文件上传自媒体，避免被识别为AI生成」→ 「图片生成后，建议截图另存新图再使用，避免被识别为AI产出」。「另存新图」比「成新文件」更直观（图片场景），「再使用」语义比「上传自媒体」更广（覆盖所有使用场景）。
- **popup「打开侧边栏」按钮升级实心 amber 填充**：白字 + amber 实底 + 字重 600 + 阴影，hover/active 加深，让按钮成 footer 视觉焦点；footer 上方加轻阴影强化 sticky 边界。

### 🛠 技术改动

- 新增 `welcome/welcome.{html,css,js}` 三个文件 + `background/events.js` 加 onInstalled 监听器（仅 reason==='install' 时触发）+ `build.sh` 把 `welcome/` 加入 REQUIRED_FILES + COPY_DIRS。
- popup CSS 抽出 `--ccs-popup-width / --ccs-popup-max-height / --ccs-popup-footer-height` 三个变量，避免散落魔法数。
- 所有动画都加 `prefers-reduced-motion` 媒体查询兜底，尊重系统级关动效偏好（无障碍）。
- 归档 `docs/archive/POPUP_FOOTER_STICKY_SHORT_DISPLAY.md` 记录 popup footer 短屏问题的失败路线（vh / dvh / JS innerHeight 同步 / setTimeout 轮询 / ResizeObserver）+ 最终方案，避免后续重蹈覆辙。

## v1.3.1 (2026-04-30)

### 🔧 改进

- **Chrome Web Store 列表标题强化关键词**：「触触搜」→「触触搜 - 多 AI 速答、封面生成器、提示词优化」，让用户在商店搜索 AI 速答 / 封面生成器 / 提示词优化任一关键词时直接命中。
- **Chrome Web Store 列表简介补充封面生成器风格**：「选中文本快速搜索和处理工具」→「选中文本快速搜索和处理工具，含封面生成器（内置小红书 / 椰树牌风格）」。避开「新功能 / 目前两款」等会过期的措辞。

## v1.3.0 (2026-04-30)

### ✨ 新功能

- **AI 检测规避提示**：封面生成器入口新增 ⚠️ 顶部 banner，悬停 ⚠️ 弹出全宽说明卡——讲清楚直接下载的图片自带 C2PA 元数据指纹（小红书 / 抖音 / 视频号等可一键识别为 AI 内容）、被识别后的代价（限流、降权、强制水印）、以及为什么截图能绕过。同口径文案也注入到 ChatGPT prompt 末尾，让用户在对话流里也能看到——双保障。
- **popup 按钮按状态切换显示「打开/关闭侧边栏」**：以前不管侧边栏开没开都显示「打开」，点了没反应。现在按实际状态切换文案与行为（`📑 打开侧边栏` ↔ `📕 关闭侧边栏`），多窗口独立追踪。

### 🛠 技术改动

- 绕过 Chrome MV3 没有 `sidePanel.isOpen()` / `close()` API 的限制：background 加 `sidePanelPortsByWindow` Map 按 windowId 追踪 port，sidepanel 启动时连 port 上报，关闭走 port 反向消息让 sidepanel 自调 `window.close()`。SW 重启 / 扩展重载时 sidepanel 端 500ms 自动重连，避免状态假报。
- 新增 `docs/KNOWN_ISSUES.md`，归档 `chrome://contextual-tasks/`（Chrome 内嵌 AI Mode 的内部协议）关键字提取失败问题——hostname 是 `contextual-tasks` 不是 `google.`，需要补分支；content script 因 chrome:// 协议禁注入，鼠标选区无解（Chrome 平台层硬限制）。文档含修复草稿代码 + 验证清单。

## v1.2.1 (2026-04-30)

### 🐛 修复

- **边栏关键字总是滞后/为空**：sidepanel 不能注入 content script，原本只能吃缓存和 URL/title 兜底，现在改为通过 `chrome.scripting.executeScript` 主动到 active tab 拉 `window.getSelection()`，和右键菜单走同一条路径。Popup 同样开启 `forceFresh`。
- **点击边栏菜单项时 keyword 仍可能是旧值**：`handleClick` 和 `pinned.execute()` 在分发前 `await refresh()` 重新拉一次选区，避免开着边栏改选区后用旧 keyword。

### 🔧 改进

- **封面生成器提示词**：模板改为「内容 / 风格 / 注意」三段式（之前是 `--要使用XX` 命令式），ChatGPT Images 解析更稳。
- **速答中篇回答补上排版要求**：与长篇对齐 ——「合理分段，段间空行，提升阅读体验」。

### 🛠 技术改动

- 修长期红的 CI lint：`eslint.config.mjs` 补登 v1.2.0 加进来但漏注册的 11 个 SW 全局（`getEngineTitle` / `runAITaskByMenuId` / `applyTextLimit` / `tryOpenMenuUrl` 等）。

## v1.2.0 (2026-04-29)

### ✨ 新功能

- **封面生成器**：右键菜单 / Popup / 侧边栏三端同步出现"🎨 封面生成器"，首批两种风格（小红书封面、椰树牌风格）×ChatGPT Images 2.0；提示词集中在 `prompts/coverPrompts.json`，扩展新风格只需改一个文件。
- **侧边栏置顶快捷动作**：侧边栏顶部固定可点击的快捷动作卡片，默认"封面生成器·小红书封面"；"✏️" 修改按钮展开 radio 切换风格，保存到 `chrome.storage.local` 跨会话持久化。

### 🔧 改进

- **速答模板两步流程**：第一步只出短篇（80 字以内带标题感）+ 中篇；末尾追加 A/B 两选项 —— A 续写长篇正文（无"长篇回答"字样、无追问），B 把短/中篇润色为更自然真实的表达（去掉"说真的""其实"等口头禅，"他"统一替换为"TA"）。
- **Popup 入口文案对齐**：底部 "📌 面板" → "📑 打开侧边栏"，图标和文案更直白。

### 🛠 技术改动

- 新引擎 `chatgpt-images` 登记到 `config/engines.json` SSoT。
- `AITaskRegistry` 注册 `cover` 任务，`KNOWN_ENGINE_IDS` 同步加 `chatgpt-images`，避免菜单点击解析静默失败。
- 修复 `build.sh` 严重缺文件 bug —— 之前打出来的 zip 缺 `background/` / `sidepanel/` / `config/` / `prompts/` / `content/` / `modules/` / `dockbar.js`，装上 service worker 直接挂；新版按 manifest 实际引用的文件清单复制，输出到上一层目录。

## Unreleased

### 改进
- 标题不换行：普通模式的弹窗标题与 Mini 模式一致，单行展示并省略溢出文本（悬停可见全文）。
- 设置面板可读性：提高文字对比度，展示“当前网站”域名；“加入黑名单/移出黑名单”按钮颜色对比更清晰。
- 实时文本更新：当继续用键盘扩展选择（如 Shift+→）时，面板标题与按钮提示会实时反映最新选中文本。
- 悬浮提示优化：功能按钮悬停时显示“功能名: 全文”（如“百度搜索: XXX”）。
- 快捷键：Ctrl+Shift+S 现在用于打开/关闭面板（切换）；Alt+S 打开面板；ESC 关闭。
- 右键菜单同步：首次右键即可刷新为最新选区/页面关键词，适配 ChatGPT / Claude 等快捷结果页。
- 自动恢复脚本：遇到 `Receiving end does not exist` 时，后台会自动注入内容脚本并重试同步。
- 调试日志强化：`[触触搜][MENU] context-preview-title-check` / `context-click-title-check` 现包含 `menuDisplay` / `menuRaw`，排查标题不同步更直观。
- 日志摘要：所有菜单事件在控制台输出中都会追加 `match/keyword/title` 等摘要字段，快速定位问题。
- 动态标题监听：侦听 `tab.title` 变化并即时刷新菜单标题，适配单页应用动态切换（如 ChatGPT 会话页）。
- 关键词预抓取：在标签页加载/激活时预计算 `prefetch-menu-state`，保证首次右键即可显示最新关键词。
- URL 关键词不再写入选区缓存：防止旧的备选词覆盖真正的用户选区，确保二级菜单首次同步成功。
- 二级菜单日志：`search-menu-title` 输出 `ccs-chuchusou` / `ccs-chatgpt` / `ccs-claude` 的实时标题与菜单快照，便于排查速答入口。
- 速答菜单日志：`fastqa-menu-title` 记录 `ccs-fastqa-root` / `ccs-fastqa-open-all` 的最新标题与快照。
- 菜单快照：`menu-title-snapshot` 在右键弹出后抓取核心菜单项的实际标题，用于比对更新是否落地。

## v2.0.0 (2025-08-26) 🚀 重大更新

### ✨ 新功能

#### 智能定位系统
- **智能位置计算**：自动选择最佳显示位置
  - 优先级：右下 → 右上 → 左下 → 左上 → 下方居中 → 上方居中
  - 确保 popover 始终在视窗内完整显示
  - 根据选中文本位置智能调整
- **位置记忆**：记住用户手动调整后的位置偏好

#### 拖拽支持
- **自由拖动**：按住标题栏即可拖动 popover 到任意位置
- **视觉反馈**：拖拽时显示半透明效果
- **位置保存**：拖拽后的位置自动保存，下次打开时记住位置

#### Mini 模式
- **紧凑布局**：只显示 5 个最常用的功能按钮
- **空间节省**：相比普通模式节省 70% 屏幕空间
- **快速切换**：一键在普通/Mini 模式之间切换
- **自定义按钮**：可配置 Mini 模式显示哪些按钮

#### 设置面板
- **显示模式**：
  - 普通模式：完整功能界面
  - Mini 模式：紧凑型界面
  - 禁用模式：临时关闭插件
- **透明度调节**：30% - 100% 可调，避免遮挡内容
- **黑名单管理**：
  - 一键将当前网站加入/移出黑名单
  - 黑名单网站自动禁用插件
- **数据持久化**：所有设置使用 chrome.storage 保存

### 💫 体验优化

- **动画效果**：
  - 淡入淡出动画让显示/隐藏更流畅
  - hover 效果优化
- **键盘支持**：
  - ESC 键快速关闭
  - 自动聚焦输入框（普通模式）
  - Tab 键导航（计划中）
- **Toast 提示**：优化提示消息显示效果
- **响应式设计**：根据模式自动调整尺寸

### 🔧 技术改进

- **状态管理**：完整的设置状态管理系统
- **数据持久化**：使用 chrome.storage.local API
- **代码重构**：模块化设计，提高可维护性
- **性能优化**：减少不必要的重渲染

---

## v1.0.0 (2025-08-26)

### 初始版本功能

- 文本选中自动弹出悬浮框
- 10 个快捷功能按钮（搜索、编码、复制等）
- 本地命令系统（/base64、/md5、/url 等）
- Shadow DOM 样式隔离
- Manifest V3 兼容

---

## 开发计划

### v2.1.0（计划中）
- [ ] 主题系统（深色模式、自定义配色）
- [ ] 快捷键自定义
- [ ] 命令历史记录
- [ ] 更多编码格式支持（JWT、Hex、Unicode）

### v2.2.0（计划中）
- [ ] 云同步设置
- [ ] 导入/导出配置
- [ ] 自定义功能按钮
- [ ] API 集成支持

### 长期计划
- [ ] AI 功能集成
- [ ] 多语言支持
- [ ] 团队协作功能
- [ ] 插件市场
