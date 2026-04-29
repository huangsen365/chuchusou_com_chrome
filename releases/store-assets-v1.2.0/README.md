# 触触搜 v1.2.0 商店素材包

> 上传 Chrome Web Store 时配合 `releases/store-listing-v1.2.0_*.txt` 一起用。

## 共 20 张图，覆盖 4 种尺寸

### Promo Tile（每个槽位上传 1 张，3 套配色挑一）

| 尺寸 | Chrome Web Store 槽位 | 文件 |
|---|---|---|
| 440×280 | Small promo tile | `blue-overview-440x280.jpg` / `warm-overview-440x280.jpg` / `dark-overview-440x280.jpg` |
| 1400×560 | Marquee promo tile | `blue-overview-1400x560.jpg` / `warm-overview-1400x560.jpg` / `dark-overview-1400x560.jpg` |

### Screenshots（最多上传 5 张）

#### 综合主题（首图推荐用这个，3 套配色挑一）

| 尺寸 | 文件 |
|---|---|
| 1280×800 | `blue-overview-1280x800.jpg` / `warm-overview-1280x800.jpg` / `dark-overview-1280x800.jpg` |
| 640×400 | `blue-overview-640x400.jpg` / `warm-overview-640x400.jpg` / `dark-overview-640x400.jpg` |

#### 专题主题（4 张差异化内容，screenshots 槽位 2-5）

| 内容 | 配色 | 1280×800 | 640×400 |
|---|---|---|---|
| 🎨 封面生成器（v1.2.0 主打） | warm | `warm-cover-1280x800.jpg` | `warm-cover-640x400.jpg` |
| 📑 侧边栏置顶（v1.2.0 主打） | warm | `warm-pin-1280x800.jpg` | `warm-pin-640x400.jpg` |
| ⚡ 速答两步流程 | dark | `dark-fastqa-1280x800.jpg` | `dark-fastqa-640x400.jpg` |
| 🌐 四端入口 | blue | `blue-entries-1280x800.jpg` | `blue-entries-640x400.jpg` |

## 推荐配色策略

- **稳妥首选**：`blue-*`（综合主题）—— 与扩展实际侧边栏 header 主色一致，识别度最强
- **新功能突出**：`warm-*`（综合主题）—— 与 v1.2.0 新增"侧边栏置顶卡片"同款暖黄
- **AI 工具调性**：`dark-*`（综合主题）—— 在商店页浅色卡片中更跳

**Promo tile（小图 + 大图）建议同色保持视觉一致。Screenshots 5 张可混搭**：

```
推荐组合 A（强调 v1.2.0 新功能 + 全功能展示）：
  Small promo tile  → warm-overview-440x280.jpg
  Marquee promo tile → warm-overview-1400x560.jpg
  Screenshot 1 → warm-overview-1280x800.jpg     首图,综合介绍
  Screenshot 2 → warm-cover-1280x800.jpg        v1.2.0 主打 1
  Screenshot 3 → warm-pin-1280x800.jpg          v1.2.0 主打 2
  Screenshot 4 → blue-entries-1280x800.jpg      四端入口
  Screenshot 5 → dark-fastqa-1280x800.jpg       速答两步流程
```

```
推荐组合 B（保守稳妥）：
  Small promo tile  → blue-overview-440x280.jpg
  Marquee promo tile → blue-overview-1400x560.jpg
  Screenshot 1-5 → 同上 1-5（混搭即可）
```

## 生成原则（避免审核被认为虚假宣传）

所有元素都来自仓库现有真实文件，零编造：

