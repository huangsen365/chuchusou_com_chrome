#!/usr/bin/env bash
# ==============================================================================
# 触触搜 popup cold-start 性能测试启动器
#
# 干净 Chrome profile + 自动 load 本项目 + 自动开 DevTools，最大化复现
# "线上用户首装第一次打开 popup" 的 cold-start 场景。
#
# 用法：
#   ./scripts/test-perf.sh           # 默认：用 build/chrome-mv3-prod（plasmo build 产物）
#   ./scripts/test-perf.sh --rebuild # 强制先跑 npm run plasmo:build
#   ./scripts/test-perf.sh --source  # 直接 load 项目根（开发场景对照）
#
# 退出时按 Ctrl+C 即可，临时 profile 会自动清理。
# ==============================================================================

set -euo pipefail

# 项目根
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$PROJECT_DIR/build/chrome-mv3-prod"

# 命令行参数
MODE="build"
for arg in "$@"; do
  case "$arg" in
    --rebuild) MODE="rebuild" ;;
    --source)  MODE="source"  ;;
    --help|-h)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "未知参数：$arg（--rebuild / --source / --help）" >&2
      exit 1
      ;;
  esac
done

# 颜色
C_RED='\033[31m'
C_GRN='\033[32m'
C_YLW='\033[33m'
C_CYN='\033[36m'
C_GRY='\033[90m'
C_BLD='\033[1m'
C_RST='\033[0m'

echo -e "${C_BLD}${C_CYN}━━━ 触触搜 popup cold-start 性能测试 ━━━${C_RST}"

# ------------------------------------------------------------------------------
# 1. 确定要 load 哪个目录
# ------------------------------------------------------------------------------

case "$MODE" in
  source)
    EXT_DIR="$PROJECT_DIR"
    echo -e "${C_YLW}模式：source（直接 load 项目根）${C_RST}"
    ;;
  rebuild)
    echo -e "${C_YLW}模式：rebuild（强制 plasmo build）${C_RST}"
    cd "$PROJECT_DIR"
    npm run plasmo:build
    EXT_DIR="$BUILD_DIR"
    ;;
  build|*)
    if [ -d "$BUILD_DIR" ] && [ -f "$BUILD_DIR/manifest.json" ]; then
      echo -e "${C_GRN}使用已有 build：$BUILD_DIR${C_RST}"
      EXT_DIR="$BUILD_DIR"
    else
      echo -e "${C_YLW}build/ 不存在，跑 plasmo:build...${C_RST}"
      cd "$PROJECT_DIR"
      npm run plasmo:build
      EXT_DIR="$BUILD_DIR"
    fi
    ;;
esac

# 校验
if [ ! -f "$EXT_DIR/manifest.json" ]; then
  echo -e "${C_RED}✗ 找不到 $EXT_DIR/manifest.json${C_RST}"
  exit 1
fi

EXT_VERSION="$(python3 -c "import json; print(json.load(open('$EXT_DIR/manifest.json'))['version'])" 2>/dev/null || echo "?")"
echo -e "  扩展版本：${C_BLD}v${EXT_VERSION}${C_RST}"
echo -e "  加载路径：${C_GRY}$EXT_DIR${C_RST}"

# ------------------------------------------------------------------------------
# 2. 找到 Chrome 可执行文件
# ------------------------------------------------------------------------------

CHROME_BIN=""
for c in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
  if [ -x "$c" ]; then
    CHROME_BIN="$c"
    break
  fi
done

if [ -z "$CHROME_BIN" ]; then
  echo -e "${C_RED}✗ 找不到 Chrome。请确认已装 Google Chrome 在 /Applications/${C_RST}"
  exit 1
fi
echo -e "  Chrome 路径：${C_GRY}$CHROME_BIN${C_RST}"

# ------------------------------------------------------------------------------
# 3. 干净的临时 profile
# ------------------------------------------------------------------------------

TS="$(date +%Y%m%d-%H%M%S)"
USER_DATA_DIR="/tmp/ccs-perf-${TS}"
mkdir -p "$USER_DATA_DIR"
echo -e "  临时 profile：${C_GRY}$USER_DATA_DIR${C_RST}"

# Ctrl+C 时自动清理
cleanup() {
  echo ""
  echo -e "${C_YLW}清理临时 profile...${C_RST}"
  rm -rf "$USER_DATA_DIR"
  echo -e "${C_GRN}✓ 完成${C_RST}"
}
trap cleanup EXT INT TERM

