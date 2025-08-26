#!/bin/bash

# 触触搜 Chrome 插件打包脚本
# 用法: ./build.sh [version]
# 示例: ./build.sh 1.0.1

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
PLUGIN_NAME="chuchusou_chrome_extension"
OUTPUT_DIR="/tmp"
VERSION="${1:-1.0.0}"  # 默认版本号 1.0.0
BUILD_DIR="${OUTPUT_DIR}/${PLUGIN_NAME}_build"
ZIP_NAME="${PLUGIN_NAME}_v${VERSION}.zip"
FINAL_ZIP="${OUTPUT_DIR}/${ZIP_NAME}"

# 需要排除的文件和目录
EXCLUDE_LIST=(
    ".git"
    ".gitignore"
    ".claude"
    "README.md"
    "*.md"
    "build.sh"
    ".DS_Store"
    "thumbs.db"
    "*.log"
    "*.bak"
    "*.tmp"
    "node_modules"
    "package.json"
    "package-lock.json"
    "yarn.lock"
    "icons/generate_icons.html"
    "*.sketch"
    "*.psd"
    "*.ai"
    ".vscode"
    ".idea"
)

# 打印带颜色的消息
print_message() {
    echo -e "${2}${1}${NC}"
}

print_header() {
    echo ""
    print_message "========================================" "${BLUE}"
    print_message "    触触搜 Chrome 插件打包工具" "${BLUE}"
    print_message "    版本: v${VERSION}" "${BLUE}"
    print_message "========================================" "${BLUE}"
    echo ""
}

# 检查必要文件
check_required_files() {
    print_message "📋 检查必要文件..." "${YELLOW}"
    
    local required_files=(
        "manifest.json"
        "content.js"
        "content.css"
        "popup/popup.html"
        "popup/popup.css"
        "popup/popup.js"
    )
    
    local missing=0
    for file in "${required_files[@]}"; do
        if [ ! -f "$file" ]; then
            print_message "  ❌ 缺少文件: $file" "${RED}"
            missing=1
        else
            print_message "  ✓ $file" "${GREEN}"
        fi
    done
    
    if [ $missing -eq 1 ]; then
        print_message "\n错误: 缺少必要文件，请检查项目结构" "${RED}"
        exit 1
    fi
    
    print_message "  所有必要文件已就绪！" "${GREEN}"
}

# 清理和创建构建目录
prepare_build_dir() {
    print_message "\n🔧 准备构建目录..." "${YELLOW}"
    
    # 清理旧的构建目录
    if [ -d "$BUILD_DIR" ]; then
        rm -rf "$BUILD_DIR"
        print_message "  已清理旧的构建目录" "${GREEN}"
    fi
    
    # 创建新的构建目录
    mkdir -p "$BUILD_DIR"
    print_message "  创建构建目录: $BUILD_DIR" "${GREEN}"
}

# 复制文件到构建目录
copy_files() {
    print_message "\n📦 复制文件到构建目录..." "${YELLOW}"
    
    # 只复制必要的文件和目录
    mkdir -p "$BUILD_DIR"
    
    # 复制必要文件
    cp manifest.json "$BUILD_DIR/"
    cp content.js "$BUILD_DIR/"
    cp content.css "$BUILD_DIR/"
    
    # 复制 popup 目录
    cp -r popup "$BUILD_DIR/"
    
    # 复制 icons 目录（但排除 generate_icons.html）
    mkdir -p "$BUILD_DIR/icons"
    cp icons/*.png "$BUILD_DIR/icons/" 2>/dev/null
    cp icons/*.svg "$BUILD_DIR/icons/" 2>/dev/null
    
    print_message "  文件复制完成，只包含必要文件" "${GREEN}"
}

# 更新版本号
update_version() {
    print_message "\n🔄 更新版本号..." "${YELLOW}"
    
    local manifest_file="$BUILD_DIR/manifest.json"
    
    # 使用 sed 更新 manifest.json 中的版本号
    if [ -f "$manifest_file" ]; then
        # 备份原文件
        cp "$manifest_file" "$manifest_file.bak"
        
        # 更新版本号
        sed -i "s/\"version\":[[:space:]]*\"[^\"]*\"/\"version\": \"${VERSION}\"/" "$manifest_file"
        
        # 删除备份文件
        rm -f "$manifest_file.bak"
        
        print_message "  版本号已更新为: v${VERSION}" "${GREEN}"
    else
        print_message "  警告: 未找到 manifest.json" "${YELLOW}"
    fi
}

# 创建 ZIP 包
create_zip() {
    print_message "\n📦 创建 ZIP 包..." "${YELLOW}"
    
    # 删除旧的 ZIP 文件
    if [ -f "$FINAL_ZIP" ]; then
        rm -f "$FINAL_ZIP"
        print_message "  已删除旧的 ZIP 文件" "${GREEN}"
    fi
    
    # 进入构建目录并创建 ZIP
    cd "$BUILD_DIR"
    zip -r "$FINAL_ZIP" . -q
    cd - > /dev/null
    
    # 获取 ZIP 文件大小
    if [ -f "$FINAL_ZIP" ]; then
        local size=$(du -h "$FINAL_ZIP" | cut -f1)
        print_message "  ZIP 包创建成功！" "${GREEN}"
        print_message "  文件: $FINAL_ZIP" "${GREEN}"
        print_message "  大小: $size" "${GREEN}"
    else
        print_message "  错误: ZIP 包创建失败" "${RED}"
        exit 1
    fi
}

# 清理构建目录
cleanup() {
    print_message "\n🧹 清理临时文件..." "${YELLOW}"
    
    if [ -d "$BUILD_DIR" ]; then
        rm -rf "$BUILD_DIR"
        print_message "  构建目录已清理" "${GREEN}"
    fi
}

# 显示 ZIP 内容
show_zip_contents() {
    print_message "\n📋 ZIP 包内容:" "${YELLOW}"
    unzip -l "$FINAL_ZIP" | tail -n +4 | head -n -2
}

# 生成安装说明
generate_instructions() {
    print_message "\n📖 安装说明:" "${BLUE}"
    echo ""
    echo "  1. 打开 Chrome 浏览器，访问 chrome://extensions/"
    echo "  2. 开启右上角的「开发者模式」"
    echo "  3. 拖拽 $FINAL_ZIP 到浏览器窗口"
    echo "     或者："
    echo "     - 解压 ZIP 文件"
    echo "     - 点击「加载已解压的扩展程序」"
    echo "     - 选择解压后的文件夹"
    echo ""
    print_message "  Chrome Web Store 上传:" "${BLUE}"
    echo "  直接上传 $FINAL_ZIP 到开发者控制台"
    echo ""
}

# 主函数
main() {
    print_header
    
    # 检查是否在正确的目录
    if [ ! -f "manifest.json" ]; then
        print_message "错误: 请在插件根目录运行此脚本" "${RED}"
        exit 1
    fi
    
    # 执行打包步骤
    check_required_files
    prepare_build_dir
    copy_files
    update_version
    create_zip
    cleanup
    show_zip_contents
    generate_instructions
    
    print_message "✨ 打包完成！" "${GREEN}"
    print_message "📦 输出文件: ${FINAL_ZIP}" "${GREEN}"
    echo ""
}

# 运行主函数
main