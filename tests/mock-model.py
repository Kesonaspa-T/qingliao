"""测试用的假模型：任何 POST 都回固定文本；请求里出现「写个脚本/python」时回文件块。
把请求体追加到 /tmp/mockllm.log，供 web-e2e.mjs 断言提示词内容。

用法：python3 tests/mock-model.py   （监听 127.0.0.1:8797，需与 web-e2e.mjs 的 baseUrl 一致）
"""
import json, http.server, socketserver

LOG = '/tmp/mockllm.log'

class H(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Qingliao-Build')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(n)
        try:
            data = json.loads(raw)
        except Exception:
            data = {}
        try:
            with open(LOG, 'a') as f:
                f.write(json.dumps(data, ensure_ascii=False) + '\n')
        except Exception:
            pass
        joined = json.dumps(data.get('messages') or [], ensure_ascii=False)
        text = '收到啦，我在呢'
        if '写个脚本' in joined or 'python' in joined.lower():
            text = '给你写好了\n[[文件:hello.py]]\nprint("hi")\n[[/文件]]'
        if data.get('stream') is False:
            body = json.dumps({'choices': [{'message': {'content': text}}]}, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self._cors()
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self._cors()
        self.end_headers()
        for i in range(0, len(text), 6):
            chunk = text[i:i + 6]
            payload = {'choices': [{'delta': {'content': chunk}}]}
            self.wfile.write(('data: ' + json.dumps(payload, ensure_ascii=False) + '\n\n').encode('utf-8'))
            self.wfile.flush()
        self.wfile.write(b'data: [DONE]\n\n')
        self.wfile.flush()

    def log_message(self, *a):
        pass

socketserver.ThreadingTCPServer.allow_reuse_address = True
socketserver.ThreadingTCPServer(('127.0.0.1', 8797), H).serve_forever()
