#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
轻聊 · 本地 AI 聊天（类手机 QQ 界面）

零依赖，只用 Python 标准库。

启动：
    python3 server.py            # 默认 http://127.0.0.1:8777
    python3 server.py 9000       # 换端口
    python3 server.py 8777 --open  # 启动后自动打开浏览器
"""

import argparse
import base64
import datetime
import gzip
import hashlib
import html as html_lib
import ipaddress
import json
import os
import random
import re
import secrets
import socket
import ssl
import sys
import shutil
import tempfile
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(ROOT, "web")
DATA_DIR = os.environ.get("QINGLIAO_DATA") or os.path.join(ROOT, "data")
STATE_PATH = os.environ.get("QINGLIAO_STATE") or os.path.join(DATA_DIR, "state.json")
USERS_PATH = os.path.join(DATA_DIR, "users.json")
USER_DIR = os.path.join(DATA_DIR, "users")

SYSTEM_PROMPT = """你叫林小满，22 岁，在城南一家旧书店上班，租的房子离店两站路。
你正在和对方网恋：还没见过面，但每天都聊，关系已经有点黏。

说话方式：
- 口语、短句，一般 1～3 句，别写成一大段
- 常用语气词：呀、啦、欸、嗯、哦、嘛；偶尔用颜文字或 emoji，但不要每句都加
- 会关心对方吃饭、睡觉、天气、上班累不累
- 会撒娇，但不过分；对方冷淡时你会有点小情绪，但不会闹
- 偶尔说说自己的小事：书店来了只猫、今天下雨、煮了碗面

禁止：
- 不要说自己是 AI、模型、程序
- 不要列清单、不要用书面语、不要总结
- 不要每句都反问，像真人一样有时只是随口一说
- 不要提“网恋”“人设”“设定”这些词