| 元素 | 来源 |
|---|---|
| Logo | `icons/128x128.png` |
| Slogan "选中文本，一键调用多家 AI" | `releases/v1.2.0.md` 商店描述段 |
| 6 个功能 emoji + 名称 | `background/utils/Constants.js` `MENU_DEFINITIONS` |
| 蓝色主色 `#0ea5e9 → #0284c7` | `sidepanel/sidepanel.css` 实际 header 渐变 |
| 暖黄色 `#fef3c7 → #fde68a` | `sidepanel/sidepanel.css` 置顶区背景 |
| 速答两步流程文案 | `prompts/fastAnswersPrompts.json` 模板 |
| 封面生成器文案 | `prompts/coverPrompts.json` 真实风格列表 |

**注意**：以上图片是**品牌/功能介绍信息图**，不是模仿产品 UI 截图，不存在虚假宣传嫌疑。

## 重新生成

```bash
cd releases/store-assets-v1.2.0
python3 generate.py
```

要求：macOS 自带 Python3 + Chrome 已安装在 `/Applications/Google Chrome.app/`。

**关键技术点**：
- 用 Chrome headless 渲染 HTML，再 sips 转 24-bit JPEG（满足 Chrome Web Store "no alpha" 要求）
- Chrome `--window-size` 设为 `(W, H+80)` 多渲染 80px 高度，再 sips 裁切到精准尺寸 —— 修复 macOS 下 Chrome headless viewport 底部约 50px 渲染空白的 bug
- 综合主题 `overview` 在 ≥640 宽度走横版（左 logo + 右 grid），在 440 宽度走竖版

## ⚠️ Screenshots 真实产品截图（可选，但建议补几张）

上面 5 张专题图够用，但如果你想再放几张**实际运行截图**显得更真实，可以自己拍：

### 5 张推荐截图脚本（按重要性排序）

#### Screenshot — 右键菜单全展开
- **场景**：浏览器打开任意中文长文（推荐：知乎热门回答、公众号文章）
- **操作**：选中 1-2 句话 → 右键
- **构图**：截图覆盖右键菜单完整展开，"高级功能"组里的 `🎨 封面生成器` / `⚡ 速答壹拾佰` / `💯 触触搜百问` / `🧠 优化提示词` 全部可见

#### Screenshot — 侧边栏置顶卡片
- **场景**：打开侧边栏（点 Popup 里的"📑 打开侧边栏"按钮）
- **操作**：什么都不做，直接截
- **构图**：包含侧边栏顶部的暖黄置顶卡片（"封面生成器 · 🔴 小红书封面"），下方主菜单也露一点

#### Screenshot — Popup 弹窗主菜单
- **场景**：点击 Chrome 工具栏的扩展图标
- **操作**：让 Popup 完整展开
- **构图**：弹窗主体 + 底部 "📑 打开侧边栏" / "⚙️ 设置" 按钮可见

#### Screenshot — 速答两步流程实际效果
- **场景**：在网页选中一段文字，右键 → 速答 → ChatGPT
- **操作**：等 ChatGPT 回答完成，截答复完整页面
- **构图**：能看到"【短篇回答】+【中篇回答】+ A/B 两个追问选项"的回答形态

#### Screenshot — 选中文本悬浮浮窗
- **场景**：在任意网页选中一段文字
- **操作**：等浮窗自动出现
- **构图**：浮窗本体 + 周围网页背景

### 截图工具（macOS）

| 需求 | 工具 |
|---|---|
| 简单截图 | `Cmd+Shift+4` 系统快捷键，框选 |
| 截图 + 标注 | CleanShot X / Shottr / Xnapper |
| 转换尺寸到 1280×800 或 640×400 | `sips -z 800 1280 input.png --out out.jpg`（按比例先截再调）|
| 不变形地裁切到目标尺寸 | 用预览 App 打开 → 工具 → 调整大小（按比例）+ 裁切 |

### 尺寸 + 格式校验

```bash
sips -g pixelWidth -g pixelHeight your-screenshot.jpg
# 期望：1280×800 或 640×400

# 强制转 24-bit JPEG（去 alpha）
sips -s format jpeg -s formatOptions high screenshot.png --out screenshot.jpg
```
