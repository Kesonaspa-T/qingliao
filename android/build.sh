#!/bin/bash
# 打包 APK（不需要 Gradle / Android Studio，直接用 build-tools 手搓）
#
# 需要：JAVA_HOME 指向一个 JRE 21（或任意 11+ 的 JRE）；
#      有 javac 就用 javac，没有就用 ECJ（Eclipse 编译器，几 MB）。
#
# 用法示例：
#   ANDROID_SDK=~/Library/Android/sdk JAVA_HOME=/path/to/jre ./build.sh
#   BUILD_TOOLS=/opt/build-tools/34.0.0 PLATFORM_JAR=/opt/platforms/android-34/android.jar \
#   JAVA_HOME=/path/to/jre ECJ_JAR=./ecj.jar ./build.sh

set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_SDK:-$HOME/Library/Android/sdk}"
BT="${BUILD_TOOLS:-$SDK/build-tools/34.0.0}"
AJ="${PLATFORM_JAR:-$SDK/platforms/android-34/android.jar}"
JAVA="${JAVA_HOME:-}/bin/java"
JAVAC="${JAVA_HOME:-}/bin/javac"
KEYTOOL="${JAVA_HOME:-}/bin/keytool"

[ -x "$JAVA" ] || { echo "找不到 java，请设置 JAVA_HOME"; exit 1; }
[ -f "$AJ" ] || { echo "找不到 android.jar：$AJ"; exit 1; }
[ -x "$BT/aapt2" ] || { echo "找不到 build-tools：$BT"; exit 1; }

OUT="$HERE/build"
rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex"

# 网页塞进 assets
rm -rf "$HERE/assets"
mkdir -p "$HERE/assets/www"
cp -R "$HERE/../web/." "$HERE/assets/www/"

# 真机自带状态栏，网页里那个模拟状态栏由 CSS（html.native .statusbar）隐藏即可。
# 千万别再把它从 HTML 里删掉：app.js 的 startClock() 依赖 #clock 元素，删掉后
# init() 会抛 TypeError，而「启动同步轮询」的 setInterval 恰好在它后面——
# 结果就是群里说完话永远不刷新、只有杀进程重开才看到回复（2026-10 的线上事故）。
python3 - "$HERE/assets/www/index.html" <<'PYEOF'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
if 'id="clock"' not in s:
    s2 = re.sub(r'(<body[^>]*>)', r'\1\n<div class="statusbar" style="display:none"><span id="clock"></span></div>', s, count=1)
    open(p, "w", encoding="utf-8").write(s2)
    print("[ensure-clock]", "injected hidden clock")
else:
    print("[ensure-clock]", "ok")
PYEOF

echo "[1/6] aapt2 compile"
"$BT/aapt2" compile --dir "$HERE/res" -o "$OUT/res.zip"

echo "[2/6] aapt2 link"
"$BT/aapt2" link -o "$OUT/base.apk" \
  -I "$AJ" \
  --manifest "$HERE/AndroidManifest.xml" \
  -R "$OUT/res.zip" \
  -A "$HERE/assets" \
  --java "$OUT/gen" \
  --auto-add-overlay

echo "[3/6] 编译 Java"
find "$HERE/src" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
if [ -x "$JAVAC" ]; then
  "$JAVAC" -encoding UTF-8 -source 8 -target 8 -nowarn \
    -bootclasspath "$AJ" -classpath "$AJ" \
    -d "$OUT/classes" @"$OUT/sources.txt"
else
  ECJ="${ECJ_JAR:-$HERE/ecj.jar}"
  [ -f "$ECJ" ] || { echo "没有 javac，也找不到 ecj.jar（用 ECJ_JAR= 指定）"; exit 1; }
  "$JAVA" -jar "$ECJ" -8 -nowarn -proc:none -encoding UTF-8 \
    -bootclasspath "$AJ" -classpath "$AJ" \
    -d "$OUT/classes" @"$OUT/sources.txt"
fi

echo "[4/6] d8"
find "$OUT/classes" -name '*.class' > "$OUT/classes.txt"
"$JAVA" -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 \
  --release --min-api 23 --lib "$AJ" --output "$OUT/dex" @"$OUT/classes.txt"

echo "[5/6] 打包 + 对齐"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT/dex" && zip -q -j "$OUT/unsigned.apk" classes.dex)
"$BT/zipalign" -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

echo "[6/6] 签名"
KS="$HERE/qingliao.keystore"
if [ ! -f "$KS" ]; then
  if [ -x "$KEYTOOL" ]; then
    "$KEYTOOL" -genkeypair -keystore "$KS" -alias qingliao \
      -keyalg RSA -keysize 2048 -validity 10000 \
      -storepass android -keypass android \
      -dname "CN=Qingliao, OU=Home, O=Home, L=Home, C=CN" >/dev/null 2>&1
  else
    openssl req -x509 -newkey rsa:2048 -nodes \
      -keyout "$OUT/key.pem" -out "$OUT/cert.pem" \
      -days 10000 -subj "/CN=Qingliao" >/dev/null 2>&1
    openssl pkcs12 -export -inkey "$OUT/key.pem" -in "$OUT/cert.pem" \
      -name qingliao -out "$KS" -passout pass:android >/dev/null 2>&1
  fi
fi

"$JAVA" -jar "$BT/lib/apksigner.jar" sign \
  --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --min-sdk-version 23 \
  --out "$HERE/qingliao.apk" "$OUT/aligned.apk"

"$JAVA" -jar "$BT/lib/apksigner.jar" verify --min-sdk-version 23 "$HERE/qingliao.apk" \
  && echo "签名校验通过"

echo
echo "自检：启动 Activity 是否真的在 dex 里"
ACT=$(unzip -p "$HERE/qingliao.apk" AndroidManifest.xml >/dev/null 2>&1; "$BT/aapt2" dump badging "$HERE/qingliao.apk" | sed -n "s/^launchable-activity: name='\([^']*\)'.*/\1/p")
DEXPATH=$(echo "$ACT" | tr '.' '/')
if unzip -p "$HERE/qingliao.apk" classes.dex | strings | grep -q "L$DEXPATH;"; then
  echo "  ✓ $ACT"
else
  echo "  ✗ manifest 里的 $ACT 不在 dex 里（包名不一致？）"
  exit 1
fi

echo
echo "OK → $HERE/qingliao.apk"
ls -lh "$HERE/qingliao.apk"
