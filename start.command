#!/bin/bash
# 双击我就能启动
cd "$(dirname "$0")" || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  echo "没找到 python3，请先安装 Python 3。"
  read -r -p "按回车关闭…" _
  exit 1
fi
python3 server.py 8777 --open
