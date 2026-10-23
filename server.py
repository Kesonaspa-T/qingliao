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
import datetime
import hashlib
import json
import os
import random
import secrets
import ssl
import sys
import shutil
import tempfile
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
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


GROUP_FIELDS = ("name", "avatar", "members", "prompt")
GROUP_RUNTIME = ("turnCounts", "lastSpurtAt", "lastChatAt")


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

    old_friends = _by_id(old.get("friends"))
    friends = []
    for f in new.get("friends") or []:
        if f.get("id") in deleted:
            continue
        base = old_friends.get(f.get("id")) or {}
        msgs = list(f.get("messages") or [])
        have = {m.get("id") for m in msgs}
        for m in base.get("messages") or []:
            if m.get("id") not in have:
                msgs.append(m)
        f = dict(f)
        f["messages"] = sorted(
            [m for m in msgs if m.get("id") not in deleted],
            key=lambda m: m.get("ts", 0),
        )
        friends.append(f)
    kept = {f.get("id") for f in friends}
    for f in old.get("friends") or []:
        if f.get("id") in kept or f.get("id") in deleted:
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
        msgs = {m.get("id"): m for m in base.get("messages") or [] if m.get("id") not in deleted}
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
        if g.get("id") in keptg or g.get("id") in deleted:
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
        if m.get("id") not in seen and m.get("id") not in deleted:
            moments.append(m)
    out["moments"] = sorted(moments, key=lambda m: m.get("ts", 0), reverse=True)[:300]

    old_pending = _by_id(old.get("pending"))
    pending = list(new.get("pending") or [])
    have = {p.get("id") for p in pending}
    _now = time.time()
    for pid, p in old_pending.items():
        if pid in have:
            continue
        # 已经到期的旧任务不再从磁盘捞回来：它要么已执行，要么是僵尸
        if float(p.get("dueAt") or 0) <= _now:
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
                "deleted", "drafts", "social"):
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
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
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
                    "build": "v25",
                    "groupUsage": {g.get("id"): {"total": group_usage(g)[0], "counts": group_usage(g)[1],
                                   "limits": group_limits(st.get("settings") or {})} for g in st.get("groups") or []},
                })
                return

            if path == "/api/rev":
                st = load_state(uid)
                return self._json(200, {"rev": int(st.get("rev") or 0)})
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
                save_state(merged, uid)
            print("[SYNC] client=%s deleted_in=%d deleted_saved=%d rev=%d" % (
                self.headers.get("X-Qingliao-Build", "legacy"), len(payload.get("deleted") or []),
                len(merged.get("deleted") or []), merged["rev"]), flush=True)
            return self._json(200, {"ok": True, "rev": merged["rev"], "moments": len(merged.get("moments") or [])})
        if path == "/api/chat":
            return self._handle_chat()
        if path == "/api/ping":
            return self._handle_ping()
        if path == "/api/search":
            return self._handle_proxy_json()
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


def gen_moment_text(friend, settings, key):
    now = datetime.datetime.now()
    wd = "一二三四五六日"[now.weekday()]
    sys = (
        "你就是" + (friend.get("name") or "") + "。\n"
        + (friend.get("persona") or "") + "\n\n"
        "现在要发一条朋友圈。\n"
        "要求：\n"
        "- 1~3 句，口语，像随手发的\n"
        "- 不写配图说明，不加引号，不用标题\n"
        "- 不要提“朋友圈”三个字，不要提问\n"
        "- 最多一个 emoji\n"
        "- 只输出这条朋友圈的文字本身"
    )
    user = "现在是周%s %s。" % (wd, now.strftime("%H:%M"))
    text = call_llm(
        settings.get("baseUrl"), key, settings.get("model"),
        [{"role": "system", "content": sys}, {"role": "user", "content": user}],
        max_tokens=120, temperature=1.0,
    )
    return _clean(text, 120)


def thread_text(st, m, limit=10):
    names = {x.get("id"): x.get("name") for x in st.get("friends") or []}
    names["me"] = (st.get("me") or {}).get("name") or "我"
    lines = []
    for c in (m.get("comments") or [])[-limit:]:
        lines.append("%s：%s" % (names.get(c.get("by"), "某人"), c.get("text", "")))
    return "\n".join(lines)


