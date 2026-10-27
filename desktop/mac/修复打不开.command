#!/bin/bash
# 去掉 macOS 的隔离标记 + 本地重新 ad-hoc 签名，让 App 能打开
cd "$(dirname "$0")"
APP=""
if [ -d "/Applications/轻聊.app" ]; then APP="/Applications/轻聊.app"; fi
if [ -z "$APP" ] && [ -d "$PWD/轻聊.app" ]; then APP="$PWD/轻聊.app"; fi
if [ -z "$APP" ]; then APP="$HOME/Applications/轻聊.app"; fi
if [ ! -d "$APP" ]; then
  echo "没找到「轻聊.app」。"
  echo "把它拖进「应用程序」，或者把本脚本放到 App 旁边再双击。"
  read -n 1 -s -r -p "按任意键关闭…"; echo; exit 1
fi
echo "处理：$APP"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
echo
echo "好了。现在双击「轻聊.app」应该能打开。"
echo "如果还是被拦：系统设置 → 隐私与安全性 → 拉到底 → 点「仍要打开」。"
read -n 1 -s -r -p "按任意键关闭…"; echo
