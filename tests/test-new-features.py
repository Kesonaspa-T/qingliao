#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""新功能的服务端单测：免打扰/作息、记忆、纪念日、生活事件、提醒、归档、恢复合并。

跑法：
    python3 tests/test-new-features.py

不联网：所有生成函数都 monkeypatch 成固定文本。
"""
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import time
import datetime
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix="ql-test-")
os.environ["QINGLIAO_DATA"] = TMP

spec = importlib.util.spec_from_file_location("qlserver", os.path.join(ROOT, "server.py"))
srv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(srv)

FAILS = []
PASSES = []


def ok(name, cond, detail=""):
    (PASSES if cond else FAILS).append(name)
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else " :: " + str(detail)[:200]))


# ---------- 纯函数 ----------

ok("跨零点时段 23→8", srv._hour_in(23, 23, 8) and srv._hour_in(0, 23, 8)
   and srv._hour_in(7, 23, 8) and not srv._hour_in(8, 23, 8)
   and not srv._hour_in(12, 23, 8))
ok("普通时段 1→6", srv._hour_in(1, 1, 6) and srv._hour_in(5, 1, 6) and not srv._hour_in(6, 1, 6))
ok("起止相同=不静音", not srv._hour_in(3, 5, 5))

hour = datetime.datetime.now().hour
ok("免打扰开关能关", srv.quiet_now({"quietOn": False, "quietStart": 0, "quietEnd": 23}) is False)
ok("免打扰窗口覆盖现在",
   srv.quiet_now({"quietOn": True, "quietStart": hour, "quietEnd": (hour + 1) % 24}) is True,
   hour)

f_asleep = {"settings": {"wake": (hour + 2) % 24, "sleep": (hour + 3) % 24}}
ok("作息：不在醒着区间就算睡", srv.friend_asleep(f_asleep) is True)
ok("作息：没填就不睡", srv.friend_asleep({}) is False)

f_mem = {"memory": "他讨厌香菜", "memoryNotes": [{"text": "我生日是 3 月 8 号"}],
         "events": [{"text": "书店来了只三花猫"}]}
mb = srv.memory_block(f_mem)
ok("记忆块含手写和自动", "我生日是 3 月 8 号" in mb and "他讨厌香菜" in mb, mb)
ok("关掉自动记忆只剩手写",
   "他讨厌香菜" not in srv.memory_block(dict(f_mem, memoryOff=True)))
# 记忆必须是旁观视角：她自己的提示词里，「我」不能指她自己
ok("记忆块标注了旁观视角", "旁观记录" in mb and "不是你" in mb, mb)
ok("手写笔记也说明了「我」指他", "里面的「我」指的都是他" in mb, mb)
# 自动记忆写歪了，客户端可以改（_edits.friends 里点名 memory）
_mf = srv.merge_friend({"id": "f1", "memory": "旧的：我老婆"}, {"id": "f1"}, {"memory": "新的：小柔是他的妻子"})
ok("客户端能改自动记忆", _mf.get("memory") == "新的：小柔是他的妻子", _mf.get("memory"))
# 总结提示词本身必须是旁观视角（防止以后又被改回「第一人称」）
_cap = {}
_orig_call = srv.call_llm
def _fake_call(base, key, model, messages, **kw):
    _cap["sys"] = messages[0]["content"]
    return "他喜欢 Z7II"
srv.call_llm = _fake_call
srv.gen_memory({"name": "R6II"}, ["浩辰：想买 Z7II"], {}, "k", "浩辰")
_gsys = _cap.get("sys", "")
ok("记忆提示词要求旁观视角", "旁观者" in _gsys and "绝对不要用「我」" in _gsys, _gsys[:80])
ok("记忆提示词用真名而不是「我」", "浩辰" in _gsys and "R6II" in _gsys, _gsys[:80])
# 账号默认名字就是「我」：不能把代词当称呼，否则等于没修
ok("代词名字会被换成「他」", srv._safe_me_name("我") == "他" and srv._safe_me_name("") == "他"
   and srv._safe_me_name("你") == "他" and srv._safe_me_name("小满") == "小满")
_cap.clear()
srv.gen_memory({"name": "R6II"}, ["我：想买 Z7II"], {}, "k", "我")
_gsys2 = _cap.get("sys", "")
ok("名字是「我」时提示词也不写「我」", "统一写「我」" not in _gsys2 and "统一写「他」" in _gsys2, _gsys2[:80])
# 每次更新只喂最近 40 条、又覆盖旧记忆 → 30 条以前的事就没了。
# 现在要：旧记忆一起带上、窗口放到 80 条、合并而不是覆盖。
_cap.clear()
srv.call_llm = _fake_call
_lines = ["第%d条" % i for i in range(100)]
srv.gen_memory({"name": "R6II", "memory": "他喜欢 Z7II；小柔是他妻子"},
               _lines, {}, "k", "浩辰")
_gsys3 = _cap.get("sys", "")
ok("记忆更新会带上旧记忆", "小柔是他妻子" in _gsys3, _gsys3[:80])
ok("记忆更新要求保留旧的、合并新的",
   "不要丢" in _gsys3 and "合并" in _gsys3, _gsys3[-160:])
ok("记忆窗口放到 80 条（第 30 条还在）",
   "第30条" in _gsys3 and "第19条" not in _gsys3, _gsys3[-80:])
srv.call_llm = _orig_call
ok("生活事件进背景块", "三花猫" in srv.life_block(f_mem))

f_ann = {"createdAt": int((time.time() - 99 * 86400) * 1000)}
ok("认识第 100 天", srv.anniversary_today(f_ann) == "认识第 100 天", srv.anniversary_today(f_ann))
md = datetime.date.today().strftime("%m-%d")
ok("自定义纪念日按月日匹配",
   srv.anniversary_today({"anniversaries": [{"name": "第一次聊天", "date": "2024-" + md}]})
   == "第一次聊天")
ok("不匹配就返回空", srv.anniversary_today({"anniversaries": [{"name": "x", "date": "2001-02-02"}]}) == "")

# ---------- 归档 ----------

uid = "u_test"
state = srv.default_state()
state["friends"] = [{
    "id": "f1", "name": "小满", "persona": "p", "createdAt": int(time.time() * 1000),
    "messages": [
        {"id": "old1", "role": "peer", "text": "很久以前", "ts": int((time.time() - 40 * 86400) * 1000)},
        {"id": "new1", "role": "user", "text": "今天", "ts": int(time.time() * 1000)},
    ],
}]
srv.save_state(state, uid)

cutoff = int((time.time() - 30 * 86400) * 1000)
old = [m for m in state["friends"][0]["messages"] if m["ts"] < cutoff]
n = srv.append_archive(uid, "f1", old)
back = srv.read_archive(uid, "f1")
ok("归档写入/读回", n == 1 and len(back) == 1 and back[0]["id"] == "old1", (n, back))
n2 = srv.append_archive(uid, "f1", old)
ok("重复归档按 id 去重", n2 == 0 and len(srv.read_archive(uid, "f1")) == 1, n2)

# 归档水位线之后，旧消息不该被客户端快照重新塞回来
# （真实流程里是 /api/archive 把 archivedBefore 写到磁盘上，这里模拟那一步）
disk = srv.load_state(uid)
disk["friends"][0]["archivedBefore"] = cutoff
srv.save_state(disk, uid)
state2 = srv.load_state(uid)
state2["friends"][0]["messages"] = [
    {"id": "old1", "role": "peer", "text": "很久以前", "ts": int((time.time() - 40 * 86400) * 1000)},
    {"id": "new1", "role": "user", "text": "今天", "ts": int(time.time() * 1000)},
]
merged = srv.merge_state(srv.load_state(uid), state2)
ids = [m["id"] for m in merged["friends"][0]["messages"]]
ok("归档后旧消息不会被旧快照复活", "old1" not in ids and "new1" in ids, ids)

# ---------- 合并字段归属 ----------

u2 = "u_fields"
st = srv.default_state()
st["friends"] = [{"id": "fa", "name": "A", "persona": "p", "createdAt": int(time.time() * 1000),
                  "messages": [], "memoryNotes": [], "reminders": []}]
srv.save_state(st, u2)
inc = {"id": "fa", "name": "A",
       "memoryNotes": [{"id": "n1", "text": "不吃香菜"}],
       "memoryOff": True,
       "anniversaries": [{"id": "a1", "name": "第一次聊天", "date": "2024-01-01"}],
       "reminders": [{"id": "r1", "text": "吃药", "dueAt": int(time.time() * 1000) + 3600000}]}
m = srv.merge_state(srv.load_state(u2),
                    {"friends": [inc], "_edits": {"friends": {"fa": inc}, "settings": {}}})
mf = m["friends"][0]
ok("客户端能写记忆/纪念日/提醒",
   mf.get("memoryOff") is True and mf.get("memoryNotes")[0]["text"] == "不吃香菜"
   and mf.get("anniversaries")[0]["name"] == "第一次聊天" and mf.get("reminders")[0]["text"] == "吃药",
   mf)

# ---------- social_tick：提醒 / 纪念日 / 生活 / 免打扰 ----------

def make_state(uid, **kw):
    st = srv.default_state()
    st["settings"].update({"apiKey": "test-key", "baseUrl": "http://127.0.0.1:9",
                           "proactive": False, "momentInterval": 10 ** 9,
                           "quietOn": False, "diaryOn": False, "lifeOn": False})
    st["settings"].update(kw)
    now_ms = int(time.time() * 1000)
    st["friends"] = [{
        "id": "f1", "name": "小满", "persona": "p", "createdAt": now_ms,
        "messages": [{"id": "m0", "role": "user", "text": "在吗", "ts": now_ms}],
        "memoryNotes": [], "anniversaries": [], "reminders": [],
    }]
    srv.save_state(st, uid)
    return st


# 提醒：到点删掉并补一条消息（生成失败也要有兜底文案）
make_state("u_rem", quietOn=True, quietStart=0, quietEnd=23)

st = srv.load_state("u_rem")
st["friends"][0]["reminders"] = [{"id": "r1", "text": "吃药", "dueAt": int(time.time() * 1000) - 5000}]
srv.save_state(st, "u_rem")
srv.social_tick("u_rem")
st = srv.load_state("u_rem")
msgs = st["friends"][0]["messages"]
ok("提醒到点会响（免打扰也响）",
   any(m.get("reminder") for m in msgs) and not st["friends"][0].get("reminders"), msgs[-2:])

# 纪念日：只响一次
make_state("u_ann")
st = srv.load_state("u_ann")
st["friends"][0]["createdAt"] = int((time.time() - 99 * 86400) * 1000)
srv.save_state(st, "u_ann")
orig_ann = srv.gen_anniversary
srv.gen_anniversary = lambda *a, **k: "今天是我们认识第 100 天，你记得吗"
srv.social_tick("u_ann")
srv.social_tick("u_ann")
st = srv.load_state("u_ann")
ann_msgs = [m for m in st["friends"][0]["messages"] if m.get("anniversary")]
ok("纪念日一天只响一次", len(ann_msgs) == 1 and st["friends"][0].get("lastAnnivKey"), len(ann_msgs))
srv.gen_anniversary = orig_ann

# 生活事件
make_state("u_life", lifeOn=True)
st = srv.load_state("u_life")
st["friends"][0]["nextLifeAt"] = time.time() - 10
srv.save_state(st, "u_life")
orig_life = srv.gen_life_event
srv.gen_life_event = lambda *a, **k: "楼下桂花开了，香得有点过分"
srv.social_tick("u_life")
st = srv.load_state("u_life")
ok("生活事件写进 events", bool(st["friends"][0].get("events")), st["friends"][0].get("events"))
ok("生活事件不会当成消息发给用户", not any("桂花" in (m.get("text") or "")
   for m in st["friends"][0]["messages"]))
srv.gen_life_event = orig_life

# 免打扰：主动消息不该冒出来
make_state("u_quiet", proactive=True, quietOn=True, quietStart=0, quietEnd=23)
st = srv.load_state("u_quiet")
st["friends"][0]["messages"][0]["ts"] = int((time.time() - 7200) * 1000)
srv.save_state(st, "u_quiet")
orig_pro = srv.gen_proactive
srv.gen_proactive = lambda *a, **k: "在干嘛呀"
srv.social_tick("u_quiet")
st = srv.load_state("u_quiet")
ok("免打扰时她不主动冒泡",
   not any("在干嘛呀" in (m.get("text") or "") for m in st["friends"][0]["messages"]),
   st["friends"][0]["messages"][-3:])

# 关掉免打扰 → 主动消息正常
# 注意：这条用例以前是「看几点跑」的——深夜跑会走「晚安」那条固定问候，跟主动无关。
# 这里把「她已经睡了」按住，只测免打扰开关。
make_state("u_quiet2", proactive=True, quietOn=False)
st = srv.load_state("u_quiet2")
st["friends"][0]["messages"][0]["ts"] = int((time.time() - 7200) * 1000)
srv.save_state(st, "u_quiet2")
srv.gen_proactive = lambda *a, **k: "在干嘛呀"
_orig_asleep = srv.friend_asleep
srv.friend_asleep = lambda *a, **k: False
# 22~23 点会先发「晚安」把主动挤掉（`last_ts` 变现在）：把早晚安标记成今天已发，
# 这条用例就只测「关了免打扰会不会主动」，不再看几点跑。
_hour = datetime.datetime.now().hour
_slot = "morning" if 7 <= _hour <= 10 else ("night" if 22 <= _hour <= 23 else "none")
st.setdefault("social", {})["lastGreet"] = datetime.date.today().isoformat() + ":" + _slot
srv.save_state(st, "u_quiet2")
srv.social_tick("u_quiet2")
srv.friend_asleep = _orig_asleep
st = srv.load_state("u_quiet2")
ok("关了免打扰她会主动",
   any("在干嘛呀" in (m.get("text") or "") for m in st["friends"][0]["messages"]),
   st["friends"][0]["messages"][-3:])
srv.gen_proactive = orig_pro

# 作息：她睡着时不主动
make_state("u_sleep", proactive=True, quietOn=False)
hour_now = datetime.datetime.now().hour
st = srv.load_state("u_sleep")
st["friends"][0]["settings"] = {"wake": (hour_now + 3) % 24, "sleep": (hour_now + 4) % 24}
st["friends"][0]["messages"][0]["ts"] = int((time.time() - 7200) * 1000)
srv.save_state(st, "u_sleep")
srv.gen_proactive = lambda *a, **k: "睡了吗"
srv.social_tick("u_sleep")
st = srv.load_state("u_sleep")
ok("她按作息睡了就不发",
   not any("睡了吗" in (m.get("text") or "") for m in st["friends"][0]["messages"]),
   st["friends"][0]["messages"][-2:])
srv.gen_proactive = orig_pro

# ---------- 恢复（import）能带回服务端字段 ----------

u3 = "u_import"
st = srv.default_state()
st["friends"] = [{"id": "fi", "name": "旧", "persona": "p", "createdAt": 1,
                  "messages": [{"id": "x", "role": "peer", "text": "旧消息", "ts": 1}]}]
srv.save_state(st, u3)
backup_friend = {"id": "fi", "name": "新名字", "persona": "p2", "createdAt": 2,
                 "messages": [{"id": "y", "role": "peer", "text": "备份消息", "ts": 2}],
                 "memory": "备份里的记忆", "diary": [{"text": "备份里的日记"}],
                 "archivedBefore": 0}
srv.merge_state(srv.load_state(u3), {"friends": [backup_friend],
                                     "_edits": {"friends": {"fi": backup_friend},
                                                "importHistory": "x"}})
merged = srv.merge_state(srv.load_state(u3), {"friends": [backup_friend],
                                              "_edits": {"friends": {"fi": backup_friend},
                                                         "importHistory": "x"}})
mf = merged["friends"][0]
ids = [m["id"] for m in mf["messages"]]
ok("恢复会整份替换消息", ids == ["y"], ids)
ok("恢复带回记忆和日记", mf.get("memory") == "备份里的记忆" and mf.get("diary"), mf.get("memory"))

# ---------- 已读：客户端能把 unread 清零 / readAt 推上去 ----------

u4 = "u_read"
st = srv.default_state()
st["friends"] = [{"id": "fr", "name": "A", "persona": "p", "createdAt": 1,
                  "messages": [{"id": "m1", "role": "user", "text": "hi", "ts": 5}],
                  "unread": 7, "readAt": 0}]
srv.save_state(st, u4)
inc = {"id": "fr", "unread": 0, "readAt": 1700000000000}
merged = srv.merge_state(srv.load_state(u4), {"friends": [inc],
                                              "_edits": {"friends": {"fr": inc}}})
mf = merged["friends"][0]
ok("客户端能清零 unread / 写 readAt", mf.get("unread") == 0 and mf.get("readAt") == 1700000000000,
   (mf.get("unread"), mf.get("readAt")))

# 旧的 essay=false 不再把概率压成 0（老版本新建朋友默认写 false）
ok("旧 essay=false 不再压住概率",
   srv.essay_chance({"settings": {"essay": False}}, {"essayChance": 15}) == 15)

# ---------- 小作文：每天按概率掷一次 ----------

make_state("u_essay", essayChance=100)
st = srv.load_state("u_essay")
st["friends"][0]["settings"] = {"essayChance": 100}
st["friends"][0]["lastEssayAt"] = 0
st["friends"][0]["essayRollDay"] = ""
srv.save_state(st, "u_essay")

real_dt = srv.datetime
class _FD(real_dt.datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 10, 28, 12, 0, 0)
class _FDate(real_dt.date):
    @classmethod
    def today(cls):
        return cls(2026, 10, 28)
srv.datetime = types.SimpleNamespace(datetime=_FD, date=_FDate,
                                     time=real_dt.time, timedelta=real_dt.timedelta)
orig_essay = srv.gen_essay
srv.gen_essay = lambda *a, **k: "这是一篇测试小作文。" * 20
try:
    srv.social_tick("u_essay")
    st = srv.load_state("u_essay")
    n1 = len([m for m in st["friends"][0]["messages"] if m.get("essay")])
    srv.social_tick("u_essay")
    st = srv.load_state("u_essay")
    n2 = len([m for m in st["friends"][0]["messages"] if m.get("essay")])
    ok("小作文概率 100% 当天写一篇且只写一篇", n1 == 1 and n2 == 1, (n1, n2))
finally:
    srv.gen_essay = orig_essay

make_state("u_essay0", essayChance=0)
st = srv.load_state("u_essay0")
st["friends"][0]["settings"] = {"essayChance": 0}
st["friends"][0]["lastEssayAt"] = 0
srv.save_state(st, "u_essay0")
srv.gen_essay = lambda *a, **k: "不该出现的小作文"
try:
    srv.social_tick("u_essay0")
    st = srv.load_state("u_essay0")
    ok("小作文概率 0 不写", not any(m.get("essay") for m in st["friends"][0]["messages"]))
finally:
    srv.gen_essay = orig_essay
    srv.datetime = real_dt

shutil.rmtree(TMP, ignore_errors=True)
print()
print("PASSES:", len(PASSES), "FAILS:", len(FAILS))
sys.exit(1 if FAILS else 0)
