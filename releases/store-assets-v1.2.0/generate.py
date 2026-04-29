#!/usr/bin/env python3
"""
触触搜 v1.2.0 商店宣传图生成器
用 HTML/CSS 渲染 + Chrome headless 截图，避免装 Pillow。
所有元素来自真实代码（icon、emoji、配色、slogan），不编造。
"""
import base64
import os
import subprocess
import sys
from pathlib import Path

REPO = Path('/Users/huangwin/Library/CloudStorage/OneDrive-个人/Projects/DAYS/20250826/chuchusou_com_chrome')
OUT  = REPO / 'releases' / 'store-assets-v1.2.0'
TMP  = Path('/tmp/store-tiles')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

# 真实 icon 内联（来自 icons/128x128.png）
icon_b64 = base64.b64encode((REPO / 'icons' / '128x128.png').read_bytes()).decode()
ICON_DATA = f"data:image/png;base64,{icon_b64}"

# 6 个真实功能（来自 Constants.js MENU_DEFINITIONS / unifiedMenuConfig.json）
FEATURES = [
    ('🔍', '触触搜'),
    ('⚡', '速答壹拾佰'),
    ('💯', '触触搜百问'),
    ('🧠', '优化提示词'),
    ('🎨', '封面生成器'),
    ('📑', '侧边栏置顶'),
]

# Slogan 来自 releases/v1.2.0.md 商店描述
SLOGAN = '选中文本，一键调用多家 AI'
SUB    = '右键 / 弹窗 / 浮窗 / 侧边栏 四端可用'

# ============== 三套配色 ==============
THEMES = {
    'blue': {
        'name':  'Blue · 主色调',
        'bg':    'linear-gradient(135deg, #0ea5e9 0%, #0284c7 60%, #075985 100%)',
        'card':  'rgba(255,255,255,0.16)',
        'cardb': 'rgba(255,255,255,0.28)',
        'fg':    '#ffffff',
        'fg2':   'rgba(255,255,255,0.85)',
        'accent':'#fde68a',
    },
    'warm': {
        'name':  'Warm · v1.2.0 调性（突出封面生成器）',
        'bg':    'linear-gradient(135deg, #fef3c7 0%, #fde68a 50%, #f59e0b 100%)',
        'card':  'rgba(255,255,255,0.55)',
        'cardb': 'rgba(146, 64, 14, 0.30)',
        'fg':    '#7c2d12',
        'fg2':   '#92400e',
        'accent':'#dc2626',
    },
    'dark': {
        'name':  'Dark · AI 工具调',
        'bg':    'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)',
        'card':  'rgba(56, 189, 248, 0.10)',
        'cardb': 'rgba(56, 189, 248, 0.40)',
        'fg':    '#f1f5f9',
        'fg2':   'rgba(241, 245, 249, 0.75)',
        'accent':'#38bdf8',
    },
}

