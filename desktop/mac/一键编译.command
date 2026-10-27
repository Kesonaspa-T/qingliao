#!/bin/bash
# 在「这台 Mac」上本地编译轻聊.app（产物没有「已隔离」标记，双击就能开）
cd "$(dirname "$0")"
VERSION="${1:-1.4.46}"

echo "轻聊 macOS 版 · 本地一键编译（版本 $VERSION）"
echo "———————————————————————————————"
echo

if ! command -v swiftc >/dev/null 2>&1; then
  echo "✗ 这台 Mac 还没有编译器（swiftc）。"
  echo
  echo "一次性装一下 Xcode Command Line Tools（几百 MB）："
  echo "  1) 打开「终端」"
  echo "  2) 运行：xcode-select --install"
  echo "  3) 弹窗点「安装」，同意协议，等它跑完"
  echo "  4) 回来再双击本脚本"
  echo
  echo "装不了 / 没有管理员密码？不要在这里编："
  echo "  · 让另一台 Mac 用 U 盘或 scp / rsync 把「轻聊.app」拷过来（不会带隔离标记，直接能开）"
  echo "  · 或者直接用 Safari 打开服务器地址（功能一样）"
  echo
  read -n 1 -s -r -p "按任意键关闭…"; echo
  exit 1
fi

echo "✓ 编译器：$(command -v swiftc)"
echo "  正在编译（第一次大约 10~30 秒）…"
echo
./build.sh "$VERSION"
CODE=$?
if [ $CODE -eq 0 ]; then
  echo
  echo "✓ 好了：$(pwd)/build/轻聊.app"
  echo "  本机编译的 App 没有「已隔离」标记，直接双击就能开。"
  echo "  想发给别人：用 build/qingliao-mac-$VERSION.zip（对方仍会被 Gatekeeper 拦，看包里的说明）。"
  open "$(pwd)/build" 2>/dev/null || true
else
  echo
  echo "✗ 编译失败，把上面的报错整段截图发我。"
fi
echo
read -n 1 -s -r -p "按任意键关闭…"; echo
