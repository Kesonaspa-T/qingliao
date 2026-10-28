// 新功能端到端：设置/记忆/提醒/撤回/备份 zip/角色卡/归档/日记
// 依赖同 web-e2e.mjs：mock 模型 8797、站点 8798、headless Chrome 9338。
import { readFileSync } from 'node:fs';
const SITE = 'http://127.0.0.1:8798', CDP = 9338;

async function api(path, data, token) {
  const r = await fetch(SITE + path, {
    method: data ? 'POST' : 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: data ? JSON.stringify(data) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const reg = await api('/api/register', { name: '新功能' + Date.now() % 10000, password: '123456' });
const TOKEN = reg.body.token;
if (!TOKEN) { console.error('register failed', reg); process.exit(1); }

const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) { console.error('no page', list.map((x) => x.type)); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const waiters = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
// 每个 CDP 调用最多等 30 秒：卡住的 eval 变成失败，而不是把整个测试挂住
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id;
  const t = setTimeout(() => {
    if (!waiters.has(i)) return;
    waiters.delete(i);
    res({ timeout: true });
  }, 30000);
  waiters.set(i, (m) => { clearTimeout(t); res(m); });
  ws.send(JSON.stringify({ id: i, method, params }));
});
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  // headless 里 confirm/alert 会把渲染线程卡死：一律当「取消」处理
  if (m.method === 'Page.javascriptDialogOpening') {
    send('Page.handleJavaScriptDialog', { accept: false });
  }
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.timeout) throw new Error('CDP eval 超时: ' + String(expression).slice(0, 90));
  if (r.result && r.result.exceptionDetails) {
    throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
}
async function waitFor(expr, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await ev(expr);
    if (v) return v;
    await sleep(300);
  }
  return null;
}
const results = [];
const ok = (name, cond, detail) => {
  const line = (cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' :: ' + String(detail).slice(0, 240));
  results.push(line);
  console.log(line);
};

await send('Network.enable');
await send('Page.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.navigate', { url: SITE + '/' });
await sleep(1500);
await ev(`localStorage.setItem('ql.token', ${JSON.stringify(TOKEN)}); location.reload();`);
await sleep(2800);
// 全测试期间 confirm 一律返回 false（避免原生弹窗卡住 headless）
await ev(`window.__confirms = []; window.confirm = (m) => { window.__confirms.push(String(m)); return false; }; true`);

ok('登录态', (await ev(`!!state && document.getElementById('login').hidden === true`)) === true);

// 建一个朋友
ok('新建朋友', (await ev(`(() => {
  openFriendSheet(null, 'new');
  document.getElementById('fFName').value = '小满';
  document.getElementById('fFPersona').value = '一个普通女生，话不多。';
  document.getElementById('btnFSave').click();
  const f = state.friends[state.friends.length - 1];
  window.__fid = f.id;
  openChat('friend', f.id);
  return state.friends.length === 2;
})()`)) === true);

// 设置里新开关能存
ok('设置新开关保存', (await ev(`(() => {
  openSheet();
  document.getElementById('fBase').value = 'http://127.0.0.1:8797';
  document.getElementById('fKey').value = 'test-key';
  document.getElementById('fModel').value = 'deepseek-flash';
  document.getElementById('fAlive').checked = true;
  document.getElementById('fQuiet').checked = true;
  document.getElementById('fQuietStart').value = '23';
  document.getElementById('fQuietEnd').value = '8';
  document.getElementById('fDiary').checked = true;
  document.getElementById('fLife').checked = true;
  document.getElementById('fArchiveDays').value = '30';
  document.getElementById('btnSheetSave').click();
  const s = state.settings;
  return s.alive === true && s.quietOn === true && s.quietStart === 23 && s.quietEnd === 8
    && s.diaryOn === true && s.lifeOn === true && s.archiveDays === 30;
})()`)) === true);

// 关掉随机延迟，测试快一点
await ev(`state.settings.delayOn = false; state.settings.typingFx = false; persist(); true`);

// 等设置真的落到服务器：不然 /api/chat 读到的还是旧状态（没有 Key → 不回）
let synced = false;
for (let i = 0; i < 15; i += 1) {
  const r = await api('/api/state', null, TOKEN);
  if (r.body && r.body.settings && r.body.settings.apiKey === 'test-key') { synced = true; break; }
  await sleep(1000);
}
ok('设置同步到服务器', synced);

