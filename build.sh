#!/bin/bash

# 触触搜 Chrome 插件打包脚本
# 用法: ./build.sh [version]
# 示例: ./build.sh 1.2.0
# 不传 version 则从 manifest.json 读取
#
# 输出目录：项目所在的"上一层目录"（与项目并列），文件名 chuchusou_chrome_extension_v{version}.zip
# 设计原则：白名单复制（manifest 实际引用的文件 + 资源），避免遗漏 / 误带

set -e

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 项目根目录与上一层
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "$PROJECT_DIR")"

# 版本号：参数 > manifest.json
ARG_VERSION="$1"
MANIFEST_VERSION="$(grep -E '"version"' "$PROJECT_DIR/manifest.json" | head -n1 | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
VERSION="${ARG_VERSION:-$MANIFEST_VERSION}"

PLUGIN_NAME="chuchusou_chrome_extension"
BUILD_DIR="/tmp/${PLUGIN_NAME}_build_${VERSION}"
ZIP_NAME="${PLUGIN_NAME}_v${VERSION}.zip"
FINAL_ZIP="${PARENT_DIR}/${ZIP_NAME}"

print_message() { echo -e "${2}${1}${NC}"; }

print_header() {
  echo ""
  print_message "========================================" "${BLUE}"
  print_message "    触触搜 Chrome 插件打包工具" "${BLUE}"
  print_message "    版本: v${VERSION}" "${BLUE}"
  print_message "    输出: ${FINAL_ZIP}" "${BLUE}"
  print_message "========================================" "${BLUE}"
  echo ""
}

# 必要文件清单（与 manifest.json 引用对齐）
REQUIRED_FILES=(
  "manifest.json"
  "content.js"
  "content.css"
  "dockbar.js"
  "background/index.js"
  "popup/popup.html"
  "popup/popup.css"
  "popup/popup.js"
  "sidepanel/sidepanel.html"
  "sidepanel/sidepanel.css"
  "sidepanel/sidepanel.js"
  "welcome/welcome.html"
  "welcome/welcome.css"
  "welcome/welcome.js"
  "icons/16x16.png"
  "icons/48x48.png"
  "icons/128x128.png"
)

# 需复制的目录（整个目录递归复制）
COPY_DIRS=(
  "background"
  "popup"
  "sidepanel"
  "welcome"
  "content"
  "modules"
  "shared"
  "config"
  "prompts"
  "icons"
  "assets"
  "members"
)

# 顶层单文件
COPY_FILES=(
  "manifest.json"
  "content.js"
  "content.css"
  "dockbar.js"
  "privacy.html"
)

check_required_files() {
  print_message "📋 检查必要文件..." "${YELLOW}"
  local missing=0
  for f in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$PROJECT_DIR/$f" ]; then
      print_message "  ❌ 缺少: $f" "${RED}"
      missing=1
    else
      print_message "  ✓ $f" "${GREEN}"
    fi
  done
  if [ $missing -eq 1 ]; then
    print_message "\n错误: 缺少必要文件，请先补齐" "${RED}"
    exit 1
  fi
}

prepare_build_dir() {
  print_message "\n🔧 准备构建目录: $BUILD_DIR" "${YELLOW}"
  rm -rf "$BUILD_DIR"
  mkdir -p "$BUILD_DIR"
}

# rsync 排除规则——清单内容也直接体现"哪些不应进 zip"
RSYNC_EXCLUDES=(
  "--exclude=.git"
  "--exclude=.gitignore"
  "--exclude=.github"
  "--exclude=.claude"
  "--exclude=.DS_Store"
  "--exclude=Thumbs.db"
  "--exclude=node_modules"
  "--exclude=*.log"
  "--exclude=*.bak"
  "--exclude=*.bak.*"      # 我们的 timestamp 备份格式
  "--exclude=*.tmp"
  "--exclude=.vscode"
  "--exclude=.idea"
  "--exclude=icons/generate_icons.html"
  "--exclude=*.sketch"
  "--exclude=*.psd"
  "--exclude=*.ai"
)

copy_files() {
  print_message "\n📦 复制文件..." "${YELLOW}"

  # 顶层单文件
  for f in "${COPY_FILES[@]}"; do
    if [ -f "$PROJECT_DIR/$f" ]; then
      cp "$PROJECT_DIR/$f" "$BUILD_DIR/"
      print_message "  ✓ $f" "${GREEN}"
    fi
  done

  # 目录递归（用 rsync 应用排除规则）
  for d in "${COPY_DIRS[@]}"; do
    if [ -d "$PROJECT_DIR/$d" ]; then
      rsync -a "${RSYNC_EXCLUDES[@]}" "$PROJECT_DIR/$d/" "$BUILD_DIR/$d/"
      print_message "  ✓ $d/" "${GREEN}"
    fi
  done
}

update_version_in_build() {
  print_message "\n🔄 写入版本号 v${VERSION}..." "${YELLOW}"
  local manifest_file="$BUILD_DIR/manifest.json"
  # 跨平台 sed（macOS BSD vs Linux GNU）：用临时文件
  python3 -c "
import json, sys
p = '$manifest_file'
m = json.load(open(p))
m['version'] = '$VERSION'
json.dump(m, open(p, 'w'), ensure_ascii=False, indent=2)
print('  manifest.version =', m['version'])
"
}

create_zip() {
  print_message "\n📦 打 ZIP..." "${YELLOW}"
  rm -f "$FINAL_ZIP"
  ( cd "$BUILD_DIR" && zip -r "$FINAL_ZIP" . -q -x "*.DS_Store" )
  if [ -f "$FINAL_ZIP" ]; then
    local size=$(du -h "$FINAL_ZIP" | cut -f1)
    print_message "  ✓ ${FINAL_ZIP} (${size})" "${GREEN}"
  else
    print_message "  ❌ 打包失败" "${RED}"
    exit 1
  fi
}

cleanup() {
  print_message "\n🧹 清理 ${BUILD_DIR}" "${YELLOW}"
  rm -rf "$BUILD_DIR"
}

show_zip_summary() {
  print_message "\n📋 ZIP 内容统计:" "${YELLOW}"
  local count=$(unzip -l "$FINAL_ZIP" | tail -n 1 | awk '{print $2}')
  print_message "  共 ${count} 个文件" "${GREEN}"
  print_message "\n  顶层结构：" "${BLUE}"
  unzip -l "$FINAL_ZIP" | awk 'NR>3 && $4 !~ /\// && $4 != "" {print "    " $4}' | sort -u | head -20
  print_message "\n  顶层目录：" "${BLUE}"
  unzip -l "$FINAL_ZIP" | awk 'NR>3 && $4 ~ /\// {split($4, p, "/"); print "    " p[1] "/"}' | sort -u
}

generate_instructions() {
  print_message "\n📖 安装/上传:" "${BLUE}"
  echo ""
  echo "  本地安装："
  echo "    1. chrome://extensions/"
  echo "    2. 开启「开发者模式」"
  echo "    3. 拖拽 ${FINAL_ZIP} 到窗口（或解压后「加载已解压」）"
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
  check_required_files
  prepare_build_dir
  copy_files
  update_version_in_build
  create_zip
  cleanup
  show_zip_summary
  generate_instructions
  print_message "\n✨ 打包完成！" "${GREEN}"
}

main
