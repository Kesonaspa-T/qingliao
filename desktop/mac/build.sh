#!/bin/bash
# 构建 macOS 版：swiftc 编译 WebView 外壳 → 组装 .app → 自签名
# 用法：./build.sh [版本号]
set -e
cd "$(dirname "$0")"

VERSION="${1:-1.4.44}"
NAME="轻聊"
OUT="build"
ICON="../../../qingliao1_副本2/desktop/轻聊.icns"

rm -rf "$OUT"
mkdir -p "$OUT/$NAME.app/Contents/MacOS" "$OUT/$NAME.app/Contents/Resources"

swiftc -O -o "$OUT/$NAME.app/Contents/MacOS/$NAME" \
  main.swift uidlg.swift \
  -framework Cocoa -framework WebKit

if [ -f "$ICON" ]; then
  cp "$ICON" "$OUT/$NAME.app/Contents/Resources/$NAME.icns"
fi

cat > "$OUT/$NAME.app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$NAME</string>
  <key>CFBundleDisplayName</key><string>$NAME</string>
  <key>CFBundleExecutable</key><string>$NAME</string>
  <key>CFBundleIdentifier</key><string>com.qingliao.app</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>CFBundleIconFile</key><string>$NAME</string>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsArbitraryLoads</key><true/>
    <key>NSAllowsArbitraryLoadsInWebContent</key><true/>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
</dict>
</plist>
PLIST

codesign --force --deep --sign - "$OUT/$NAME.app" >/dev/null 2>&1 || echo "（自签名失败，不影响本机打开）"
echo "构建完成：$OUT/$NAME.app  版本 $VERSION"