def gen_comment_text(friend, author_name, moment_text, thread, settings, key):
    sys = (
        "你就是" + (friend.get("name") or "") + "。\n"
        + (friend.get("persona") or "") + "\n\n"
        + author_name + " 发了条朋友圈：\n「" + (moment_text or "") + "」\n\n"
    )
    if thread:
        sys += "评论区已经有这些话：\n" + thread + "\n\n"
        sys += (
            "你再补一句评论。注意：\n"
            "- 别人说过的话别重复\n"
            "- 如果对方是在回你，就顺着往下接，别再问同一个问题\n"
            "- 10~25 字，口语\n"
            "- 只输出你自己的一句评论（不超过 30 字），不要加人名前缀，不要写成对话，不要替别人说话"
        )
    else:
        sys += "用一句评论回应，10~25 字，口语，像熟人随口说的。不客套，不要堆 emoji。只输出评论本身。"
    text = call_llm(
        settings.get("baseUrl"), key, settings.get("model"),
        [{"role": "system", "content": sys}], max_tokens=70, temperature=1.0,
    )
    return _clean(text, 60)


def gen_reply_text(friend, commenter_name, moment_text, comment_text, thread, settings, key):
    sys = (
        "你就是" + (friend.get("name") or "") + "。\n"
        + (friend.get("persona") or "") + "\n\n"
        + "你发了条朋友圈：\n「" + (moment_text or "") + "」\n\n"
    )
    if thread:
        sys += "评论区：\n" + thread + "\n\n"
    sys += (
        commenter_name + " 刚评论了：\n「" + (comment_text or "") + "」\n\n"
        "回他一句。10~25 字，口语，像真人回评论。别客套，别总结。\n"
        "只输出你自己的一句话，不要加人名前缀，不要替别人说话。"
    )
    text = call_llm(
        settings.get("baseUrl"), key, settings.get("model"),
        [{"role": "system", "content": sys}], max_tokens=70, temperature=1.0,
    )
    return _clean(text, 60)


def gen_dm_text(friend, owner_name, moment_text, settings, key):
    sys = (
        "你就是" + (friend.get("name") or "") + "。\n"
        + (friend.get("persona") or "") + "\n\n"
        + owner_name + " 刚发了条朋友圈：\n「" + (moment_text or "") + "」\n\n"
        "你想私聊跟他说一句，就为这事儿。10~25 字，口语，像微信上随手发的。"
        "不要提“朋友圈”三个字。只输出你自己这一句，不要扮演对方。"
    )
    text = call_llm(
        settings.get("baseUrl"), key, settings.get("model"),
        [{"role": "system", "content": sys}], max_tokens=70, temperature=1.0,
    )
    return _clean(text, 60)


def group_prompt_text(group_prompt):
    return "\n\n【群设定：群内所有成员共同遵守】\n" + group_prompt + "\n\n" if group_prompt else ""


def gen_group_line(friend, author_name, moment_text, prev_lines, settings, key, group_prompt=""):
    sys = (
        "你就是" + (friend.get("name") or "") + "。\n"
        + (friend.get("persona") or "") + "\n\n"
        + "你们在一个群里聊天。" + author_name + " 刚发了条朋友圈：\n「" + (moment_text or "") + "」\n\n"
    )
    sys += group_prompt_text(group_prompt)
    if prev_lines:
        sys += "群里已经有人说：\n" + "\n".join(prev_lines) + "\n\n"
    sys += "你要在群里说一句，聊的就是这条。10~25 字，口语，像群里随口插一句。只输出这一句。"
    text = call_llm(
        settings.get("baseUrl"), key, settings.get("model"),
        [{"role": "system", "content": sys}], max_tokens=70, temperature=1.0,
    )
    return _clean(text, 60)


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


def gen_group_smalltalk(friend, group_name, recent_lines, settings, key, group_prompt=""):
    sys = (
        "你就是" + (friend.get("name") or "") + "。\n"
        + (friend.get("persona") or "") + "\n\n"
        "你们在一个叫「" + (group_name or "群") + "」的群里。\n"
    )
    sys += group_prompt_text(group_prompt)
    if recent_lines:
        sys += "最近群里聊的是：\n" + "\n".join(recent_lines) + "\n\n"
    sys += ("你想起来一句，随口发到群里。10~20 字，口语，别问句式的套话。"
            "只输出你自己这一句，不要加人名前缀，不要替别人说话。")
    text = call_llm(
        settings.get("baseUrl"), key, settings.get("model"),
        [{"role": "system", "content": sys}], max_tokens=60, temperature=1.0,
    )
    return _clean(text, 50)