// 她的记忆：加一条，保存
const note = '我不吃香菜-' + Date.now().toString(36);
ok('记忆面板能加条目', (await ev(`(async () => {
  const f = friendById(window.__fid);
  openMemorySheet(f);
  document.getElementById('memNew').value = ${JSON.stringify(note)};
  document.getElementById('btnMemAdd').click();
  document.getElementById('btnMemSave').click();
  return (f.memoryNotes || []).length === 1 && f.memoryNotes[0].text === ${JSON.stringify(note)};
})()`)) === true);

// 等记忆真的写到服务器（也顺便验证「客户端能改她的记忆」）
const fid = await ev('window.__fid');
let memSynced = false;
for (let i = 0; i < 15; i += 1) {
  const r = await api('/api/state', null, TOKEN);
  const rf = ((r.body && r.body.friends) || []).find((x) => x.id === fid);
  if (rf && (rf.memoryNotes || []).some((n) => n.text === note)) { memSynced = true; break; }
  await sleep(1000);
}
ok('记忆同步到服务器', memSynced);
// 注意：用 bytes 偏移去 slice 字符串会错位（中文 UTF-8），直接读全文按唯一标记找
await ev(`(() => { const i = document.getElementById('input'); i.value = '晚上吃什么'; send(); return true; })()`);
const replied = await waitFor(`(state.friends.find(f => f.id === window.__fid).messages || [])
  .some(m => m.role === 'peer' && m.text && m.text.indexOf('收到啦') >= 0)`, 30000);
const logAfter = (() => { try { return readFileSync('/tmp/mockllm.log', 'utf8'); } catch (_) { return ''; } })();
ok('收到回复', !!replied);
ok('手写的记忆进了提示词', logAfter.includes(note), logAfter.slice(-300));

// 提醒：她写的协议要被收进提醒列表、不能漏成正文
ok('提醒协议被解析', (await ev(`(async () => {
  const f = friendById(window.__fid);
  const before = (f.reminders || []).length;
  const d = new Date(Date.now() + 10 * 86400000);
  const when = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' 08:00';
  await deliver('friend', f, '好呀，我记着呢\\n[[提醒:' + when + '|吃药]]', f.id, 2);
  const leak = f.messages.some(m => String(m.text || '').includes('[[提醒'));
  return (f.reminders || []).length === before + 1
    && f.reminders[f.reminders.length - 1].text === '吃药' && !leak;
})()`)) === true);

// 活着三件套：打错字 → 撤回 → 重发
ok('会打错字再撤回', (await ev(`(async () => {
  const f = friendById(window.__fid);
  const orig = Math.random;
  Math.random = () => 0.05;
  try { await deliver('friend', f, '今天有点累了\\n我先去睡了', f.id, 2); }
  finally { Math.random = orig; }
  return f.messages.filter(m => m.recalled).length >= 1;
})()`)) === true);

// 已读：给她设一条未来才到点的迟回，看看渲染有没有「已读」
ok('已读标记能渲染', (await ev(`(() => {
  const f = friendById(window.__fid);
  f.peerReadAt = Date.now();
  f.messages.push({ id: 'u-' + Date.now(), role: 'user', text: '你看到了吗', ts: Date.now() });
  renderChat();
  return !!document.querySelector('.read-tag');
})()`)) === true);

// zip 读写往返（备份/恢复的基础）
ok('zip 读写往返', (await ev(`(() => {
  const items = [{ name: 'a.txt', data: '你好' }, { name: 'blobs/x.bin', data: new Uint8Array([1, 2, 3, 255]) }];
  const z = zipStore(items);
  const buf = z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength);
  const out = unzipStore(buf);
  const txt = new TextDecoder().decode(out['a.txt']);
  const bin = Array.from(out['blobs/x.bin']);
  return txt === '你好' && bin.join(',') === '1,2,3,255';
})()`)) === true);

// 另一台设备同步到「撤回」也要跟着变
ok('另一台设备能看到撤回', (await ev(`(() => {
  const f = friendById(window.__fid);
  const m = { id: 'rc-' + Date.now(), role: 'peer', authorId: f.id, text: '原话', ts: Date.now() };
  f.messages.push(m);
  mergeRemote({ friends: [{ id: f.id, messages: [{ ...m, recalled: true, text: '' }] }] });
  return m.recalled === true && m.text === '';
})()`)) === true);