# ------------------------------------------------------------------------------
# 4. 把性能测量命令塞进剪贴板（macOS pbcopy）
# ------------------------------------------------------------------------------

PERF_CMD='(()=>{const m=performance.getEntriesByType("mark").map(e=>({m:e.name,t:Math.round(e.startTime)}));const r=performance.getEntriesByType("resource").map(e=>({n:e.name.split("/").pop().split("?")[0],d:Math.round(e.duration),s:e.transferSize||e.encodedBodySize||0,t:e.initiatorType}));const nav=performance.getEntriesByType("navigation")[0];const total=nav?Math.round(nav.domContentLoadedEventEnd):null;const summary={popup_DOMContentLoaded_ms:total,resources_count:r.length,resources_total_bytes:r.reduce((a,b)=>a+b.s,0),resources:r,perf_marks:m};console.log(JSON.stringify(summary,null,2));copy(JSON.stringify(summary,null,2));console.log("%c✓ 已复制到剪贴板","color:green;font-weight:bold");return summary;})();'

if command -v pbcopy >/dev/null 2>&1; then
  echo -n "$PERF_CMD" | pbcopy
  CLIPBOARD_OK=1
else
  CLIPBOARD_OK=0
fi

# 也写到一个文件方便手动拷
PERF_CMD_FILE="$USER_DATA_DIR/perf-cmd.txt"
echo "$PERF_CMD" > "$PERF_CMD_FILE"

# ------------------------------------------------------------------------------
# 5. 打印操作指引
# ------------------------------------------------------------------------------

echo ""
echo -e "${C_BLD}${C_CYN}━━━ 操作指引（一共 3 步）━━━${C_RST}"
echo ""
echo -e "${C_BLD}步骤 1${C_RST}：Chrome 即将打开。等 3 秒确保扩展装好。"
echo -e "        ${C_GRY}（onInstalled 跑完，prewarm 写入 storage，模拟首装用户）${C_RST}"
echo ""
echo -e "${C_BLD}步骤 2${C_RST}：${C_YLW}先关掉 Chrome${C_RST}（⌘Q），再用 ${C_YLW}/usr/bin/open${C_RST} 重新打开同一个 profile，"
echo -e "        让 SW 真正进入 ${C_RED}冷启动${C_RST} 状态。"
echo -e "        ${C_GRY}（重启脚本会在下面提供；不重启也能测，但贴近线上没那么真）${C_RST}"
echo ""
echo -e "${C_BLD}步骤 3${C_RST}：点击 toolbar 上的 ${C_YLW}🔍 触触搜${C_RST} 扩展图标 → popup 弹出。"
echo -e "        在 popup 上 ${C_YLW}右键 → 检查${C_RST} 打开 DevTools（或 Cmd+Shift+I）。"
echo -e "        在 Console 里 ${C_YLW}粘贴并回车${C_RST}（命令已在剪贴板）："
echo ""
if [ "$CLIPBOARD_OK" = "1" ]; then
  echo -e "        ${C_GRN}✓ 性能测量命令已复制到剪贴板${C_RST}"
else
  echo -e "        ${C_YLW}⚠ 剪贴板复制失败，命令也写到了 $PERF_CMD_FILE${C_RST}"
fi
echo -e "        ${C_GRY}（命令会自动打印 + 复制 JSON 报告到剪贴板）${C_RST}"
echo ""
echo -e "${C_BLD}步骤 4${C_RST}：把那段 JSON 粘给我，我来分析。"
echo ""

# ------------------------------------------------------------------------------
# 6. 启动 Chrome
# ------------------------------------------------------------------------------

CHROME_FLAGS=(
  --user-data-dir="$USER_DATA_DIR"
  --load-extension="$EXT_DIR"
  --no-first-run
  --no-default-browser-check
  --disable-features=DefaultBrowserCheck,FirstRunReleaseNotes
  --new-window
  "chrome://extensions/"
)

echo -e "${C_GRY}启动 Chrome...（关掉这个 Chrome 窗口或按 Ctrl+C 退出测试）${C_RST}"
echo ""

# 为了方便用户能"关掉再开"，把启动命令也打印出来
RESTART_CMD="$CHROME_BIN --user-data-dir=\"$USER_DATA_DIR\" --load-extension=\"$EXT_DIR\" --no-first-run --new-window"
echo -e "${C_BLD}如需"关掉 Chrome 再重开同一 profile"${C_RST}（步骤 2，制造 SW 冷启动）："
echo -e "${C_GRY}  $RESTART_CMD${C_RST}"
echo ""

"$CHROME_BIN" "${CHROME_FLAGS[@]}"
