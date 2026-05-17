#!/bin/bash

# 触触搜 Chrome 扩展 - Plasmo-based 发布打包脚本
# 用法: ./build.sh [version]
# 不传 version 则从 manifest.json 读取
#
# 流程：
#   1. npm run plasmo:build —— 走 Plasmo 完整构建 + compat postbuild + verify
#      （Plasmo 编译 src/* 出 bundles，postbuild 把 legacy 文件复制进 build/，
#        把 manifest 入口按 legacy/Plasmo 选项 patched 好，verify 检查 33 个
#        manifest-referenced 文件齐全 + JS 语法合法）
#   2. 写入版本号到 build/chrome-mv3-prod/manifest.json
#   3. 打 zip 到 ../chuchusou_chrome_extension_v{version}.zip
#   4. 输出统计 + 安装指引
#
# 与旧 build.sh 的关键区别：
#   旧: 直接从 PROJECT_DIR rsync 文件，绕过 Plasmo 完全独立打包
#   新: zip 内容 = npm run plasmo:build 的 build/chrome-mv3-prod/ 完整产物
#       Plasmo 是真正的 SSoT，build.sh 只是 thin wrapper

set -e

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "$PROJECT_DIR")"
BUILD_DIR="$PROJECT_DIR/build/chrome-mv3-prod"

# 版本号：参数 > manifest.json
ARG_VERSION="$1"
MANIFEST_VERSION="$(python3 -c "import json; print(json.load(open('$PROJECT_DIR/manifest.json'))['version'])")"
VERSION="${ARG_VERSION:-$MANIFEST_VERSION}"

PLUGIN_NAME="chuchusou_chrome_extension"
ZIP_NAME="${PLUGIN_NAME}_v${VERSION}.zip"
FINAL_ZIP="${PARENT_DIR}/${ZIP_NAME}"

print_message() { echo -e "${2}${1}${NC}"; }

print_header() {
  echo ""
  print_message "========================================" "${BLUE}"
  print_message "    触触搜 Plasmo Build & Pack" "${BLUE}"
  print_message "    版本: v${VERSION}" "${BLUE}"
  print_message "    输出: ${FINAL_ZIP}" "${BLUE}"
  print_message "========================================" "${BLUE}"
  echo ""
}

run_plasmo_build() {
  print_message "🚀 npm run plasmo:build" "${YELLOW}"
  cd "$PROJECT_DIR"
  npm run plasmo:build
  if [ ! -d "$BUILD_DIR" ]; then
    print_message "❌ Plasmo build 后没有 $BUILD_DIR" "${RED}"
    exit 1
  fi
  print_message "  ✓ Plasmo build OK" "${GREEN}"
}

sync_version_to_build_manifest() {
  print_message "\n🔄 同步版本号 v${VERSION} 到 build/manifest.json" "${YELLOW}"
  python3 -c "
import json
p = '$BUILD_DIR/manifest.json'
m = json.load(open(p))
m['version'] = '$VERSION'
json.dump(m, open(p, 'w'), ensure_ascii=False, indent=2)
print('  build manifest.version =', m['version'])
"
}

create_zip() {
  print_message "\n📦 打 ZIP" "${YELLOW}"
  rm -f "$FINAL_ZIP"
  ( cd "$BUILD_DIR" && zip -r "$FINAL_ZIP" . -q -x "*.DS_Store" "*.bak" "*.bak.*" )
  if [ -f "$FINAL_ZIP" ]; then
    local size
    size=$(du -h "$FINAL_ZIP" | cut -f1)
    print_message "  ✓ ${FINAL_ZIP} (${size})" "${GREEN}"
  else
    print_message "  ❌ 打包失败" "${RED}"
    exit 1
  fi
}

show_zip_summary() {
  print_message "\n📋 ZIP 内容统计" "${YELLOW}"
  local count
  count=$(unzip -l "$FINAL_ZIP" | tail -n 1 | awk '{print $2}')
  print_message "  共 ${count} 个文件" "${GREEN}"
  print_message "\n  顶层文件" "${BLUE}"
  unzip -l "$FINAL_ZIP" | awk 'NR>3 && $4 !~ /\// && $4 != "" {print "    " $4}' | sort -u | head -20
  print_message "\n  顶层目录" "${BLUE}"
  unzip -l "$FINAL_ZIP" | awk 'NR>3 && $4 ~ /\// {split($4, p, "/"); print "    " p[1] "/"}' | sort -u
}

generate_instructions() {
  print_message "\n📖 安装/上传" "${BLUE}"
  echo ""
  echo "  本地安装："
  echo "    1. chrome://extensions/"
  echo "    2. 开启「开发者模式」"
  echo "    3. 「加载已解压」选择 $BUILD_DIR，或拖拽 ${FINAL_ZIP}"
  echo ""
  echo "  上架 Chrome Web Store："
  echo "    https://chrome.google.com/webstore/devconsole"
  echo "    上传 ${FINAL_ZIP}，填发布说明（见 releases/v${VERSION}.md）"
  echo ""
}

main() {
  print_header
  if [ ! -f "$PROJECT_DIR/manifest.json" ]; then
    print_message "错误: 项目目录无 manifest.json" "${RED}"
    exit 1
  fi
  run_plasmo_build
  sync_version_to_build_manifest
  create_zip
  show_zip_summary
  generate_instructions
  print_message "\n✨ Plasmo 打包完成" "${GREEN}"
}

main
