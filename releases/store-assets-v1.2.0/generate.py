#!/usr/bin/env python3
"""
触触搜 v1.2.0 商店素材生成器（comprehensive）
====================================================
用 HTML/CSS 渲染 + Chrome headless 截图，避免装 Pillow。
所有元素来自真实代码（icon、emoji、配色、slogan），零编造。

输出 4 种尺寸 × 多种主题：
- 1280×800 / 640×400 → Chrome Web Store Screenshots 槽位（最多上传 5 张）
- 440×280            → Small Promo Tile
- 1400×560           → Marquee Promo Tile

主题：
- overview（综合）  : 3 套配色（blue/warm/dark）→ 4 种尺寸都铺
- cover    (封面生成器 v1.2.0 主打) : warm 配色 × 1280/640
- pin      (侧边栏置顶 v1.2.0 主打) : warm 配色 × 1280/640
- fastqa   (速答两步流程)         : dark 配色 × 1280/640
- entries  (四端入口对比)         : blue 配色 × 1280/640
"""
import base64
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]  # 项目根目录
OUT  = REPO / 'releases' / 'store-assets-v1.2.0'
TMP  = Path('/tmp/store-tiles')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

icon_b64 = base64.b64encode((REPO / 'icons' / '128x128.png').read_bytes()).decode()
ICON = f"data:image/png;base64,{icon_b64}"

FEATURES = [
    ('🔍', '触触搜'),
    ('⚡', '速答壹拾佰'),
    ('💯', '触触搜百问'),
    ('🧠', '优化提示词'),
    ('🎨', '封面生成器'),
    ('📑', '侧边栏置顶'),
]

ENTRIES = [
    ('🖱️', '右键菜单',  '选中即点'),
    ('🪟', 'Popup 弹窗', '完整菜单'),
    ('💬', '悬浮浮窗',  '跟随选区'),
    ('📑', '侧边栏',    '常驻可置顶'),
]

SLOGAN = '选中文本，一键调用多家 AI'

THEMES = {
    'blue': {
        'bg':    'linear-gradient(135deg, #0ea5e9 0%, #0284c7 60%, #075985 100%)',
        'card':  'rgba(255,255,255,0.16)',
        'cardb': 'rgba(255,255,255,0.28)',
        'fg':    '#ffffff',
        'fg2':   'rgba(255,255,255,0.85)',
        'fg3':   'rgba(255,255,255,0.65)',
        'accent':'#fde68a',
        'tagbg': '#ffffff',
        'tagfg': '#075985',
    },
    'warm': {
        'bg':    'linear-gradient(135deg, #fef3c7 0%, #fde68a 50%, #f59e0b 100%)',
        'card':  'rgba(255,255,255,0.55)',
        'cardb': 'rgba(146, 64, 14, 0.30)',
        'fg':    '#7c2d12',
        'fg2':   '#92400e',
        'fg3':   '#a16207',
        'accent':'#dc2626',
        'tagbg': '#7c2d12',
        'tagfg': '#fef3c7',
    },
    'dark': {
        'bg':    'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)',
        'card':  'rgba(56, 189, 248, 0.10)',
        'cardb': 'rgba(56, 189, 248, 0.40)',
        'fg':    '#f1f5f9',
        'fg2':   'rgba(241, 245, 249, 0.75)',
        'fg3':   'rgba(241, 245, 249, 0.55)',
        'accent':'#38bdf8',
        'tagbg': '#38bdf8',
        'tagfg': '#0f172a',
    },
}

SIZES = {
    'small'         : (440, 280),     # promo tile - small
    'marquee'       : (1400, 560),    # promo tile - marquee
    'screenshot-lg' : (1280, 800),    # store screenshot - large
    'screenshot-sm' : (640, 400),     # store screenshot - small
}

def base_css(w, h, theme):
    return f'''
*{{margin:0;padding:0;box-sizing:border-box;-webkit-font-smoothing:antialiased}}
html,body{{width:{w}px;height:{h}px;overflow:hidden;font-family:"PingFang SC","Heiti SC","Microsoft YaHei",sans-serif}}
body{{background:{theme['bg']};color:{theme['fg']};position:relative;overflow:hidden}}
'''

