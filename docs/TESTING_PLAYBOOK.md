# 测试与排障手册（Playbook）

> 2026-06 右键菜单系列战役沉淀。原则一句话：**先复现、后修复——用时间线和截图说话，不靠猜。**

## 工具箱（scripts/）

| 工具 | 用途 | 要点 |
|---|---|---|
| `lib/cdp.mjs` | 共享 CDP 管道 | 单调用 20s 超时（target 死亡不悬挂）；evaluate 报错取 `exception.description`（`text` 恒为没用的 "Uncaught"） |
| `verify-extension-smoke.mjs` | 真 Chrome 装 build 产物全链回归（npm test 链尾） | 见下"冒烟套路" |
| `verify-ai-fill-ux.mjs` | 内容脚本 UX 回归 | 素页注入 content.js + stub chrome + mock 受控编辑器（model 只认 input/compositionend 事件，模拟 React/Slate） |
| `repro-first-rightclick.mjs` | 毫秒级时间线取证 | `Debugger.pause` 冻结 SW = 等价冷启动；手势时间戳 vs `contextMenus.update` 到达时间戳 |
| `repro-live-shot.mjs` | 有头真菜单视觉取证 | headed Chrome 弹出**真原生菜单** + `screencapture -x` 截屏给 AI/人眼看 |

## 冒烟套路（写新断言时照抄）

- **装载**：Chrome 136+ 无视 `--load-extension`，唯一正路 = `--enable-unsafe-extension-debugging` + CDP `Extensions.loadUnpacked`（且不要再加旧 flag，会互相干扰）
- **去外网（hermetic）**：`--host-resolver-rules=MAP www.baidu.com 127.0.0.1:<port>` + 本地 HTTPS 夹具（`scripts/fixtures/` 自签证书）+ `--ignore-certificate-errors`——CI 上真网站反爬/抖动 = 随机红
- **间谍**：SW 侧包一层 `chrome.contextMenus.update` / `logMenuEvent` 收集时间线；**存在性探针** = 用"重复 id create 必报 duplicate"反证菜单项已注册（contextMenus 没有查询 API）
- **失败必倾倒现场**：状态表 + 事件尾巴 + `tabs.query` 映射，让 CI 自己交代（曾靠这个发现 CI 上 tab id 归属与本地不同）
- **真实手势**：CDP `Input.dispatchMouseEvent` 是 trusted 事件；headless 下选区要先 `Page.bringToFront`，三连击比拖选稳
- **进程卫生**：`fail()` 抛错别 `process.exit`（跳过 finally → 僵尸 Chrome）；SIGKILL + 等 200ms 再删临时 profile；全局看门狗先杀 Chrome 再退

## 有头视觉取证套路

- 右键后菜单进 **macOS 模态循环**：右键 Input 调用**不要 await**（回包被卡），截屏后直接 SIGKILL（菜单随进程消失）；每个场景独立启动一次 Chrome
- 截图由 AI Read 读图判断——原生菜单内容任何 API 都读不到，这是唯一取证手段

## 血泪经验（背下来）

1. **扩展有 ≥2 个"当前上下文匹配"的顶层菜单项 → Chrome 折叠成扩展名父项**（任何标题都看不见）。`selection` 与 `editable` 上下文会共存——互斥必须绝对
2. **原生菜单弹出后不重绘**：标题必须在右键**之前**就正确；mac 在 mousedown 即弹出，异步更新永远赶不上第一次绘制 → 选区标题用原生 `%s`（绘制瞬间代入，零管道）
3. **共享状态多写入者竞态**：菜单标题被 onActivated/loading/title/complete 并发抢写，谁最后落地谁说了算 → 在唯一汇聚点（setMenuState）立"**空值不得覆盖新鲜非空值**"的单调性守卫
4. **python 往 JS 模板字符串里写代码 = 转义层级地狱**：`\n` / `${}` 会被吃一层，页面端 SyntaxError 还会掩埋真实报错——写完必 grep 验证落盘内容
5. 测试不忠实比没有测试更糟：executeScript 合成 selectionChanged 与生产路径行为不同（CI 漂移），真实路径（trusted 三连击 → content.js）才可信

## 发版/验证速查

- 日常验证构建：`npm run plasmo:build`（**别跑 build.sh**——会同名覆盖可能已上架的 zip）
- `npm test` = 静态 14 关 + 构建 + 产物 3 关 + 真 Chrome 冒烟全链；CI 同款（ubuntu + node 22 + 预装 Chrome）
- events.js 移植就绪状态与剩余人工回归项：见 `TECH_DEBT_AUDIT.md` 头部
