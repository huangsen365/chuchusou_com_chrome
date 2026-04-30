# Marquee Scroll Windows 修复记录

> **状态**：已修复并归档，不再作为 `TO-BE-FIX` 任务追踪
> **修复日期**：2026-05-01
> **结论**：不要再依赖 CSS marquee；当前方案用 `requestAnimationFrame` 直接驱动 `transform`

---

## 背景

扩展有两处温馨提示使用横向滚动文字：

1. 侧边栏 banner：`.sp-pin-tip`
2. 欢迎页顶部横条：`.top-marquee`

原实现依赖：

```css
padding-left: 100%;
animation: ... translateX(-100%);
```

在 macOS Chrome 上滚动正常，但 Windows Chrome 上用户反馈滚动不起作用。

---

## 修复方案

保留原来的单文本节点 marquee 结构，不再改成双副本 track。关键变化：

- CSS 不再声明 marquee keyframes，不再使用 `padding-left: 100%`。
- JS 在页面加载时测量 marquee viewport 和文字实际宽度。
- JS 用 `requestAnimationFrame` 按 px/s 更新 `transform: translateX(...)`。
- `ResizeObserver` 监听 viewport 尺寸变化，旧浏览器 fallback 到 `window.resize`。
- 不再做 hover 暂停，避免 Windows 测试时鼠标停在横幅上被误判为滚动失效。

涉及文件：

- `sidepanel/sidepanel.css`
- `sidepanel/sidepanel.js`
- `welcome/welcome.css`
- `welcome/welcome.js`

---

## 为什么这样修

Windows 问题很可能出在 flex item 内的百分比 padding 解析时机。父元素是 `flex: 1; min-width: 0; overflow: hidden`，子元素是 `inline-block`，`padding-left: 100%` 在 Windows Chrome 上可能没有解析成实际 marquee viewport 宽度。

RAF 方案绕开这些不稳定点：动画不再走 CSS keyframes，位置也不再依赖 flex 百分比计算，而是每帧按实际宽度计算出的 px 坐标更新。

---

## 不要重复的失败路线

- 双副本文字 + `translateX(-50%)`：用户已反馈 Windows 仍不行。
- 继续依赖 `padding-left: 100%`：会回到原问题。
- 继续依赖 CSS keyframes：Windows 上可能被系统动效设置或浏览器实现影响。
- 在没有 Windows 实测证据时继续猜 flex 百分比行为。

---

## 回归 checklist

| # | 验收项 | 期望 |
|---|---|---|
| 1 | 侧边栏 ⚠️ 旁文字 | 从右往左滚动，约 18s/loop |
| 2 | 侧边栏 hover | 仍继续滚动 |
| 3 | 欢迎页顶部横条 | 从右往左滚动，约 20s/loop |
| 4 | 欢迎页 hover | 仍继续滚动 |
| 5 | Windows 系统关闭动画 | 仍从右往左滚动 |

Mac 和 Windows 都要通过。