# ============================================================
# 综合主题 overview — 4 种尺寸自适应
# ============================================================
def html_overview(theme, w, h):
    feats = ''.join(
        f'<div class="feat"><span class="emoji">{e}</span><span class="lbl">{n}</span></div>'
        for e, n in FEATURES
    )
    if w <= 440:
        title_sz, slogan_sz, logo_sz, gap, pad, emoji_sz, lbl_sz, sub_sz = 32, 15, 64, 6, 22, 20, 11, 12
    elif w <= 640:
        # 640×400 改走 horizontal 布局（左 logo+slogan / 右 grid），避免 vertical 时 head+slogan 把 grid 挤到不够 2 行
        title_sz, slogan_sz, logo_sz, gap, pad, emoji_sz, lbl_sz, sub_sz = 38, 18, 64, 8, 20, 28, 13, 12
    elif w <= 1280:
        title_sz, slogan_sz, logo_sz, gap, pad, emoji_sz, lbl_sz, sub_sz = 84, 38, 160, 18, 60, 56, 24, 24
    else:
        title_sz, slogan_sz, logo_sz, gap, pad, emoji_sz, lbl_sz, sub_sz = 80, 32, 140, 18, 64, 48, 18, 18

    # 640 起切换 horizontal（左右），440 维持 vertical（上下）
    layout = 'horizontal' if w >= 640 else 'vertical'
    if layout == 'horizontal':
        return f'''<!doctype html><html><head><meta charset="utf-8"><style>{base_css(w,h,theme)}
body{{display:flex;align-items:stretch;padding:{pad}px;gap:{pad-10}px}}
.left{{flex:0 0 {w//3+30}px;display:flex;flex-direction:column;justify-content:center;gap:18px}}
.head{{display:flex;align-items:center;gap:{gap+6}px}}
.logo{{width:{logo_sz}px;height:{logo_sz}px;border-radius:{logo_sz//5}px;box-shadow:0 12px 40px rgba(0,0,0,0.25);flex-shrink:0}}
.title{{font-size:{title_sz}px;font-weight:900;letter-spacing:1px;line-height:1}}
.sub{{font-size:{sub_sz}px;color:{theme['fg2']};letter-spacing:1px;margin-top:6px}}
.slogan{{font-size:{slogan_sz}px;font-weight:700;line-height:1.3}}
.right{{flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:{gap+8}px;align-content:center}}
.feat{{background:{theme['card']};border:1px solid {theme['cardb']};border-radius:{logo_sz//7}px;padding:{pad//3}px {pad//4}px;display:flex;flex-direction:column;align-items:center;gap:8px;backdrop-filter:blur(8px)}}
.emoji{{font-size:{emoji_sz}px;line-height:1}}
.lbl{{font-size:{lbl_sz}px;font-weight:600;color:{theme['fg']};white-space:nowrap}}
</style></head><body>
<div class="left">
  <div class="head"><img class="logo" src="{ICON}"><div><div class="title">触触搜</div><div class="sub">Chuchusou · v1.2.0</div></div></div>
  <div class="slogan">{SLOGAN}</div>
</div>
<div class="right">{feats}</div>
</body></html>'''
    else:
        return f'''<!doctype html><html><head><meta charset="utf-8"><style>{base_css(w,h,theme)}
body{{display:flex;flex-direction:column;padding:{pad}px}}
.head{{display:flex;align-items:center;gap:{gap+6}px;margin-bottom:8px}}
.logo{{width:{logo_sz}px;height:{logo_sz}px;border-radius:{logo_sz//5}px;box-shadow:0 6px 18px rgba(0,0,0,0.18);flex-shrink:0}}
.title{{font-size:{title_sz}px;font-weight:800;letter-spacing:0.5px;line-height:1.05}}
.sub{{font-size:{sub_sz}px;color:{theme['fg2']};letter-spacing:0.3px}}
.slogan{{font-size:{slogan_sz}px;font-weight:600;margin:6px 0 12px;line-height:1.3}}
.grid{{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:1fr 1fr;gap:{gap}px;flex:1;min-height:0}}
.feat{{background:{theme['card']};border:1px solid {theme['cardb']};border-radius:10px;padding:8px 6px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-height:0;overflow:hidden}}
.emoji{{font-size:{emoji_sz}px;line-height:1}}
.lbl{{font-size:{lbl_sz}px;font-weight:500;color:{theme['fg2']};white-space:nowrap}}
</style></head><body>
<div class="head"><img class="logo" src="{ICON}"><div><div class="title">触触搜</div><div class="sub">Chuchusou · v1.2.0</div></div></div>
<div class="slogan">{SLOGAN}</div>
<div class="grid">{feats}</div>
</body></html>'''

