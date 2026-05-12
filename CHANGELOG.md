# 更新日志

## v1.6.2 (2026-05-12)

商店与文档 SEO 文案更新：manifest 名称 / 描述、README、welcome、package.json 同步加入「ChatGPT Image 2.0」关键字，方便用户在 Chrome Web Store / Google 搜索时命中。详细见 [releases/v1.6.2.md](./releases/v1.6.2.md)。

### 🔧 改进

- **manifest `name` 加入「ChatGPT Image 2.0 封面生成器」**：商店搜索结果与扩展列表中能直接看到核心卖点，方便目标用户识别。
- **manifest `description` 加入「基于 ChatGPT Image 2.0」**：同时保留「ChatGPT Images」（OpenAI 官方写法）兼容两种搜索拼写，覆盖 132 字符内的关键词组合。
- **README.md / welcome 页 SEO 文案同步**：H1 标题、tagline、封面生成器段落均提及 ChatGPT Image 2.0，GitHub 搜索 & 欢迎页阅读体验一致。
- **package.json `description` 替换为功能描述**：从原 tagline「轻触即搜，一触即达」改为含功能关键字的描述，便于 GitHub Topics / 第三方扫描器索引。

### 🛠 技术改动

- 改动仅限文案，无代码逻辑变更；service worker / content script / 提示词模板全部不动。
- 改动文件：`manifest.json` / `package.json` / `package-lock.json` / `README.md` / `welcome/welcome.html`。

## v1.6.1 (2026-05-12)

封面生成器扩容：新增「二次元可爱」「极简的留白」两个内置风格 + 自定义风格 textarea 上限大幅放宽。详细见 [releases/v1.6.1.md](./releases/v1.6.1.md)。

### ✨ 新功能

- **新增内置封面风格「二次元可爱」**：日系二次元可爱风格（随机各种），覆盖粉嫩马卡龙色调 / 圆润线条 / 大眼睛 Q 版 / 赛璐璐 / 水彩等卡哇伊调性。在右键菜单 / Popup / Sidepanel 三个入口同步出现。
- **新增内置封面风格「极简的留白」**：大面积留白 / 黑白灰为主 / 低饱和 / 细线条的高级感调性，但会在标题里随机挑 1～2 个关键字眼用一种鲜明饱和的非黑白灰颜色（朱红 / 橙黄 / 钴蓝 / 草绿 / 紫罗兰 / 桃粉 / 柠檬黄 任选其一）做视觉锚点，形成"通篇克制 + 一点鲜活"的杂志封面效果。

### 🔧 改进

- **自定义风格 textarea 上限 600 → 5000 字**：之前 600 字撑不下「二次元可爱」这类需要逐行加详细解释的预设库。HTML maxlength / counter 显示 / JS 保存兜底 三处同步放宽。
- **「💡 不知道填什么？」引导词全面更新**：跳 ChatGPT 时的提示词从原通用版换成《幸运星》系参考标尺，聚焦日系二次元日常 / 校园 / 轻喜剧 / 吐槽 / 宅文化方向，要求男女角色对半、避免黑暗 / 热血 / 赛博 / 欧美写实风。两种描述方式交替输出（完整句式 / 风格名+关键词）。
- **引导词二次精简**：初版引导词 800 字 → 365 字（URL 编码 6595 → 3069 字节），避免部分用户遇到 ChatGPT 端 URL 过长打不开的情况。

### 🛠 技术改动

- `prompts/coverPrompts.json` 新增 `anime-cute` / `minimal` 两条 category，沿用现有 `runAITaskByMenuId` 快速通道，无需碰 KNOWN_ENGINE_IDS。
- `background/utils/Constants.js` 同步登记两条 MENU_DEFINITIONS + COVER_CATEGORY_TITLES。
- 三处用户可见文案（manifest 描述 / welcome / README / sidepanel 提示）同步增列两个新风格名。

## v1.6.0 (2026-05-11)

侧边栏与 Popup 体验升级：关键字复制更顺手、完整关键字悬停即显，新增实验性语音选引擎入口，并继续打磨封面生成器与剪贴板兜底。详细见 [releases/v1.6.0.md](./releases/v1.6.0.md)。

### ✨ 新功能

- **Popup 关键字一键复制**：Popup 顶部关键字徽章右侧新增 📋 按钮，可直接把当前完整关键字复制到剪贴板，方便在其它页面或工具里复用。
- **侧边栏关键字一键复制**：侧边栏顶部关键字徽章右侧新增 📋 按钮，复制时优先保留 raw 原文，长段落和换行内容不会被压扁。
- **实验性语音选引擎**：新增默认关闭的语音选引擎能力，用户开启后可在有关键字时通过 🎤 说出引擎名，再从候选结果中确认，不会自动跳转。

### 🐛 修复

- **完整关键字悬停显示慢**：之前依赖浏览器原生 `title`，悬停后需要等浏览器延迟才显示完整内容。现在 Popup / 侧边栏改为自定义即时 tooltip，鼠标移上去几乎立刻显示完整关键字。
- **封面生成器 ⓘ 弹层残留**：侧边栏失焦、隐藏或切换窗口时，封面生成器说明弹层会自动收起，避免用户回来后看到过期浮层。
- **剪贴板关键字按钮可见性**：侧边栏剪贴板按钮在有关键字时保留为“更新关键字”，用户不需要先清空当前关键字，也能随时用剪贴板内容替换。

### 🔧 改进

- **封面风格参考提示优化**：继续调整封面生成器相关提示与风格参考入口，让用户更容易获得可用的封面风格关键词。
- **关键字 tooltip 视觉优化**：完整关键字浮层支持换行、长文本滚动和深色背景，不再受原短徽章省略号区域限制。

