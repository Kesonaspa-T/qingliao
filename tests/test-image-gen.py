#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生图代理的服务端单测：/api/image 转发 + url→base64 + 错误透传 + 鉴权。

跑法：
    python3 tests/test-image-gen.py

不联网：本地起一个假的生图中转站（/v1/images/generations），
server.py 起在另一个随机端口，全部走真实 HTTP。
"""
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix="ql-img-test-")

FAILS = []
PASSES = []


def ok(name, cond, detail=""):
    (PASSES if cond else FAILS).append(name)
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else " :: " + str(detail)[:240]))


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


PNG_1X1 = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


# ---------- 假的生图中转站 ----------
CALLS = []
EDITS = []
EDIT_AUTH = []


def parse_multipart(headers, raw):
    """把 multipart/form-data 拆成 [{name, filename, value, size}]，用来断言服务器怎么拼的。"""
    ctype = headers.get("Content-Type", "")
    m = re.search(r"boundary=([^;]+)", ctype)
    if not m:
        return []
    boundary = m.group(1).strip().strip('"').encode()
    parts = []
    for chunk in raw.split(b"--" + boundary):
        chunk = chunk.strip(b"\r\n")
        if not chunk or chunk.startswith(b"--"):
            continue
        head, _, body = chunk.partition(b"\r\n\r\n")
        name = filename = ""
        for line in head.decode("utf-8", "ignore").split("\r\n"):
            mm = re.search(r'name="([^"]*)"', line)
            if mm:
                name = mm.group(1)
            mm = re.search(r'filename="([^"]*)"', line)
            if mm:
                filename = mm.group(1)
        parts.append({"name": name, "filename": filename,
                      "size": len(body),
                      "value": "" if filename else body.decode("utf-8", "ignore")})
    return parts


class MockRelay(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        raw = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == "/img.png":
            raw = __import__("base64").b64decode(PNG_1X1)
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        self._send(404, {"error": "not found"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n)
        if self.path == "/v1/images/edits":
            parts = parse_multipart(self.headers, raw)
            EDITS.append(parts)
            EDIT_AUTH.append(self.headers.get("Authorization"))
            names = [p["name"] for p in parts]
            model = next((p["value"] for p in parts if p["name"] == "model"), "")
            if model == "retry-field" and "image[]" in names:
                return self._send(400, {"error": {"message": "Unknown parameter: image[]"}})
            if model == "edits-fail":
                return self._send(500, {"error": {"message": "boom"}})
            if model == "guardrail":
                return self._send(400, {"error": {"message": "Your prompt may violate our guardrails around nudity, sexuality"}})
            return self._send(200, {"created": 1, "data": [{"b64_json": PNG_1X1}]})
        body = json.loads(raw or b"{}")
        CALLS.append({"path": self.path, "auth": self.headers.get("Authorization"), "body": body})
        if self.path != "/v1/images/generations":
            return self._send(404, {"error": "not found"})
        if body.get("model") == "no-key":
            return self._send(401, {"error": {"message": "invalid api key"}})
        if body.get("model") == "bad-param":
            return self._send(400, {"error": {"message": "size is not supported"}})
        if body.get("model") == "url-only":
            return self._send(200, {"data": [{"url": "http://127.0.0.1:%d/img.png" % self.server.server_port}]})
        return self._send(200, {"created": 1, "data": [{"b64_json": PNG_1X1}]})


relay_port = free_port()
relay = ThreadingHTTPServer(("127.0.0.1", relay_port), MockRelay)
threading.Thread(target=relay.serve_forever, daemon=True).start()
RELAY = "http://127.0.0.1:%d" % relay_port

# ---------- 起 server.py ----------
port = free_port()
env = dict(os.environ, QINGLIAO_DATA=TMP)
proc = subprocess.Popen([sys.executable, os.path.join(ROOT, "server.py"), str(port)],
                        cwd=ROOT, env=env,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
BASE = "http://127.0.0.1:%d" % port
TOKEN = ""


def api(method, path, payload=None, token=None, raw=False):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    tok = token if token is not None else TOKEN
    if tok:
        req.add_header("Authorization", "Bearer " + tok)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read()
            return r.status, (json.loads(body) if not raw else body)
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, {"raw": body[:200].decode("utf-8", "ignore")}


try:
    # 等服务起来
    up = False
    for _ in range(80):
        try:
            st, _j = api("GET", "/api/authinfo", token="")
            if st == 200:
                up = True
                break
        except Exception:
            pass
        time.sleep(0.15)
    ok("server.py 起来了", up, BASE)

    st, j = api("POST", "/api/register", {"name": "测试用户", "password": "123456"}, token="")
    ok("注册拿到 token", st == 200 and bool(j.get("token")), (st, j))
    TOKEN = j.get("token", "")

    st, j = api("GET", "/api/status")
    ok("服务端 build 升到 v47", st == 200 and j.get("build") == "v47", j.get("build"))

    # 1) 正常 b64_json 转发 + Key 透传
    st, j = api("POST", "/api/image", {
        "url": RELAY + "/v1/images/generations",
        "key": "sk-image-test",
        "body": {"model": "gpt-image-1", "prompt": "窗边的自拍", "n": 1, "size": "1024x1024"},
    })
    item = ((j.get("data") or [{}])[0] if isinstance(j.get("data"), list) else {})
    ok("生图请求返回 b64_json", st == 200 and item.get("b64_json") == PNG_1X1, (st, j))
    ok("生图请求把提示词和参数原样转过去",
       CALLS and CALLS[-1]["body"].get("prompt") == "窗边的自拍"
       and CALLS[-1]["body"].get("model") == "gpt-image-1"
       and CALLS[-1]["body"].get("size") == "1024x1024", CALLS[-1] if CALLS else None)
    ok("生图 Key 走 Authorization: Bearer",
       CALLS and CALLS[-1]["auth"] == "Bearer sk-image-test", CALLS[-1] if CALLS else None)

    # 2) 只回 url 的中转：服务器要下载成 b64_json
    st, j = api("POST", "/api/image", {
        "url": RELAY + "/v1/images/generations", "key": "k",
        "body": {"model": "url-only", "prompt": "把这张存成 base64"},
    })
    item = ((j.get("data") or [{}])[0] if isinstance(j.get("data"), list) else {})
    ok("只回 url 的中转会补成 b64_json", st == 200 and item.get("b64_json") == PNG_1X1, (st, j))
    ok("补 b64 时带上真实格式", item.get("output_format") == "png", item.get("output_format"))

    # 3) 错误透传：Key 错、参数错
    st, j = api("POST", "/api/image", {
        "url": RELAY + "/v1/images/generations", "key": "k",
        "body": {"model": "no-key", "prompt": "x"},
    })
    ok("401 变成能看懂的一句话", st == 502 and "Key" in (j.get("error") or ""), (st, j))
    st, j = api("POST", "/api/image", {
        "url": RELAY + "/v1/images/generations", "key": "k",
        "body": {"model": "bad-param", "prompt": "x"},
    })
    ok("400 把中转到的话带回来", st == 502 and "size is not supported" in (j.get("error") or ""), (st, j))

    # 4) 参数缺失 / 未登录
    st, j = api("POST", "/api/image", {"key": "k", "body": {"prompt": "x"}})
    ok("缺接口地址返回 400", st == 400 and "生图接口" in (j.get("error") or ""), (st, j))
    st, j = api("POST", "/api/image", {"url": RELAY, "body": "x"})
    ok("body 不是对象返回 400", st == 400, (st, j))
    st, j = api("POST", "/api/image", {"url": "file:///etc/passwd", "body": {"prompt": "x"}})
    ok("只放行 http(s)，不做成万能代理", st == 400 and "http" in (j.get("error") or ""), (st, j))
    st, j = api("POST", "/api/image", {"url": RELAY + "/v1/images/generations", "body": {"prompt": "x"}}, token="")
    ok("没登录不能白嫖生图", st == 401, (st, j))

    # 5) 连不上的地址
    st, j = api("POST", "/api/image", {"url": "http://127.0.0.1:1/v1/images/generations", "body": {"prompt": "x"}})
    ok("连不上中转时给一句人话", st == 502 and "连不上生图接口" in (j.get("error") or ""), (st, j))

    # 6) 带参考图：/api/image-edit 拼 multipart
    refs = ["data:image/jpeg;base64," + "A" * 8, "data:image/png;base64," + "B" * 8]
    st, j = api("POST", "/api/image-edit", {
        "url": RELAY + "/v1/images/edits", "key": "sk-edit",
        "body": {"model": "edits-ok", "prompt": "窗边自拍", "n": 1, "size": "1024x1536", "quality": "high"},
        "images": refs,
    })
    item = ((j.get("data") or [{}])[0] if isinstance(j.get("data"), list) else {})
    ok("参考图走 /images/edits 并拿回 b64", st == 200 and item.get("b64_json") == PNG_1X1, (st, j))
    last = EDITS[-1] if EDITS else []
    names = [p["name"] for p in last]
    ok("multipart 里参数齐全", all(k in names for k in ("model", "prompt", "n", "size", "quality")), names)
    ok("参考图按 image[] 传，数量对", names.count("image[]") == 2, names)
    ok("参考图带文件名和内容", all(p["filename"] and p["size"] > 0 for p in last if p["name"] == "image[]"),
       [(p["name"], p["filename"], p["size"]) for p in last])
    ok("edit 的 Key 也走 Bearer", EDIT_AUTH and EDIT_AUTH[-1] == "Bearer sk-edit", EDIT_AUTH[-1] if EDIT_AUTH else None)
    # 中继只认 image 时自动换字段名再试一次
    before = len(EDITS)
    st, j = api("POST", "/api/image-edit", {
        "url": RELAY + "/v1/images/edits", "key": "k",
        "body": {"model": "retry-field", "prompt": "x"}, "images": refs[:1],
    })
    tried = [sorted(set(p["name"] for p in e)) for e in EDITS[before:]]
    ok("image[] 被拒后自动改试 image", st == 200 and len(EDITS) - before == 2
       and "image[]" in tried[0] and "image" in tried[1], (st, j, tried))
    # 500 不该重试、也不该假装成功
    before = len(EDITS)
    st, j = api("POST", "/api/image-edit", {
        "url": RELAY + "/v1/images/edits", "key": "k",
        "body": {"model": "edits-fail", "prompt": "x"}, "images": refs[:1],
    })
    ok("中转 500 直接报错，不重复扣费", st == 502 and len(EDITS) - before == 1, (st, j))
    # 审核拦下来：不要换字段名重试（白跑一次），直接把原话带回去
    before = len(EDITS)
    st, j = api("POST", "/api/image-edit", {
        "url": RELAY + "/v1/images/edits", "key": "k",
        "body": {"model": "guardrail", "prompt": "x"}, "images": refs[:1],
    })
    ok("审核 400 不重复请求，原话带回去",
       st == 502 and len(EDITS) - before == 1 and "guardrails" in (j.get("error") or ""),
       (st, j, len(EDITS) - before))
    st, j = api("POST", "/api/image-edit", {"url": RELAY + "/v1/images/edits", "body": {"prompt": "x"}, "images": []})
    ok("没有参考图返回 400", st == 400 and "参考图" in (j.get("error") or ""), (st, j))
    st, j = api("POST", "/api/image-edit", {
        "url": RELAY + "/v1/images/edits", "body": {"prompt": "x"}, "images": refs}, token="")
    ok("没登录不能带参考图生图", st == 401, (st, j))
finally:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except Exception:
        proc.kill()
    relay.shutdown()

print("\nPASSES: %d FAILS: %d" % (len(PASSES), len(FAILS)))
sys.exit(1 if FAILS else 0)
