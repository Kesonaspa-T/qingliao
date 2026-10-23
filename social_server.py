#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""轻聊 · 朋友圈服务

只跑调度，不开网页。丢到服务器上挂着就行：

    python3 social_server.py

每 20 秒检查一次所有账号：该发朋友圈就发，该点赞/评论/回复/私聊/群里聊就做。

注意：别和 server.py 同时跑，两边都会调度，会重复发。
"""
import time

import server


def main():
    print("轻聊 · 朋友圈服务已启动")
    print("数据目录：%s" % server.DATA_DIR)
    print("账号：%s" % ", ".join(server.all_uids()))
    print("每 20 秒检查一次，Ctrl+C 停止。\n")
    while True:
        for uid in server.all_uids():
            try:
                server.social_tick(uid)
            except Exception as e:
                print("[social]", uid, e)
        time.sleep(20)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n已停止。")
