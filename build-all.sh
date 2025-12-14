#!/bin/bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_command() {
    if command -v "$1" &> /dev/null; then
        return 0
    else
        return 1
    fi
}

detect_os() {
    case "$(uname -s)" in
        Linux*)     OS="linux";;
        Darwin*)    OS="macos";;
        CYGWIN*|MINGW*|MSYS*) OS="windows";;
        *)          OS="unknown";;
    esac
    echo "$OS"
}

check_node() {
    if check_command node; then
        NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VERSION" -ge 16 ]; then
            log_success "Node.js $(node -v) 已安装"
            return 0
        else
            log_error "Node.js 版本过低，需要 16+"
            return 1
        fi
    else
        log_error "未安装 Node.js"
        return 1
    fi
}

check_rust() {
    if check_command rustc && check_command cargo; then
        log_success "Rust $(rustc --version | awk '{print $2}') 已安装"
        return 0
    else
        log_error "未安装 Rust"
        return 1
    fi
}

check_bun() {
    if check_command bun; then
        log_success "Bun $(bun --version) 已安装"
        return 0
    else
        log_warning "未安装 Bun，将使用 npm"
        return 1
    fi
}

check_android_env() {
    log_info "检查 Android 编译环境..."
    
    if [ -z "$ANDROID_HOME" ] && [ -z "$ANDROID_SDK_ROOT" ]; then
        log_warning "ANDROID_HOME 或 ANDROID_SDK_ROOT 未设置"
        return 1
    fi
    
    ANDROID_SDK="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
    
    if [ ! -d "$ANDROID_SDK" ]; then
        log_warning "Android SDK 目录不存在: $ANDROID_SDK"
        return 1
    fi
    
    if [ ! -d "$ANDROID_SDK/ndk" ] && [ -z "$ANDROID_NDK_HOME" ]; then
        log_warning "Android NDK 未安装"
        return 1
    fi
    
    if ! check_command java; then
        log_warning "Java 未安装"
        return 1
    fi
    
    JAVA_VERSION=$(java -version 2>&1 | head -n 1 | cut -d'"' -f2 | cut -d'.' -f1)
    if [ "$JAVA_VERSION" -lt 11 ]; then
        log_warning "Java 版本过低，需要 11+"
        return 1
    fi
    
    ANDROID_TARGETS=("aarch64-linux-android" "armv7-linux-androideabi" "i686-linux-android" "x86_64-linux-android")
    MISSING_TARGETS=()
    
    for target in "${ANDROID_TARGETS[@]}"; do
        if ! rustup target list --installed | grep -q "$target"; then
            MISSING_TARGETS+=("$target")
        fi
    done
    
    if [ ${#MISSING_TARGETS[@]} -gt 0 ]; then
        log_warning "缺少 Rust Android targets: ${MISSING_TARGETS[*]}"
        log_info "正在安装缺少的 targets..."
        for target in "${MISSING_TARGETS[@]}"; do
            rustup target add "$target" || true
        done
    fi
    
    log_success "Android 编译环境检查通过"
    return 0
}

check_ios_env() {
    if [ "$(detect_os)" != "macos" ]; then
        return 1
    fi
    
    log_info "检查 iOS 编译环境..."
    
    if ! check_command xcodebuild; then
        log_warning "Xcode 未安装"
        return 1
    fi
    
    if ! check_command xcrun; then
        log_warning "Xcode Command Line Tools 未安装"
        return 1
    fi
    
    IOS_TARGETS=("aarch64-apple-ios" "x86_64-apple-ios" "aarch64-apple-ios-sim")
    MISSING_TARGETS=()
    
    for target in "${IOS_TARGETS[@]}"; do
        if ! rustup target list --installed | grep -q "$target"; then
            MISSING_TARGETS+=("$target")
        fi
    done
    
    if [ ${#MISSING_TARGETS[@]} -gt 0 ]; then
        log_info "正在安装缺少的 iOS targets..."
        for target in "${MISSING_TARGETS[@]}"; do
            rustup target add "$target" || true
        done
    fi
    
    log_success "iOS 编译环境检查通过"
    return 0
}

install_dependencies() {
    log_info "安装项目依赖..."
    
    if check_bun; then
        bun install
    else
        npm install
    fi
    
    log_success "依赖安装完成"
}

build_frontend() {
    log_info "构建前端..."
    
    if check_bun; then
        bun run build
    else
        npm run build
    fi
    
    log_success "前端构建完成"
}

build_desktop() {
    local OS=$(detect_os)
    log_info "构建桌面应用 ($OS)..."
    
    if check_bun; then
        bun run tauri build
    else
        npm run tauri build
    fi
    
    log_success "桌面应用构建完成"
}

build_android() {
    log_info "构建 Android 应用..."
    
    if check_bun; then
        bun run tauri android build
    else
        npm run tauri android build
    fi
    
    log_success "Android APK 构建完成"
    
    APK_PATH="src-tauri/gen/android/app/build/outputs/apk/release"
    if [ -d "$APK_PATH" ]; then
        log_info "APK 位置: $APK_PATH"
    fi
}

build_ios() {
    log_info "构建 iOS 应用..."
    
    if check_bun; then
        bun run tauri ios build
    else
        npm run tauri ios build
    fi
    
    log_success "iOS 应用构建完成"
}

main() {
    echo ""
    echo "╔════════════════════════════════════════╗"
    echo "║       WorkPlan 多平台构建脚本          ║"
    echo "╚════════════════════════════════════════╝"
    echo ""
    
    local OS=$(detect_os)
    log_info "当前操作系统: $OS"
    
    log_info "检查基础环境..."
    
    if ! check_node; then
        log_error "请先安装 Node.js 16+"
        exit 1
    fi
    
    if ! check_rust; then
        log_error "请先安装 Rust"
        exit 1
    fi
    
    check_bun
    
    ANDROID_AVAILABLE=false
    IOS_AVAILABLE=false
    
    if check_android_env; then
        ANDROID_AVAILABLE=true
    fi
    
    if check_ios_env; then
        IOS_AVAILABLE=true
    fi
    
    echo ""
    log_info "构建计划:"
    echo "  - 桌面应用 ($OS): ✓"
    if [ "$ANDROID_AVAILABLE" = true ]; then
        echo "  - Android APK: ✓"
    else
        echo "  - Android APK: ✗ (环境不满足)"
    fi
    if [ "$IOS_AVAILABLE" = true ]; then
        echo "  - iOS 应用: ✓"
    else
        echo "  - iOS 应用: ✗ (环境不满足)"
    fi
    echo ""
    
    install_dependencies
    
    build_frontend
    
    build_desktop
    
    if [ "$ANDROID_AVAILABLE" = true ]; then
        build_android
    fi
    
    if [ "$IOS_AVAILABLE" = true ]; then
        build_ios
    fi
    
    echo ""
    echo "╔════════════════════════════════════════╗"
    echo "║            构建完成！                  ║"
    echo "╚════════════════════════════════════════╝"
    echo ""
    
    log_info "构建产物位置:"
    echo "  - 桌面应用: src-tauri/target/release/bundle/"
    if [ "$ANDROID_AVAILABLE" = true ]; then
        echo "  - Android: src-tauri/gen/android/app/build/outputs/apk/"
    fi
    if [ "$IOS_AVAILABLE" = true ]; then
        echo "  - iOS: src-tauri/gen/apple/build/"
    fi
}

main "$@"