// 备份包：能解出来、state.json 完整
ok('备份包可解可读', (await ev(`(async () => {
  const { zip, count } = await buildBackupZip();
  const out = unzipStore(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength));
  const s = JSON.parse(new TextDecoder().decode(out['state.json']));
  return s.friends.length === state.friends.length && !!out['说明.txt'] && count >= 2;
})()`)) === true);

// 从备份恢复：覆盖掉改坏的名字
ok('从备份恢复', (await ev(`(async () => {
  const { zip } = await buildBackupZip();
  const f = friendById(window.__fid);
  const good = f.name;
  f.name = '被改坏了';
  rememberFriendEdit(f, { name: '被改坏了' });
  persist();
  const file = new File([zip], 'backup.zip', { type: 'application/zip' });
  const oc = window.confirm;
  window.confirm = () => true;
  try { await restoreFromZip(file); } finally { window.confirm = oc; }
  const f2 = friendById(window.__fid);
  return !!f2 && f2.name === good;
})()`)) === true);

// 角色卡导入
ok('角色卡导入', (await ev(`(async () => {
  const card = { format: 'qingliao-card', name: '卡片人', persona: '一个测试角色', settings: { bursts: 2 } };
  const file = new File([JSON.stringify(card)], 'card.json', { type: 'application/json' });
  const n0 = state.friends.length;
  await importRoleCard(file);
  const f = state.friends[state.friends.length - 1];
  return state.friends.length === n0 + 1 && f.name === '卡片人' && f.persona === '一个测试角色';
})()`)) === true);

// 日记 / 提醒面板能渲染
ok('日记面板', (await ev(`(() => {
  const f = friendById(window.__fid);
  f.diary = [{ id: 'd1', date: '2026-10-01', ts: Date.now(), text: '今天下了雨' }];
  openDiarySheet(f);
  return document.querySelector('#diarySheet .diary-text').textContent === '今天下了雨';
})()`)) === true);
ok('提醒面板', (await ev(`(() => {
  openReminderSheet();
  return document.querySelectorAll('#reminderSheet .reminder-row').length >= 1;
})()`)) === true);

// 聊天书：docx 头是 PK，生成不抛异常
ok('聊天书能生成', (await ev(`(async () => {
  openChatBookSheet();
  const sel = document.getElementById('bookConv');
  sel.value = 'friend:' + window.__fid;
  document.getElementById('bookRange').value = '0';
  await makeChatBook();
  const z = makeDocx('# 标题\\n正文一行');
  return z[0] === 80 && z[1] === 75;
})()`)) === true);

// 归档：插一条 40 天前的消息，归档 30 天，能从归档接口读回来
const arch = await ev(`(async () => {
  const f = friendById(window.__fid);
  const oldId = 'old-' + Date.now();
  f.messages.push({ id: oldId, role: 'peer', authorId: f.id, text: '很久以前的消息', ts: Date.now() - 40 * 86400000 });
  await apiFetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...state, _edits: { friends: {}, settings: {} } }) });
  const r = await apiFetch('/api/archive', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days: 30 }) });
  const j = await r.json();
  const g = await (await apiFetch('/api/archive?fid=' + encodeURIComponent(f.id) + '&limit=50')).json();
  return JSON.stringify({ status: r.status, archived: j.archived,
    got: (g.messages || []).length, has: (g.messages || []).some(m => m.text === '很久以前的消息') });
})()`);
let archObj = {};
try { archObj = JSON.parse(arch); } catch (_) {}
ok('归档接口可用', archObj.status === 200 && archObj.has === true, arch);

// 归档后客户端渲染「加载更早」入口
ok('归档后出现「加载更早」', (await ev(`(async () => {
  const f = friendById(window.__fid);
  const s = await (await apiFetch('/api/state')).json();
  const rf = s.friends.find(x => x.id === window.__fid);
  f.archivedBefore = rf.archivedBefore;
  openChat('friend', f.id);
  renderChat();
  return !!document.querySelector('.load-earlier');
})()`)) === true);

// 归档按钮（confirm 会被 headless 卡住，这里把确认改成「取消」）
ok('归档按钮不报错', (await ev(`(async () => {
  const o = window.confirm;
  window.confirm = () => false;
  try { await archiveNow(); } finally { window.confirm = o; }
  return true;
})()`)) === true);

const fails = results.filter((x) => x.startsWith('FAIL')).length;
console.log('FAILS:', fails);
process.exit(fails ? 1 : 0);
