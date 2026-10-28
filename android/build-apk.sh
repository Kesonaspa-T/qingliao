#!/bin/bash
# 打 Android 包：复用现有 APK 的 classes.dex（本机没有 Java 编译器），只换 assets/www。
# 用法：./android/build-apk.sh [版本名] [versionCode]
#   ./android/build-apk.sh 1.4.48 48
# 依赖可用环境变量覆盖：BT（build-tools 目录）、AJ（android.jar）、JAVA、KS、DEXSRC（取 classes.dex 的旧 APK）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="${1:-1.4.48}"
CODE="${2:-48}"
BT="${BT:-/private/tmp/ql-dev/btmac/android-14}"
AJ="${AJ:-$HOME/Documents/qingliao-handoff/.build-tools/sdk/android-34-ext12/android.jar}"
JAVA="${JAVA:-/Applications/BlueJ.app/Contents/PlugIns/aarch64/Contents/Home/bin/java}"
KS="${KS:-$HOME/Documents/qingliao/android/qingliao.keystore}"
DEXSRC="${DEXSRC:-$HOME/Documents/轻聊-发版材料/qingliao.apk}"

for f in "$BT/aapt2" "$AJ" "$JAVA" "$KS" "$DEXSRC"; do
  [ -e "$f" ] || { echo "缺文件：$f"; exit 1; }
done

W="$(mktemp -d /tmp/ql-apk.XXXXXX)"
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/assets/www"
cp -R "$ROOT/web/." "$W/assets/www/"
cp -R "$ROOT/android/res" "$W/res"
cp "$ROOT/android/AndroidManifest.xml" "$W/AndroidManifest.xml"
sed -i '' -e "s/android:versionCode=\"[0-9]*\"/android:versionCode=\"$CODE\"/" \
          -e "s/android:versionName=\"[^\"]*\"/android:versionName=\"$VER\"/" "$W/AndroidManifest.xml"

"$BT/aapt2" compile --dir "$W/res" -o "$W/res.zip"
"$BT/aapt2" link -o "$W/base.apk" -I "$AJ" --manifest "$W/AndroidManifest.xml" \
  -R "$W/res.zip" -A "$W/assets" --java "$W/gen" --auto-add-overlay

mkdir -p "$W/dex"
(cd "$W/dex" && unzip -o -q "$DEXSRC" classes.dex)
cp "$W/base.apk" "$W/unsigned.apk"
(cd "$W/dex" && zip -q -j "$W/unsigned.apk" classes.dex)
"$BT/zipalign" -f 4 "$W/unsigned.apk" "$W/aligned.apk"
mkdir -p "$ROOT/android/build"
OUT="$ROOT/android/build/qingliao-$VER.apk"
"$JAVA" -jar "$BT/lib/apksigner.jar" sign --ks "$KS" --ks-pass pass:android \
  --key-pass pass:android --min-sdk-version 23 --out "$OUT" "$W/aligned.apk"
"$JAVA" -jar "$BT/lib/apksigner.jar" verify --min-sdk-version 23 "$OUT" >/dev/null

echo "OK：$OUT"
stat -f "大小 %z 字节" "$OUT" 2>/dev/null || stat -c "大小 %s 字节" "$OUT"
shasum -a 256 "$OUT" 2>/dev/null || sha256sum "$OUT"