# ============== HTML 模板 ==============
def html_small(theme):
    """440 × 280 — Small Promo Tile"""
    feats = ''.join(
        f'<div class="feat"><span class="emoji">{e}</span><span class="lbl">{n}</span></div>'
        for e, n in FEATURES
    )
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
*{{margin:0;padding:0;box-sizing:border-box;-webkit-font-smoothing:antialiased}}
html,body{{width:440px;height:280px;overflow:hidden;font-family:"PingFang SC","Heiti SC","Microsoft YaHei",sans-serif}}
body{{background:{theme['bg']};color:{theme['fg']};display:flex;flex-direction:column;padding:20px 22px;position:relative;overflow:hidden}}
.head{{display:flex;align-items:center;gap:14px;margin-bottom:10px}}
.logo{{width:64px;height:64px;border-radius:14px;box-shadow:0 6px 18px rgba(0,0,0,0.18);flex-shrink:0}}
.brand{{display:flex;flex-direction:column;gap:2px}}
.title{{font-size:32px;font-weight:800;letter-spacing:0.5px;line-height:1.05}}
.sub{{font-size:12px;color:{theme['fg2']};letter-spacing:0.3px}}
.slogan{{font-size:15px;font-weight:600;margin:6px 0 12px;line-height:1.3}}
.grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}}
.feat{{background:{theme['card']};border:1px solid {theme['cardb']};border-radius:10px;padding:8px 6px;display:flex;flex-direction:column;align-items:center;gap:3px}}
.emoji{{font-size:20px;line-height:1}}
.lbl{{font-size:11px;font-weight:500;color:{theme['fg2']};white-space:nowrap}}
</style></head><body>
<div class="head"><img class="logo" src="{ICON_DATA}"><div class="brand"><div class="title">触触搜</div><div class="sub">Chuchusou · v1.2.0</div></div></div>
<div class="slogan">{SLOGAN}</div>
<div class="grid">{feats}</div>
</body></html>'''

def html_marquee(theme):
    """1400 × 560 — Marquee Promo Tile"""
    feats = ''.join(
        f'<div class="feat"><span class="emoji">{e}</span><span class="lbl">{n}</span></div>'
        for e, n in FEATURES
    )
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
*{{margin:0;padding:0;box-sizing:border-box;-webkit-font-smoothing:antialiased}}
html,body{{width:1400px;height:560px;overflow:hidden;font-family:"PingFang SC","Heiti SC","Microsoft YaHei",sans-serif}}
body{{background:{theme['bg']};color:{theme['fg']};display:flex;align-items:stretch;padding:64px 80px;gap:60px;position:relative;overflow:hidden}}
.left{{flex:0 0 460px;display:flex;flex-direction:column;justify-content:center;gap:20px}}
.head{{display:flex;align-items:center;gap:24px}}
.logo{{width:140px;height:140px;border-radius:28px;box-shadow:0 12px 40px rgba(0,0,0,0.25);flex-shrink:0}}
.brand{{display:flex;flex-direction:column;gap:4px}}
.title{{font-size:80px;font-weight:900;letter-spacing:1px;line-height:1}}
.sub{{font-size:18px;color:{theme['fg2']};letter-spacing:1px}}
.slogan{{font-size:32px;font-weight:700;line-height:1.3}}
.subline{{font-size:18px;color:{theme['fg2']};line-height:1.5}}
.right{{flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:18px;align-content:center}}
.feat{{background:{theme['card']};border:1px solid {theme['cardb']};border-radius:18px;padding:24px 16px;display:flex;flex-direction:column;align-items:center;gap:10px;backdrop-filter:blur(8px)}}
.emoji{{font-size:48px;line-height:1}}
.lbl{{font-size:18px;font-weight:600;color:{theme['fg']}}}
</style></head><body>
<div class="left">
  <div class="head"><img class="logo" src="{ICON_DATA}"><div class="brand"><div class="title">触触搜</div><div class="sub">Chuchusou · v1.2.0</div></div></div>
  <div class="slogan">{SLOGAN}</div>
  <div class="subline">{SUB}</div>
</div>
<div class="right">{feats}</div>
</body></html>'''

# ============== 渲染 ==============
def render(html_path, png_path, w, h):
    """用 Chrome headless 把 HTML 渲染成 PNG"""
    cmd = [
        CHROME,
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--default-background-color=00000000',  # 防止背景填充
        f'--window-size={w},{h}',
        '--force-device-scale-factor=1',
        f'--screenshot={png_path}',
        f'file://{html_path}',
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        print(f'  ⚠️ Chrome stderr: {result.stderr[:200]}')

def to_jpeg_no_alpha(png_path, jpg_path):
    """sips 把 PNG 转 24-bit JPEG（自动去 alpha）"""
    subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', 'high',
                    str(png_path), '--out', str(jpg_path)],
                   capture_output=True, check=True)

def verify_size(path, expected_w, expected_h):
    """sips 读图片尺寸验证"""
    out = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', str(path)],
                         capture_output=True, text=True)
    return f'{expected_w}×{expected_h}' if (f'pixelWidth: {expected_w}' in out.stdout and
                                              f'pixelHeight: {expected_h}' in out.stdout) else f'⚠️ 尺寸不匹配: {out.stdout}'

# ============== 主流程 ==============
TMP.mkdir(exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

specs = [
    ('small',   440,  280, html_small),
    ('marquee', 1400, 560, html_marquee),
]

print(f'输出目录: {OUT}')
print('=' * 60)

for theme_id, theme in THEMES.items():
    print(f'\n[{theme_id}] {theme["name"]}')
    for kind, w, h, fn in specs:
        html_path = TMP / f'{theme_id}_{kind}.html'
        png_path  = TMP / f'{theme_id}_{kind}.png'
        jpg_name  = f'{theme_id}-{kind}-{w}x{h}.jpg'
        jpg_path  = OUT / jpg_name

        html_path.write_text(fn(theme), encoding='utf-8')
        render(str(html_path), str(png_path), w, h)
        to_jpeg_no_alpha(png_path, jpg_path)
        print(f'  ✓ {jpg_name:<40s} {verify_size(jpg_path, w, h)}  ({jpg_path.stat().st_size//1024} KB)')

print('\n' + '=' * 60)
print(f'完成。输出 6 张 JPEG 到 {OUT}')
