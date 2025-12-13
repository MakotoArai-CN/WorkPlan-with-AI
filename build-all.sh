#!/bin/bash
set -e

echo "🔨 Building WorkPlan for all platforms..."

# 清理旧构建
rm -rf src-tauri/target/release/bundle

# 检测当前平台并构建
case "$(uname -s)" in
    Darwin)
        echo "📦 Building for macOS..."
        
        # Apple Silicon
        rustup target add aarch64-apple-darwin
        bun tauri build --target aarch64-apple-darwin
        
        # Intel Mac
        rustup target add x86_64-apple-darwin
        bun tauri build --target x86_64-apple-darwin
        
        echo "✅ macOS builds complete!"
        ;;
    Linux)
        echo "📦 Building for Linux..."
        
        # x64
        bun tauri build --target x86_64-unknown-linux-gnu
        
        echo "✅ Linux build complete!"
        ;;
    MINGW*|CYGWIN*|MSYS*)
        echo "📦 Building for Windows..."
        bun tauri build --target x86_64-pc-windows-msvc
        echo "✅ Windows build complete!"
        ;;
esac

echo ""
echo "📁 Build outputs:"
find src-tauri/target -name "*.exe" -o -name "*.msi" -o -name "*.dmg" -o -name "*.deb" -o -name "*.AppImage" 2>/dev/null | head -20