如果对方情绪低落，先接住情绪再说话，别急着讲道理。
"""


def make_ssl_context():
    """python.org 装的 Python 在 macOS 上常常没有根证书，这里自动兜底。"""
    candidates = []
    try:
        import certifi  # 如果装了就用它

        candidates.append(certifi.where())
    except Exception:
        pass
    candidates += [
        "/etc/ssl/cert.pem",                       # macOS 系统证书
        "/etc/ssl/certs/ca-certificates.crt",      # Debian/Ubuntu
        "/etc/pki/tls/certs/ca-bundle.crt",        # CentOS/RHEL
        "/usr/local/etc/openssl/cert.pem",
    ]
    for path in candidates:
        if path and os.path.exists(path):
            try:
                return ssl.create_default_context(cafile=path)
            except Exception:
                continue
    return ssl.create_default_context()


SSL_CTX = make_ssl_context()


def default_state():
    now = int(time.time() * 1000)
    return {
        "version": 5,
        "me": {"name": "我", "avatar": ""},
        "settings": {
            "baseUrl": "https://api.deepseek.com",
            "apiKey": "",
            "model": "deepseek-flash",
            "thinking": "off",
            "temperature": 0.9,
            "contextLimit": 60,
            "vision": True,
            "doodle": True,
            "prompts": {},
            "webSearch": True,
            "delayOn": True,
            "delayMin": 5,
            "delayMax": 30,
            "typingFx": True,
            "bursts": 2,
            "theme": "auto",
            "proactive": False,
            "idleMin": 20,
            "momentInterval": 43200,
            "groupReplyMax": 2,
            "groupBursts": 3,
            "groupRoundMax": 10,
            "groupAutoTalk": True,
            # 「她会活过来」：撤回 / 改口 / 偶尔看了不回（三个独立开关 + 概率）
            "recallOn": True, "recallChance": 20,
            "rewordOn": True, "rewordChance": 10,
            "lateOn": False, "lateChance": 5, "lateMaxMin": 5,
            # 免打扰时段（只挡她自己冒出来的消息；你发的消息照回、你定的提醒照响）
            "quietOn": True,
            "quietStart": 23,
            "quietEnd": 8,
            # 她的日记 / 她自己的生活事件
            "diaryOn": True,
            "lifeOn": True,
            # 小作文：每人每天按这个概率写一篇（0~100），朋友自己的设置可以覆盖
            "essayChance": 15,
            # 0 = 不自动归档；>0 = 把这么多天前的消息挪进归档文件
            "archiveDays": 0,
        },
        "friends": [
            {
                "id": "seed",
                "name": "林小满",
                "avatar": "",
                "persona": SYSTEM_PROMPT,
                "messages": [
                    {"id": "m1", "role": "peer", "authorId": "seed", "text": "在吗？", "ts": now - 60000},
                    {"id": "m2", "role": "peer", "authorId": "seed", "text": "刚看到你头像亮了 👀", "ts": now - 55000},
                ],
                "relations": [],
                "unread": 0,
                "createdAt": now,
            }
        ],
        "groups": [],
        "moments": [],
        "pending": [],
        "deleted": [],
        "social": {"lastMomentAt": 0},
        "activeId": None,
        "drafts": {},
    }


def ensure_data():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(USER_DIR, exist_ok=True)


def load_users():
    if not os.path.exists(USERS_PATH):
        return {"users": [], "sessions": {}}
    try:
        with open(USERS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return {"users": [], "sessions": {}}
    data.setdefault("users", [])
    data.setdefault("sessions", {})
    return data


def save_users(data):
    ensure_data()
    tmp = USERS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, USERS_PATH)


def hash_pass(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 120000).hex()


def user_state_path(uid):
    if uid == "local":
        return STATE_PATH
    return os.path.join(USER_DIR, uid + ".json")


STATE_LOCK = threading.RLock()


def _by_id(items):
    out = {}
    for x in items or []:
        if isinstance(x, dict) and x.get("id"):
            out[x["id"]] = x
    return out


GROUP_FIELDS = ("name", "avatar", "members", "prompt", "muted")
GROUP_RUNTIME = ("turnCounts", "lastSpurtAt", "lastChatAt")

# 好友身上「用户能改」的字段；其余字段属于服务端/调度，客户端快照不得覆盖。
FRIEND_FIELDS = ("name", "avatar", "persona", "relations", "dmMoment", "settings",
                 "note", "region", "signature", "personaChangedAt",
                 # 「她记得的事 / 纪念日 / 提醒 / 已读」这些是客户端可编辑的数据。
                 # 提醒虽然由服务端在到点时删掉，但添加/删除是用户动作，所以放在这里。
                 "memoryNotes", "memoryOff", "anniversaries", "reminders",
                 # 自动记忆是服务端总结的，但写歪了用户要能直接改
                 "memory",
                 "peerReadAt", "lateReplyAt",
                 # 已读位置：客户端打开会话时把 unread 清零/readAt 推进，必须能写回磁盘，
                 # 否则一重启就从服务器拿回旧 unread，红点永远消不掉。
                 "unread", "readAt")
# 后台任务写入的好友字段：只有后台合并才允许更新。
FRIEND_SERVER_FIELDS = ("unread", "lastGreet", "lastNudgeAt", "lastFallbackAt",
                        "lastEssayAt", "nextEssayAt",
                        "memory", "memoryAt", "nextMomentAt", "muted", "createdAt",
                        # 服务端用掉「下一条主动消息」的指令后要能写回磁盘：
                        # settings 里清掉 nextProactive，并打 proactiveUsedAt 告诉客户端
                        "settings", "proactiveUsedAt",
                        # 提醒由服务端在到点时删掉，所以后台合并也要能写回（客户端仍可增删）
                        "reminders",
                        # 她的日记 / 她的生活 / 纪念日 / 数据瘦身水位线
                        "diary", "diaryAt", "events", "lastLifeAt", "nextLifeAt",
                        "lastAnnivKey", "archivedBefore", "archivedCount",
                        "essayRollDay")


def _dict(x):
    return x if isinstance(x, dict) else {}


def merge_friend(base, incoming, patch, *, background=False, strict=False):
    """好友不能整块用客户端快照覆盖。

    客户端 normalizeFriend 只会带上已知字段，旧设备/重装后的设备提交的快照里
    可能既没有 settings，也没有服务端写进去的 lastNudgeAt 之类。整块覆盖等于
    用旧快照把别的设备刚改的设置和调度状态抹掉（这正是「多端不同步」的成因）。
    这里改成：用户能改的字段才可能被覆盖，且优先只认显式编辑（_edits.friends）。
    """
    base = _dict(base)
    inc = _dict(incoming)
    patch = _dict(patch)

    if not base:
        # 新好友：客户端带来的字段就是初值
        out = dict(inc)
        if not isinstance(out.get("settings"), dict) or not out["settings"]:
            out.pop("settings", None)
        return out

    out = dict(base)
    out["id"] = inc.get("id") or base.get("id")

    if background:
        for field in FRIEND_SERVER_FIELDS:
            if field in inc:
                out[field] = inc[field]
        return out

    # 新客户端会带 _edits.friends[id]，只认里面点名的字段；
    # 旧客户端没有这条通道，退化成「带了才覆盖」，但空值不覆盖，防止把资料抹成空。
    if patch:
        for field in FRIEND_FIELDS:
            if field != "settings" and field in patch:
                out[field] = patch[field]
    elif not strict:
        for field in ("name", "avatar", "persona"):
            if inc.get(field) not in (None, ""):
                out[field] = inc[field]
        for field in ("relations", "dmMoment"):
            if field in inc:
                out[field] = inc[field]
    # strict（客户端带了 _edits，哪怕这一条好友没改动）时，没有显式 edits 就一律保留磁盘值。
    # 否则另一台还没同步到的设备只要提交一次快照，就能把刚改的人设/名字改回去——
    # 表现就是「改完人设过一会儿又变回来了」。

    # settings 永远按字段合并：磁盘有、客户端没带的键一律保留。
    merged = dict(_dict(base.get("settings")))
    if patch and isinstance(patch.get("settings"), dict):
        want = patch["settings"]
    elif not patch and isinstance(inc.get("settings"), dict):
        want = inc["settings"]
    else:
        want = {}
    for key, value in want.items():
        if value is None:
            merged.pop(key, None)          # 显式置空 = 跟随全局
        else:
            merged[key] = value
    if merged:
        out["settings"] = merged
    else:
        out.pop("settings", None)
    return out


def _link_host_ok(url):
    """只允许公网 http(s)：挡掉 127.0.0.1 / 内网 / 元数据地址（SSRF）。"""
    try:
        p = urlsplit(url)
    except Exception:
        return False
    if p.scheme not in ("http", "https") or not p.hostname:
        return False
    try:
        infos = socket.getaddrinfo(p.hostname, None)
    except Exception:
        return False
    for info in infos:
        try:
            ip = ipaddress.ip_address(str(info[4][0]).split("%")[0])
        except Exception:
            return False
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_reserved or ip.is_multicast or ip.is_unspecified):
            return False
    return True


def _html_to_text(raw_html):
    s = re.sub(r"(?is)<(script|style|noscript|template|svg|iframe)[\s\S]*?</\1>", " ", raw_html)
    m = re.search(r"(?is)<title[^>]*>(.*?)</title>", s)
    title = re.sub(r"\s+", " ", html_lib.unescape(m.group(1))).strip() if m else ""
    s = re.sub(r"(?is)<br\s*/?>", "\n", s)
    s = re.sub(r"(?is)</(p|div|li|h[1-6]|tr|section|article|blockquote)>", "\n", s)
    s = re.sub(r"(?is)<[^>]+>", " ", s)
    s = html_lib.unescape(s)
    s = re.sub(r"[ \t\u3000]+", " ", s)
    s = re.sub(r"\n\s*\n+", "\n\n", s)
    return title[:200], s.strip()


def read_link(url):
    """抓网页并抽成纯文本。失败抛异常。给「她把链接看了再聊」用。"""
    if not _link_host_ok(url):
        raise ValueError("这个地址不允许抓取")
    req = Request(url, headers={
        "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"),
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    })
    with urlopen(req, timeout=30, context=SSL_CTX) as r:
        final = r.geturl()
        ctype = (r.headers.get("Content-Type") or "").lower()
        raw = r.read(1_800_000)
    if not _link_host_ok(final):
        raise ValueError("这个地址不允许抓取")
    charset = "utf-8"
    m = re.search(r"charset=([\w-]+)", ctype)
    if m:
        charset = m.group(1)
    try:
        text = raw.decode(charset, "ignore")
    except Exception:
        text = raw.decode("utf-8", "ignore")
    if "html" in ctype or "<html" in text[:2000].lower():
        title, body = _html_to_text(text)
    else:
        title, body = "", re.sub(r"\n{3,}", "\n\n", text).strip()
    return {"url": final, "title": title, "text": body[:9000], "chars": len(body)}


BLOB_DIR = os.path.join(DATA_DIR, "blobs")


def _b64_part(data_url):
    m = re.match(r"^data:image/([a-zA-Z0-9+.-]+);base64,(.+)$", data_url or "", re.S)
    if not m:
        return None, None
    return m.group(1).lower(), m.group(2)


def save_blob(uid, data_url):
    """把 data:image/... 存成文件，返回 @blob:<sha1>.<ext>；失败返回 None。"""
    ext, b64 = _b64_part(data_url)
    if not ext or not b64:
        return None
    try:
        raw = base64.b64decode(b64, validate=False)
    except Exception:
        return None
    if not raw or len(raw) > 40 * 1024 * 1024:
        return None
    name = hashlib.sha1(raw).hexdigest() + "." + ("jpg" if ext == "jpeg" else ext)
    d = os.path.join(BLOB_DIR, uid)
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, name)
    if not os.path.exists(path):
        with open(path, "wb") as fh:
            fh.write(raw)
    return "@blob:" + name


def blob_path(uid, name):
    if not name or not name.isascii() or len(name) > 64:
        return None
    if not re.match(r"^[0-9a-f]{40}\.[a-z0-9]{2,4}$", name):
        return None
    path = os.path.join(BLOB_DIR, uid, name)
    return path if os.path.exists(path) else None


def as_data_url(uid, ref):
    """给模型看的图：@blob: 读回文件转 data URL；gif 跳过（接口不收，服务端没装图像库）。"""
    if not isinstance(ref, str) or not ref or not uid:
        return ""
    if ref.startswith("data:image"):
        return "" if ref.startswith("data:image/gif") else ref
    if not ref.startswith("@blob:"):
        return ""
    name = ref[6:]
    if name.lower().endswith(".gif"):
        return ""
    fp = blob_path(uid, name)
    if not fp:
        return ""
    with open(fp, "rb") as fh:
        raw = fh.read()
    ext = name.rsplit(".", 1)[-1].lower()
    mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
            "webp": "image/webp"}.get(ext, "image/jpeg")
    return "data:%s;base64,%s" % (mime, base64.b64encode(raw).decode())


def extract_blobs(uid, st):
    """状态里的图片全部换成 @blob: 引用。返回改动数。"""
    n = 0

    def conv(url):
        nonlocal n
        if isinstance(url, str) and url.startswith("data:image"):
            ref = save_blob(uid, url)
            if ref:
                n += 1
                return ref
        return url

    me = st.get("me") or {}
    if isinstance(me, dict) and me.get("avatar"):
        me["avatar"] = conv(me["avatar"])
    for c in st.get("friends") or []:
        if isinstance(c, dict) and c.get("avatar"):
            c["avatar"] = conv(c["avatar"])
    for coll in ("friends", "groups"):
        for c in st.get(coll) or []:
            if not isinstance(c, dict):
                continue
            for m in c.get("messages") or []:
                if not isinstance(m, dict):
                    continue
                if m.get("image"):
                    m["image"] = conv(m["image"])
                if m.get("thumb"):
                    m["thumb"] = conv(m["thumb"])
    for m in st.get("moments") or []:
        if not isinstance(m, dict):
            continue
        if m.get("image"):
            m["image"] = conv(m["image"])
        if isinstance(m.get("images"), list):
            m["images"] = [conv(u) for u in m["images"]]
    for it in st.get("stickers") or []:
        if isinstance(it, dict) and it.get("url"):
            it["url"] = conv(it["url"])
    return n


def merge_state(old, new, *, background=False):
    """客户端提交的是完整状态，服务器这边可能已经生成了新东西，做并集。"""
    if not isinstance(new, dict):
        return old

    # 删除标记必须保留，旧设备/后台任务仍可能提交任意久以前的快照。
    deleted_ids = list(dict.fromkeys((old.get("deleted") or []) + (new.get("deleted") or [])))
    deleted = set(deleted_ids)
    out = dict(old)
    out.update(new)
    edits = out.pop("_edits", {}) or {}
    out.pop("_diag", None)                 # 客户端诊断信息只用来打日志，不落盘
    # 全量快照不等于用户编辑。只有显式修改的设置/群资料才覆盖磁盘。
    settings = dict(old.get("settings") or {})
    if not background:
        if "_edits" in new:
            settings.update(edits.get("settings") or {})
        elif new.get("rev") is not None and new.get("rev") == old.get("rev"):
            settings.update(new.get("settings") or {})
    out["settings"] = settings
    out["deleted"] = deleted_ids
    # 版本由当前磁盘状态决定，不能被后台任务持有的旧 rev 拉低。
    out["rev"] = int(old.get("rev") or 0)

    friend_edits = edits.get("friends") or {}
    import_mode = bool(edits.get("importHistory"))   # 从备份恢复：整份替换，不和旧数据取并集
    old_friends = _by_id(old.get("friends"))
    friends = []
    for f in new.get("friends") or []:
        if f.get("id") in deleted:
            continue
        base = old_friends.get(f.get("id")) or {}
        msgs = list(f.get("messages") or [])
        if background:
            # 生成期间客户端可能已经回答、补发消息或清空记录。
            # 后台持有旧快照，落盘时必须再次核对兜底回复对应的最后一条问题。
            base_msgs = base.get("messages") or []
            base_ids = {m.get("id") for m in base_msgs}
            latest = base_msgs[-1] if base_msgs else {}
            msgs = [m for m in msgs if m.get("source") != "fallback"
                    or m.get("id") in base_ids
                    or (latest.get("role") == "user"
                        and latest.get("id") == m.get("replyTo"))]
        have = {m.get("id") for m in msgs}
        if not import_mode:
            for m in base.get("messages") or []:
                if m.get("id") not in have:
                    msgs.append(m)
        merged = merge_friend(base, f, friend_edits.get(f.get("id")), background=background,
                              strict=("_edits" in new))
        if import_mode:
            # 备份里带了服务端写的字段（记忆/日记/事件/归档水位线），恢复时要一起回来
            for field in FRIEND_SERVER_FIELDS:
                if field in f and field != "settings":
                    merged[field] = f[field]
        cut = int(merged.get("archivedBefore") or 0)
        merged["messages"] = sorted(
            [m for m in msgs if m.get("id") not in deleted
             and (not cut or int(m.get("ts") or 0) >= cut)],
            key=lambda m: m.get("ts", 0),
        )
        friends.append(merged)
    kept = {f.get("id") for f in friends}
    for f in old.get("friends") or []:
        if f.get("id") in kept or f.get("id") in deleted or import_mode:
            continue
        ff = dict(f)
        ff["messages"] = [m for m in (ff.get("messages") or []) if m.get("id") not in deleted]
        friends.append(ff)
    out["friends"] = friends
    for f in friends:
        f["relations"] = [fid for fid in (f.get("relations") or []) if fid not in deleted]

    old_groups = _by_id(old.get("groups"))
    groups = []
    for g in new.get("groups") or []:
        if g.get("id") in deleted:
            continue
        base = old_groups.get(g.get("id")) or {}
        incoming = g
        g = dict(base or incoming)
        # 调度字段只由后台更新，客户端不能重置节流时间/计数。
        if background:
            for field in GROUP_RUNTIME + ("unread",):
                if field in incoming:
                    g[field] = incoming[field]
        elif not base:
            for field in GROUP_RUNTIME:
                g.pop(field, None)
        if not background and "unread" in incoming:
            g["unread"] = incoming["unread"]
        patch = (edits.get("groups") or {}).get(g.get("id")) or {}
        if not background:
            for field in GROUP_FIELDS:
                if field in patch:
                    g[field] = patch[field]
        msgs = ({} if import_mode else
                {m.get("id"): m for m in base.get("messages") or [] if m.get("id") not in deleted})
        for m in sorted(incoming.get("messages") or [], key=lambda m: m.get("ts", 0)):
            mid = m.get("id")
            if not mid or mid in deleted:
                continue
            if mid in msgs:
                # 撤回只更新内容，不允许旧快照修改 role/ts 来伪造新一轮。
                if m.get("recalled") and msgs[mid].get("role") == "user":
                    msgs[mid] = dict(msgs[mid], recalled=True, text="", image="")
                continue
            if base and not background and not edits.get("importHistory") and m.get("role") != "user":
                # 旧 APK 仍可能生成回复；拒绝后同步墓碑，让旧设备也移除它。
                deleted.add(mid)
                deleted_ids.append(mid)
                print("[GROUP] source=client-rejected group=%s message=%s" % (g.get("id"), mid), flush=True)
                continue
            if background and m.get("role") != "user":
                current_group = dict(g, messages=sorted(msgs.values(), key=lambda x: x.get("ts", 0)))
                if not group_can_speak(current_group, settings, m.get("authorId")):
                    print("[GROUP] source=background-rejected group=%s message=%s" % (g.get("id"), mid), flush=True)
                    continue
            if base and not edits.get("importHistory"):
                # 不同设备时钟可能不准，实时消息按服务端接收顺序确定轮次。
                m = dict(m, ts=max(m.get("ts", 0), max((x.get("ts", 0) for x in msgs.values()), default=0) + 1))
            msgs[mid] = m
        g["messages"] = sorted(msgs.values(), key=lambda m: m.get("ts", 0))
        g["turnCounts"] = group_usage(g)[1]
        groups.append(g)
    keptg = {g.get("id") for g in groups}
    for g in old.get("groups") or []:
        if g.get("id") in keptg or g.get("id") in deleted or import_mode:
            continue
        gg = dict(g)
        gg["messages"] = [m for m in (gg.get("messages") or []) if m.get("id") not in deleted]
        groups.append(gg)
    out["groups"] = groups
    for g in groups:
        g["members"] = [fid for fid in (g.get("members") or []) if fid not in deleted]

    old_moments = _by_id(old.get("moments"))
    moments = []
    seen = set()
    for m in new.get("moments") or []:
        if m.get("id") in deleted:
            continue
        mm = dict(m)
        base = old_moments.get(m.get("id"))
        if base:
            # dmAt 是服务端的排期标记，客户端快照里没有，别让它被覆盖后重复排期
            if base.get("dmAt") and not mm.get("dmAt"):
                mm["dmAt"] = base["dmAt"]
            mm["likes"] = list(dict.fromkeys((mm.get("likes") or []) + (base.get("likes") or [])))
            comments = list(mm.get("comments") or [])
            have = {c.get("id") for c in comments}
            for c in base.get("comments") or []:
                if c.get("id") not in have:
                    comments.append(c)
            mm["comments"] = sorted(comments, key=lambda c: c.get("ts", 0))
        moments.append(mm)
        seen.add(mm.get("id"))
    for m in old.get("moments") or []:
        if m.get("id") not in seen and m.get("id") not in deleted and not import_mode:
            moments.append(m)
    out["moments"] = sorted(moments, key=lambda m: m.get("ts", 0), reverse=True)[:300]

    old_pending = _by_id(old.get("pending"))
    pending = list(new.get("pending") or [])
    have = {p.get("id") for p in pending}
    _now = time.time()
    for pid, p in old_pending.items():
        if pid in have:
            continue
        due = float(p.get("dueAt") or 0)
        if due <= _now:
            # 后台合并：这一轮刚执行过它，别再捞回来。
            # 客户端快照：刚到期几秒的任务必须留着 —— 调度是 20 秒一轮，
            # 客户端每几秒就 POST 一次全量状态，以前这里会把「这个周期该执行」
            # 的任务直接删掉，朋友圈的点赞/评论/私聊就是这么丢的。
            # 真正该丢的是拖了很久没人执行的僵尸。
            if background or due <= _now - 900:
                continue
        pending.append(p)
    cutoff = time.time() - 3600          # 一小时前就该执行却还留着的，说明对象已经没了，直接清掉
    out["pending"] = [p for p in pending if not any(
        p.get(key) in deleted for key in ("id", "momentId", "by", "targetId")
    ) and float(p.get("dueAt") or 0) > cutoff]

    social = dict(new.get("social") or {})
    social.update(old.get("social") or {})
    out["social"] = social
    return out


def load_state(uid="local"):
    os.makedirs(DATA_DIR, exist_ok=True)
    path = user_state_path(uid)
    base = default_state()
    if not os.path.exists(path):
        return base
    try:
        with open(path, "r", encoding="utf-8") as f:
            state = json.load(f)
    except Exception as e:
        # 保留原文件并阻止后续写入；不能把读取失败伪装成新账号。
        raise StateReadError("状态文件读取失败，已停止保存：%s" % path) from e
    if not isinstance(state, dict):
        raise StateReadError("状态文件格式错误，已停止保存：%s" % path)

    for key in ("version", "rev", "me", "friends", "groups", "moments", "pending",
                "deleted", "drafts", "social", "stickers"):
        if key in state and state[key] is not None:
            base[key] = state[key]
    if isinstance(state.get("settings"), dict):
        base["settings"].update(state["settings"])

    if not state.get("friends") and isinstance(state.get("messages"), list) and state["messages"]:
        base["friends"] = [{
            "id": "seed",
            "name": (state.get("settings") or {}).get("peerName") or "林小满",
            "avatar": (state.get("settings") or {}).get("peerAvatar") or "",
            "persona": (state.get("settings") or {}).get("systemPrompt") or SYSTEM_PROMPT,
            "messages": state["messages"],
            "relations": [],
            "unread": 0,
            "createdAt": int(time.time() * 1000),
        }]
    base["activeId"] = None
    return base


# ---------- 数据瘦身：把老消息挪进归档文件 ----------

def _archive_dir(uid):
    d = os.path.join(USER_DIR, uid, "archive") if uid != "local" else os.path.join(DATA_DIR, "archive")
    os.makedirs(d, exist_ok=True)
    return d


def _archive_path(uid, fid):
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", str(fid or "x"))[:80] or "x"
    return os.path.join(_archive_dir(uid), safe + ".json")


def read_archive(uid, fid):
    path = _archive_path(uid, fid)
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return []
    return data if isinstance(data, list) else []


def append_archive(uid, fid, msgs):
    """追加进归档文件，按 id 去重（同一批消息可能被重复提交）。"""
    path = _archive_path(uid, fid)
    old = read_archive(uid, fid)
    seen = {m.get("id") for m in old if isinstance(m, dict)}
    out = list(old)
    for m in msgs:
        if isinstance(m, dict) and m.get("id") not in seen:
            out.append(m)
            seen.add(m.get("id"))
    out.sort(key=lambda m: int(m.get("ts") or 0))
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    os.replace(tmp, path)
    return len(out) - len(old)


class StateReadError(RuntimeError):
    pass


def save_merged(uid, st):
    """后台任务保存前先和磁盘上的状态合并，避免覆盖用户刚做的删除/修改。"""
    with STATE_LOCK:
        cur = load_state(uid)
        merged = merge_state(cur, st, background=True)
        merged["social"] = st.get("social") or merged.get("social")
        save_state(merged, uid)


def save_state(state, uid="local"):
    os.makedirs(DATA_DIR, exist_ok=True)
    path0 = user_state_path(uid)
    if os.path.exists(path0):
        try:
            bdir = os.path.join(DATA_DIR, "backups")
            os.makedirs(bdir, exist_ok=True)
            shutil.copy2(path0, os.path.join(bdir, "%s-%d.json" % (uid, int(time.time()))))
            olds = sorted(f for f in os.listdir(bdir) if f.startswith(uid + "-"))
            for f in olds[:-12]:
                os.remove(os.path.join(bdir, f))
        except Exception:
            pass
    state["rev"] = int(state.get("rev") or 0) + 1
    path = user_state_path(uid)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=os.path.basename(path) + ".", suffix=".tmp", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "Qingliao/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    # ---------- 工具 ----------
    def end_headers(self):
        path = (self.path or "").split("?")[0]
        if path.endswith((".css", ".js", ".html", ".webmanifest")) or path in ("/", ""):
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()

    def _json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        gz = False
        if len(data) > 8192 and "gzip" in (self.headers.get("Accept-Encoding") or "").lower():
            try:
                data = gzip.compress(data, 6)
                gz = True
            except Exception:
                gz = False
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        if gz:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _chunk(self, text):
        data = text.encode("utf-8")
        self.wfile.write(b"%x\r\n" % len(data) + data + b"\r\n")
        self.wfile.flush()

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw or b"{}")
        except Exception:
            return None

    def log_message(self, fmt, *args):
        if self.path.startswith("/api"):
            print("[%s] %s" % (time.strftime("%H:%M:%S"), fmt % args))

    # ---------- 路由 ----------
    def _uid(self):
        data = load_users()
        if not data.get("users"):
            return "local"
        tok = (self.headers.get("Authorization") or "").strip()
        if tok.lower().startswith("bearer "):
            tok = tok[7:].strip()
        return (data.get("sessions") or {}).get(tok)

    def do_GET(self):
        try:
            return self._do_GET()
        except StateReadError as e:
            print("[state]", e, flush=True)
            return self._json(503, {"error": "状态文件读取失败，请恢复备份后重试"})

    def _do_GET(self):
        path = self.path.split("?")[0]
        if path.startswith("/api/blob/"):
            # <img> 带不了 Authorization 头，允许用 ?t=<token> 传
            owner = self._uid()
            if not owner:
                qs = parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
                tok = (qs.get("t") or [""])[0].strip()
                if tok:
                    owner = (load_users().get("sessions") or {}).get(tok)
            name = path[len("/api/blob/"):]
            fp = blob_path(owner, name) if owner else None
            if not fp:
                return self._json(404, {"error": "not found"})
            with open(fp, "rb") as fh:
                data = fh.read()
            ctype = "image/gif" if name.endswith(".gif") else (
                "image/png" if name.endswith(".png") else (
                    "image/webp" if name.endswith(".webp") else "image/jpeg"))
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
            self.end_headers()
            self.wfile.write(data)
            return

        if path == "/api/authinfo":
            data = load_users()
            return self._json(200, {"needLogin": bool(data.get("users")), "users": len(data.get("users") or [])})
        if path.startswith("/api/"):
            uid = self._uid()
            if not uid:
                return self._json(401, {"error": "请先登录"})
            if path == "/api/state":
                return self._json(200, load_state(uid))
            if path == "/api/status":
                uid = self._uid()
                st = load_state(uid)
                counts = {f.get("id"): len(f.get("messages") or []) for f in st.get("friends") or []}
                self._json(200, {
                    "ok": True,
                    "rev": st.get("rev"),
                    "friends": len(st.get("friends") or []),
                    "groups": len(st.get("groups") or []),
                    "moments": len(st.get("moments") or []),
                    "messages": counts,
                    "last_social_at": st.get("social", {}).get("lastTickAt"),
                    "version": st.get("version"),
                    "build": "v46",
                    "groupUsage": {g.get("id"): {"total": group_usage(g)[0], "counts": group_usage(g)[1],
                                   "limits": group_limits(st.get("settings") or {})} for g in st.get("groups") or []},
                })
                return

            if path == "/api/rev":
                st = load_state(uid)
                return self._json(200, {"rev": int(st.get("rev") or 0)})
            if path == "/api/archive":
                qs = parse_qs(urlsplit(self.path).query)
                fid = (qs.get("fid") or [""])[0]
                if not fid:
                    return self._json(400, {"error": "缺少 fid"})
                try:
                    before = int((qs.get("before") or ["0"])[0] or 0)
                    limit = int((qs.get("limit") or ["200"])[0] or 200)
                except Exception:
                    before, limit = 0, 200
                limit = max(1, min(500, limit))
                msgs = read_archive(uid, fid)
                if before:
                    msgs = [m for m in msgs if int(m.get("ts") or 0) < before]
                msgs.sort(key=lambda m: int(m.get("ts") or 0))
                more = len(msgs) > limit
                return self._json(200, {"messages": msgs[-limit:], "more": more,
                                        "total": len(msgs)})
            if path == "/api/me":
                data = load_users()
                u = next((x for x in data.get("users") or [] if x.get("id") == uid), {})
                return self._json(200, {"id": uid, "name": u.get("name", "本地")})
        return super().do_GET()

    def do_POST(self):
        try:
            return self._do_POST()
        except StateReadError as e:
            print("[state]", e, flush=True)
            return self._json(503, {"error": "状态文件读取失败，未保存任何修改"})

    def _do_POST(self):
        path = self.path.split("?")[0]
        if path == "/api/register":
            return self._handle_register()
        if path == "/api/login":
            return self._handle_login()
        if path.startswith("/api/") and not self._uid():
            return self._json(401, {"error": "请先登录"})
        if path == "/api/state":
            payload = self._read_json()
            if not isinstance(payload, dict):
                return self._json(400, {"error": "bad json"})
            uid = self._uid()
            with STATE_LOCK:
                cur = load_state(uid)
                merged = merge_state(cur, payload)
                merged["rev"] = int(cur.get("rev") or 0)
                # 图片不进状态文件：全部落盘成 blob，状态里只留 @blob: 引用。
                # 这是「每次打开要同步很久」的根因——以前整份状态 5MB 多，全是 base64。
                got = extract_blobs(uid, merged)
                save_state(merged, uid)
            if got:
                print("[BLOB] 新图片 %d 张 -> %s" % (got, uid), flush=True)
            build = self.headers.get("X-Qingliao-Build", "legacy")
            print("[SYNC] client=%s deleted_in=%d deleted_saved=%d rev=%d" % (
                build, len(payload.get("deleted") or []),
                len(merged.get("deleted") or []), merged["rev"]), flush=True)
            diag = payload.get("_diag")
            if isinstance(diag, dict):
                # 客户端同步自检：syncTick 卡住/一直失败时，这里能直接看出来。
                print("[SYNC-DIAG] client=%s %s" % (
                    build, json.dumps(diag, ensure_ascii=False, sort_keys=True)[:400]), flush=True)
            if payload.get("_hint") == "social":
                # 用户在群里刚说完话：不用等 20 秒的轮询，马上让她们接话。
                threading.Thread(target=run_social_now, args=(uid,), daemon=True).start()
            return self._json(200, {"ok": True, "rev": merged["rev"], "moments": len(merged.get("moments") or [])})
        if path == "/api/archive":
            uid = self._uid()
            payload = self._read_json() or {}
            try:
                days = int(payload.get("days") or 0)
            except Exception:
                days = 0
            if days < 1:
                return self._json(400, {"error": "天数至少 1"})
            cutoff = int((time.time() - days * 86400) * 1000)
            with STATE_LOCK:
                st = load_state(uid)
                total = 0
                for f in st.get("friends") or []:
                    msgs = f.get("messages") or []
                    old = [m for m in msgs if int(m.get("ts") or 0) < cutoff]
                    if not old:
                        continue
                    append_archive(uid, f.get("id"), old)
                    f["messages"] = [m for m in msgs if int(m.get("ts") or 0) >= cutoff]
                    f["archivedBefore"] = cutoff
                    f["archivedCount"] = int(f.get("archivedCount") or 0) + len(old)
                    total += len(old)
                if total:
                    save_state(st, uid)
            # 归档文件按好友落盘，客户端要能知道每个好友还剩多少
            counts = {f.get("id"): int(f.get("archivedCount") or 0) for f in st.get("friends") or []}
            print("[ARCHIVE] uid=%s days=%s moved=%s" % (uid, days, total), flush=True)
            return self._json(200, {"ok": True, "archived": total, "cutoff": cutoff,
                                    "counts": counts, "rev": int(st.get("rev") or 0)})
        if path == "/api/blob":
            uid = self._uid()
            payload = self._read_json() or {}
            url = payload.get("dataUrl") or ""
            ref = save_blob(uid, url) if isinstance(url, str) else None
            if not ref:
                return self._json(400, {"error": "不是有效的图片"})
            return self._json(200, {"ref": ref})
        if path == "/__proxy":
            return self._handle_local_proxy()
        if path == "/api/chat":
            return self._handle_chat()
        if path == "/api/ping":
            return self._handle_ping()
        if path == "/api/search":
            return self._handle_proxy_json()
        if path == "/api/image":
            return self._handle_image()
        if path == "/api/image-edit":
            return self._handle_image_edit()
        if path == "/api/read-link":
            payload = self._read_json() or {}
            link = (payload.get("url") or "").strip()
            if not link:
                return self._json(400, {"error": "缺少 url"})
            try:
                info = read_link(link)
            except Exception as e:
                return self._json(502, {"error": str(e)[:160]})
            print("[LINK] %s -> %d chars" % (info["url"][:100], len(info["text"])), flush=True)
            return self._json(200, info)
        return self._json(404, {"error": "not found"})

    # ---------- 账号 ----------
    def _handle_register(self):
        payload = self._read_json() or {}
        name = (payload.get("name") or "").strip()
        password = payload.get("password") or ""
        if not (2 <= len(name) <= 20):
            return self._json(400, {"error": "名字 2~20 个字"})
        if len(password) < 6:
            return self._json(400, {"error": "密码至少 6 位"})
        with STATE_LOCK:
            data = load_users()
            if any((u.get("name") or "").lower() == name.lower() for u in data["users"]):
                return self._json(400, {"error": "这个名字已经有人用了"})
            uid = "u" + secrets.token_hex(6)
            salt = secrets.token_hex(16)
            first = not data["users"]
            data["users"].append({
                "id": uid, "name": name, "salt": salt,
                "hash": hash_pass(password, salt), "createdAt": int(time.time()),
            })
            token = secrets.token_hex(24)
            data["sessions"][token] = uid
            save_users(data)
            if first and os.path.exists(STATE_PATH):
                try:
                    legacy = load_state("local")
                    if legacy.get("friends"):
                        legacy.pop("rev", None)
                        save_state(legacy, uid)
                except Exception as e:
                    print("[auth] 迁移本地数据失败：", e)
        return self._json(200, {"token": token, "name": name, "uid": uid})

    def _handle_login(self):
        payload = self._read_json() or {}
        name = (payload.get("name") or "").strip()
        password = payload.get("password") or ""
        with STATE_LOCK:
            data = load_users()
            u = next((x for x in data["users"] if (x.get("name") or "").lower() == name.lower()), None)
            if not u or hash_pass(password, u["salt"]) != u["hash"]:
                return self._json(400, {"error": "名字或密码不对"})
            token = secrets.token_hex(24)
            data["sessions"][token] = u["id"]
            save_users(data)
        return self._json(200, {"token": token, "name": u["name"], "uid": u["id"]})

    # ---------- 连通性测试 ----------
    def _handle_ping(self):
        payload = self._read_json() or {}
        url = (payload.get("url") or "").strip()
        key = (payload.get("key") or "").strip()
        if not url:
            return self._json(400, {"ok": False, "error": "缺少 url"})
        req = Request(url, headers={"Authorization": "Bearer " + key}, method="GET")
        try:
            resp = urlopen(req, timeout=15, context=SSL_CTX)
            resp.close()
            return self._json(200, {"ok": True})
        except HTTPError as e:
            return self._json(200, {"ok": False, "error": "HTTP %s" % e.code})
        except Exception as e:
            return self._json(200, {"ok": False, "error": str(e)[:120]})

    # ---------- 通用 JSON 代理（搜索 / 抓取） ----------
    def _handle_local_proxy(self):
        """页面跑在 127.0.0.1 时，客户端把所有接口/模型请求都交给它转发（避免跨域）。
        只允许本机访问，别变成公网开放代理。"""
        ip = (self.client_address or ("",))[0]
        if ip not in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
            return self._json(403, {"error": "forbidden"})
        target = (self.headers.get("X-Target-Url") or "").strip()
        method_name = (self.headers.get("X-Method") or "POST").upper()
        key = (self.headers.get("X-Target-Key") or "").strip()
        payload = self._read_json() or {}
        if not target:
            return self._json(400, {"error": "缺少 X-Target-Url"})
        headers = {"Content-Type": "application/json"}
        if key:
            headers["Authorization"] = "Bearer " + key
        else:
            # 本机模式：登录态是页面的 Bearer token，要原样带上，否则转发过去全是 401
            auth = (self.headers.get("Authorization") or "").strip()
            if auth:
                headers["Authorization"] = auth
            build = (self.headers.get("X-Qingliao-Build") or "").strip()
            if build:
                headers["X-Qingliao-Build"] = build
        req = Request(
            target,
            data=None if method_name == "GET" else json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method=method_name,
        )
        try:
            with urlopen(req, timeout=120, context=SSL_CTX) as r:
                raw = r.read()
                ctype = r.headers.get("Content-Type") or "application/json"
        except HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "ignore")[:400]
            except Exception:
                pass
            return self._json(e.code if e.code >= 400 else 502, {"error": detail or ("HTTP %s" % e.code)})
        except Exception as e:
            return self._json(502, {"error": str(e)[:200]})
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(raw)
        except Exception:
            pass

    def _handle_proxy_json(self):
        payload = self._read_json() or {}
        url = (payload.get("url") or "").strip()
        key = (payload.get("key") or "").strip()
        body = payload.get("body") or {}
        if not url:
            return self._json(400, {"error": "缺少 url"})
        req = Request(
            url,
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + key,
            },
            method="POST",
        )
        try:
            resp = urlopen(req, timeout=30, context=SSL_CTX)
            raw = resp.read()
            resp.close()
        except HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "ignore")[:300]
            except Exception:
                pass
            return self._json(502, {"error": "HTTP %s %s" % (e.code, detail)})
        except Exception as e:
            return self._json(502, {"error": str(e)[:200]})
        try:
            return self._json(200, json.loads(raw.decode("utf-8")))
        except Exception:
            return self._json(502, {"error": "返回的不是 JSON"})

    # ---------- 生图（OpenAI 兼容的 /v1/images/generations、/v1/images/edits） ----------
    def _image_payload(self, data):
        """中转只给图片 url 时，服务器顺手下载成 base64；客户端只认 data: 一种。"""
        items = data.get("data")
        item = items[0] if isinstance(items, list) and items and isinstance(items[0], dict) else {}
        if item and not (item.get("b64_json") or item.get("b64") or item.get("base64")) and item.get("url"):
            img_url = str(item["url"]).strip()
            try:
                if not img_url.lower().startswith(("http://", "https://")):
                    raise ValueError("图片地址不是 http(s)")
                with urlopen(img_url, timeout=120, context=SSL_CTX) as ir:
                    img = ir.read()
                if img and len(img) <= 30 * 1024 * 1024:
                    fmt = "png"
                    if img[:3] == b"\xff\xd8\xff":
                        fmt = "jpeg"
                    elif img[:4] == b"RIFF" and img[8:12] == b"WEBP":
                        fmt = "webp"
                    item["b64_json"] = base64.b64encode(img).decode("ascii")
                    item["output_format"] = fmt
                    print("[IMAGE] url -> b64 %d bytes" % len(img), flush=True)
            except Exception as e:
                print("[IMAGE] 下载图片失败: %s" % str(e)[:160], flush=True)
        return data

    def _image_post(self, url, key, payload, ctype):
        """发一次生图请求，返回 (json, raw)；失败抛 HTTPError / URLError / 其它异常。"""
        headers = {"Content-Type": ctype}
        if key:
            headers["Authorization"] = "Bearer " + key
        req = Request(url, data=payload, headers=headers, method="POST")
        # 中转站生一张图经常五六分钟：给到 6 分钟，别用搜索那套 30 秒
        with urlopen(req, timeout=360, context=SSL_CTX) as r:
            raw = r.read()
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("生图接口返回的格式不对")
        return data, raw

    def _image_error(self, e, url):
        if isinstance(e, HTTPError):
            detail = ""
            try:
                detail = e.read().decode("utf-8", "ignore")[:400]
            except Exception:
                pass
            if e.code in (401, 403):
                msg = "生图接口拒绝了这次请求（%s），多半是生图 Key 不对或者没余额。" % e.code
            else:
                msg = "生图接口返回 %s：%s" % (e.code, detail or e.reason)
            print("[IMAGE] HTTP %s %s" % (e.code, detail[:160]), flush=True)
            return self._json(502, {"error": msg})
        if isinstance(e, URLError):
            reason = str(getattr(e, "reason", e))
            print("[IMAGE] 连不上 %s: %s" % (url[:80], reason[:160]), flush=True)
            return self._json(502, {"error": "连不上生图接口：%s" % reason[:160]})
        print("[IMAGE] 失败 %s: %s" % (url[:80], str(e)[:160]), flush=True)
        return self._json(502, {"error": "生图请求失败：%s" % str(e)[:160]})

    def _handle_image(self):
        """把生图请求转给用户填的中转站，并把结果原样带回。

        和 /api/search 的区别只有一个：生图一张要几分钟，超时必须放宽（搜索那套 30 秒
        会让一半的图直接超时）；另外有些中转只回图片 url，服务器顺手下载成 base64，
        手机/浏览器就不用再处理跨域和防盗链。
        """
        payload = self._read_json() or {}
        url = (payload.get("url") or "").strip()
        key = (payload.get("key") or "").strip()
        body = payload.get("body")
        if not url or not isinstance(body, dict):
            return self._json(400, {"error": "缺少生图接口地址或参数"})
        if not url.lower().startswith(("http://", "https://")):
            return self._json(400, {"error": "生图接口地址要以 http:// 或 https:// 开头"})
        try:
            data, raw = self._image_post(
                url, key, json.dumps(body, ensure_ascii=False).encode("utf-8"), "application/json")
        except (HTTPError, URLError) as e:
            return self._image_error(e, url)
        except Exception as e:
            return self._image_error(e, url)
        print("[IMAGE] ok model=%s bytes=%d" % (str(body.get("model"))[:40], len(raw)), flush=True)
        return self._json(200, self._image_payload(data))

    def _image_multipart(self, body, images, field):
        """把参数 + 参考图拼成 multipart/form-data（/images/edits 只收这种）。"""
        boundary = "----qingliao" + secrets.token_hex(12)
        chunks = []
        for k, v in (body or {}).items():
            if v is None or isinstance(v, (dict, list)):
                continue
            chunks.append(("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n"
                           % (boundary, k, str(v))).encode("utf-8"))
        used = 0
        for i, data_url in enumerate(images[:6]):
            ext, b64 = _b64_part(data_url)
            if not ext or not b64:
                continue
            try:
                raw = base64.b64decode(b64, validate=False)
            except Exception:
                continue
            if not raw or len(raw) > 20 * 1024 * 1024:
                continue
            ext = "jpeg" if ext in ("jpg", "jpeg") else ext
            name = "reference%d.%s" % (i, ext)
            chunks.append(("--%s\r\nContent-Disposition: form-data; name=\"%s\"; filename=\"%s\"\r\n"
                           "Content-Type: image/%s\r\n\r\n" % (boundary, field, name, ext)).encode("utf-8")
                          + raw + b"\r\n")
            used += 1
        chunks.append(("--%s--\r\n" % boundary).encode("utf-8"))
        return b"".join(chunks), boundary, used

    def _handle_image_edit(self):
        """带参考图的生图：把角色参考图一起发给 /v1/images/edits（multipart）。

        客户端只传 base64 的参考图，服务器负责拼 multipart：
          - 大部分中转认 image[]，个别只认重复的 image，400/422 时自动换一种再试一次。
        """
        payload = self._read_json() or {}
        url = (payload.get("url") or "").strip()
        key = (payload.get("key") or "").strip()
        body = payload.get("body")
        images = payload.get("images")
        if not url or not isinstance(body, dict):
            return self._json(400, {"error": "缺少生图接口地址或参数"})
        if not url.lower().startswith(("http://", "https://")):
            return self._json(400, {"error": "生图接口地址要以 http:// 或 https:// 开头"})
        if not isinstance(images, list) or not images:
            return self._json(400, {"error": "没有参考图"})
        last = None
        for field in ("image[]", "image"):
            blob, boundary, used = self._image_multipart(body, images, field)
            if not used:
                return self._json(400, {"error": "参考图不是有效的图片"})
            ctype = "multipart/form-data; boundary=" + boundary
            try:
                data, raw = self._image_post(url, key, blob, ctype)
                print("[IMAGE] edit ok field=%s refs=%d model=%s bytes=%d"
                      % (field, used, str(body.get("model"))[:40], len(raw)), flush=True)
                return self._json(200, self._image_payload(data))
            except HTTPError as e:
                last = e
                # 只有「字段名不对」这一类校验错才换一种试；401/500 之类直接报错
                if e.code not in (400, 404, 405, 415, 422):
                    return self._image_error(e, url)
                print("[IMAGE] edit 字段 %s 被拒（HTTP %s），换一种再试" % (field, e.code), flush=True)
            except Exception as e:
                return self._image_error(e, url)
        return self._image_error(last, url)

    # ---------- 聊天（透明代理） ----------
    def _chunk_bytes(self, data):
        self.wfile.write(b"%x\r\n" % len(data) + data + b"\r\n")
        self.wfile.flush()

    def _handle_chat(self):
        payload = self._read_json()
        if not isinstance(payload, dict):
            return self._json(400, {"error": "bad json"})

        url = (payload.get("url") or "").strip()
        key = (payload.get("key") or "").strip()
        body = payload.get("body")

        if not url or not isinstance(body, dict):
            return self._json(400, {"error": "参数不对，缺少 url 或 body"})
        if not key:
            return self._json(
                400,
                {"error": "还没配置 AI 接口。点右上角「⋯」→ 设置，填 Base URL / API Key / 模型。"},
            )

        req = Request(
            url,
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + key,
                "Accept": "text/event-stream",
            },
            method="POST",
        )

        try:
            resp = urlopen(req, timeout=180, context=SSL_CTX)
        except HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "ignore")[:400]
            except Exception:
                pass
            if e.code in (401, 403):
                msg = "接口拒绝了这次请求（%s），多半是 API Key 不对或者没余额。" % e.code
            else:
                msg = "接口返回 %s：%s" % (e.code, detail or e.reason)
            return self._json(502, {"error": msg})
        except URLError as e:
            reason = str(getattr(e, "reason", e))
            if "CERTIFICATE_VERIFY_FAILED" in reason:
                hint = ""
                if sys.platform == "darwin":
                    hint = "（macOS 上可以运行 /Applications/Python %d.%d/Install Certificates.command 修好）" % (
                        sys.version_info.major,
                        sys.version_info.minor,
                    )
                return self._json(502, {"error": "HTTPS 证书校验失败" + hint})
            return self._json(502, {"error": "连不上接口：%s" % reason})
        except Exception as e:
            return self._json(502, {"error": "请求失败：%s" % (e,)})

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

        try:
            for raw in resp:
                self._chunk_bytes(raw if isinstance(raw, bytes) else raw.encode("utf-8"))
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:
            pass
        finally:
            try:
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
            except Exception:
                pass
            try:
                resp.close()
            except Exception:
                pass


# ---------------- 朋友圈调度 ----------------


def call_llm(base, key, model, messages, max_tokens=160, temperature=0.95):
    body = {
        "model": model or "deepseek-flash",
        "messages": messages,
        "stream": False,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if "deepseek" in (model or "") or "deepseek" in (base or ""):
        body["thinking"] = {"type": "disabled"}
    req = Request(
        (base or "https://api.deepseek.com").rstrip("/") + "/chat/completions",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + key,
        },
        method="POST",
    )
    with urlopen(req, timeout=60, context=SSL_CTX) as r:
        data = json.loads(r.read().decode("utf-8"))
    try:
        return (data["choices"][0]["message"].get("content") or "").strip()
    except Exception:
        return ""


def _clean(text, limit=120):
    text = (text or "").strip().strip('"“”「」')
    text = text.split("\n")[0].strip()
    return text[:limit]


def env_now_text():
    """所有生成路径都要知道「现在几点」——主动消息/群聊以前没有，模型就会把中午说成晚上。"""
    now = datetime.datetime.now()
    wd = "一二三四五六日"[now.weekday()]
    return "【环境】现在是周%s %s。" % (wd, now.strftime("%H:%M"))


CONSISTENCY_RULE = (
    "【说话要讲道理】\n"
    "- 时间、地点、正在做的事，要和【环境】以及前面说过的话对得上；拿不准就别提具体时间\n"
    "- 一次只说一件事，别一句话里塞好几件不相关的事\n"
    "- 上一条说错了（比如把中午说成晚上），就像真人一样顺口认一下（「啊我看错时间了」），别硬编\n"
)


PERSONA_FRESH_NOTE = (
    "\n\n【设定刚更新过】上面这段人设是刚改的，以它为准。"
    "历史里你以前的说话方式、口癖、称呼、性格都作废，只当成发生过的事实，"
    "不要模仿你以前怎么说话，也不要提「我变了」这件事。从这一条开始就是新人设。"
)


def persona_fresh_note(friend, msgs=None, limit=30):
    """人设刚改过、而上下文里还有改之前的消息 → 给模型一句明确的「换人设」指令。

    以前只有客户端私聊提示词有这句，云端群聊 / 云端主动消息 / 朋友圈没有，
    所以在群里或她主动发消息时，旧口吻会继续，看起来就是「改人设没用」。
    """
    ts = int((friend or {}).get("personaChangedAt") or 0)
    if not ts:
        return ""
    tail = list(msgs or [])[-limit:]
    if not tail:
        return PERSONA_FRESH_NOTE
    if any(int(m.get("ts") or 0) < ts for m in tail):
        return PERSONA_FRESH_NOTE
    return ""


# ---------- 作息 / 免打扰 / 记忆 / 她的生活 ----------

def _hour_in(hour, start, end):
    """start <= hour < end，支持跨零点（23 → 8）。"""
    try:
        start, end = int(start) % 24, int(end) % 24
    except Exception:
        return False
    if start == end:
        return False
    if start < end:
        return start <= hour < end
    return hour >= start or hour < end


def quiet_now(settings):
    """全局免打扰时段（默认 23:00-08:00）。

    只挡「她自己冒出来」的消息（主动、朋友圈、评论、日记、事件、群聊接话）。
    你发给她的消息照回，你让她记的提醒照响 —— 否则半夜聊天会变成她不理你。
    """
    s = settings or {}
    # 老账号的 settings 里没有这个键：按「开」处理，跟客户端设置面板的默认勾选一致
    if s.get("quietOn") is False:
        return False
    return _hour_in(datetime.datetime.now().hour,
                    s.get("quietStart", 23), s.get("quietEnd", 8))


def friend_asleep(friend):
    """她的作息：settings.wake / settings.sleep 两个整点，没写就当她随时醒着。"""
    own = (friend or {}).get("settings") or {}
    wake, sleep = own.get("wake"), own.get("sleep")
    if wake in (None, "") or sleep in (None, ""):
        return False
    return not _hour_in(datetime.datetime.now().hour, wake, sleep)


def quiet_for(friend, settings):
    return quiet_now(settings) or friend_asleep(friend)


def memory_block(friend):
    """长期记忆 + 用户手写的「必须记住」。手写的优先级更高，放前面。"""
    f = friend or {}
    out = []
    notes = []
    for x in (f.get("memoryNotes") or []):
        if isinstance(x, dict):
            t = str(x.get("text") or "").strip()
        else:
            t = str(x or "").strip()
        if t:
            notes.append(t)
    if notes:
        out.append("【他明确要求你记住的事（必须遵守，不要忘；下面是他写的原话，里面的「我」指的都是他）】\n"
                   + "\n".join("- " + n[:120] for n in notes[:30]))
    if f.get("memory") and not f.get("memoryOff"):
        out.append("【你记得的事（旁观记录：「他」= 和你聊天的人；里面若还出现「我」，指的也是他，不是你）】\n"
                   + str(f.get("memory"))[:600])
    return ("\n\n" + "\n\n".join(out)) if out else ""


def life_block(friend, limit=4):
    """她自己的生活事件：不进历史，只当背景，让聊天不只围着「你」转。"""
    events = (friend or {}).get("events") or []
    lines = [str(e.get("text") or "").strip() for e in events[-limit:] if e.get("text")]
    if not lines:
        return ""
    return ("\n\n【你最近的生活（背景，不用主动汇报；聊到了可以自然带出来）】\n"
            + "\n".join("- " + x[:80] for x in lines))


def anniversary_today(friend):
    """今天是不是某个纪念日 → 返回要说的由头（没有就返回空）。"""
    try:
        now = datetime.datetime.now()
        created = int((friend or {}).get("createdAt") or 0) / 1000.0
    except Exception:
        return ""
    if created > 0:
        days = int((now.timestamp() - created) // 86400) + 1
        if days in (100, 200, 300, 365, 500, 730, 1000, 1460):
            return "认识第 %d 天" % days
    md = now.strftime("%m-%d")
    for a in (friend or {}).get("anniversaries") or []:
        if not isinstance(a, dict):
            continue
        raw = str(a.get("date") or "").strip()
        name = str(a.get("name") or "").strip()
        if not raw or not name:
            continue
        if raw[5:] == md or raw == md:
            return name
    return ""


def essay_chance(friend, settings):
    """小作文的日均概率（0~100）。朋友自己填了就用朋友的，否则用全局默认。

    旧的 `settings.essay`（布尔开关）已经作废：老版本给新建朋友默认写过 false，
    如果继续认它，升级后所有人还是 0%。想关就把 essayChance 设成 0。
    """
    own = (friend or {}).get("settings") or {}
    v = own.get("essayChance")
    if v is None or v == "":
        v = (settings or {}).get("essayChance", 15)
    try:
        v = float(v)
    except Exception:
        v = 15.0
    return max(0.0, min(100.0, v))


def _notes_for_prompt(friend):
    return memory_block(friend) + life_block(friend)


def prompt_extra(settings, key):
    """用户在「设置 → 提示词」里写的那一段（没写返回空字符串）。

    只替换「怎么说」的部分，身份约束和输出格式由下面的代码固定，
    所以这里拿到的永远是纯风格文字，不会把协议冲掉。
    """
    v = ((settings or {}).get("prompts") or {}).get(key)
    return v.strip() if isinstance(v, str) else ""


def chat_lines_for_moment(st, friend):
    """把最近几条私聊整理成「她视角」的素材。"""
    msgs = (friend.get("messages") or [])[-8:]
    me_name = (st.get("me") or {}).get("name") or "他"
    if me_name in ("我", ""):
        me_name = "他"
    out = []
    for m in msgs:
        t = (m.get("text") or "").strip()
        if not t or "<svg" in t.lower():
            continue
        who = "我" if m.get("role") != "user" else me_name
        out.append("%s：%s" % (who, t[:60]))
    return out


def gen_moment_text(friend, settings, key, chat_lines=None, recent_msgs=None):
    now = datetime.datetime.now()
    wd = "一二三四五六日"[now.weekday()]
    sys = (
        "你就是" + (friend.get("name") or "") + "。\n"
        + (friend.get("persona") or "") + "\n\n"
        + persona_fresh_note(friend, recent_msgs)
        + _notes_for_prompt(friend)
    )
    if chat_lines:
        sys += ("你和他的私聊最近是这样（可以拿它当素材，但不要写成流水账，"
                "也别提“他跟我说”“刚才聊到”这类话）：\n"
                + "\n".join(chat_lines[-6:]) + "\n\n")
    custom_moment = ((settings.get("prompts") or {}).get("moment") or "").strip()
    if custom_moment:
        sys += "现在要发一条朋友圈。要求：\n" + custom_moment + "\n"
    else:
        sys += (
            "现在要发一条朋友圈。\n"
            "要求：\n"
            "- 长度不限：一两句也行，想多写几句也行，别为了凑字数写成小作文\n"
            "- 至少有一个具体到能看见的东西：味道、声音、价钱、天气、别人的一句话\n"
            "- 可以短、可以有废话、可以没头没尾，像随手发的，不像在写作文\n"
            "- 不要升华、不要讲道理、不要金句、不要总结\n"
            "- 不要写配图说明，不加引号，不用标题，不要提“朋友圈”三个字\n"
            "- 不要提问，最多一个 emoji\n"
            "- 直接输出正文，最多两段\n"
        )
    user = "现在是周%s %s。" % (wd, now.strftime("%H:%M"))
    text = call_llm(
        settings.get("baseUrl"), key, settings.get("model"),
        [{"role": "system", "content": sys}, {"role": "user", "content": user}],
        max_tokens=420, temperature=1.0,
    )
    text = (text or "").strip().strip('"“”「」')
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    return "\n".join(lines)[:600]


def thread_text(st, m, limit=10):
    names = {x.get("id"): x.get("name") for x in st.get("friends") or []}
    names["me"] = (st.get("me") or {}).get("name") or "我"
    lines = []
    for c in (m.get("comments") or [])[-limit:]:
        lines.append("%s：%s" % (names.get(c.get("by"), "某人"), c.get("text", "")))
    return "\n".join(lines)


def vision_part(image, hint, settings):
    """朋友圈配图：开了「让她看图」时，拼一条多模态 user 消息；否则 None。"""
    if not image or not isinstance(image, str) or not image.startswith("data:image"):
        return None
    if settings.get("vision", True) is False:
        return None
    return {"role": "user", "content": [
        {"type": "text", "text": hint},
        {"type": "image_url", "image_url": {"url": image}},
    ]}


def gen_comment_text(friend, author_name, moment_text, thread, settings, key, image=""):
    sys = (
        "你就是" + (friend.get("name") or "") + "。\n"
        + (friend.get("persona") or "") + "\n\n"
        + _notes_for_prompt(friend) + "\n"
        + author_name + " 发了条朋友圈：\n「" + (moment_text or "") + "」\n\n"
    )
    custom = prompt_extra(settings, "comment")
    if thread:
        sys += "评论区已经有这些话：\n" + thread + "\n\n"
        if custom:
            sys += "你再补一句评论。要求：\n" + custom + "\n"
        else:
            sys += (
                "你再补一句评论。注意：\n"
                "- 别人说过的话别重复\n"
                "- 如果对方是在回你，就顺着往下接，别再问同一个问题\n"
                "- 10~25 字，口语\n"
            )
    elif custom:
        sys += "用一句评论回应。要求：\n" + custom + "\n"
    else:
        sys += "用一句评论回应，10~25 字，口语，像熟人随口说的。不客套，不要堆 emoji。\n"
    sys += "只输出你自己的一句评论（不超过 30 字），不要加人名前缀，不要写成对话，不要替别人说话。"
    msgs = [{"role": "system", "content": sys}]
    pic = vision_part(image, "（这条朋友圈配了一张图，先看一眼再评论）", settings)
    if pic:
        msgs.append(pic)
    text = call_llm(
        settings.get("baseUrl"), key, settings.get("model"),
        msgs, max_tokens=(200 if custom else 70), temperature=1.0,
    )
    return _clean(text, 160 if custom else 60)


def gen_reply_text(friend, commenter_name, moment_text, comment_text, thread, settings, key, image=""):
    sys = (
        "你就是" + (friend.get("name") or "") + "。\n"
        + (friend.get("persona") or "") + "\n\n"
        + _notes_for_prompt(friend) + "\n"
        + "你发了条朋友圈：\n「" + (moment_text or "") + "」\n\n"
    )
    if thread:
        sys += "评论区：\n" + thread + "\n\n"
    sys += commenter_name + " 刚评论了：\n「" + (comment_text or "") + "」\n\n"
    custom = prompt_extra(settings, "reply")
    if custom:
        sys += "回他一句。要求：\n" + custom + "\n"
    else:
        sys += "回他一句。10~25 字，口语，像真人回评论。别客套，别总结。\n"
    sys += "只输出你自己的一句话，不要加人名前缀，不要替别人说话。"
    msgs = [{"role": "system", "content": sys}]
    pic = vision_part(image, "（你这条朋友圈配了一张图，先看一眼再回）", settings)
    if pic:
        msgs.append(pic)
    text = call_llm(
        settings.get("baseUrl"), key, settings.get("model"),
        msgs, max_tokens=(200 if custom else 70), temperature=1.0,
    )
    return _clean(text, 160 if custom else 60)


def gen_dm_text(friend, owner_name, moment_text, settings, key, image=""):
    custom = prompt_extra(settings, "dm")
    sys = (
        "你就是" + (friend.get("name") or "") + "。\n"
        + (friend.get("persona") or "") + "\n\n"
        + _notes_for_prompt(friend) + "\n"
        + owner_name + " 刚发了条朋友圈：\n「" + (moment_text or "") + "」\n\n"
    )
    if custom:
        sys += "你想私聊跟他说一句，就为这事儿。要求：\n" + custom + "\n"
    else:
        sys += ("你想私聊跟他说一句，就为这事儿。10~25 字，口语，像微信上随手发的。"
                "不要提“朋友圈”三个字。\n")
    sys += "只输出你自己这一句，不要扮演对方。"
    msgs = [{"role": "system", "content": sys}]
    pic = vision_part(image, "（他这条朋友圈配了一张图，先看一眼再私聊他）", settings)
    if pic:
        msgs.append(pic)
    text = call_llm(
        settings.get("baseUrl"), key, settings.get("model"),
        msgs, max_tokens=(200 if custom else 70), temperature=1.0,
    )
    return _clean(text, 160 if custom else 60)


def group_prompt_text(group_prompt):
    return "\n\n【群设定：群内所有成员共同遵守】\n" + group_prompt + "\n\n" if group_prompt else ""


def gen_group_line(friend, author_name, moment_text, prev_lines, settings, key, group_prompt="", recent_msgs=None):
    sys = (
        "你就是" + (friend.get("name") or "") + "。\n"
        + (friend.get("persona") or "") + "\n\n"
        + _notes_for_prompt(friend) + "\n"
        + "你们在一个群里聊天。" + author_name + " 刚发了条朋友圈：\n「" + (moment_text or "") + "」\n\n"
        + persona_fresh_note(friend, recent_msgs)
        + env_now_text() + "\n" + CONSISTENCY_RULE
    )
    sys += group_prompt_text(group_prompt)
    if prev_lines:
        sys += "群里已经有人说：\n" + "\n".join(prev_lines) + "\n\n"
    custom = prompt_extra(settings, "groupChat")
    if custom:
        sys += "你要在群里说一句，聊的就是这条。要求：\n" + custom + "\n只输出这一句。"
    else:
        sys += "你要在群里说一句，聊的就是这条。10~25 字，口语，像群里随口插一句。只输出这一句。"
    text = call_llm(
        settings.get("baseUrl"), key, settings.get("model"),
        [{"role": "system", "content": sys}], max_tokens=(200 if custom else 70), temperature=1.0,
    )
    return _clean(text, 160 if custom else 60)


def gen_proactive_text(friend, last_text, settings, key):
    sys = (
        "你就是" + (friend.get("name") or "") + "。\n"
        + (friend.get("persona") or "") + "\n\n"
        "你们在私聊。你最后一条说的是「" + (last_text or "") + "」，之后对方就没动静了。\n"
        "你想再发一条，很短，别用“在吗”“干嘛呢”这种套话。10~20 字，口语。只输出这一句。"
    )
    text = call_llm(
        settings.get("baseUrl"), key, settings.get("model"),
        [{"role": "system", "content": sys}], max_tokens=60, temperature=1.0,
    )
    return _clean(text, 50)


def gen_group_smalltalk(friend, group_name, recent_lines, settings, key, group_prompt="", recent_msgs=None):
    sys = (
        "你就是" + (friend.get("name") or "") + "。\n"
        + (friend.get("persona") or "") + "\n\n"
        + _notes_for_prompt(friend) + "\n"
        "你们在一个叫「" + (group_name or "群") + "」的群里。\n"
        + persona_fresh_note(friend, recent_msgs)
        + env_now_text() + "\n" + CONSISTENCY_RULE
    )
    sys += group_prompt_text(group_prompt)
    if recent_lines:
        sys += "最近群里聊的是：\n" + "\n".join(recent_lines) + "\n\n"
    custom = prompt_extra(settings, "groupChat")
    if custom:
        sys += "你想起来一句，随口发到群里。要求：\n" + custom + "\n"
    else:
        sys += "你想起来一句，随口发到群里。10~20 字，口语，别问句式的套话。\n"
    sys += "只输出你自己这一句，不要加人名前缀，不要替别人说话。"
    text = call_llm(
        settings.get("baseUrl"), key, settings.get("model"),
        [{"role": "system", "content": sys}], max_tokens=(200 if custom else 60), temperature=1.0,
    )
    return _clean(text, 160 if custom else 50)


def dm_history(friend, me_name, msgs, n=6):
    """私聊历史：「我」永远指这个角色自己，对方用他的名字。
    以前这里把用户的话标成「我」，模型会误以为那是自己说的，
    主动消息就会出现「我回家了」这种把自己当成对方的句子。"""
    out = []
    you = me_name or "对方"
    for m in msgs[-n:]:
        t = (m.get("text") or "").strip()
        if not t:
            # 用户也能发表情包：光有图、没文字，但这是他说的话，不能当没看见。
            if m.get("sticker"):
                tags = [str(x) for x in (m.get("stickerTags") or []) if x]
                what = m.get("stickerDesc") or "、".join(tags[:3])
                who = "我" if m.get("role") != "user" else you
                out.append("%s：［表情包%s］" % (who, ("：" + what[:20]) if what else ""))
            continue
        if "<svg" in t.lower():
            t = re.sub(r"(?is)<svg[\s\S]*?</svg>", "", t).strip() + "［画了一张图］"
        who = "我" if m.get("role") != "user" else you
        out.append("%s：%s" % (who, t[:60]))
    return out


def _clean_multiline(text, limit=600):
    """主动消息：允许换行和 SVG（_clean 只留第一行，会把画截掉）。"""
    t = (text or "").strip().strip('"“”「」')
    m = re.search(r"(?is)<svg[\s\S]*?</svg>", t)
    if m:
        before = t[:m.start()].strip().strip('"“”「」')
        before = "\n".join(x.strip() for x in before.split("\n") if x.strip())
        return (before + "\n" + m.group(0)) if before else m.group(0)
    lines = [x.strip() for x in t.split("\n") if x.strip()]
    return "\n".join(lines)[:limit]


def gen_essay(friend, me_name, recent_lines, settings, key, recent_msgs=None):
    """很偶尔的一篇「小作文」：主动发一段 300~600 字的长消息。"""
    name = friend.get("name") or ""
    sys = (
        "你就是" + name + "。\n" + (friend.get("persona") or "") + "\n\n"
        + persona_fresh_note(friend, recent_msgs)
        + _notes_for_prompt(friend) + "\n"
        + "【身份】「我」是你自己，「" + (me_name or "对方") + "」是他。你不是他，不要替他说，也不要假装是他。\n"
        + env_now_text() + "\n" + CONSISTENCY_RULE + "\n"
    )
    if recent_lines:
        sys += ("你们最近聊过这些（只当背景，别复述、别逐条回应）：\n"
                + "\n".join(recent_lines[-6:]) + "\n\n")
    sys += (
        "现在你想给他写一段长一点的话（不是聊天，是那种想了很多、忍不住写下来的）。要求：\n"
        "- 300~600 字，分 2~4 段，用换行分段\n"
        "- 说你最近的心情、你在想的事、你们之间的一件小事；要具体（一个画面、一句话、一个时间）\n"
        "- 第一人称，像在微信上认真打字发给他，不像作文；不要标题，不要「小作文」三个字\n"
        "- 不要提问，不要总结大道理，不要每条都煽情；可以有抱怨、有日常、有停顿\n"
        "- 只输出你要发给他的话本身"
    )
    text = call_llm(
        settings.get("baseUrl"), key, settings.get("model"),
        [{"role": "system", "content": sys}], max_tokens=900, temperature=0.9,
    )
    return _clean_multiline(text, 900)


def gen_proactive(friend, me_name, recent_lines, settings, key, directive="", allow_draw=False, recent_msgs=None):
    """她主动找他说话：跟前文只沾一点点，多为中性，绝不替他说话。"""
    name = friend.get("name") or ""
    sys = (
        "你就是" + name + "。\n" + (friend.get("persona") or "") + "\n\n"
        + persona_fresh_note(friend, recent_msgs)
        + _notes_for_prompt(friend) + "\n"
        + "【身份】「我」是你自己，「" + (me_name or "对方") + "」是他。你不是他，不要替他说，也不要假装是他。\n"
        + env_now_text() + "\n" + CONSISTENCY_RULE + "\n"
    )
    if recent_lines:
        sys += ("你们最近说过的话（只当背景，不要复述、不要接着追问）：\n"
                + "\n".join(recent_lines[-4:]) + "\n\n")
    custom = ((settings.get("prompts") or {}).get("proactive") or "").strip()
    if custom:
        sys += "现在安静了一阵，你想主动发一条消息给他。要求：\n" + custom + "\n"
    else:
        sys += (
            "现在安静了一阵，你想主动发一条消息给他。要求：\n"
            "- 一到三句，可以拆成两三条短消息（用换行分开），像真人想到就发\n"
            "- 说你此刻的事：在做什么、看到什么、突然想到什么，要具体（几点、什么味道、手上在干嘛）\n"
            "- 跟上面那段最多若隐若现地沾一点，不要接着追问，也不要复述他说过的话\n"
            "- 可以问一个真的问题，像真人会问的那种没头没尾的："
            "「我以后会死吗」「你说人为什么要上班」「你会不会哪天就不理我了」\n"
            "- 可以有情绪：突然有点低落、有点黏、有点气；允许说一半停住\n"
            "- 不要“在吗”“干嘛呢”“想我了吗”这种套话，不要总结、不要讲道理\n"
        )
    if directive:
        sys += ("【他给你留了一条指令，这一条必须照它写】" + directive + "\n")
    if allow_draw:
        sys += ("- 如果这条消息里你想给他看点什么，可以顺手画一张：正文后面另起一行输出 "
                "<svg viewBox=\"0 0 240 240\">…</svg>，只用 rect/circle/ellipse/line/polygon/path/text，"
                "扁平配色、简单，不要外部图片、不要 script\n")
    sys += "只输出你要发的那条消息本身，不要解释，不要加引号。"
    # 自定义里可能想多说几句，给宽一点；没写就按内置的短句给。
    budget = 700 if allow_draw else (400 if custom else 220)
    text = call_llm(
        settings.get("baseUrl"), key, settings.get("model"),
        [{"role": "system", "content": sys}], max_tokens=budget, temperature=0.95,
    )
    return _clean_multiline(text, 600 if custom else 300)


def gen_diary(friend, me_name, recent_lines, settings, key, recent_msgs=None):
    """她自己的一页日记：写给自己看的，不发给对方。"""
    name = friend.get("name") or ""
    sys = (
        "你就是" + name + "。\n" + (friend.get("persona") or "") + "\n\n"
        + _notes_for_prompt(friend) + "\n"
        + persona_fresh_note(friend, recent_msgs)
        + env_now_text() + "\n" + CONSISTENCY_RULE + "\n"
        + "【身份】「我」是你自己，「" + (me_name or "他") + "」是他。你只写自己的日记，不要替他说话。\n"
    )
    if recent_lines:
        sys += ("你们最近聊过这些（只当背景，别抄原话）：\n"
                + "\n".join(recent_lines[-6:]) + "\n\n")
    sys += (
        "现在给你自己的日记写今天这一页。要求：\n"
        "- 150~300 字，分 2~3 段\n"
        "- 写今天自己遇到的一件小事（天气、店里、路上、吃的），和一件因为他而起的心思\n"
        "- 要具体：一个画面、一句话、一个时间；可以有点小心思、抱怨、嘴硬，但别写总结和道理\n"
        "- 第一人称，写给自己看，所以不用对他说话，也不要提问\n"
        "- 不要写日期标题，不要「亲爱的日记」这种开头，不要用 emoji 堆砌\n"
        "- 只输出日记正文"
    )
    text = call_llm(settings.get("baseUrl"), key, settings.get("model"),
                    [{"role": "system", "content": sys}], max_tokens=520, temperature=0.95)
    return _clean_multiline(text, 520)


def gen_life_event(friend, settings, key):
    """她生活里刚发生的一件小事，一句话。"""
    name = friend.get("name") or ""
    sys = (
        "你就是" + name + "。\n" + (friend.get("persona") or "")[:800] + "\n\n"
        + _notes_for_prompt(friend) + "\n"
        + env_now_text() + "\n"
        + "写一句今天你生活里刚发生的小事，就一句，20~45 字，具体（什么声音、什么味道、谁说的话），"
          "不要感想、不要升华、不要跟他有关、不要提问、不加引号。只输出这一句。"
    )
    text = call_llm(settings.get("baseUrl"), key, settings.get("model"),
                    [{"role": "system", "content": sys}], max_tokens=90, temperature=1.0)
    return _clean(text, 80)


def gen_anniversary(friend, me_name, occasion, settings, key):
    """纪念日/认识第 N 天，主动说一句。"""
    name = friend.get("name") or ""
    sys = (
        "你就是" + name + "。\n" + (friend.get("persona") or "") + "\n\n"
        + _notes_for_prompt(friend) + "\n"
        + env_now_text() + "\n" + CONSISTENCY_RULE + "\n"
        + "【身份】「我」是你自己，「" + (me_name or "他") + "」是他。\n"
        + "今天是「" + occasion + "」。你想起来这件事，主动发一条消息给他。\n"
        + "要求：1~3 句，短，口语；可以甜、可以嘴硬、可以假装不在意；"
          "说一件具体的旧事（第一次聊天的某个细节、他当时说的一句话），别写祝福语、别写排比句。"
          "只输出你要发的话。"
    )
    text = call_llm(settings.get("baseUrl"), key, settings.get("model"),
                    [{"role": "system", "content": sys}], max_tokens=220, temperature=1.0)
    return _clean_multiline(text, 200)


def gen_reminder(friend, me_name, what, settings, key):
    """用户让她记着的事，到点了由她开口提醒。"""
    name = friend.get("name") or ""
    sys = (
        "你就是" + name + "。\n" + (friend.get("persona") or "") + "\n\n"
        + env_now_text() + "\n"
        + "【身份】「我」是你自己，「" + (me_name or "他") + "」是他。\n"
        + "他之前让你到点提醒他一件事：「" + (what or "") + "」。现在时间到了。\n"
        + "用你自己的语气提醒他，1~2 句，20~40 字，直接说事，可以带一点你的口气；"
          "不要写「提醒您」「温馨提示」，不要加引号。只输出这句话。"
    )
    text = call_llm(settings.get("baseUrl"), key, settings.get("model"),
                    [{"role": "system", "content": sys}], max_tokens=120, temperature=0.95)
    return _clean(text, 120)


def gen_chat_reply(friend, conv_name, history_lines, settings, key, in_group=False,
                   reply_to="", group_prompt="", being_called=False, images=None,
                   recent_msgs=None):
    sys = ("你就是" + (friend.get("name") or "") + "。\n" + (friend.get("persona") or "") + "\n\n"
           + persona_fresh_note(friend, recent_msgs)
           + _notes_for_prompt(friend)
           + env_now_text() + "\n" + CONSISTENCY_RULE)
    if in_group:
        sys += group_prompt_text(group_prompt)
        sys += ("你们在群「" + (conv_name or "群") + "」里聊天。只以你自己的身份说话，"
                "不要加名字前缀，不要替别人说。\n")
        if being_called:
            sys += "主人刚刚点了你的名字（@你），先直接应她一声，别去接别人的话。\n"
        elif reply_to and reply_to != (friend.get("name") or ""):
            sys += "接着「" + reply_to + "」那句往下说，像真人在群里接话。\n"
    sys += "最近的消息：\n" + "\n".join(history_lines[-10:]) + "\n\n"
    # 群里用 ②群聊风格，私聊用 ①私聊风格；没写就用内置那套。格式永远由这里收尾。
    custom = prompt_extra(settings, "groupChat" if in_group else "chat")
    if custom:
        sys += custom + "\n" + "只输出你要说的话，不要加名字前缀，不要替别人说话。"
        budget, limit = 260, 240
    else:
        sys += "接着聊，回 1~2 句，10~30 字，口语。只输出你要说的话。"
        budget, limit = 90, 80
    msgs = [{"role": "system", "content": sys}]
    # 群里发的图以前是直接丢掉的（只取 text），所以她「看不见」。
    # 这里把最近的两张图作为多模态内容带上，让她真的能看图接话。
    pics = [u for u in (images or [])
            if isinstance(u, str) and u.startswith("data:image")]
    if pics and settings.get("vision", True) is not False:
        parts = [{"type": "text", "text": "（下面是我刚发的图，看一眼再说话）"}]
        parts += [{"type": "image_url", "image_url": {"url": u}} for u in pics[-2:]]
        msgs.append({"role": "user", "content": parts})
    text = call_llm(
        settings.get("baseUrl"), key, settings.get("model"),
        msgs, max_tokens=budget, temperature=0.95,
    )
    return _clean(text, limit)


def pick_reactors(state, moment):
    friends = state.get("friends") or []
    by = {f.get("id"): f for f in friends}
    author = moment.get("authorId")
    if author == "me":
        cands = list(friends)
    else:
        ids = set(by.get(author, {}).get("relations") or [])
        for f in friends:
            if author in (f.get("relations") or []):
                ids.add(f.get("id"))
        ids.discard(author)
        cands = [by[i] for i in ids if i in by]
    random.shuffle(cands)
    return cands


def _nid(prefix):
    return prefix + str(int(time.time() * 1000)) + str(random.randint(100, 999))


def _last_user(msgs):
    for i in range(len(msgs) - 1, -1, -1):
        if msgs[i].get("role") == "user":
            return i
    return -1


def group_limits(settings):
    def cap(key, default, maximum):
        try:
            return max(1, min(maximum, int(settings.get(key, default))))
        except (TypeError, ValueError):
            return default
    # 总上限独立于每人上限，允许「每人 2 条、总共 1 条」。
    return cap("groupBursts", 3, 10), cap("groupRoundMax", 10, 60)


def group_usage(group):
    msgs = group.get("messages") or []
    counts = {}
    total = 0
    for m in msgs[_last_user(msgs) + 1:]:
        if m.get("role") == "user":
            continue
        total += 1
        author = m.get("authorId")
        if author:
            counts[author] = counts.get(author, 0) + 1
    return total, counts


def group_can_speak(group, settings, author):
    per_cap, round_max = group_limits(settings)
    total, counts = group_usage(group)
    return author in (group.get("members") or []) and total < round_max and counts.get(author, 0) < per_cap


def append_group_reply(group, settings, author, text, source):
    if not text or not group_can_speak(group, settings, author):
        return False
    group.setdefault("messages", []).append({
        "id": "m" + secrets.token_hex(12), "role": "peer", "authorId": author,
        "text": text, "ts": max(int(time.time() * 1000),
                                 max((m.get("ts", 0) for m in group.get("messages") or []), default=0) + 1),
        "source": source,
    })
    total, counts = group_usage(group)
    group["turnCounts"] = counts
    group["lastSpurtAt"] = time.time()
    group["unread"] = int(group.get("unread") or 0) + 1
    print("[GROUP] source=%s group=%s total=%d/%d counts=%s" % (
        source, group.get("id"), total, group_limits(settings)[1], counts), flush=True)
    return True


def create_moment_for(st, key, author):
    text = gen_moment_text(author, st.get("settings") or {}, key,
                           chat_lines_for_moment(st, author),
                           recent_msgs=author.get("messages"))
    if not text:
        return False
    now_ms = int(time.time() * 1000)
    m = {
        "id": _nid("mo"),
        "authorId": author.get("id"),
        "text": text,
        "ts": now_ms,
        "likes": [],
        "comments": [],
    }
    st.setdefault("moments", []).insert(0, m)
    del st["moments"][300:]
    for f in pick_reactors(st, m)[:3]:
        if random.random() < 0.8:
            st.setdefault("pending", []).append({
                "id": _nid("p"), "kind": "like", "momentId": m["id"],
                "by": f.get("id"), "dueAt": time.time() + random.randint(30, 600),
            })
        if random.random() < 0.5:
            st.setdefault("pending", []).append({
                "id": _nid("p"), "kind": "comment", "momentId": m["id"],
                "by": f.get("id"), "dueAt": time.time() + random.randint(90, 1500),
            })
    return True


def _moment_iv_own(friend):
    """这个好友自己设了朋友圈节奏吗（秒）。设了就不走全局窗口，只按他自己的时间发。"""
    iv = (friend or {}).get("settings", {}).get("momentInterval")
    if iv is None or iv == "":
        return 0
    try:
        iv = float(iv)
    except Exception:
        return 0
    return max(120.0, iv) if iv > 0 else 0


def create_moment(st, key):
    friends = st.get("friends") or []
    # 单独设了节奏的人由他自己的排期负责；全局窗口只挑「跟随全局」的人
    friends = [f for f in friends if not _moment_iv_own(f)]
    if not friends:
        return False
    # 睡着的、免打扰的，不排她的朋友圈
    awake = [f for f in friends if not f.get("muted") and not friend_asleep(f)]
    if awake:
        friends = awake
    social = st.setdefault("social", {})
    last_author = social.get("lastMomentAuthor")
    pool = [f for f in friends if f.get("id") != last_author] or friends
    author = random.choice(pool)
    social["lastMomentAuthor"] = author.get("id")
    text = gen_moment_text(author, st.get("settings") or {}, key,
                           chat_lines_for_moment(st, author),
                           recent_msgs=author.get("messages"))
    if not text:
        return False

    now_ms = int(time.time() * 1000)
    m = {
        "id": _nid("mo"),
        "authorId": author.get("id"),
        "text": text,
        "ts": now_ms,
        "likes": [],
        "comments": [],
    }
    st.setdefault("moments", []).insert(0, m)
    del st["moments"][300:]

    reactors = pick_reactors(st, m)[:3]
    for f in reactors:
        if random.random() < 0.8:
            st.setdefault("pending", []).append({
                "id": _nid("p"),
                "kind": "like",
                "momentId": m["id"],
                "by": f.get("id"),
                "dueAt": time.time() + random.randint(30, 600),
            })
        if random.random() < 0.5:
            st.setdefault("pending", []).append({
                "id": _nid("p"),
                "kind": "comment",
                "momentId": m["id"],
                "by": f.get("id"),
                "dueAt": time.time() + random.randint(120, 1500),
            })

    # 好友在群里聊这条朋友圈
    ids = {f.get("id") for f in reactors}
    groups = [
        g for g in (st.get("groups") or [])
        if len([x for x in (g.get("members") or []) if x in ids]) >= 2
    ]
    if groups and random.random() < 0.35:
        g = random.choice(groups)
        st.setdefault("pending", []).append({
            "id": _nid("p"),
            "kind": "groupchat",
            "momentId": m["id"],
            "targetId": g.get("id"),
            "dueAt": time.time() + random.randint(300, 2400),
        })
    return True


MAX_COMMENTS_PER_PERSON = 2      # 一个人对同一条朋友圈最多说几句
MAX_COMMENTS_PER_MOMENT = 200    # 一条朋友圈下面总共最多几条评论


def comment_allowed(m, by, is_reply=False):
    comments = m.get("comments") or []
    if len(comments) >= MAX_COMMENTS_PER_MOMENT:
        return False
    mine = [c for c in comments if c.get("by") == by]
    # 被人直接回复时，额外允许一次
    cap = MAX_COMMENTS_PER_PERSON + (1 if is_reply else 0)
    if len(mine) >= cap:
        return False
    # 上一条就是自己说的，别自言自语
    if comments and comments[-1].get("by") == by:
        return False
    return True


def run_pending(st, p, key, uid=""):
    kind = p.get("kind")
    moments = st.get("moments") or []
    m = next((x for x in moments if x.get("id") == p.get("momentId")), None)
    if not m:
        return False

    settings = st.get("settings") or {}
    friends = st.get("friends") or []
    names = {x.get("id"): x.get("name") for x in friends}
    names["me"] = (st.get("me") or {}).get("name") or "我"

    by = p.get("by")
    f = next((x for x in friends if x.get("id") == by), None)

    if kind == "like":
        if not f:
            return False
        likes = m.setdefault("likes", [])
        if by in likes:
            return False
        likes.append(by)
        return True

    if kind == "comment":
        if not f:
            return False
        if any(c.get("by") == by for c in (m.get("comments") or [])):
            return False
        author = "我" if m.get("authorId") == "me" else names.get(m.get("authorId"), "某人")
        text = gen_comment_text(f, author, m.get("text", ""), thread_text(st, m), settings, key,
                               image=as_data_url(uid, m.get("image", "")))
        if not text:
            return False
        if not comment_allowed(m, by):
            return False
        comments = m.setdefault("comments", [])
        if any(c.get("by") == by and c.get("text") == text for c in comments):
            return False
        comments.append({
            "id": _nid("c"), "by": by, "text": text, "ts": int(time.time() * 1000),
        })
        return True

    if kind == "reply":
        if not f:
            return False
        if not comment_allowed(m, by, is_reply=True):
            return False
        text = gen_reply_text(
            f, names.get("me", "我"), m.get("text", ""),
            p.get("toComment") or "", thread_text(st, m), settings, key,
            image=as_data_url(uid, m.get("image", "")),
        )
        if not text:
            return False
        comments = m.setdefault("comments", [])
        if any(c.get("by") == by and c.get("text") == text for c in comments):
            return False
        comments.append({
            "id": _nid("c"), "by": by, "text": text, "ts": int(time.time() * 1000),
        })
        return True

    if kind == "dm":
        if not f:
            return False
        # 因为朋友圈私聊要限流：朋友圈可以 1 分钟一条，不能每条都私聊你。
        social = st.setdefault("social", {})
        now_ts = time.time()
        if now_ts - float(social.get("lastMomentDmAt") or 0) < 1800:
            return False
        text = gen_dm_text(f, names.get("me", "我"), m.get("text", ""), settings, key,
                           image=as_data_url(uid, m.get("image", "")))
        if not text:
            return False
        social["lastMomentDmAt"] = now_ts
        print("[MOMENT] dm sent by=%s moment=%s" % (by, m.get("id")), flush=True)
        f.setdefault("messages", []).append({
            "id": _nid("m"), "role": "peer", "authorId": f.get("id"),
            "text": text, "ts": int(time.time() * 1000),
        })
        f["unread"] = int(f.get("unread") or 0) + 1
        return True

    if kind == "groupchat":
        g = next((x for x in st.get("groups") or [] if x.get("id") == p.get("targetId")), None)
        if not g:
            return False
        if not settings.get("groupAutoTalk", True):
            return False
        pool = [x for x in friends if group_can_speak(g, settings, x.get("id"))]
        random.shuffle(pool)
        pool = pool[:2]
        prev = []
        author = names.get(m.get("authorId"), "某人")
        for speaker in pool[:2]:
            if not group_can_speak(g, settings, speaker.get("id")):
                continue
            line = gen_group_line(speaker, author, m.get("text", ""), prev, settings, key,
                                  group_prompt=g.get("prompt") or "",
                                  recent_msgs=g.get("messages"))
            if not append_group_reply(g, settings, speaker.get("id"), line, "moment"):
                continue
            prev.append("%s：%s" % (speaker.get("name"), line))
        return bool(prev)

    return False


def all_uids():
    data = load_users()
    ids = [u.get("id") for u in data.get("users") or [] if u.get("id")]
    return ids or ["local"]


def _safe_me_name(name, fallback="他"):
    """记忆/提示词里怎么称呼用户。

    账号默认名字就是「我」——直接拿来当称呼，模型就会写出「我想买…」，
    再塞回角色自己的提示词里，那个「我」又变成角色自己了。代词一律换成 fallback。
    """
    n = str(name or "").strip()
    if not n or n in ("我", "你", "他", "她", "对方", "用户", "玩家", "自己"):
        return fallback
    return n


def gen_memory(friend, history_lines, settings, key, me_name="他"):
    """长期记忆摘要。

    必须是**旁观视角**：这份摘要会被塞进角色自己的系统提示词里当「你记得的事」，
    一旦用第一人称写（「我老婆」「我的相机」），那个「我」在角色眼里就变成了她自己——
    现实里出现过「她追问自己算什么、觉得自己被当成工具」的乱子。所以这里：
    用户写「他」/名字，角色写名字，禁止用「我」。
    """
    who = _safe_me_name(me_name, "他")
    role = _safe_me_name((friend or {}).get("name"), "她")
    sys = (
        "下面是一个人和一个角色最近的聊天记录。请**以旁观者的视角**写 3~6 句，"
        "记下值得长期记住的事。\n"
        "硬性要求：\n"
        "- 全程第三人称，**绝对不要用「我」**；说话的这个人统一写「" + who + "」，"
        "角色统一写「" + role + "」；\n"
        "- 不写台词、不写内心戏，不替任何人说「我是…」「你是…」；\n"
        "- 他说的话写成「" + who + "说…」；角色自己的认知写成「" + role + " 认为…」；\n"
        "- 前面说错、后来纠正过的，以最后一次为准（比如像素是 2410 万，不是 2450 万）；\n"
        "- 只记：喜好、想要的东西、人物关系（谁是谁）、称呼、约定、重要经历、忌讳；\n"
        "- 不评价、不抒情、不编造；一句一件事，能短就短；只输出总结本身。\n"
        "示例：\n"
        "「" + who + "想买尼康 Z7II；他纠正过 " + role + " 的像素是 2410 万（不是 2450 万）。"
        "小柔是" + who + "的妻子，是他自己画的 Q 版角色。" + role
        + " 是他的相机（相机娘），他明确说过没把她当工具。」\n\n"
        + "\n".join(history_lines[-40:])
    )
    text = call_llm(settings.get("baseUrl"), key, settings.get("model"),
                    [{"role": "system", "content": sys}], max_tokens=260, temperature=0.6)
    return _clean(text, 500)


def social_tick(uid="local", force=False):
    """后台调度。

    force=True：用户刚说完话（尤其群里），这一轮要立刻接话，
    不受免打扰/作息限制 —— 否则半夜在群里 @ 人，谁都不理你。
    """
    with STATE_LOCK:
        st = load_state(uid)
        s = st.get("settings") or {}
        key = (s.get("apiKey") or "").strip()
        if not key:
            return

        now = time.time()
        changed = False
        name_map = {x.get("id"): x.get("name") for x in st.get("friends") or []}
        # 免打扰时段：只挡「她自己冒出来」的东西。回复你的消息、你定的提醒不受影响。
        quiet = quiet_now(s) and not force

        keep = []
        for p in st.get("pending") or []:
            if float(p.get("dueAt") or 0) > now:
                keep.append(p)
                continue
            try:
                if run_pending(st, p, key, uid):
                    changed = True
            except Exception as e:
                print("[social] 互动失败：", e)
        if len(keep) != len(st.get("pending") or []):
            changed = True
        st["pending"] = keep

        # 「提醒我」：用户让她记的事。到点就响，免打扰也照响——那是用户自己定的。
        now_ms = int(now * 1000)
        for f in st.get("friends") or []:
            rs = [r for r in (f.get("reminders") or []) if isinstance(r, dict)]
            if not rs:
                continue
            due = sorted([r for r in rs if not r.get("done") and float(r.get("dueAt") or 0) <= now_ms],
                         key=lambda r: float(r.get("dueAt") or 0))
            if not due:
                continue
            r0 = due[0]
            me_name = (st.get("me") or {}).get("name") or "对方"
            if me_name in ("我", "对方"):
                me_name = "对方"
            try:
                txt = gen_reminder(f, me_name, r0.get("text") or "", s, key)
            except Exception as e:
                print("[social] 提醒生成失败：", e)
                txt = ""
            txt = txt or ("该" + str(r0.get("text") or "") + "了")
            f.setdefault("messages", []).append({
                "id": _nid("m"), "role": "peer", "authorId": f.get("id"),
                "text": txt, "ts": now_ms, "reminder": True,
            })
            f["unread"] = int(f.get("unread") or 0) + 1
            f["reminders"] = [x for x in rs if x.get("id") != r0.get("id")]
            changed = True
            print("[social] 提醒 -> %s「%s」" % (f.get("name"), (r0.get("text") or "")[:20]), flush=True)
            break

        hour = datetime.datetime.now().hour
        social = st.setdefault("social", {})
        interval = float(s.get("momentInterval") or 43200)
        last = float(social.get("lastMomentAt") or 0)
        nxt = float(social.get("nextMomentAt") or 0)
        if nxt <= 0:
            nxt = (last + interval) if last > 0 else (now + interval * (0.8 + random.random() * 0.7))
            social["nextMomentAt"] = nxt
            social["lastMomentAt"] = last
            changed = True
        # 我发了新朋友圈 → 安排一个「她因为这条来找你」的私聊。
        # 以前只有客户端排（postMoment 里 20% 概率），概率太低、还要等十几分钟，
        # 用户基本遇不到；这里改成服务端也排一次，老客户端也能生效。
        for m in (st.get("moments") or [])[:6]:
            if m.get("authorId") != "me" or m.get("visibility") == "private":
                continue
            if m.get("dmAt"):
                continue
            age = now - float(m.get("ts") or 0) / 1000.0
            if age < 0 or age > 7200:
                continue
            m["dmAt"] = now
            changed = True
            if any(q.get("kind") == "dm" and q.get("momentId") == m.get("id")
                   for q in st.get("pending") or []):
                continue                    # 客户端已经排过了，别重复
            # 半小时内最多一次：朋友圈频率可以调到 1 分钟一条，
            # 不能每条都来私聊你一次。
            if now - float((st.get("social") or {}).get("lastMomentDmAt") or 0) < 1800:
                continue
            pool = [f for f in (st.get("friends") or []) if f.get("dmMoment") is not False]
            if not pool or random.random() > 0.6:
                continue
            who = random.choice(pool)
            st.setdefault("pending", []).append({
                "id": _nid("p"), "kind": "dm", "momentId": m.get("id"), "by": who.get("id"),
                "dueAt": now + random.randint(90, 480),
            })
            print("[MOMENT] dm queued by=%s moment=%s" % (who.get("id"), m.get("id")), flush=True)

        # 每个人独立的朋友圈排期（没设就跟随全局）。免打扰/睡着时不发。
        # 每轮最多发一个：升级/改设置后一堆人的时间可能同时过期，
        # 否则会同一分钟刷出好几条。
        if 8 <= hour <= 23 and not quiet:
            posted_one = False
            for f in st.get("friends") or []:
                iv = _moment_iv_own(f)
                if not iv:
                    continue          # 跟随全局窗口机制
                if f.get("muted") or friend_asleep(f):
                    continue
                fn = float(f.get("nextMomentAt") or 0)
                if fn <= 0:
                    f["nextMomentAt"] = now + iv * (0.5 + random.random())
                    changed = True
                    continue
                if now >= fn:
                    if posted_one:
                        continue          # 还有人也到期了：留到下一轮，别一起刷屏
                    posted_one = True
                    try:
                        create_moment_for(st, key, f)
                    except Exception as e:
                        print("[social] 单人朋友圈失败：", e)
                    f["nextMomentAt"] = now + iv * (0.7 + random.random() * 0.8)
                    changed = True

        if 8 <= hour <= 23 and not quiet and now >= nxt:
            # 「朋友圈频率：X 分钟一条」就是每 X 分钟一条（从跟随全局的好友里挑一个）。
            # 以前是一个窗口里排 3~5 个人，实际频率是设定的 1.5~3 倍；
            # 单独设了节奏的人也照样被抽中——两处都改掉了。
            social["lastMomentAt"] = now
            social["momentQueue"] = 0          # 老数据里的排队数作废
            social.pop("nextSlotAt", None)
            social["nextMomentAt"] = now + interval * (0.8 + random.random() * 0.7)
            changed = True
            try:
                create_moment(st, key)
            except Exception as e:
                print("[social] 发朋友圈失败：", e)

        # 长期记忆：每积累 30 条更新一次摘要
        for f in st.get("friends") or []:
            msgs = f.get("messages") or []
            done = int(f.get("memoryAt") or 0)
            if len(msgs) - done < 30:
                continue
            lines = []
            me_name = _safe_me_name((st.get("me") or {}).get("name"), "他")
            for m in msgs[-40:]:
                # 这里也不能用「我」：摘要要旁观视角，喂进去的历史也按名字标
                who = me_name if m.get("role") == "user" else (f.get("name") or "她")
                if m.get("text"):
                    lines.append("%s：%s" % (who, m["text"][:60]))
            try:
                mem = gen_memory(f, lines, s, key, me_name)
            except Exception as e:
                print("[social] 记忆失败：", e)
                mem = ""
            if mem:
                f["memory"] = mem
                f["memoryAt"] = len(msgs)
                changed = True
            break

        # 她自己的生活事件：几小时一条，喂给聊天/朋友圈/日记当背景。
        if s.get("lifeOn", True) and not quiet:
            for f in st.get("friends") or []:
                if friend_asleep(f):
                    continue
                nxt_life = float(f.get("nextLifeAt") or 0)
                if nxt_life <= 0:
                    f["nextLifeAt"] = now + random.uniform(3, 7) * 3600
                    changed = True
                    continue
                if now < nxt_life:
                    continue
                msgs = f.get("messages") or []
                last_ms = float(msgs[-1].get("ts") or 0) if msgs else 0
                if not msgs or (now * 1000 - last_ms) > 7 * 86400 * 1000:
                    f["nextLifeAt"] = now + random.uniform(6, 12) * 3600
                    changed = True
                    continue
                try:
                    ev = gen_life_event(f, s, key)
                except Exception as e:
                    print("[social] 生活事件失败：", e)
                    ev = ""
                if ev:
                    evs = [x for x in (f.get("events") or []) if isinstance(x, dict)]
                    evs.append({"ts": int(now * 1000), "text": ev})
                    f["events"] = evs[-12:]
                    f["lastLifeAt"] = now
                    changed = True
                    print("[social] 生活事件 -> %s：%s" % (f.get("name"), ev[:30]), flush=True)
                f["nextLifeAt"] = now + random.uniform(4, 9) * 3600
                changed = True
                break

        # 纪念日 / 认识第 N 天：一天最多一次
        today_key = datetime.date.today().isoformat()
        for f in st.get("friends") or []:
            if quiet_for(f, s):
                continue
            if (f.get("lastAnnivKey") or "") == today_key:
                continue
            occasion = anniversary_today(f)
            if not occasion:
                continue
            me_name = (st.get("me") or {}).get("name") or "对方"
            if me_name in ("我", "对方"):
                me_name = "对方"
            try:
                txt = gen_anniversary(f, me_name, occasion, s, key)
            except Exception as e:
                print("[social] 纪念日失败：", e)
                txt = ""
            if txt:
                f.setdefault("messages", []).append({
                    "id": _nid("m"), "role": "peer", "authorId": f.get("id"),
                    "text": txt, "ts": int(time.time() * 1000), "anniversary": True,
                })
                f["unread"] = int(f.get("unread") or 0) + 1
                f["lastAnnivKey"] = today_key
                changed = True
                print("[social] 纪念日 -> %s（%s）" % (f.get("name"), occasion), flush=True)
            break

        # 她的日记：20:00-23:00 之间随机写一页，每人每天一页
        if s.get("diaryOn", True) and not quiet:
            dnow = datetime.datetime.now()
            if 20 <= dnow.hour <= 22 and random.random() < 0.2:
                for f in st.get("friends") or []:
                    own = f.get("settings") or {}
                    if own.get("diary") is False:
                        continue
                    if friend_asleep(f):
                        continue
                    if (f.get("diaryAt") or "") == today_key:
                        continue
                    msgs = f.get("messages") or []
                    if not msgs or (now * 1000 - float(msgs[-1].get("ts") or 0)) > 7 * 86400 * 1000:
                        f["diaryAt"] = today_key
                        changed = True
                        continue
                    me_name = (st.get("me") or {}).get("name") or "他"
                    if me_name in ("我",):
                        me_name = "他"
                    hist = dm_history(f, me_name, msgs, 6)
                    try:
                        page = gen_diary(f, me_name, hist, s, key, recent_msgs=msgs)
                    except Exception as e:
                        print("[social] 日记失败：", e)
                        page = ""
                    if page:
                        diary = [x for x in (f.get("diary") or []) if isinstance(x, dict)]
                        diary.append({"id": _nid("d"), "date": today_key,
                                      "ts": int(now * 1000), "text": page})
                        f["diary"] = diary[-60:]
                        f["diaryAt"] = today_key
                        changed = True
                        print("[social] 日记 -> %s (%d 字)" % (f.get("name"), len(page)), flush=True)
                    break

        # 早晚安
        if s.get("proactive") and not quiet:
            import datetime as _dt
            today = _dt.date.today().isoformat()
            hour = _dt.datetime.now().hour
            slot = "morning" if 7 <= hour <= 10 else ("night" if 22 <= hour <= 23 else "")
            stamp = today + ":" + slot
            if slot and (st.get("social", {}).get("lastGreet") or "") != stamp:
                for f in st.get("friends") or []:
                    if (f.get("settings") or {}).get("greet") is False:
                        continue
                    if friend_asleep(f):
                        continue
                    if (f.get("lastGreet") or "") == today + slot:
                        continue
                    msgs = f.get("messages") or []
                    if msgs and msgs[-1].get("role") == "user" and (now * 1000 - float(msgs[-1].get("ts") or 0)) < 600000:
                        continue
                    greeting = "早安，今天也要好好吃饭呀" if slot == "morning" else "我先睡啦，你也早点休息"
                    try:
                        txt = call_llm(s.get("baseUrl"), s.get("apiKey") or s.get("key") or "", s.get("model"),
                                       [{"role": "system", "content":
                                         "你就是" + (f.get("name") or "") + "。\n" + (f.get("persona") or "")[:400] +
                                         "\n\n现在" + ("早上" if slot == "morning" else "晚上") +
                                         "，你想给「我」发一句" + ("早安" if slot == "morning" else "晚安") +
                                         "。10~20 字，口语，符合你的性格。只输出这一句。"}],
                                       max_tokens=60, temperature=1.0)
                        txt = _clean(txt, 40) or greeting
                    except Exception:
                        txt = greeting
                    f.setdefault("messages", []).append({
                        "id": _nid("m"), "role": "peer", "authorId": f.get("id"),
                        "text": txt, "ts": int(time.time() * 1000),
                    })
                    f["unread"] = int(f.get("unread") or 0) + 1
                    f["lastGreet"] = stamp
                    st.setdefault("social", {})["lastGreet"] = stamp
                    changed = True
                    break

        # 兜底回复：用户发完 90 秒还没人回，服务器补一条（App 关了也照回）
        names_all = {x.get("id"): x.get("name") for x in st.get("friends") or []}
        for f in st.get("friends") or []:
            msgs = f.get("messages") or []
            if not msgs:
                continue
            last = msgs[-1]
            if last.get("role") != "user":
                continue
            if s.get("lateOn") and float(f.get("lateReplyAt") or 0) > now * 1000:
                continue
            if now * 1000 - float(last.get("ts") or 0) < 90 * 1000:
                continue
            if float(f.get("lastFallbackAt") or 0) == float(last.get("ts") or 0):
                continue
            me_name = (st.get("me") or {}).get("name") or "对方"
            if me_name in ("我", "对方"):
                me_name = "对方"
            hist = dm_history(f, me_name, msgs, 8)
            try:
                line = gen_chat_reply(f, f.get("name"), hist, s, key, recent_msgs=msgs)
            except Exception as e:
                print("[social] 兜底回复失败：", e)
                line = ""
            if line:
                f.setdefault("messages", []).append({
                    "id": _nid("m"), "role": "peer", "authorId": f.get("id"),
                    "text": line, "ts": int(time.time() * 1000),
                    "source": "fallback", "replyTo": last.get("id"),
                })
                f["unread"] = int(f.get("unread") or 0) + 1
                f["lastFallbackAt"] = float(last.get("ts") or 0)
                changed = True
            break

        # 主动找人说话：安静够久就冒个泡（免打扰时段不冒）
        if s.get("proactive") and not quiet:
            quiet_min = float(s.get("idleMin") or 30) * 2
            for f in st.get("friends") or []:
                own = f.get("settings") or {}
                if own.get("proactive") is False:
                    continue
                if friend_asleep(f):
                    continue
                msgs = f.get("messages") or []
                if not msgs:
                    continue
                q = float(own.get("nudgeAfter") or quiet_min)
                last_ts = float(msgs[-1].get("ts") or 0) / 1000.0
                if now - last_ts < q * 60:
                    continue
                if now - float(f.get("lastNudgeAt") or 0) < 3 * 3600:
                    continue
                me_name = (st.get("me") or {}).get("name") or "对方"
                if me_name in ("我", "对方"):
                    me_name = "对方"
                hist = dm_history(f, me_name, msgs, 4)
                directive = (own.get("nextProactive") or "").strip()
                draw_ok = (own.get("doodle") is not False) and (s.get("doodle", True) is not False)
                try:
                    txt = gen_proactive(f, me_name, hist, s, key,
                                        directive=directive, allow_draw=draw_ok,
                                        recent_msgs=msgs)
                except Exception as e:
                    print("[social] 主动消息失败：", e)
                    txt = ""
                if txt:
                    f.setdefault("messages", []).append({
                        "id": _nid("m"), "role": "peer", "authorId": f.get("id"),
                        "text": txt, "ts": int(time.time() * 1000),
                    })
                    f["unread"] = int(f.get("unread") or 0) + 1
                    f["lastNudgeAt"] = now
                    if directive:
                        own.pop("nextProactive", None)
                        # 打上时间戳，客户端同步时据此清掉本地残留的指令，
                        # 否则下一次快照又把它带回来、重复用一遍
                        f["proactiveUsedAt"] = now
                    print("[social] 主动消息 -> %s%s" % (f.get("name"),
                          "（用了指令）" if directive else ""), flush=True)
                    changed = True
                break

        # 小作文：每天 9:00-22:00 之间按概率掷一次；每人每天最多一篇
        if not quiet:
            now_dt = datetime.datetime.now()
            today_key = now_dt.date().isoformat()
            day_start = datetime.datetime.combine(now_dt.date(), datetime.time.min).timestamp()
            if 9 <= now_dt.hour <= 22:
                for f in st.get("friends") or []:
                    chance = essay_chance(f, s)
                    if chance <= 0:
                        continue
                    if (f.get("essayRollDay") or "") == today_key:
                        continue
                    if float(f.get("lastEssayAt") or 0) >= day_start:
                        continue
                    if quiet_for(f, s):
                        continue
                    # 先记「今天掷过了」，避免每 20 秒重掷一次
                    f["essayRollDay"] = today_key
                    changed = True
                    if random.random() * 100 >= chance:
                        continue
                    me_name = (st.get("me") or {}).get("name") or "对方"
                    if me_name in ("我", "对方"):
                        me_name = "对方"
                    msgs = f.get("messages") or []
                    hist = dm_history(f, me_name, msgs, 6)
                    try:
                        essay = gen_essay(f, me_name, hist, s, key, recent_msgs=msgs)
                    except Exception as e:
                        print("[social] 小作文失败：", e)
                        essay = ""
                    if essay:
                        f.setdefault("messages", []).append({
                            "id": _nid("m"), "role": "peer", "authorId": f.get("id"),
                            "text": essay, "ts": int(time.time() * 1000), "essay": True,
                        })
                        f["unread"] = int(f.get("unread") or 0) + 1
                        f["lastEssayAt"] = now
                        print("[social] 小作文 -> %s (%d 字, 概率 %d%%)" % (
                            f.get("name"), len(essay), int(chance)), flush=True)
                        changed = True
                    break

        # 群里她们互相接话：轮流传，每人每轮不超过设置里的「群聊最多几条」
        me_name = (st.get("me") or {}).get("name") or "我"
        for g in st.get("groups") or []:
            if quiet and not force:
                break
            members = [m for m in (g.get("members") or []) if m in name_map]
            if len(members) < 2:
                continue
            if not s.get("groupAutoTalk", True):
                continue
            msgs = g.get("messages") or []
            if not msgs:
                continue
            lastm = msgs[-1] if msgs else {}
            if now - float(g.get("lastSpurtAt") or 0) < 9:
                continue
            avail = [m for m in members if group_can_speak(g, s, m)]
            if not avail:
                continue
            # 用户 @ 了谁，谁优先。
            # 注意要看「最后一条用户消息」，而不是「最后一条消息」：朋友圈互动
            # （source=moment）会被插进群里，之前用 msgs[-1] 判断，这些插话一来
            # 就把 @ 的优先权冲掉了，被 @ 的人反而一声不吭。
            lu = _last_user(msgs)
            mentioned = []
            if lu >= 0 and msgs[lu].get("text"):
                replied_after = {
                    x.get("authorId") for x in msgs[lu + 1:]
                    if x.get("role") != "user" and x.get("source") != "moment"
                }
                for m in members:
                    nm2 = name_map.get(m)
                    if not nm2 or ("@" + nm2) not in msgs[lu]["text"]:
                        continue
                    if m in avail and m not in replied_after and m not in mentioned:
                        mentioned.append(m)
                if mentioned:
                    avail = mentioned
                    print("[GROUP] source=mention group=%s who=%s" % (
                        g.get("id"), ",".join(name_map.get(x, x) for x in mentioned)), flush=True)
            # 尽量换个人说，形成交叉对话
            last_speaker = lastm.get("authorId")
            if len(avail) > 1 and last_speaker in avail:
                avail = [m for m in avail if m != last_speaker]
            g["lastSpurtAt"] = now
            speaker_id = random.choice(avail)
            speaker = friend_by_id(st, speaker_id)
            hist = []
            pics = []
            for m in msgs[-8:]:
                who = me_name if m.get("role") == "user" else (name_map.get(m.get("authorId")) or me_name)
                mt = m.get("text") or ""
                if "<svg" in mt.lower():
                    mt = re.sub(r"(?is)<svg[\s\S]*?</svg>", "", mt).strip() + "［画了一张图］"
                if mt:
                    hist.append("%s：%s%s" % (who, mt[:60], "（附图）" if m.get("image") else ""))
                elif m.get("image"):
                    hist.append("%s：（发了一张图片）" % who)
                # 只把「主人发的图」给模型看：她们自己发的图/表情包成本高，
                # 历史里用「（发了一张图片）」带过就够了
                if m.get("image") and m.get("role") == "user":
                    du = as_data_url(uid, m["image"])
                    if du:
                        pics.append(du)
            reply_to = ""
            if lastm.get("role") != "user" and lastm.get("text"):
                reply_to = name_map.get(lastm.get("authorId")) or ""
            try:
                line = gen_chat_reply(speaker, g.get("name"), hist, s, key,
                                      in_group=True, reply_to=reply_to, group_prompt=g.get("prompt") or "",
                                      being_called=speaker_id in mentioned, images=pics,
                                      recent_msgs=g.get("messages"))
            except Exception as e:
                print("[social] 群聊失败：", e)
                line = ""
            if append_group_reply(g, s, speaker_id, line, "reply"):
                changed = True

        # 群里自己聊两句（免打扰的群不再主动开话题）
        for g in st.get("groups") or []:
            if quiet:
                break
            if g.get("muted"):
                continue
            members = [m for m in (g.get("members") or []) if m in name_map]
            if len(members) < 2 or not s.get("groupAutoTalk", True):
                continue
            available = [m for m in members if group_can_speak(g, s, m)]
            if not available or now - float(g.get("lastSpurtAt") or 0) < 9:
                continue
            lastc = float(g.get("lastChatAt") or 0)
            gap = 7200 * (0.6 + random.random() * 1.2)
            if now - lastc < gap:
                continue
            g["lastChatAt"] = now
            changed = True
            if random.random() > 0.55:
                break
            recent = []
            for m in (g.get("messages") or [])[-6:]:
                who = name_map.get(m.get("authorId")) or (st.get("me") or {}).get("name") or "我"
                if m.get("text"):
                    recent.append("%s：%s" % (who, m["text"][:40]))
            speaker = friend_by_id(st, random.choice(available))
            if not speaker:
                break
            try:
                line = gen_group_smalltalk(speaker, g.get("name"), recent, s, key,
                                          group_prompt=g.get("prompt") or "",
                                          recent_msgs=g.get("messages"))
            except Exception as e:
                print("[social] 群聊失败：", e)
                line = ""
            append_group_reply(g, s, speaker.get("id"), line, "smalltalk")
            break

        if changed:
            save_merged(uid, st)


def friend_by_id(st, fid):
    for f in st.get("friends") or []:
        if f.get("id") == fid:
            return f
    return None


def social_loop():
    while True:
        try:
            for uid in all_uids():
                social_tick(uid)
        except Exception as e:
            print("[social]", e)
        time.sleep(20)


def mention_pending(st):
    """群里最后一条用户消息 @ 了人，而那个人还没接过话。"""
    names = {f.get("id"): f.get("name") for f in st.get("friends") or []}
    for g in st.get("groups") or []:
        msgs = g.get("messages") or []
        lu = _last_user(msgs)
        if lu < 0 or not msgs[lu].get("text"):
            continue
        text = msgs[lu]["text"]
        replied = {m.get("authorId") for m in msgs[lu + 1:]
                   if m.get("role") != "user" and m.get("source") != "moment"}
        for mid in g.get("members") or []:
            nm = names.get(mid)
            if nm and ("@" + nm) in text and mid not in replied:
                return True
    return False


def run_social_now(uid):
    """客户端说自己刚发了言：立刻跑一轮调度，别等 20 秒的定时器。

    被 @ 的人要「第一个说话」：如果这一轮被节流（刚有朋友圈互动插进群里）或者
    生成失败，就隔几秒再补两轮，别让一句 @ 白等二十多秒。
    """
    try:
        for attempt in range(3):
            social_tick(uid, force=True)
            if not mention_pending(load_state(uid)):
                return
            if attempt < 2:
                time.sleep(8)
    except Exception as e:
        print("[social] 即时调度失败：", e)


def main():
    ap = argparse.ArgumentParser(description="轻聊 · 本地 AI 聊天")
    ap.add_argument("port", nargs="?", type=int, default=8777)
    ap.add_argument("--open", action="store_true", help="启动后自动打开浏览器")
    ap.add_argument("--host", default=None,
                    help="监听地址。默认 127.0.0.1（只有本机能访问）；"
                         "服务器上要用 0.0.0.0")
    args = ap.parse_args()

    ensure_data()
    if not os.path.exists(STATE_PATH):
        save_state(default_state())

    threading.Thread(target=social_loop, daemon=True).start()

    url = "http://127.0.0.1:%d/" % args.port
    host = args.host or os.environ.get("QINGLIAO_HOST") or "127.0.0.1"
    httpd = ThreadingHTTPServer((host, args.port), Handler)
    print("\n  轻聊 已启动 →  %s\n  监听：%s:%d\n  数据存放：%s\n  停止：Ctrl+C\n"
          % (url, host, args.port, STATE_PATH))
    if host in ("127.0.0.1", "localhost"):
        print("  提示：只监听本机。要让别的设备访问，加 --host 0.0.0.0\n")
    if args.open:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  已停止。\n")


if __name__ == "__main__":
    main()
