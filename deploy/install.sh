#!/bin/bash
# 轻聊 · 一键装到 Linux 服务器
# 用法： sudo bash install.sh [安装目录]   默认 /opt/qingliao
set -e

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-/opt/qingliao}"

if [ "$(id -u)" != "0" ]; then
  echo "用 sudo 跑：sudo bash install.sh"
  exit 1
fi

command -v python3 >/dev/null || { echo "缺 python3"; exit 1; }

echo "安装到 $DEST"
mkdir -p "$DEST"
cp "$SRC/server.py" "$SRC/social_server.py" "$DEST/"
rm -rf "$DEST/web"
cp -R "$SRC/web" "$DEST/web"
mkdir -p "$DEST/data"

chown -R root:root "$DEST"
chmod 700 "$DEST/data"

sed "s#/opt/qingliao#$DEST#g; s#server.py 8777#server.py 8777 --host 0.0.0.0#g" \
  "$SRC/deploy/qingliao.service" > /etc/systemd/system/qingliao.service
systemctl daemon-reload
systemctl enable --now qingliao

sleep 1
systemctl --no-pager status qingliao | head -6
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "装好了 → http://$IP:8777"
echo "日志：journalctl -u qingliao -f"
echo "数据：$DEST/data"
echo
echo "想只跑朋友圈、不开网页？"
echo "  systemctl disable --now qingliao"
echo "  cd $DEST && nohup python3 social_server.py > social.log 2>&1 &"