def gen_chat_reply(friend, conv_name, history_lines, settings, key, in_group=False, reply_to="", group_prompt=""):
    sys = "你就是" + (friend.get("name") or "") + "。\n" + (friend.get("persona") or "") + "\n\n"
    if in_group:
        sys += group_prompt_text(group_prompt)
        sys += ("你们在群「" + (conv_name or "群") + "」里聊天。只以你自己的身份说话，"
                "不要加名字前缀，不要替别人说。\n")
        if reply_to and reply_to != (friend.get("name") or ""):
            sys += "接着「" + reply_to + "」那句往下说，像真人在群里接话。\n"
    sys += "最近的消息：\n" + "\n".join(history_lines[-10:]) + "\n\n"
    sys += "接着聊，回 1~2 句，10~30 字，口语。只输出你要说的话。"
    text = call_llm(
        settings.get("baseUrl"), key, settings.get("model"),
        [{"role": "system", "content": sys}], max_tokens=90, temperature=0.95,
    )
    return _clean(text, 80)


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
    text = gen_moment_text(author, st.get("settings") or {}, key)
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


def create_moment(st, key):
    friends = st.get("friends") or []
    if not friends:
        return False
    social = st.setdefault("social", {})
    last_author = social.get("lastMomentAuthor")
    pool = [f for f in friends if f.get("id") != last_author] or friends
    author = random.choice(pool)
    social["lastMomentAuthor"] = author.get("id")
    text = gen_moment_text(author, st.get("settings") or {}, key)
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


def run_pending(st, p, key):
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
        text = gen_comment_text(f, author, m.get("text", ""), thread_text(st, m), settings, key)
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
        text = gen_dm_text(f, names.get("me", "我"), m.get("text", ""), settings, key)
        if not text:
            return False
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
                                  group_prompt=g.get("prompt") or "")
            if not append_group_reply(g, settings, speaker.get("id"), line, "moment"):
                continue
            prev.append("%s：%s" % (speaker.get("name"), line))
        return bool(prev)

    return False


def all_uids():
    data = load_users()
    ids = [u.get("id") for u in data.get("users") or [] if u.get("id")]
    return ids or ["local"]


def gen_memory(friend, history_lines, settings, key):
    sys = ("下面是你和「我」最近的聊天。用 3~5 句、第一人称，总结你们之间值得长期记住的事："
           "聊过什么、我的偏好、发生过的事。像写日记，别评价，别编造。只输出总结。\n\n"
           + "\n".join(history_lines[-40:]))
    text = call_llm(settings.get("baseUrl"), key, settings.get("model"),
                    [{"role": "system", "content": sys}], max_tokens=220, temperature=0.6)
    return _clean(text, 500)


