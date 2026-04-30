# Popup Footer Sticky on Short Display 修复记录

> **状态**：已修复并归档，不再作为 `TO-BE-FIX` 任务追踪
> **修复日期**：2026-04-30
> **结论**：不要再走 viewport height / JS height-sync 路线；当前方案使用 fixed footer + body 滚动

---

## 背景

Chrome 扩展 popup 底部 footer 包含：

1. 设置按钮
2. 打开侧边栏按钮
3. chuchusou.com 链接

原始目标是：无论浏览器窗口或显示器多短、popup 内容多长，footer 都必须始终固定在 popup 可视区域底部，让用户随时能看到「打开侧边栏」按钮。

这个目标在 Chrome extension popup 上下文里不能靠 `100vh` / `100dvh` / JS 同步高度稳定实现。最终采用的策略是反过来处理：不再尝试让内部容器等于 popup viewport，而是把 footer 固定到 popup viewport 底部，让内容在它下方滚动。

---

## 修复方案

`popup/popup.css` 的关键改动：

- `body` 从 `overflow: hidden` 改为 `overflow-y: auto`，允许 popup 文档滚动。
- `.menu-container` / `.settings-panel` 不再做内部滚动，避免 body 与菜单容器双滚动。
- `.menu-footer` 改为 `position: fixed; bottom: 0; left: 0; right: 0`，固定在 popup 可视区域底部。
- `.ccs-popup-menu` 增加底部 padding，避免最后一个菜单项被 fixed footer 盖住。
- popup 宽度、高度和 footer 高度抽成 CSS 变量，避免散落魔法数。

这个方案不读取也不写入运行时高度，因此不会触发 Chrome popup 尺寸反馈链死锁。

---

## 原失败原因

Chrome popup 的实际高度依赖 body 的自然内容尺寸。任何“读取 popup 高度，再写回某个容器高度”的方案，都容易切断 Chrome 的尺寸反馈链：

1. popup 初始内容较短，Chrome 给出一个较小窗口高度
2. JS 读取这个临时高度
3. JS 把容器高度写成这个临时高度
4. body 被锁死在小高度
5. Chrome 不再扩展 popup

`100vh` / `100dvh` 这类纯 viewport height 方案也没有稳定命中，在 extension popup 里短屏场景下可能裁切内容或让 popup 更碍事。

---

## 已尝试且失败的方向

- `height: 100vh`：在 popup 上下文中可能按屏幕视口解析，短屏时内容被裁切。
- JS 读取 `window.innerHeight` 后写入容器高度：容易把 popup 锁死在 loading 阶段的小高度。
- 多次 `setTimeout` / `requestAnimationFrame` 重试：锁死后读到的仍然是错误高度。
- `ResizeObserver`：尺寸已经被写死后不会再触发有效纠正。
- `height: 100dvh`：在 Chrome popup 中仍不稳定，用户反馈更碍事。

不要在没有新证据的情况下重复上述方案。

---

## 当前产品处理

代码层面保留低风险视觉强化：

- `popup/popup.css` 中 footer 顶部阴影用于强化边界感。
- `popup/popup.css` 中「打开侧边栏」按钮改为 amber 实心按钮，提高可见性。
- `popup/popup.css` 中 footer 固定在 popup viewport 底部，菜单内容从底部 padding 留出可滚动空间。

产品层面用其他入口降低 footer 不固定的影响：

- 首次安装打开欢迎页。
- 欢迎页重点引导用户打开侧边栏。
- popup footer 中的侧边栏按钮继续保留，并作为固定底部入口。

---

## 如果未来必须重启

不要直接改代码。先补齐验证条件：

1. 建立可复现的短屏测试环境，至少覆盖 400px / 500px / 600px 高度。
2. 录制或自动化验证 popup 外层滚动条、内部滚动条、footer 可见性。
3. 明确 Chrome 版本和操作系统。
4. 先写回归验证清单，再做 CSS / DOM 结构调整。

如果没有这些条件，不要重新引入 JS height-sync 或 viewport height 方案。