# ============================================================
# 专题：封面生成器 cover (warm)
# ============================================================
def html_cover(theme, w, h):
    is_lg = w >= 1000
    p = 80 if is_lg else 36
    title_sz = 88 if is_lg else 44
    sub_sz = 28 if is_lg else 17
    body_sz = 26 if is_lg else 14
    badge_sz = 20 if is_lg else 12
    arrow_sz = 56 if is_lg else 24
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>{base_css(w,h,theme)}
body{{display:flex;flex-direction:column;justify-content:center;padding:{p}px;gap:{p//4}px}}
.badge{{display:inline-block;background:{theme['tagbg']};color:{theme['tagfg']};padding:{badge_sz//4}px {int(badge_sz//1.2)}px;border-radius:{badge_sz}px;font-size:{badge_sz}px;font-weight:700;letter-spacing:1.5px;align-self:flex-start}}
.title{{font-size:{title_sz}px;font-weight:900;line-height:1;display:flex;align-items:center;gap:{title_sz//4}px}}
.sub{{font-size:{sub_sz}px;color:{theme['fg2']};font-weight:600;line-height:1.4}}
.flow{{display:flex;align-items:center;gap:{p//4}px;margin-top:{p//4}px;flex-wrap:wrap}}
.step{{background:{theme['card']};border:2px solid {theme['cardb']};border-radius:{p//4}px;padding:{p//4}px {int(p//2.5)}px;font-size:{body_sz}px;font-weight:600;color:{theme['fg']};text-align:center}}
.arrow{{font-size:{arrow_sz}px;color:{theme['fg2']};font-weight:300}}
.styles{{display:flex;gap:{p//4}px;margin-top:{p//6}px;flex-wrap:wrap}}
.tag{{background:{theme['tagbg']};color:{theme['tagfg']};padding:{body_sz//3}px {int(body_sz//1.2)}px;border-radius:{body_sz}px;font-size:{body_sz}px;font-weight:700}}
.tag.muted{{opacity:0.45}}
</style></head><body>
<span class="badge">v1.2.0 NEW</span>
<div class="title"><span>🎨</span><span>封面生成器</span></div>
<div class="sub">选中标题文本 → 一键调用 ChatGPT Images 2.0 → 渲染封面图</div>
<div class="flow">
  <div class="step">📝 选中文本</div>
  <div class="arrow">→</div>
  <div class="step">⚡ 一键触发</div>
  <div class="arrow">→</div>
  <div class="step">🖼️ ChatGPT Images 2.0</div>
</div>
<div class="styles">
  <span class="tag">🔴 小红书封面</span>
  <span class="tag">🥥 椰树牌风格</span>
  <span class="tag muted">+ 更多扩展中</span>
</div>
</body></html>'''

# ============================================================
# 专题：侧边栏置顶 pin (warm)
# ============================================================
def html_pin(theme, w, h):
    is_lg = w >= 1000
    p = 80 if is_lg else 36
    title_sz = 88 if is_lg else 44
    sub_sz = 28 if is_lg else 17
    body_sz = 24 if is_lg else 14
    badge_sz = 20 if is_lg else 12
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>{base_css(w,h,theme)}
body{{display:flex;flex-direction:column;justify-content:center;padding:{p}px;gap:{p//5}px}}
.badge{{display:inline-block;background:{theme['tagbg']};color:{theme['tagfg']};padding:{badge_sz//4}px {int(badge_sz//1.2)}px;border-radius:{badge_sz}px;font-size:{badge_sz}px;font-weight:700;letter-spacing:1.5px;align-self:flex-start}}
.title{{font-size:{title_sz}px;font-weight:900;line-height:1;display:flex;align-items:center;gap:{title_sz//4}px}}
.sub{{font-size:{sub_sz}px;color:{theme['fg2']};font-weight:600;line-height:1.4;margin-bottom:{p//5}px}}
.bullets{{display:flex;flex-direction:column;gap:{int(body_sz//1.5)}px}}
.b{{display:flex;align-items:center;gap:{int(body_sz//1.5)}px;font-size:{body_sz}px;color:{theme['fg']};font-weight:600}}
.dot{{width:{int(body_sz//1.5)}px;height:{int(body_sz//1.5)}px;background:{theme['fg']};border-radius:50%;flex-shrink:0}}
.demo{{margin-top:{p//4}px;background:{theme['card']};border:2px solid {theme['cardb']};border-radius:{p//4}px;padding:{body_sz}px;display:flex;align-items:center;gap:{body_sz}px}}
.demo-ic{{font-size:{int(title_sz//1.8)}px;flex-shrink:0}}
.demo-text{{flex:1;min-width:0}}
.demo-l1{{font-size:{int(body_sz//1.6)}px;color:{theme['fg2']};font-weight:600;margin-bottom:4px;letter-spacing:0.5px}}
.demo-l2{{font-size:{body_sz}px;color:{theme['fg']};font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
.demo-edit{{font-size:{body_sz}px;width:{body_sz*2}px;height:{body_sz*2}px;background:{theme['card']};border:2px solid {theme['cardb']};border-radius:{body_sz//2}px;display:flex;align-items:center;justify-content:center;flex-shrink:0}}
</style></head><body>
<span class="badge">v1.2.0 NEW</span>
<div class="title"><span>📑</span><span>侧边栏置顶</span></div>
<div class="sub">把最常用的动作钉在侧边栏顶部，一键直达</div>
<div class="bullets">
  <div class="b"><span class="dot"></span>默认置顶 · 封面生成器 · 小红书风格</div>
  <div class="b"><span class="dot"></span>✏️ 修改按钮 · 一键切换风格</div>
  <div class="b"><span class="dot"></span>chrome.storage.local · 跨会话持久化</div>
</div>
<div class="demo">
  <span class="demo-ic">🎨</span>
  <div class="demo-text">
    <div class="demo-l1">CHUCHUSOU · COVER</div>
    <div class="demo-l2">🔴 小红书封面</div>
  </div>
  <div class="demo-edit">✏️</div>
</div>
</body></html>'''

# ============================================================
# 专题：速答两步流程 fastqa (dark)
# ============================================================
def html_fastqa(theme, w, h):
    is_lg = w >= 1000
    p = 80 if is_lg else 36
    title_sz = 88 if is_lg else 44
    sub_sz = 26 if is_lg else 16
    body_sz = 22 if is_lg else 13
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>{base_css(w,h,theme)}
body{{display:flex;flex-direction:column;justify-content:center;padding:{p}px;gap:{p//5}px}}
.title{{font-size:{title_sz}px;font-weight:900;line-height:1;display:flex;align-items:center;gap:{title_sz//4}px}}
.sub{{font-size:{sub_sz}px;color:{theme['fg2']};font-weight:600;line-height:1.4;margin-bottom:{p//4}px}}
.steps{{display:flex;flex-direction:column;gap:{int(body_sz//1.2)}px}}
.step{{background:{theme['card']};border:2px solid {theme['cardb']};border-radius:{p//5}px;padding:{body_sz}px {int(body_sz*1.3)}px;display:flex;align-items:flex-start;gap:{body_sz}px}}
.num{{width:{body_sz*2}px;height:{body_sz*2}px;background:{theme['accent']};color:#0f172a;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:{int(body_sz*1.2)}px;font-weight:900;flex-shrink:0}}
.step-content{{flex:1}}
.step-title{{font-size:{int(body_sz*1.2)}px;font-weight:700;color:{theme['fg']};margin-bottom:{body_sz//4}px}}
.step-detail{{font-size:{body_sz}px;color:{theme['fg2']};line-height:1.5}}
</style></head><body>
<div class="title"><span>⚡</span><span>速答壹拾佰</span></div>
<div class="sub">一题多 AI 对比 · 智能两步流程</div>
<div class="steps">
  <div class="step"><div class="num">1</div><div class="step-content"><div class="step-title">先输出短篇 + 中篇</div><div class="step-detail">短篇 80 字内具备标题感 · 中篇约 10 句完整阐述</div></div></div>
  <div class="step"><div class="num">2</div><div class="step-content"><div class="step-title">末尾追加 A / B 两选项</div><div class="step-detail">A · 续写长篇正文（无追问，便于复制使用）<br>B · 把短/中篇润色为更自然的真实表达</div></div></div>
</div>
</body></html>'''

# ============================================================
# 专题：四端入口 entries (blue)
# ============================================================
def html_entries(theme, w, h):
    is_lg = w >= 1000
    p = 80 if is_lg else 36
    title_sz = 80 if is_lg else 38
    sub_sz = 26 if is_lg else 16
    card_emoji = 64 if is_lg else 32
    card_title = 26 if is_lg else 16
    card_desc = 18 if is_lg else 11
    cards = ''.join(
        f'<div class="card"><div class="ce">{e}</div><div class="ct">{n}</div><div class="cd">{d}</div></div>'
        for e, n, d in ENTRIES
    )
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>{base_css(w,h,theme)}
body{{display:flex;flex-direction:column;justify-content:center;padding:{p}px;gap:{p//4}px}}
.title{{font-size:{title_sz}px;font-weight:900;line-height:1;display:flex;align-items:center;gap:{title_sz//4}px}}
.sub{{font-size:{sub_sz}px;color:{theme['fg2']};font-weight:600;margin-bottom:{p//4}px}}
.grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:{p//5}px;flex:1}}
.card{{background:{theme['card']};border:2px solid {theme['cardb']};border-radius:{p//4}px;padding:{p//4}px {p//5}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:{p//8}px;text-align:center;backdrop-filter:blur(8px)}}
.ce{{font-size:{card_emoji}px;line-height:1}}
.ct{{font-size:{card_title}px;font-weight:700;color:{theme['fg']}}}
.cd{{font-size:{card_desc}px;color:{theme['fg2']};font-weight:500}}
</style></head><body>
<div class="title"><span>🌐</span><span>四种入口任选</span></div>
<div class="sub">同一套功能 · 不同场景灵活切换</div>
<div class="grid">{cards}</div>
</body></html>'''

# ============================================================
# Render pipeline
# ============================================================
def render(html_path, png_path, w, h):
    """Chrome headless 渲染。多给 80 高度避免 macOS viewport bottom 空白 bug，后面 sips 裁回精准尺寸"""
    cmd = [
        CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
        f'--window-size={w},{h+80}',
        '--force-device-scale-factor=1',
        f'--screenshot={png_path}',
        f'file://{html_path}',
    ]
    subprocess.run(cmd, capture_output=True, text=True, timeout=30, check=False)

def to_jpeg(png_path, jpg_path, w, h):
    """先用 sips 裁切到精准尺寸，再转 24-bit JPEG（去 alpha）"""
    # 裁切原图（左上角对齐）到目标尺寸
    subprocess.run(['sips', '-c', str(h), str(w), str(png_path)], capture_output=True, check=True)
    # 转 JPEG 高质量
    subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', 'high',
                    str(png_path), '--out', str(jpg_path)],
                   capture_output=True, check=True)

def verify(path, w, h):
    out = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', str(path)],
                         capture_output=True, text=True)
    ok = (f'pixelWidth: {w}' in out.stdout and f'pixelHeight: {h}' in out.stdout)
    return f'{w}×{h} ✓' if ok else f'⚠️ 错: {out.stdout.splitlines()[1:]}'

JOBS = [
    # 综合主题：4 种尺寸都铺，3 种配色
    ('blue', 'overview', html_overview, list(SIZES.items())),
    ('warm', 'overview', html_overview, list(SIZES.items())),
    ('dark', 'overview', html_overview, list(SIZES.items())),
    # 专题：每个 1 配色 × 2 screenshot 尺寸
    ('warm', 'cover',   html_cover,   [('screenshot-lg', SIZES['screenshot-lg']), ('screenshot-sm', SIZES['screenshot-sm'])]),
    ('warm', 'pin',     html_pin,     [('screenshot-lg', SIZES['screenshot-lg']), ('screenshot-sm', SIZES['screenshot-sm'])]),
    ('dark', 'fastqa',  html_fastqa,  [('screenshot-lg', SIZES['screenshot-lg']), ('screenshot-sm', SIZES['screenshot-sm'])]),
    ('blue', 'entries', html_entries, [('screenshot-lg', SIZES['screenshot-lg']), ('screenshot-sm', SIZES['screenshot-sm'])]),
]

TMP.mkdir(exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

# 清理旧 jpg（保留 README/script）
for old in OUT.glob('*.jpg'):
    old.unlink()

print(f'输出目录: {OUT}')
print('=' * 70)

count = 0
for theme_id, content_id, fn, sizes in JOBS:
    theme = THEMES[theme_id]
    print(f'\n[{theme_id} · {content_id}]')
    for size_id, (w, h) in sizes:
        html_path = TMP / f'{theme_id}_{content_id}_{size_id}.html'
        png_path  = TMP / f'{theme_id}_{content_id}_{size_id}.png'
        jpg_name  = f'{theme_id}-{content_id}-{w}x{h}.jpg'
        jpg_path  = OUT / jpg_name

        html_path.write_text(fn(theme, w, h), encoding='utf-8')
        render(str(html_path), str(png_path), w, h)
        to_jpeg(png_path, jpg_path, w, h)
        size_kb = jpg_path.stat().st_size // 1024
        print(f'  ✓ {jpg_name:<48s} {verify(jpg_path, w, h):<14s} {size_kb} KB')
        count += 1

print('\n' + '=' * 70)
print(f'完成。共 {count} 张 JPEG，输出到 {OUT}')
