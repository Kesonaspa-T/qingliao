#!/bin/bash
# 双击运行：去掉隔离标记，然后打开轻聊
cd "$(dirname "$0")"
APP="$(pwd)/轻聊.app"
if [ ! -d "$APP" ]; then
  echo "没找到 轻聊.app，请把它和这个脚本放在同一个文件夹里"
  read -r -p "按回车关闭"
  exit 1
fi
xattr -dr com.apple.quarantine "$APP" 2>/dev/null
chmod +x "$APP/Contents/MacOS/轻聊" 2>/dev/null
open "$APP"
echo "已启动。如果还是打不开，把这个窗口里的内容截图发我。"
sleep 1
