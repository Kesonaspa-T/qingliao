#!/bin/bash
# 打一个能直接 scp 到服务器的包
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/qingliao-server.tar.gz"
cd "$HERE"
tar czf "$OUT" \
  --exclude='__pycache__' \
  server.py social_server.py web deploy README.md
echo "OK → $OUT"
ls -lh "$OUT"
