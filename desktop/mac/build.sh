#!/bin/bash
# 构建 macOS 版：swiftc 编译 WebView 外壳 → 组装 .app → 自签名
# 用法：./build.sh [版本号]
#
# 默认产出「通用二进制」（Apple 芯片 + Intel 都能跑）。
# 只想要本机架构（快一点）：ARCH=native ./build.sh 1.4.46
set -e
cd "$(dirname "$0")"

VERSION="${1:-1.4.46}"
NAME="轻聊"
OUT="build"
EXE="$OUT/$NAME.app/Contents/MacOS/$NAME"

rm -rf "$OUT"
mkdir -p "$OUT/$NAME.app/Contents/MacOS" "$OUT/$NAME.app/Contents/Resources"

# ---- 编译：默认 arm64 + x86_64，lipo 成一个包 ----
if [ "${ARCH:-universal}" = "native" ]; then
  swiftc -O -o "$EXE" main.swift uidlg.swift -framework Cocoa -framework WebKit
else
  swiftc -O -o "$OUT/$NAME-arm64" main.swift uidlg.swift -framework Cocoa -framework WebKit
  # 没装 Intel SDK 的老机器会失败：那就退回单架构，不要因此构建不出来。
  if swiftc -O -target x86_64-apple-macos11 -o "$OUT/$NAME-x86" main.swift uidlg.swift \
       -framework Cocoa -framework WebKit 2>/dev/null; then
    lipo -create "$OUT/$NAME-arm64" "$OUT/$NAME-x86" -output "$EXE"
    rm -f "$OUT/$NAME-arm64" "$OUT/$NAME-x86"
  else
    echo "（这台机器编不了 x86_64，退回 arm64 单架构）"
    mv "$OUT/$NAME-arm64" "$EXE"
  fi
fi

# ---- 图标：优先用现成的 .icns，没有就把 desktop/icon.png 转一个 ----
ICON=""
for c in "./$NAME.icns" "../$NAME.icns" "../icon.png"; do
  [ -f "$c" ] && ICON="$c" && break
done
if [ -n "$ICON" ]; then
  case "$ICON" in
    *.icns) cp "$ICON" "$OUT/$NAME.app/Contents/Resources/$NAME.icns" ;;
    *.png)
      ICONSET="$OUT/$NAME.iconset"
      mkdir -p "$ICONSET"
      for s in 16 32 64 128 256 512; do
        sips -z $s $s "$ICON" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null 2>&1 || true
        d=$((s * 2))
        sips -z $d $d "$ICON" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null 2>&1 || true
      done
      iconutil -c icns "$ICONSET" -o "$OUT/$NAME.app/Contents/Resources/$NAME.icns" >/dev/null 2>&1 \
        && rm -rf "$ICONSET" || echo "（图标转换失败，用系统默认图标）"
      ;;
  esac
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

# ---- 打包：App + 「打不开怎么办」说明。没有 Apple 开发者签名，第一次一定被 Gatekeeper 拦 ----
DISTNAME="qingliao-mac-$VERSION"
DIST="$OUT/$DISTNAME"
rm -rf "$DIST"
mkdir -p "$DIST"
cp -R "$OUT/$NAME.app" "$DIST/"
for f in "如何打开（重要）.txt" "修复打不开.command"; do
  [ -f "$f" ] && cp "$f" "$DIST/"
done
chmod +x "$DIST/修复打不开.command" 2>/dev/null || true

OUT_ABS="$(cd "$OUT" && pwd)"
ZIP="$OUT_ABS/$DISTNAME.zip"
rm -f "$ZIP"
# 先清扩展属性再 ditto：ditto 能正确写 UTF-8 文件名（Info-ZIP 的 zip 会丢 UTF-8 标记，
# 中文名在别的 Mac 上解压容易乱码），清掉 xattr 后也不会多出 ._ 垃圾文件
xattr -cr "$DIST" 2>/dev/null || true
( cd "$OUT" && ditto -c -k --keepParent "$DISTNAME" "$ZIP" )

echo "构建完成：$OUT/$NAME.app  版本 $VERSION"
lipo -info "$EXE" 2>/dev/null || true
echo "打包：$ZIP"
echo "  里面是：轻聊.app + 如何打开（重要）.txt + 修复打不开.command"
