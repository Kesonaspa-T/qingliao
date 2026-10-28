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
make_state("u_quiet2", proactive=True, quietOn=False)
st = srv.load_state("u_quiet2")
st["friends"][0]["messages"][0]["ts"] = int((time.time() - 7200) * 1000)
srv.save_state(st, "u_quiet2")
srv.gen_proactive = lambda *a, **k: "在干嘛呀"
srv.social_tick("u_quiet2")
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

shutil.rmtree(TMP, ignore_errors=True)
print()
print("PASSES:", len(PASSES), "FAILS:", len(FAILS))
sys.exit(1 if FAILS else 0)