### 🛠 技术改动

- 语音功能通过 MV3 offscreen workaround 接入，默认关闭；仅在用户主动启用并点击 🎤 时进入识别流程。
- Popup / Side panel 的完整关键字显示从 `title` 属性迁移到 `data-full-keyword` + CSS hover/focus-within，避免原生 tooltip 延迟和样式不可控。

## v1.5.4 (2026-05-02)

侧边栏顶部蓝色 header 锁高度修复——切换页面时不再上下跳。详细见 [releases/v1.5.4.md](./releases/v1.5.4.md)。

### 🐛 修复

- **header 高度跳跃**：之前频繁切换页面时（有些页面提取到关键字、有些没有），顶部蓝色 header 会在 28px ↔ 32px 之间小幅抖动 4px，整个 sticky 区跟着跳，体验割裂。根因：keyword 徽章高度（19.4px）大于左侧 logo+标题（15.6px），`align-items:center` 让 header 跟随最高子元素变化。修复：`.sp-header` 加 `min-height: 32px` 锁高，徽章出现/消失都维持同高。

## v1.5.3 (2026-05-01)

侧边栏 UX 持续打磨：封面卡片置顶 + header 收窄省空间、剪贴板 / 自定义风格多项体验修复、新增 ⓘ 详情弹层。详细见 [releases/v1.5.3.md](./releases/v1.5.3.md)。

### ✨ 新功能

- **封面卡片置顶**：`.sp-pin` 从主滚动区搬进 sticky 区，菜单滚动时常驻视野。最终 sticky 顺序：(收窄)header → AI 检测温馨提示 → 剪贴板按钮 → 封面生成器卡片。
- **顶部蓝色 header 收窄**：padding 14/16 → 6/14、icon 20→15、标题 16→13、keyword 徽章紧凑化，整体省 ~22px 高度，刚好给新加入 sticky 的封面卡片腾位。
- **封面卡片 ⓘ 详情弹层**：标题旁加 ⓘ 图标，点击（非 hover，触屏 / 桌面行为统一）展开详情卡片，4 种关闭路径：再点 ⓘ / 点 × / 点弹层外部 / ESC。弹层内含字数篇幅建议（10–30 字）、风格 / 比例切换说明、💡 自定义风格参考入口、文字来源说明。
- **自定义风格 picker 加「💡 不知道填什么？」帮助按钮**：跳 ChatGPT 让它列 30 个封面风格名供参考，缓解部分用户"想不出风格关键词"的痛点。
- **置顶卡片标题加字数提示**：`封面生成器` → `封面生成器（建议字数适中）`，配合 title 兜全文「建议选择字数适中，否则图片效果不佳」。

### 🐛 修复

- **剪贴板读取被 500 字符 cap 截断**：之前 sidepanel 剪贴板按钮硬截 500 字，多段换行长文超出部分丢失。上限 500 → 6000 对齐 backend `LIMITS.aiChat`，下游 `applyTextLimit` 仍按 menuId 做引擎级保护。
- **剪贴板内容灌给搜索引擎查询失败**：之前所有菜单类型都用 `keyword.raw`（带换行），Google / Baidu 等搜索引擎收到 `%0A` 当噪声，查询语义被破坏。修复：`handleClick` 按 `item.type` 分流——搜索类（search/ai-search/ecommerce/translate/portal）用 `keyword.text`（合并空白成单空格），AI 对话 / 任务类继续用 `keyword.raw` 保段落结构。
- **手动剪贴板 keyword 优先级被悄悄替换**：之前 `refresh()` 仅在自动提取为空时保留手动值；只要后台返回任意内容（标题提取 / 缓存选区），剪贴板内容就被覆盖。表现为"最后一次动作不是 📋 时系统回到默认机制"。修复：手动设过 keyword 后 URL 不变就一律保留，唯一退出条件 = URL 切换或用户再点 📋 写新值。
- **自定义预设 textarea 保存时残留脏数据**：之前直接存 textarea 原文，行首尾空格 / 多余空行写入存储。修复：保存路径走 `parseCustomLines + join('\n')` 规范化清洗。

### 🔧 改进

- **picker 自动滚顶**：因为 `.sp-pin` 现在常驻顶部，picker 仍在主滚动区——用户滚到中段时点 ✏️，picker 出现在视野外。`openPicker()` 末尾加 `window.scrollTo({ top: 0, behavior: 'smooth' })` 确保可见。
- **自定义预设 label 不再被强制换行**：之前我加的 `flex: 1` + `min-width: 0` 让 label 在容器空间不够时被强制中途断词。改用 `white-space: nowrap` + 容器 `flex-wrap: wrap`，label 整段保持完整，按钮空间不够时优雅落到下一行。

### 🛠 技术改动

- 新增 `.sp-pin-task-info` ⓘ 图标交互模式：`<span>` 嵌套在 `<button>` 内（避免 nested button 非法 HTML），点击靠 `e.stopPropagation()` 阻止冒泡到外层封面生成 action；键盘可达性靠 `role="button" tabindex="0"` + Enter/Space keydown handler；`aria-expanded` 同步切换状态。
- `.sp-pin` 加 `position: relative`、`.sp-pin-task-popover` 用 `position: absolute; top: calc(100% - 1px)` 紧贴 `.sp-pin` 下边缘，`max-height: 70vh` 内滚兜底超长内容。
- `bindTaskInfoPopover()` 4 种关闭路径：`infoEl click toggle` / `closeBtn click` / `document click contains 检查` / `document keydown Escape`。

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
