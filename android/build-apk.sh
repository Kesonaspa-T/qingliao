#!/bin/bash
# 打 Android 包：用 ecj 编译 android/src 下的 Java，再用 d8 生成 classes.dex；编译不了才回退旧 dex。
# 用法：./android/build-apk.sh [版本名] [versionCode]
#   ./android/build-apk.sh 1.4.51 51
# 依赖可用环境变量覆盖：BT、AJ、JAVA、KS、DEXSRC（回退用）、ECJ（编译器 jar，缺了会尝试下载）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="${1:-1.4.48}"
CODE="${2:-48}"
BT="${BT:-/private/tmp/ql-dev/btmac/android-14}"
AJ="${AJ:-$HOME/Documents/qingliao-handoff/.build-tools/sdk/android-34-ext12/android.jar}"
JAVA="${JAVA:-/Applications/BlueJ.app/Contents/PlugIns/aarch64/Contents/Home/bin/java}"
KS="${KS:-$HOME/Documents/qingliao/android/qingliao.keystore}"
DEXSRC="${DEXSRC:-$HOME/Documents/轻聊-发版材料/qingliao.apk}"
ECJ="${ECJ:-$ROOT/android/build/ecj.jar}"

for f in "$BT/aapt2" "$AJ" "$JAVA" "$KS"; do
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

# ---- Java → dex ----
mkdir -p "$W/classes" "$W/dexnew" "$W/dex"
DEX_OK=0
if [ ! -f "$ECJ" ]; then
  mkdir -p "$(dirname "$ECJ")"
  curl -fsSL --max-time 60 -o "$ECJ" \
    https://repo1.maven.org/maven2/org/eclipse/jdt/ecj/3.46.100/ecj-3.46.100.jar 2>/dev/null || true
fi
if [ -f "$ECJ" ]; then
  SRC="$(find "$ROOT/android/src" -name '*.java')"
  RSRC="$(find "$W/gen" -name '*.java' 2>/dev/null || true)"
  if "$JAVA" -jar "$ECJ" -1.8 -bootclasspath "$AJ" -d "$W/classes" $SRC $RSRC >/tmp/ql-ecj.log 2>&1; then
    JH="$(cd "$(dirname "$JAVA")/.." && pwd)"
    if PATH="$JH/bin:$PATH" "$BT/d8" --lib "$AJ" --min-api 23 --output "$W/dexnew" \
         $(find "$W/classes" -name '*.class') >/tmp/ql-d8.log 2>&1; then
      cp "$W/dexnew/classes.dex" "$W/classes.dex"
      DEX_OK=1
      echo "已编译新的 classes.dex（含原生存储桥）"
    else
      echo "警告：d8 失败，回退旧 dex（见 /tmp/ql-d8.log）"
    fi
  else
    echo "警告：ecj 编译失败，回退旧 dex（见 /tmp/ql-ecj.log）"
  fi
fi
if [ "$DEX_OK" = 0 ]; then
  [ -f "$DEXSRC" ] || { echo "缺旧 APK 取 dex：$DEXSRC"; exit 1; }
  (cd "$W/dex" && unzip -o -q "$DEXSRC" classes.dex)
  cp "$W/dex/classes.dex" "$W/classes.dex"
fi
cp "$W/base.apk" "$W/unsigned.apk"
(cd "$W" && zip -q -j "$W/unsigned.apk" classes.dex)
"$BT/zipalign" -f 4 "$W/unsigned.apk" "$W/aligned.apk"
mkdir -p "$ROOT/android/build"
OUT="$ROOT/android/build/qingliao-$VER.apk"
"$JAVA" -jar "$BT/lib/apksigner.jar" sign --ks "$KS" --ks-pass pass:android \
  --key-pass pass:android --min-sdk-version 23 --out "$OUT" "$W/aligned.apk"
"$JAVA" -jar "$BT/lib/apksigner.jar" verify --min-sdk-version 23 "$OUT" >/dev/null

echo "OK：$OUT"
stat -f "大小 %z 字节" "$OUT" 2>/dev/null || stat -c "大小 %s 字节" "$OUT"
shasum -a 256 "$OUT" 2>/dev/null || sha256sum "$OUT"
