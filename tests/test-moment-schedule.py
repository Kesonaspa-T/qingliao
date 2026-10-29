#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""朋友圈排期单测：总频率 + 每个人单独节奏，到底生不生效。

跑法：python3 tests/test-moment-schedule.py
不联网：模型调用、生成函数全部 monkeypatch；时钟用假时钟，按分钟推进 24 小时。
"""
import copy
import datetime as _dt
import importlib.util
import os
import random
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix="ql-moment-")
os.environ["QINGLIAO_DATA"] = TMP

spec = importlib.util.spec_from_file_location("qlserver", os.path.join(ROOT, "server.py"))
srv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(srv)

FAILS = []
PASSES = []


def ok(name, cond, detail=""):
    (PASSES if cond else FAILS).append(name)
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else " :: " + str(detail)[:200]))


# ---------- 假时钟：12:00 起，按分钟推进 ----------
CLOCK = [0.0]


class TimeShim:
    def __getattr__(self, k):
        return getattr(time, k)

    def time(self):
        return CLOCK[0]


srv.time = TimeShim()


class FakeDatetime(_dt.datetime):
    @classmethod
    def now(cls, tz=None):
        return _dt.datetime.fromtimestamp(CLOCK[0])


class FakeDate(_dt.date):
    @classmethod
    def today(cls):
        return _dt.date.fromtimestamp(CLOCK[0])


class FakeDT:
    datetime = FakeDatetime
    date = FakeDate
    timedelta = _dt.timedelta
    time = _dt.time


srv.datetime = FakeDT

# ---------- 假模型：不联网 ----------
srv.call_llm = lambda *a, **k: ""
srv.gen_moment_text = lambda *a, **k: "测试朋友圈"
srv.gen_comment_text = lambda *a, **k: ""
srv.gen_reply_text = lambda *a, **k: ""
srv.gen_chat_reply = lambda *a, **k: ""
srv.gen_proactive_text = lambda *a, **k: ""
srv.gen_essay = lambda *a, **k: ""
srv.gen_diary = lambda *a, **k: ""
srv.gen_life_event = lambda *a, **k: ""
srv.gen_anniversary = lambda *a, **k: ""
srv.gen_group_line = lambda *a, **k: ""
srv.gen_group_smalltalk = lambda *a, **k: ""
srv.gen_dm_text = lambda *a, **k: ""

# ---------- 内存里的 state ----------
STATE = {"u": None}


def load_state(uid="local"):
    return copy.deepcopy(STATE["u"])


def save_state(st, uid="local"):
    STATE["u"] = copy.deepcopy(st)


srv.load_state = load_state
srv.save_state = save_state
# social_tick 最后走的是 save_merged，也要接到内存里
srv.save_merged = lambda uid, st: save_state(st, uid)


def make_state(global_minutes, friends):
    """friends: [(名字, 单人节奏秒 or None)]"""
    st = srv.default_state()
    s = st["settings"]
    s.update({
        "apiKey": "test-key", "baseUrl": "http://127.0.0.1:9", "model": "mock",
        "momentInterval": global_minutes * 60,
        "quietOn": False, "proactive": False, "essayChance": 0,
        "lifeOn": False, "diaryOn": False, "groupAutoTalk": False,
        "lateOn": False, "groupBursts": 0, "groupRoundMax": 1,
    })
    st["friends"] = []
    for i, (name, own_iv) in enumerate(friends):
        f = {
            "id": "f%d" % i, "name": name, "persona": "测试角色",
            "messages": [], "createdAt": int(CLOCK[0] * 1000),
            "nextMomentAt": 0,
        }
        if own_iv:
            f["settings"] = {"momentInterval": own_iv}
        st["friends"].append(f)
    st["moments"] = []
    st["social"] = {}
    return st


def run_hours(st, hours, start_ts):
    """从 start_ts 起按分钟推进，返回每个人发了多少条、以及各自的时间点。"""
    CLOCK[0] = start_ts
    STATE["u"] = copy.deepcopy(st)
    seen = {}
    for _ in range(int(hours * 60)):
        CLOCK[0] += 60
        srv.social_tick("u")
        for m in STATE["u"].get("moments") or []:
            seen.setdefault(m["id"], m)          # 每条只算一次（moments 里会一直在）
    by_id = {f["id"]: f["name"] for f in st["friends"]}
    counts = {f["name"]: 0 for f in st["friends"]}
    times = {f["name"]: [] for f in st["friends"]}
    for m in seen.values():
        n = by_id.get(m.get("authorId"), m.get("authorId"))
        counts[n] = counts.get(n, 0) + 1
        times.setdefault(n, []).append(m.get("ts"))
    return counts, times


# 起点：某天 12:00
T0 = _dt.datetime(2026, 10, 29, 12, 0, 0).timestamp()

# ---------- 场景 1：只有全局频率，没有单人节奏 ----------
random.seed(11)
st = make_state(120, [("甲", None), ("乙", None), ("丙", None)])   # 每 2 小时一条
counts, times = run_hours(st, 24, T0)
total = sum(counts.values())
# 8:00-23:00 是活动时间（16 小时），2 小时一条 + 0.8~1.5 抖动 → 5~11 条
ok("全局 120 分钟：24 小时内条数是「每 2 小时一条」的量级", 4 <= total <= 12, counts)
ok("全局频率下大家都会被轮到", len([k for k, v in counts.items() if v > 0]) >= 2, counts)

# ---------- 场景 2：一个人单独设了 1 小时，全局 12 小时 ----------
random.seed(12)
st = make_state(720, [("甲", 3600), ("乙", None), ("丙", None)])
counts, times = run_hours(st, 12, T0)
# 1 小时一条 + 0.7~1.5 抖动 → 8~17 条
ok("单人设 1 小时：12 小时里大约每小时一条", 8 <= counts.get("甲", 0) <= 18, counts)
ok("单人节奏只影响他自己（乙丙按全局 12 小时，很少）", counts.get("乙", 0) + counts.get("丙", 0) <= 2, counts)

# ---------- 场景 3：单人设了很长的间隔，全局很短 ----------
# 期望：单独设置优先——全局窗口不该再挑他，否则「单独设置」就是摆设
random.seed(13)
st = make_state(60, [("甲", 72 * 3600), ("乙", None), ("丙", None)])
counts, times = run_hours(st, 6, T0)
ok("单人设 72 小时：6 小时里他不该出现（单独节奏优先）", counts.get("甲", 0) == 0, counts)
ok("全局 60 分钟：6 小时里大约 4~7 条（不是一小时 3 条）", 3 <= sum(counts.values()) <= 8, counts)

# ---------- 场景 4：全员都设了单人节奏 → 全局窗口不该再发 ----------
random.seed(14)
st = make_state(60, [("甲", 6 * 3600), ("乙", 6 * 3600)])
counts, times = run_hours(st, 3, T0)
ok("全员单人节奏：3 小时内一条都不该有全局窗口硬塞", sum(counts.values()) == 0, counts)

# ---------- 场景 5：同一好友的间隔应大致等于设置值 ----------
random.seed(15)
st = make_state(720, [("甲", 2 * 3600)])
counts, times = run_hours(st, 12, T0)
ts = sorted(t for t in times.get("甲", []) if t)
gaps = [(ts[i + 1] - ts[i]) / 60000.0 for i in range(len(ts) - 1)]
avg = sum(gaps) / len(gaps) if gaps else 0
ok("设 2 小时：平均间隔在 1.4~3 小时之间", gaps and 84 <= avg <= 180, {"count": counts.get("甲"), "avg_min": round(avg, 1)})

print()
print("PASSES: %d FAILS: %d" % (len(PASSES), len(FAILS)))
if FAILS:
    print("失败：", FAILS)
    raise SystemExit(1)
