#!/bin/bash
# 打「源码包」：拷到没有编译器的 Mac 上，用 Xcode Command Line Tools 本机编译。
# 本机编译出来的 App 没有「已隔离」标记，不需要 Gatekeeper 放行。
# 用法：./make-src.sh [版本号]
set -e
cd "$(dirname "$0")"
VERSION="${1:-1.4.48}"
NAME="qingliao-mac-src-$VERSION"
OUT="build/$NAME"

rm -rf "$OUT"
mkdir -p "$OUT"
cp "一键编译.command" build.sh main.swift uidlg.swift LocalServer.swift HardReset.swift \
   "如何打开（重要）.txt" "修复打不开.command" ../icon.png "$OUT/"
rm -rf "$OUT/web" && cp -R ../../web "$OUT/web"
chmod +x "$OUT/一键编译.command" "$OUT/修复打不开.command"
xattr -cr "$OUT" 2>/dev/null || true

rm -f "build/$NAME.zip"
( cd build && ditto -c -k --keepParent "$NAME" "$NAME.zip" )
echo "源码包：$(pwd)/build/$NAME.zip"
ls -lh "build/$NAME.zip"