def social_tick(uid="local"):
    with STATE_LOCK:
        st = load_state(uid)
        s = st.get("settings") or {}
        key = (s.get("apiKey") or "").strip()
        if not key:
            return

        now = time.time()
        changed = False
        name_map = {x.get("id"): x.get("name") for x in st.get("friends") or []}

        keep = []
        for p in st.get("pending") or []:
            if float(p.get("dueAt") or 0) > now:
                keep.append(p)
                continue
            try:
                if run_pending(st, p, key):
                    changed = True
            except Exception as e:
                print("[social] 互动失败：", e)
        if len(keep) != len(st.get("pending") or []):
            changed = True
        st["pending"] = keep

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
        # 每个人独立的朋友圈排期（没设就跟随全局）
        if 8 <= hour <= 23:
            for f in st.get("friends") or []:
                own = f.get("settings") or {}
                iv = own.get("momentInterval")
                if iv is None:
                    continue          # 跟随全局窗口机制
                iv = max(300, float(iv))
                fn = float(f.get("nextMomentAt") or 0)
                if fn <= 0:
                    f["nextMomentAt"] = now + iv * (0.5 + random.random())
                    changed = True
                    continue
                if now >= fn:
                    try:
                        create_moment_for(st, key, f)
                    except Exception as e:
                        print("[social] 单人朋友圈失败：", e)
                    f["nextMomentAt"] = now + iv * (0.7 + random.random() * 0.8)
                    changed = True

        if 8 <= hour <= 23 and now >= nxt:
            # 一个窗口里安排 3~5 个人发，时间随机打散
            friends_now = [f for f in (st.get("friends") or []) if not f.get("muted")]
            k = min(len(friends_now), random.randint(3, 5)) if friends_now else 0
            social["lastMomentAt"] = now
            social["momentQueue"] = k
            social["nextMomentAt"] = now + interval * (0.8 + random.random() * 0.7)
            step = interval / max(1, k) if k else interval
            social["nextSlotAt"] = now + step * (0.3 + random.random() * 0.8)
            changed = True

        # 窗口内的排期：到点了就让一个人发
        slot = float(social.get("nextSlotAt") or 0)
        left = int(social.get("momentQueue") or 0)
        if left > 0 and now >= slot:
            social["momentQueue"] = left - 1
            step = interval / max(1, int(social.get("momentQueue") or left) + 1)
            social["nextSlotAt"] = now + step * (0.4 + random.random() * 1.2)
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
            for m in msgs[-40:]:
                who = "我" if m.get("role") == "user" else (f.get("name") or "她")
                if m.get("text"):
                    lines.append("%s：%s" % (who, m["text"][:60]))
            try:
                mem = gen_memory(f, lines, s, key)
            except Exception as e:
                print("[social] 记忆失败：", e)
                mem = ""
            if mem:
                f["memory"] = mem
                f["memoryAt"] = len(msgs)
                changed = True
            break

        # 早晚安
        if s.get("proactive"):
            import datetime as _dt
            today = _dt.date.today().isoformat()
            hour = _dt.datetime.now().hour
            slot = "morning" if 7 <= hour <= 10 else ("night" if 22 <= hour <= 23 else "")
            stamp = today + ":" + slot
            if slot and (st.get("social", {}).get("lastGreet") or "") != stamp:
                for f in st.get("friends") or []:
                    if (f.get("settings") or {}).get("greet") is False:
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
            if now * 1000 - float(last.get("ts") or 0) < 90 * 1000:
                continue
            if float(f.get("lastFallbackAt") or 0) == float(last.get("ts") or 0):
                continue
            hist = []
            for m in msgs[-8:]:
                who = "我" if m.get("role") == "user" else (f.get("name") or "她")
                if m.get("text"):
                    hist.append("%s：%s" % (who, m["text"][:60]))
            try:
                line = gen_chat_reply(f, f.get("name"), hist, s, key)
            except Exception as e:
                print("[social] 兜底回复失败：", e)
                line = ""
            if line:
                f.setdefault("messages", []).append({
                    "id": _nid("m"), "role": "peer", "authorId": f.get("id"),
                    "text": line, "ts": int(time.time() * 1000),
                })
                f["unread"] = int(f.get("unread") or 0) + 1
                f["lastFallbackAt"] = float(last.get("ts") or 0)
                changed = True
            break

        # 主动找人说话：安静够久就冒个泡
        if s.get("proactive"):
            quiet_min = float(s.get("idleMin") or 30) * 2
            for f in st.get("friends") or []:
                own = f.get("settings") or {}
                if own.get("proactive") is False:
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
                hist = []
                for m in msgs[-6:]:
                    who = "我" if m.get("role") == "user" else (f.get("name") or "她")
                    if m.get("text"):
                        hist.append("%s：%s" % (who, m["text"][:50]))
                try:
                    txt = gen_chat_reply(f, f.get("name"), hist, s, key)
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
                    changed = True
                break

        # 群里她们互相接话：轮流传，每人每轮不超过设置里的「群聊最多几条」
        me_name = (st.get("me") or {}).get("name") or "我"
        for g in st.get("groups") or []:
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
            # 用户 @ 了谁，谁优先（下一次发言时）
            if lastm.get("role") == "user" and lastm.get("text"):
                for m in members:
                    nm2 = name_map.get(m)
                    if nm2 and ("@" + nm2) in lastm["text"] and m in avail:
                        avail = [m]
                        break
            # 尽量换个人说，形成交叉对话
            last_speaker = lastm.get("authorId")
            if len(avail) > 1 and last_speaker in avail:
                avail = [m for m in avail if m != last_speaker]
            g["lastSpurtAt"] = now
            speaker_id = random.choice(avail)
            speaker = friend_by_id(st, speaker_id)
            hist = []
            for m in msgs[-8:]:
                who = me_name if m.get("role") == "user" else (name_map.get(m.get("authorId")) or me_name)
                if m.get("text"):
                    hist.append("%s：%s" % (who, m["text"][:60]))
            reply_to = ""
            if lastm.get("role") != "user" and lastm.get("text"):
                reply_to = name_map.get(lastm.get("authorId")) or ""
            try:
                line = gen_chat_reply(speaker, g.get("name"), hist, s, key,
                                      in_group=True, reply_to=reply_to, group_prompt=g.get("prompt") or "")
            except Exception as e:
                print("[social] 群聊失败：", e)
                line = ""
            if append_group_reply(g, s, speaker_id, line, "reply"):
                changed = True

        # 群里自己聊两句
        for g in st.get("groups") or []:
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
                                          group_prompt=g.get("prompt") or "")
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
