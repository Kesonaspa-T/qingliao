"""私聊兜底与客户端竞态：python3 tests/test-reply-fallback.py，不访问模型或真实数据。"""
import copy
import importlib.util
import os
from pathlib import Path
import tempfile
import time
import unittest

tmp = tempfile.TemporaryDirectory(prefix="ql-fallback-test-")
os.environ["QINGLIAO_DATA"] = tmp.name
spec = importlib.util.spec_from_file_location("qlserver", Path(__file__).resolve().parents[1] / "server.py")
srv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(srv)


class FallbackTests(unittest.TestCase):
    def setUp(self):
        self.state = srv.default_state()
        self.state["settings"].update(apiKey="test-only", lifeOn=False, diaryOn=False,
                                      essayChance=0, proactive=False, lateOn=False)
        self.user = {"id": "u1", "role": "user", "text": "问题", "ts": int(time.time() * 1000) - 120000}
        self.state["friends"] = [{"id": "f1", "name": "测试", "createdAt": int(time.time() * 1000),
                                  "settings": {"greet": False}, "nextMomentAt": time.time() + 86400,
                                  "messages": [self.user]}]
        self.fallback = {"id": "a-fallback", "role": "peer", "text": "兜底", "ts": int(time.time() * 1000),
                         "source": "fallback", "replyTo": "u1"}
        self.incoming = copy.deepcopy(self.state)
        self.incoming["friends"][0]["messages"].append(self.fallback)

    def merge(self, old):
        return srv.merge_state(old, self.incoming, background=True)["friends"][0]["messages"]

    def test_default_late_reply_off(self):
        self.assertIs(srv.default_state()["settings"]["lateOn"], False)

    def test_unanswered_fallback_accepted(self):
        self.assertIn(self.fallback, self.merge(self.state))

    def test_client_answer_arrived_during_generation(self):
        self.state["friends"][0]["messages"].append({"id": "client", "role": "peer", "text": "已回答", "ts": self.user["ts"] + 1})
        self.assertNotIn(self.fallback, self.merge(self.state))

    def test_new_question_arrived_during_generation(self):
        self.state["friends"][0]["messages"].append({"id": "u2", "role": "user", "text": "补充", "ts": self.user["ts"] + 1})
        self.assertNotIn(self.fallback, self.merge(self.state))

    def test_cleared_history_does_not_receive_fallback(self):
        self.state["friends"][0]["messages"] = []
        self.state["deleted"] = ["u1"]
        self.assertEqual(self.merge(self.state), [])

    def test_existing_fallback_is_not_deleted_by_later_question(self):
        self.state["friends"][0]["messages"] += [self.fallback, {"id": "u2", "role": "user", "text": "后来", "ts": self.fallback["ts"] + 1}]
        self.assertIn(self.fallback, self.merge(self.state))

    def test_scheduler_honors_late_wait_and_marks_target(self):
        uid = "test-scheduler"
        calls = []
        original = srv.gen_chat_reply
        srv.gen_chat_reply = lambda *a, **kw: calls.append(1) or "模拟回复"
        try:
            self.state["settings"]["lateOn"] = True
            self.state["friends"][0]["lateReplyAt"] = int(time.time() * 1000) + 60000
            srv.save_state(self.state, uid)
            srv.social_tick(uid)
            self.assertEqual(calls, [])
            state = srv.load_state(uid)
            state["friends"][0]["lateReplyAt"] = 0
            srv.save_state(state, uid)
            srv.social_tick(uid)
            last = srv.load_state(uid)["friends"][0]["messages"][-1]
            self.assertEqual((last.get("source"), last.get("replyTo")), ("fallback", "u1"))
            self.assertEqual(len(calls), 1)
        finally:
            srv.gen_chat_reply = original


if __name__ == "__main__":
    try:
        unittest.main()
    finally:
        tmp.cleanup()
