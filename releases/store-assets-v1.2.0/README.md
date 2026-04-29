# 触触搜 v1.2.0 商店素材包

> 上传 Chrome Web Store 时配合 `releases/store-listing-v1.2.0_*.txt` 一起用。

## 文件说明

| 文件 | 尺寸 | 用途 | Chrome Web Store 字段 |
|---|---|---|---|
| `blue-small-440x280.jpg` | 440×280 | Small Promo Tile（蓝色主调） | Small promo tile |
| `warm-small-440x280.jpg` | 440×280 | Small Promo Tile（暖黄/v1.2.0 主打调） | Small promo tile |
| `dark-small-440x280.jpg` | 440×280 | Small Promo Tile（深色 AI 调） | Small promo tile |
| `blue-marquee-1400x560.jpg` | 1400×560 | Marquee Promo Tile（蓝） | Marquee promo tile |
| `warm-marquee-1400x560.jpg` | 1400×560 | Marquee Promo Tile（暖黄） | Marquee promo tile |
| `dark-marquee-1400x560.jpg` | 1400×560 | Marquee Promo Tile（深色） | Marquee promo tile |
| `generate.py` | — | 生成脚本（v1.3.0 改一行 slogan 就能复用） | — |

## 推荐选哪张

- **稳妥首选**：`blue-*` —— 与扩展实际侧边栏 header 主色一致，最贴合产品识别度
- **新功能突出**：`warm-*` —— 与 v1.2.0 新增的"侧边栏置顶卡片"是同款暖黄，能强化新功能记忆点
- **AI 工具调性**：`dark-*` —— 在商店页一堆浅色卡片里更跳，但偏离扩展实际配色

挑一套（小图 + 大图同色）保持视觉一致即可。

## 生成原则（避免审核被认为虚假宣传）

所有元素都来自仓库现有真实文件，零编造：

| 元素 | 来源 |
|---|---|
| Logo | `icons/128x128.png` |
| Slogan "选中文本，一键调用多家 AI" | `releases/v1.2.0.md` 商店描述段 |
| 6 个功能 emoji + 名称 | `background/utils/Constants.js` `MENU_DEFINITIONS` |
| 蓝色主色 `#0ea5e9 → #0284c7` | `sidepanel/sidepanel.css` 实际 header 渐变 |
| 暖黄色 `#fef3c7 → #fde68a` | `sidepanel/sidepanel.css` 置顶区背景 |

## 重新生成

```bash
cd releases/store-assets-v1.2.0
python3 generate.py
```

要求：macOS 自带 Python3 + Chrome 已安装在 `/Applications/Google Chrome.app/`。

无 Pillow 依赖，用 Chrome headless 渲染 HTML 截图，再用 `sips` 转 JPEG（自动去 alpha，符合 Chrome Web Store "24-bit no alpha" 要求）。

## ⚠️ Screenshots 必须自己拍

Chrome Web Store 要求至少 1 张产品截图（1280×800 或 640×400）。**这部分我没有也不应该自动生成** —— 必须是扩展真实运行在 Chrome 里的画面，否则就是虚假素材。

### 5 张推荐截图脚本（按重要性排序）

#### Screenshot 1 — 右键菜单全展开 ★必拍
- **场景**：浏览器打开任意中文长文（推荐：知乎热门回答、公众号文章）
- **操作**：选中 1-2 句话 → 右键
- **构图**：截图覆盖右键菜单完整展开，"高级功能"组里的 `🎨 封面生成器` / `⚡ 速答壹拾佰` / `💯 触触搜百问` / `🧠 优化提示词` 全部可见
- **目的**：一眼显示扩展核心入口

#### Screenshot 2 — 侧边栏置顶卡片（v1.2.0 主打）★必拍
- **场景**：打开侧边栏（点 Popup 里的"📑 打开侧边栏"按钮）
- **操作**：什么都不做，直接截
- **构图**：包含侧边栏顶部的暖黄置顶卡片（"封面生成器 · 🔴 小红书封面"），下方主菜单也露一点
- **目的**：突出 v1.2.0 唯一识别度的新 UI

#### Screenshot 3 — Popup 弹窗主菜单
- **场景**：点击 Chrome 工具栏的扩展图标
- **操作**：让 Popup 完整展开
- **构图**：弹窗主体 + 底部 "📑 打开侧边栏" / "⚙️ 设置" 按钮可见
- **目的**：第二种入口形态

#### Screenshot 4 — 速答两步流程实际效果
- **场景**：在网页选中一段文字（比如"中国茶文化"），右键 → 速答 → ChatGPT
- **操作**：等 ChatGPT 回答完成，截答复完整页面
- **构图**：能看到"【短篇回答】+【中篇回答】+ A/B 两个追问选项"的回答形态
- **目的**：用真实对话页证明模板效果

#### Screenshot 5 — 选中文本悬浮浮窗
- **场景**：在任意网页选中一段文字
- **操作**：等浮窗自动出现
- **构图**：浮窗本体 + 周围网页背景，体现"选中即用"的体验
- **目的**：展示第三种入口

### 截图工具推荐（macOS）

| 需求 | 工具 |
|---|---|
| 简单截图 | `Cmd+Shift+4` 系统快捷键，框选 |
| 截图 + 标注 | CleanShot X / Shottr / Xnapper（需买）|
| 精确尺寸（1280×800 或 640×400） | 截完用 `sips` 调整：`sips -z 800 1280 input.png --out out.jpg`（会变形，建议先按比例截再微调）|
| 不变形地裁切到目标尺寸 | 用预览 App 打开 → 工具 → 调整大小（按比例） + 裁切 |

### 尺寸校验

```bash
sips -g pixelWidth -g pixelHeight your-screenshot.jpg
# 期望：1280×800 或 640×400
```

### 格式要求

- JPEG 或 24-bit PNG（不带 alpha）
- 直接 macOS 截图保存的 PNG 是带 alpha 的，建议导出为 JPEG：
  ```bash
  sips -s format jpeg -s formatOptions high screenshot.png --out screenshot.jpg
  ```
