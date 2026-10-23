/* 轻聊 · 多会话 + 朋友圈 + 群聊 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const phone = $('#phone');
const chatEl = $('#chat');
const inputEl = $('#input');
const sendBtn = $('#btnSend');
const statusEl = $('#peerStatus');
const emojiPanel = $('#emojiPanel');
const sheet = $('#sheet');
const friendSheet = $('#friendSheet');
const groupSheet = $('#groupSheet');
const groupInfoSheet = $('#groupInfoSheet');
const momentSheet = $('#momentSheet');
const msgMenu = $('#msgMenu');
const toastEl = $('#toast');
const fab = $('#scrollFab');
const fabBadge = $('#fabBadge');
const convList = $('#convList');
const contactList = $('#contactList');
const momentList = $('#momentList');
const pageChat = $('#pageChat');
const tabbar = $('#tabbar');

const NATIVE = !!(window.AndroidChat && window.AndroidChat.start);
const isDesk = () => window.matchMedia('(min-width: 900px)').matches;
const isAndroidWebView = /Android/i.test(navigator.userAgent) && !/Chrome\/\d+\.\d+ (?!.*Mobile)/.test('');
if (/Android/i.test(navigator.userAgent)) document.documentElement.classList.add('native');
const APP_BUILD = 'v' + (new URLSearchParams((document.currentScript?.getAttribute('src') || '').split('?')[1] || '').get('v') || 'dev');

const TOKEN_KEY = 'ql.token';
const SERVER_KEY = 'ql.server';
let TOKEN = localStorage.getItem(TOKEN_KEY) || '';
let SERVER = (localStorage.getItem(SERVER_KEY) || '').replace(/\/+$/, '');
let lastRev = -1;

function isCloud() { return NATIVE ? !!SERVER : true; }

function apiFetch(path, opts) {
  const o = opts || {};
  const headers = Object.assign({}, o.headers || {});
  headers['X-Qingliao-Build'] = APP_BUILD;
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  return fetch(SERVER + path, Object.assign({}, o, { headers }));
}

const EMOJIS = ['😊','😂','🥺','😳','😴','😭','😅','🤔','😌','🥰','😘','💕','🌙','☁️','🍚','🍜','🐱','🐰','✨','🎧','📚','🫧','😤','🙃','😉','💤','🍰','🧋','🌧️','🌻','🫶','😶','🥲','🫠','💭','🍂','🧸','🎐','🌊','🍊'];

const COARSE = window.matchMedia('(pointer: coarse)').matches;

const DEFAULT_PERSONA = `你叫林小满，22 岁，在城南一家旧书店上班，租的房子离店两站路。
你正在和对方网恋：还没见过面，但每天都聊，关系已经有点黏。

说话方式：
- 口语、短句，一般 1～3 句，别写成一大段
- 常用语气词：呀、啦、欸、嗯、哦、嘛；偶尔用颜文字或 emoji，但不要每句都加
- 会关心对方吃饭、睡觉、天气、上班累不累
- 会撒娇，但不过分；对方冷淡时你会有点小情绪，但不会闹

禁止：
- 不要说自己是 AI、模型、程序
- 不要列清单、不要用书面语、不要总结
- 不要提“网恋”“人设”“设定”这些词`;

const PRESETS = {
  warm: { name: '林小满', persona: DEFAULT_PERSONA },
  cool: { name: '沈迟', persona: `你叫沈迟，26 岁，在做设计。
你话不多，有点冷，但不是讨厌对方，只是懒得说废话。

说话方式：
- 短，经常一句话就完了
- 很少用语气词和 emoji
- 偶尔冷不丁关心一句，说完又装作没事

禁止：
- 不要说自己是 AI
- 不要热情、不要撒娇` },
  sunny: { name: '周樂', persona: `你叫周樂，20 岁，大二，学动画。
你话多、情绪起伏大，开心和难过都写在脸上。

说话方式：
- 一句话拆成两三条发
- 爱用感叹号和 emoji
- 情绪来得快去得也快

禁止：
- 不要说自己是 AI
- 不要冷静分析` },
  bookish: { name: '陈屿', persona: `你叫陈屿，24 岁，在图书馆做编目。
你安静，喜欢具体的东西：雨、旧纸的味道、某一段旋律。

说话方式：
- 句子短但有画面感
- 不太直接表达情绪，会用比喻
- 会记得对方提过的小细节

禁止：
- 不要说自己是 AI
- 不要用网络流行语` },
};

const DEFAULT_SETTINGS = {
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-flash',
  thinking: 'off',
  temperature: 0.9,
  contextLimit: 200,
  vision: true,
  webSearch: true,
  delayOn: true,
  delayMin: 5,
  delayMax: 30,
  typingFx: true,
  bursts: 5,
  groupBursts: 3,
  groupRoundMax: 10,
  groupAutoTalk: true,
  theme: 'auto',
  proactive: false,
  idleMin: 20,
  momentInterval: 43200,
  groupReplyMax: 2,
};

const uid = (p) => (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pad = (n) => String(n).padStart(2, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function defaultState() {
  return {
    version: 5,
    me: { name: '我', avatar: '' },
    settings: { ...DEFAULT_SETTINGS },
    friends: [],
    groups: [],
    moments: [],
    pending: [],
    deleted: [],
    social: {},
    conv: null,
    drafts: {},
  };
}

function makeFriend(o = {}) {
  return {
    id: o.id || uid('f'),
    name: o.name || '新朋友',
    avatar: o.avatar || '',
    persona: o.persona || DEFAULT_PERSONA,
    messages: Array.isArray(o.messages) ? o.messages : [],
    relations: Array.isArray(o.relations) ? o.relations : [],
    dmMoment: o.dmMoment !== false,
    unread: 0,
    createdAt: o.createdAt || Date.now(),
  };
}

function makeGroup(o = {}) {
  return {
    id: o.id || uid('g'),
    name: o.name || '群聊',
    avatar: o.avatar || '',
    prompt: o.prompt || '',
    members: Array.isArray(o.members) ? o.members : [],
    messages: Array.isArray(o.messages) ? o.messages : [],
    unread: 0,
    createdAt: o.createdAt || Date.now(),
  };
}

let state = defaultState();
let pendingEdits = { settings: {}, groups: {} };
const GROUP_FIELDS = ['name', 'avatar', 'members', 'prompt'];

function changedFields(before, after, fields) {
  const patch = {};
  for (const key of fields) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) patch[key] = after[key];
  }
  return patch;
}

function importEdits(s) {
  return { settings: { ...s.settings }, importHistory: uid('import'),
    groups: Object.fromEntries(s.groups.map(g => [g.id, Object.fromEntries(GROUP_FIELDS.map(k => [k, g[k]]))])) };
}
const rt = new Map();

let lastTs = 0;
let lastActivity = Date.now();
let menuTargetId = null;
let quoteFor = null;
let longPressTimer = null;
let friendEditMode = 'edit';
let editingFriendId = null;
/* ---------------- 小工具 ---------------- */

function timeOf(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function agoOf(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function dividerOf(ts) {
  const d = new Date(ts);
  const now = new Date();
  const hm = timeOf(ts);
  if (d.toDateString() === now.toDateString()) return hm;
  const y = new Date(now.getTime() - 86400000);
  if (d.toDateString() === y.toDateString()) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

function listTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return timeOf(ts);
  const y = new Date(now.getTime() - 86400000);
  if (d.toDateString() === y.toDateString()) return '昨天';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function weekday(d) {
  return '周' + '日一二三四五六'[d.getDay()];
}

function initialOf(name) {
  return ((name || '?').trim()[0] || '?').toUpperCase();
}

function nearBottom() {
  return chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 120;
}

function scrollBottom(force) {
  if (!force && !nearBottom()) return;
  try { chatEl.scrollTo({ top: chatEl.scrollHeight, behavior: 'instant' }); }
  catch (_) { chatEl.scrollTop = chatEl.scrollHeight; }
}

function setStatus(t) { statusEl.textContent = t; }

let toastTimer = null;
function toast(text, ms = 2000) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}

function friendById(id) { return state.friends.find((f) => f.id === id) || null; }
function groupById(id) { return state.groups.find((g) => g.id === id) || null; }
function convById(kind, id) { return kind === 'group' ? groupById(id) : friendById(id); }
function currentConv() {
  if (!state.conv) return null;
  return convById(state.conv.kind, state.conv.id);
}
function convKey(kind, id) { return kind + ':' + id; }
function lastMessage(c) { return c.messages[c.messages.length - 1] || null; }

function speakerOf(msg, conv) {
  if (msg.role === 'user') return state.me;
  if (msg.authorId) return friendById(msg.authorId) || conv;
  return conv;
}

function nameOf(id) {
  if (id === 'me') return state.me.name || '我';
  const f = friendById(id);
  return f ? f.name : '某人';
}

/* ---------------- 存储 ---------------- */

const Store = {
  async load() {
    if (!isCloud()) {
      try {
        const raw = localStorage.getItem('qingliao.state');
        if (raw) return JSON.parse(raw);
      } catch (_) {}
      return null;
    }
    const res = await apiFetch('/api/state');
    if (res.status === 401) return { __needLogin: true };
    if (!res.ok) throw new Error('无法读取服务器状态，请稍后重试');
    return await res.json();
  },
  async save(s) {
    if (!isCloud()) {
      try { localStorage.setItem('qingliao.state', JSON.stringify(s)); }
      catch (e) { toast('存储空间满了，清理一下'); }
      return;
    }
    if (Store.saving) { Store.again = true; return; }
    Store.saving = true;
    const edits = JSON.parse(JSON.stringify(pendingEdits));
    let failed = false;
    try {
      const res = await apiFetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...s, _edits: edits }),
      });
      // 保存回执不代表已经读到合并后的状态；lastRev 只能由成功拉取更新。
      if (!res.ok) throw new Error('save failed');
      const clear = (pending, sent) => {
        for (const key of Object.keys(sent)) {
          if (JSON.stringify(pending[key]) === JSON.stringify(sent[key])) delete pending[key];
        }
      };
      clear(pendingEdits.settings, edits.settings);
      for (const [id, patch] of Object.entries(edits.groups)) {
        if (pendingEdits.groups[id]) clear(pendingEdits.groups[id], patch);
      }
      if (edits.importHistory && pendingEdits.importHistory === edits.importHistory) delete pendingEdits.importHistory;
    } catch (_) {
      failed = true;
      toast('保存失败，正在重试');
    } finally {
      Store.saving = false;
      if (failed || Store.again) {
        Store.again = false;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { saveTimer = null; return Store.save(state); }, failed ? 4000 : 0);
      }
    }
  },
};

let saveTimer = null;
let localRevision = 0;
function rememberDeleted(ids) {
  // 离线设备可能很久以后才提交旧状态，不能按数量丢弃删除标记。
  state.deleted = [...new Set([...(state.deleted || []), ...ids])];
}

function pruneDeleted(s) {
  const dead = new Set(s.deleted || []);
  if (!dead.size) return false;
  let changed = false;
  const filter = (items, keep) => {
    const list = items || [];
    const kept = list.filter(keep);
    if (kept.length !== list.length) changed = true;
    return kept;
  };
  s.friends = filter(s.friends, (f) => !dead.has(f.id));
  s.groups = filter(s.groups, (g) => !dead.has(g.id));
  for (const c of [...s.friends, ...s.groups]) {
    c.messages = filter(c.messages, (m) => !dead.has(m.id));
  }
  for (const f of s.friends) f.relations = filter(f.relations, (id) => !dead.has(id));
  for (const g of s.groups) g.members = filter(g.members, (id) => !dead.has(id));
  s.moments = filter(s.moments, (m) => !dead.has(m.id));
  s.pending = filter(s.pending, (p) =>
    ![p.id, p.momentId, p.by, p.targetId].some((id) => dead.has(id)));
  return changed;
}

function persist() {
  localRevision += 1;
  pruneDeleted(state);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; return Store.save(state); }, 250);
}

/* ---------------- 主题 / 头像 ---------------- */

const darkMedia = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const t = state.settings.theme || 'auto';
  const dark = t === 'dark' || (t === 'auto' && darkMedia.matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#17181b' : '#f7f8fa');
  if (NATIVE && window.AndroidChat.setBars) {
    try { window.AndroidChat.setBars(dark); } catch (_) {}
  }
}

darkMedia.addEventListener('change', () => {
  if ((state.settings.theme || 'auto') === 'auto') applyTheme();
});

function avatarEl(who, cls) {
  const el = document.createElement('div');
  el.className = 'avatar' + (cls ? ' ' + cls : '');
  const url = who && who.avatar;
  if (url) {
    const img = document.createElement('img');
    img.src = url; img.alt = '';
    el.append(img);
  } else {
    el.textContent = initialOf(who && who.name);
  }
  return el;
}

function paintAvatar(el, url, name) {
  el.textContent = '';
  if (url) {
    const img = document.createElement('img');
    img.src = url; img.alt = '';
    el.append(img);
  } else {
    const s = document.createElement('span');
    s.textContent = initialOf(name);
    el.append(s);
  }
}

function fileToDataUrl(file, max, quality) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        try { resolve(canvas.toDataURL('image/jpeg', quality)); }
        catch (_) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = reader.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function imageToDataUrl(file, max, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round((img.width || 1) * scale));
      c.height = Math.max(1, Math.round((img.height || 1) * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读不出来')); };
    img.src = url;
  });
}

function pickImage({ max = 1024, quality = 0.8 } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return resolve(null);
      resolve(await fileToDataUrl(file, max, quality));
    };
    input.click();
  });
}

/* ---------------- 列表 ---------------- */

function sortedConvs() {
  const items = [];
  for (const f of state.friends) {
    if (f.messages.length) items.push({ kind: 'friend', data: f, ts: lastMessage(f).ts });
  }
  for (const g of state.groups) {
    if (g.messages.length) items.push({ kind: 'group', data: g, ts: lastMessage(g).ts });
  }
  return items.sort((a, b) => b.ts - a.ts);
}

function convPreview(c, kind) {
  const last = lastMessage(c);
  if (!last) return '';
  const prefix = last.role === 'user' ? '我：' : '';
  if (last.image) return prefix + '[图片]';
  if (kind === 'group') {
    return (last.role === 'user' ? '我：' : nameOf(last.authorId) + '：') + (last.text || '');
  }
  return prefix + (last.text || '');
}

function renderConversations() {
  if (searching) { renderSearchResults(); return; }
  convList.textContent = '';
  const items = sortedConvs();

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '还没有聊天。去「通讯录」点一个人，或者自己建个群';
    convList.append(empty);
    renderTabBadge();
    return;
  }

  for (const { kind, data } of items) {
    const row = document.createElement('div');
    row.className = 'conv';

    if (kind === 'group') {
      const av = document.createElement('div');
      av.className = 'avatar group-av';
      av.textContent = '群';
      row.append(av);
    } else {
      row.append(avatarEl(data));
    }

    const main = document.createElement('div');
    main.className = 'conv-main';

    const top = document.createElement('div');
    top.className = 'conv-top';
    const name = document.createElement('div');
    name.className = 'conv-name';
    name.textContent = data.name;
    const time = document.createElement('div');
    time.className = 'conv-time';
    time.textContent = listTime(lastMessage(data).ts);
    top.append(name, time);

    const bottom = document.createElement('div');
    bottom.className = 'conv-bottom';
    const preview = document.createElement('div');
    preview.className = 'conv-preview';
    preview.textContent = convPreview(data, kind);
    bottom.append(preview);

    if (data.unread > 0) {
      const badge = document.createElement('i');
      badge.className = 'unread';
      badge.textContent = data.unread > 99 ? '99+' : String(data.unread);
      bottom.append(badge);
    }

    main.append(top, bottom);
    row.append(main);
    row.addEventListener('click', () => openChat(kind, data.id));
    convList.append(row);
  }

  renderTabBadge();
}

function renderContacts() {
  contactList.textContent = '';
  if (!state.friends.length && !state.groups.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '通讯录是空的。点右上角 ＋ 新建一个朋友';
    contactList.append(empty);
    return;
  }

  if (state.groups.length) {
    const head = document.createElement('div');
    head.className = 'group-title';
    head.style.padding = '12px 14px 6px';
    head.textContent = '群聊';
    contactList.append(head);
    for (const g of state.groups) {
      const row = document.createElement('div');
      row.className = 'conv';
      const av = document.createElement('div');
      av.className = 'avatar group-av';
      av.textContent = '群';
      row.append(av);
      const main = document.createElement('div');
      main.className = 'conv-main';
      const top = document.createElement('div');
      top.className = 'conv-top';
      const name = document.createElement('div');
      name.className = 'conv-name';
      name.textContent = g.name;
      top.append(name);
      const bottom = document.createElement('div');
      bottom.className = 'conv-bottom';
      const p = document.createElement('div');
      p.className = 'conv-preview';
      p.textContent = g.members.map(nameOf).join('、') || '还没有人';
      bottom.append(p);
      main.append(top, bottom);
      row.append(main);
      row.addEventListener('click', () => openChat('group', g.id));
      contactList.append(row);
    }
  }

  if (state.friends.length) {
    const head = document.createElement('div');
    head.className = 'group-title';
    head.style.padding = '12px 14px 6px';
    head.textContent = '朋友';
    contactList.append(head);
    for (const f of [...state.friends].sort((a, b) => a.name.localeCompare(b.name, 'zh'))) {
      const row = document.createElement('div');
      row.className = 'conv';
      row.append(avatarEl(f));
      const main = document.createElement('div');
      main.className = 'conv-main';
      const top = document.createElement('div');
      top.className = 'conv-top';
      const name = document.createElement('div');
      name.className = 'conv-name';
      name.textContent = f.name;
      top.append(name);
      const bottom = document.createElement('div');
      bottom.className = 'conv-bottom';
      const p = document.createElement('div');
      p.className = 'conv-preview';
      p.textContent = (f.persona || '').split('\n')[0] || '还没写人设';
      bottom.append(p);
      main.append(top, bottom);
      row.append(main);
      row.addEventListener('click', () => openChat('friend', f.id));
      contactList.append(row);
    }
  }
}

function renderMe() {
  const el = $('#meAvatar');
  paintAvatar(el, state.me.avatar, state.me.name);
  el.classList.add('big');
  $('#meName').textContent = state.me.name || '我';
}

function renderTabBadge() {
  const unreadChats = [...state.friends, ...state.groups].reduce((n, c) => n + (c.unread || 0), 0);
  const btn = tabbar.querySelector('[data-tab="msg"]');
  let badge = btn.querySelector('.tbadge');
  if (!unreadChats) {
    if (badge) badge.remove();
  } else {
    if (!badge) {
      badge = document.createElement('i');
      badge.className = 'tbadge';
      btn.append(badge);
    }
    badge.textContent = unreadChats > 99 ? '99+' : String(unreadChats);
  }
}

/* ---------------- 朋友圈 ---------------- */

function momentAuthor(m) {
  return m.authorId === 'me' ? state.me : (friendById(m.authorId) || { name: '某人', avatar: '' });
}

function renderMoments() {
  momentList.textContent = '';
  if (!state.moments.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '朋友圈还空着。\n自己发一条，或者等她们发。';
    empty.style.whiteSpace = 'pre-line';
    momentList.append(empty);
    return;
  }

  for (const m of state.moments) {
    if (m.visibility === 'private' && m.authorId !== 'me') continue;
    const card = document.createElement('div');
    card.className = 'moment';

    const head = document.createElement('div');
    head.className = 'moment-head';
    head.append(avatarEl(momentAuthor(m)));
    const who = document.createElement('div');
    who.className = 'moment-who';
    const nm = document.createElement('div');
    nm.className = 'moment-name';
    nm.textContent = momentAuthor(m).name;
    const tm = document.createElement('div');
    tm.className = 'moment-time';
    tm.textContent = agoOf(m.ts);
    who.append(nm, tm);
    head.append(who);
    card.append(head);

    const text = document.createElement('div');
    text.className = 'moment-text';
    text.textContent = m.text;
    card.append(text);

    if (m.image) {
      const im = document.createElement('img');
      im.className = 'moment-img';
      im.src = m.image;
      im.alt = '';
      im.loading = 'lazy';
      im.addEventListener('click', () => openLightbox(m.image));
      card.append(im);
    }

    const acts = document.createElement('div');
    acts.className = 'moment-actions';
    const liked = (m.likes || []).includes('me');
    const likeBtn = document.createElement('button');
    likeBtn.textContent = liked ? '♥ 取消' : '♡ 赞';
    likeBtn.className = liked ? 'on' : '';
    likeBtn.addEventListener('click', () => toggleLike(m.id));
    acts.append(likeBtn);

    const cmtBtn = document.createElement('button');
    cmtBtn.textContent = '评论';
    cmtBtn.addEventListener('click', () => toggleCommentBox(m.id, card));
    acts.append(cmtBtn);

    const delBtn = document.createElement('button');
    delBtn.textContent = '删除';
    delBtn.className = 'danger-text';
    delBtn.addEventListener('click', () => deleteMoment(m.id));
    acts.append(delBtn);
    card.append(acts);

    const social = document.createElement('div');
    social.className = 'moment-social';

    const likeNames = (m.likes || []).map(nameOf);
    const likes = document.createElement('div');
    likes.className = 'likes';
    likes.textContent = likeNames.length ? '♥ ' + likeNames.join('、') : '';
    likes.hidden = !likeNames.length;
    social.append(likes);

    const comments = document.createElement('div');
    comments.className = 'comments';
    comments.hidden = !(m.comments || []).length;
    for (const c of m.comments || []) {
      const line = document.createElement('div');
      line.className = 'comment';
      line.title = '点这条可以回复' + nameOf(c.by);
      const b = document.createElement('b');
      b.textContent = nameOf(c.by) + '：';
      line.append(b);
      if (c.replyTo) {
        const to = document.createElement('span');
        to.className = 'cmt-to';
        to.textContent = '回复 ' + nameOf(c.replyTo) + '：';
        line.append(to);
      }
      line.append(document.createTextNode(c.text));
      if (c.by === 'me') {
        line.addEventListener('click', () => {
          if (!confirm('删除这条评论？')) return;
          m.comments = (m.comments || []).filter((x) => x.id !== c.id);
          persist(); renderMoments();
        });
      } else {
        line.addEventListener('click', () => openReplyBox(m, c, card));
      }
      comments.append(line);
    }
    social.append(comments);
    social.hidden = !likeNames.length && !(m.comments || []).length;
    card.append(social);

    momentList.append(card);
  }
}

function openLightbox(src) {
  let box = document.getElementById('lightbox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'lightbox';
    const img = document.createElement('img');
    img.id = 'lightboxImg';
    box.append(img);
    document.body.append(box);
    box.addEventListener('click', () => { box.classList.remove('open'); });
  }
  document.getElementById('lightboxImg').src = src;
  box.classList.add('open');
}

function deleteMoment(id) {
  if (!confirm('删除这条朋友圈？')) return;
  state.moments = state.moments.filter((x) => x.id !== id);
  rememberDeleted([id]);
  persist();
  renderMoments();
  toast('已删除');
}

let replyingTo = null;

function openReplyBox(m, c, card) {
  const old = card.querySelector('.cmt-box');
  if (old) old.remove();
  const box = document.createElement('div');
  box.className = 'cmt-box';
  const input = document.createElement('input');
  input.placeholder = '回复 ' + nameOf(c.by) + '…';
  input.maxLength = 200;
  const send = document.createElement('button');
  send.textContent = '发送';
  const cancel = document.createElement('button');
  cancel.textContent = '取消';
  cancel.className = 'ghost';
  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    addComment(m.id, text, c.by);
    box.remove();
  };
  send.addEventListener('click', submit);
  cancel.addEventListener('click', () => box.remove());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  box.append(input, send, cancel);
  card.appendChild(box);
  setTimeout(() => input.focus(), 30);
}

function toggleCommentBox(momentId, card) {
  const old = card.querySelector('.cmt-box');
  if (old) { old.remove(); return; }

  const box = document.createElement('div');
  box.className = 'cmt-box';
  const input = document.createElement('input');
  input.placeholder = '说点什么…';
  input.maxLength = 200;
  const btn = document.createElement('button');
  btn.textContent = '发送';

  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    addComment(momentId, text);
  };

  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); }
  });

  box.append(input, btn);
  card.append(box);
  input.focus();
}

function addComment(momentId, text, replyTo) {
  const m = state.moments.find((x) => x.id === momentId);
  if (!m) return;
  m.comments = m.comments || [];
  const c = { id: uid('c'), by: 'me', text: text.slice(0, 200), ts: Date.now() };
  if (replyTo) c.replyTo = replyTo;
  m.comments.push(c);

  // 被回复的那个人一定要接话（无论他是作者还是普通评论者）
  if (replyTo && replyTo !== 'me' && friendById(replyTo)) {
    const dup = state.pending.some((p) => p.kind === 'reply' && p.momentId === momentId && p.by === replyTo);
    if (!dup) {
      state.pending.push({
        id: uid('p'), kind: 'reply', momentId, by: replyTo,
        toComment: text.slice(0, 200),
        dueAt: Date.now() / 1000 + 30 + Math.random() * 240,
      });
    }
  }

  if (m.authorId && m.authorId !== 'me' && m.authorId !== replyTo) {
    state.pending.push({
      id: uid('p'), kind: 'reply', momentId, by: m.authorId,
      toComment: text.slice(0, 200),
      dueAt: Date.now() / 1000 + 60 + Math.random() * 540,
    });

    // 另一个熟人也可能过来插一句
    if (Math.random() < 0.35) {
      const author = friendById(m.authorId);
      const others = state.friends.filter((f) => f.id !== m.authorId
        && ((f.relations || []).includes(m.authorId) || (author && (author.relations || []).includes(f.id))));
      if (others.length) {
        const pick = others[Math.floor(Math.random() * others.length)];
        state.pending.push({
          id: uid('p'), kind: 'comment', momentId, by: pick.id,
          dueAt: Date.now() / 1000 + 120 + Math.random() * 600,
        });
      }
    }
  }

  persist();
  renderMoments();
  toast('已评论');
}

function toggleLike(id) {
  const m = state.moments.find((x) => x.id === id);
  if (!m) return;
  m.likes = m.likes || [];
  const i = m.likes.indexOf('me');
  if (i >= 0) m.likes.splice(i, 1);
  else m.likes.push('me');
  persist();
  renderMoments();
}

function postMoment(text) {
  const clean = (text || '').trim();
  if (!clean) return toast('写点什么再发');
  const vis = document.getElementById('fMomentVis');
  const m = {
    id: uid('mo'),
    authorId: 'me',
    visibility: vis ? vis.value : 'public',
    image: momentImage || '',
    text: clean.slice(0, 500),
    ts: Date.now(),
    likes: [],
    comments: [],
  };
  state.moments.unshift(m);
  enqueueReactions(m);
  persist();
  renderMoments();
  closeMomentSheet();
  toast('发出去了');
}

function relatedFriends(authorId) {
  if (authorId === 'me') return [...state.friends];
  const author = friendById(authorId);
  const ids = new Set((author && author.relations) || []);
  for (const f of state.friends) {
    if ((f.relations || []).includes(authorId)) ids.add(f.id);
  }
  ids.delete(authorId);
  return state.friends.filter((f) => ids.has(f.id));
}

function pendingExists(kind, momentId, by) {
  return state.pending.some((p) => p.kind === kind && p.momentId === momentId && p.by === by);
}

const MAX_PER_PERSON = 2;
const MAX_PER_MOMENT = 200;

function canComment(m, by, isReply) {
  const cs = m.comments || [];
  if (cs.length >= MAX_PER_MOMENT) return false;
  const cap = MAX_PER_PERSON + (isReply ? 1 : 0);   // 被人直接回复时多允许一次
  if (cs.filter((c) => c.by === by).length >= cap) return false;
  if (cs.length && cs[cs.length - 1].by === by) return false;
  return true;
}

function enqueueReactions(m) {
  if (m.visibility === 'private') return;
  let pool = relatedFriends(m.authorId);
  if (m.visibility === 'relations') pool = pool.filter((f) => (f.relations || []).length > 0);
  pool = pool.sort(() => Math.random() - 0.5).slice(0, 5);
  const nowSec = Date.now() / 1000;
  for (const f of pool) {
    if (Math.random() < 0.85 && !pendingExists('like', m.id, f.id)) {
      state.pending.push({
        id: uid('p'), kind: 'like', momentId: m.id, by: f.id,
        dueAt: nowSec + 20 + Math.random() * 600,
      });
    }
    if (Math.random() < 0.85 && !pendingExists('comment', m.id, f.id)) {
      state.pending.push({
        id: uid('p'), kind: 'comment', momentId: m.id, by: f.id,
        dueAt: nowSec + 90 + Math.random() * 1500,
      });
    }
  }

  const dmPool = state.friends.filter((f) => f.dmMoment !== false);
  if (dmPool.length && Math.random() < 0.2) {
    const f = dmPool[Math.floor(Math.random() * dmPool.length)];
    state.pending.push({
      id: uid('p'), kind: 'dm', momentId: m.id, by: f.id,
      dueAt: nowSec + 120 + Math.random() * 1200,
    });
  }
}

/* ---------------- 聊天页 ---------------- */

function isActive(kind, id) {
  return !!state.conv && state.conv.kind === kind && state.conv.id === id;
}

function openChat(kind, id) {
  const conv = convById(kind, id);
  if (!conv) return;
  state.conv = { kind, id };
  conv.unread = 0;
  renderConversations();

  $('#peerName').textContent = conv.name;
  setStatus('在线');
  pageChat.classList.add('open');
  phone.classList.add('chat-open');

  renderChat();
  restoreDraft();
  updateSendBtn();

  const r = rtOf(convKey(kind, id));
  if (r.phase === 'streaming' || r.phase === 'waiting') setStatus('对方正在输入…');

  startClock();
  if (!COARSE) inputEl.focus();
  persist();
}

function closeChat() {
  pageChat.classList.remove('open');
  phone.classList.remove('chat-open');
  state.conv = null;
  renderConversations();
  persist();
}

function renderChat() {
  const conv = currentConv();
  if (conv && state.deleted && state.deleted.length) {
    const dead = new Set(state.deleted);
    conv.messages = conv.messages.filter((m) => !dead.has(m.id));
  }
  chatEl.textContent = '';
  lastTs = 0;
  if (!conv) return;
  const kind = state.conv.kind;

  if (!conv.messages.length) {
    const tip = document.createElement('div');
    tip.className = 'empty';
    tip.textContent = kind === 'group'
      ? '群里还没人说话。开个头吧'
      : '还没有消息，说点什么吧';
    chatEl.append(tip);
  }

  for (const m of conv.messages) renderMessage(m, { conv, kind, animate: false });
  scrollBottom(true);
  updateFab();
}

function addDivider(ts) {
  const d = document.createElement('div');
  d.className = 'time-divider';
  d.textContent = dividerOf(ts);
  chatEl.append(d);
}

function renderMessage(msg, opts = {}) {
  const conv = opts.conv || currentConv();
  if (!conv) return { row: null, bubble: null };
  const kind = opts.kind || (state.conv ? state.conv.kind : 'friend');
  const typing = !!opts.typing;

  if (!typing && msg.ts && isActive(kind, conv.id)) {
    if (lastTs === 0 || msg.ts - lastTs > 5 * 60 * 1000) addDivider(msg.ts);
    lastTs = msg.ts;
  }

  const row = document.createElement('div');
  row.className = 'row ' + (msg.role === 'user' ? 'me' : 'peer') + (opts.animate === false ? '' : ' anim');
  if (msg.id) row.dataset.id = msg.id;
  if (msg.role === 'system') {
    row.className = 'sys-line';
    const t = document.createElement('span');
    t.textContent = msg.text || '';
    row.append(t);
    chatEl.append(row);
    if (!typing) scrollBottom();
    return { row, bubble: t };
  }
  if (msg.recalled) {
    row.className = 'sys-line';
    const t = document.createElement('span');
    t.textContent = (msg.role === 'user' ? '你' : nameOf(msg.authorId)) + ' 撤回了一条消息';
    row.append(t);
    chatEl.append(row);
    if (!typing) scrollBottom();
    return { row, bubble: t };
  }

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (typing) {
    bubble.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
  } else if (msg.image) {
    bubble.classList.add('pic');
    const img = document.createElement('img');
    img.className = 'pic';
    img.src = msg.image;
    img.alt = '';
    bubble.append(img);
  } else {
    bubble.textContent = msg.text;
  }

  if (msg.quote && msg.quote.text) {
    const q = document.createElement('div');
    q.className = 'quote-block';
    q.textContent = msg.quote.author + '：' + msg.quote.text;
    bubble.prepend(q);
  }

  bubble.addEventListener('click', (e) => {
    if (!isDesk() || !msgMenu.hidden) return;
    e.stopPropagation();
    swallowClick = true;
    openMenu(row, 0, 0);
  });

  const who = speakerOf(msg, conv);
  const av = avatarEl(who);
  av.addEventListener('dblclick', () => {
    conv.messages.push({ id: uid('m'), role: 'system', text: '你拍了拍 ' + who.name, ts: Date.now() });
    persist(); renderChat();
  });
  row.append(av);

  if (kind === 'group' && msg.role !== 'user') {
    const col = document.createElement('div');
    col.className = 'bubble-col';
    const nm = document.createElement('div');
    nm.className = 'who';
    nm.textContent = who.name;
    col.append(nm, bubble);
    row.append(col);
  } else {
    row.append(bubble);
  }

  chatEl.append(row);
  if (!typing) scrollBottom();
  return { row, bubble };
}

function clearReadMark() {
  $$('.readmark', chatEl).forEach((el) => el.remove());
}

function markRead() {
  clearReadMark();
  const mark = document.createElement('div');
  mark.className = 'readmark';
  mark.textContent = '已读';
  chatEl.append(mark);
  scrollBottom();
}

let unreadInChat = 0;

function updateFab() {
  const away = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight > 240;
  if (away) fab.hidden = false;
  else { fab.hidden = true; unreadInChat = 0; fabBadge.hidden = true; }
}

chatEl.addEventListener('scroll', () => {
  if (nearBottom()) { unreadInChat = 0; fabBadge.hidden = true; }
  updateFab();
});

fab.addEventListener('click', () => {
  unreadInChat = 0;
  fabBadge.hidden = true;
  scrollBottom(true);
  updateFab();
});

/* ---------------- 请求 ---------------- */

const nativePending = {};
const nativePosts = {};
const nativePing = {};

window.QingliaoNative = {
  delta(id, text) {
    const p = nativePending[id];
    if (!p || !p.onDelta) return;
    let obj = null;
    try { obj = JSON.parse(text); } catch (_) { obj = null; }
    p.onDelta(obj || { content: text });
  },
  done(id) {
    const p = nativePending[id];
    delete nativePending[id];
    if (p && p.onDone) p.onDone();
  },
  error(id, msg) {
    const p = nativePending[id];
    delete nativePending[id];
    if (p && p.onError) p.onError(new Error(msg || '出错了'));
  },
  postDone(id, text) {
    const p = nativePosts[id];
    delete nativePosts[id];
    if (!p) return;
    let data = null;
    try { data = JSON.parse(text); } catch (_) { data = null; }
    if (!data) p.reject(new Error('返回的不是 JSON'));
    else p.resolve(data);
  },
  postFail(id, msg) {
    const p = nativePosts[id];
    delete nativePosts[id];
    if (p) p.reject(new Error(msg || '请求失败'));
  },
  pong(id, ok, msg) {
    const fn = nativePing[id];
    delete nativePing[id];
    if (fn) fn(ok, msg);
  },
};

function chatUrl() {
  return (state.settings.baseUrl || '').trim().replace(/\/+$/, '') + '/chat/completions';
}

const SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: '联网搜索，用来查实时信息（新闻、天气、价格、比分、最新政策等）。需要最新或你不确定的事实时调用。',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: '搜索关键词，简短具体' } },
      required: ['query'],
    },
  },
};

function searchEnabled() { return !!state.settings.webSearch; }

function toolsUrl(path) {
  const base = (state.settings.baseUrl || '').trim().replace(/\/+$/, '');
  return base.endsWith('/v1') ? base + path : base + '/v1' + path;
}

function requestJson(url, key, body) {
  if (NATIVE && !SERVER && window.AndroidChat.post) {
    return new Promise((resolve, reject) => {
      const id = 'j' + Date.now() + Math.random().toString(36).slice(2, 5);
      nativePosts[id] = { resolve, reject };
      try { window.AndroidChat.post(id, url, key, JSON.stringify(body)); }
      catch (e) { delete nativePosts[id]; reject(e); }
    });
  }
  return apiFetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, key, body }),
  }).then(async (res) => {
    let data = {};
    try { data = await res.json(); } catch (_) { data = {}; }
    if (data && data.error) throw new Error(data.error);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return data;
  });
}

function formatSearch(data, query) {
  const results = (data && data.results) || [];
  if (!results.length) return '没有搜到关于「' + query + '」的结果。';
  const lines = ['搜索「' + query + '」的结果：'];
  results.slice(0, 5).forEach((r, i) => {
    lines.push('\n[' + (i + 1) + '] ' + (r.title || ''));
    if (r.url) lines.push(r.url);
    if (r.summary) lines.push(String(r.summary).trim());
    if (r.content) lines.push('正文节选：' + String(r.content).replace(/\s+/g, ' ').slice(0, 700));
  });
  return lines.join('\n');
}

async function runTool(tc) {
  let args = {};
  try { args = JSON.parse((tc.function && tc.function.arguments) || '{}'); } catch (_) { args = {}; }
  const query = String(args.query || '').trim().slice(0, 128);
  if (!query) return '搜索词为空。';
  try {
    const data = await requestJson(toolsUrl('/tools/search'), (state.settings.apiKey || '').trim(), {
      query, count: 5, need_content: true, ori_question: query,
    });
    return formatSearch(data, query);
  } catch (e) {
    return '搜索失败：' + (e && e.message ? e.message : e);
  }
}

function buildBody(messages, withTools) {
  const s = state.settings;
  const body = { model: s.model || 'deepseek-flash', messages, stream: true };
  if (withTools) body.tools = [SEARCH_TOOL];
  if (/deepseek/i.test(s.model || '')) {
    if (s.thinking === 'off') body.thinking = { type: 'disabled' };
    else { body.thinking = { type: 'enabled' }; body.reasoning_effort = s.thinking; }
  }
  if (s.thinking === 'off') {
    let t = Number(s.temperature);
    if (!isFinite(t)) t = 0.9;
    body.temperature = t;
  }
  return body;
}

function toApiMessage(m, allowImage) {
  const role = m.role === 'user' ? 'user' : 'assistant';
  if (m.image) {
    if (allowImage && state.settings.vision) {
      return { role, content: [
        { type: 'text', text: m.text || '（图片）' },
        { type: 'image_url', image_url: { url: m.image } },
      ] };
    }
    return { role, content: (m.text ? m.text + ' ' : '') + '（发了一张图片）' };
  }
  return { role, content: m.text };
}

function buildMessages(friend, conv, nudge) {
  const s = state.settings;
  const now = new Date();
  const isGroup = conv.members && Array.isArray(conv.members);

  let sys = (friend.persona || DEFAULT_PERSONA).trim();
  if (friend.memory) sys += `\n\n【你记得的事】${friend.memory}`;
  const meName = state.me.name || '我';
  sys += `\n\n【环境】现在是 ${timeOf(now.getTime())}，${weekday(now)}。你在和「${meName}」聊天。`;
  sys += `\n\n【身份】你只扮演「${friend.name}」。下面每条消息前面都标了说话人。`;
  sys += `\n绝对不要替「${meName}」说话，不要写对方的台词，不要扮演他，也不要自问自答。`;

  if (isGroup) {
    const others = conv.members.filter((id) => id !== friend.id).map(nameOf);
    sys += `\n\n【群聊】这是一个群，群里有：${state.me.name || '我'}、你（${friend.name}）${others.length ? '、' + others.join('、') : ''}。`;
    sys += '\n你看得到所有人说的话。只回你该回的部分，别替别人说话，也别总结全场。';
    if (conv.prompt) sys += '\n\n【群设定】' + conv.prompt;
  }

  if (searchEnabled()) {
    sys += '\n\n【联网】需要最新消息或不确定的事，用 web_search 查一下再说。不要提“搜索”这个词，别编。';
  }

  const bursts = isGroup
    ? Math.max(1, Math.min(10, Number(s.groupBursts) || 10))
    : Math.max(1, Math.min(5, Number(fs(friend, 'bursts', 5)) || 5));
  if (bursts > 1) {
    sys += `\n\n【发送方式】想说两句以上时，用换行拆成 2~${bursts} 条短消息，每条不超过 20 字；只说一句就只写一句。`;
  }

  const out = [{ role: 'system', content: sys }];
  const limit = Math.max(6, Number(s.contextLimit) || 60);
  const history = conv.messages
    .filter((m) => (m.text || m.image) && !m.recalled && m.role !== 'system')
    .slice(-limit);

  let imageBudget = 2;
  const prepared = [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i];
    let allow = false;
    if (m.image && imageBudget > 0) { allow = true; imageBudget -= 1; }
    const base = toApiMessage(m, allow);
    const qt = m.quote && m.quote.text ? '（引用 ' + m.quote.author + '：' + m.quote.text + '）' : '';
    if (qt && typeof base.content === 'string') base.content = qt + base.content;
    if (isGroup) {
      if (m.role === 'peer' && m.authorId === friend.id) {
        prepared.unshift({ role: 'assistant', content: typeof base.content === 'string' ? base.content : (m.text || '') });
      } else {
        const nm = m.role === 'user' ? (state.me.name || '我') : nameOf(m.authorId);
        const txt = typeof base.content === 'string' ? base.content : (m.text || '（图片）');
        prepared.unshift({ role: 'user', content: '【' + nm + '】' + txt });
      }
    } else {
      if (m.role === 'user' && typeof base.content === 'string') {
        prepared.unshift({ role: 'user', content: '【' + meName + '】' + base.content });
      } else {
        prepared.unshift(base);
      }
    }
  }

  for (const m of prepared) out.push(m);
  if (nudge) out.push({ role: 'system', content: nudge });
  return out;
}

function startStream({ url, key, body, onDelta, onDone, onError }) {
  if (NATIVE && !SERVER) {
    const id = 'r' + Date.now() + Math.random().toString(36).slice(2, 5);
    nativePending[id] = { onDelta, onDone, onError };
    try { window.AndroidChat.start(id, url, key, JSON.stringify(body)); }
    catch (e) { onError(e); }
    return () => { try { window.AndroidChat.abort(id); } catch (_) {} };
  }

  const ctrl = new AbortController();
  (async () => {
    const res = await apiFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, key, body }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let detail = '';
      try {
        const text = await res.text();
        try {
          const j = JSON.parse(text);
          detail = (j.error && (j.error.message || j.error)) || text;
        } catch (_) { detail = text; }
      } catch (_) {}
      const msg = res.status === 401 || res.status === 403
        ? `接口拒绝了这次请求（${res.status}），多半是 API Key 不对或者没余额。`
        : `接口返回 ${res.status}：${String(detail).slice(0, 200)}`;
      throw new Error(msg);
    }
    await readSse(res, onDelta);
    onDone();
  })().catch((err) => {
    if (err && err.name === 'AbortError') { onDone(); return; }
    onError(err);
  });

  return () => { try { ctrl.abort(); } catch (_) {} };
}

async function readSse(res, onDelta) {
  const reader = res.body.getReader();
  const dec = new TextDecoder('utf-8');
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          let obj;
          try { obj = JSON.parse(data); } catch (_) { continue; }
          let delta = null;
          try { delta = obj.choices[0].delta || null; } catch (_) { delta = null; }
          if (delta) onDelta(delta);
        }
      }
    }
  } finally {
    try { reader.cancel(); } catch (_) {}
  }
}

function streamOnce({ url, key, body, onDelta }) {
  let cancel = null;
  const promise = new Promise((resolve, reject) => {
    let content = '';
    let reasoning = '';
    const calls = [];

    cancel = startStream({
      url, key, body,
      onDelta: (d) => {
        if (!d) return;
        if (d.reasoning_content) reasoning += d.reasoning_content;
        if (d.content) { content += d.content; if (onDelta) onDelta(d.content); }
        if (Array.isArray(d.tool_calls)) {
          for (const tc of d.tool_calls) {
            const i = Number.isFinite(tc.index) ? tc.index : 0;
            if (!calls[i]) calls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } };
            const cur = calls[i];
            if (tc.id) cur.id = tc.id;
            if (tc.type) cur.type = tc.type;
            if (tc.function) {
              if (tc.function.name) cur.function.name += tc.function.name;
              if (tc.function.arguments) cur.function.arguments += tc.function.arguments;
            }
          }
        }
      },
      onDone: () => resolve({ content, reasoning, toolCalls: calls.filter(Boolean) }),
      onError: reject,
    });
  });
  return { promise, cancel: () => { try { if (cancel) cancel(); } catch (_) {} } };
}

async function runChat(friend, conv, r, nudge) {
  const convo = buildMessages(friend, conv, nudge);
  const useTools = searchEnabled();
  const key = (state.settings.apiKey || '').trim();
  let text = '';

  for (let round = 0; round < 3; round += 1) {
    const job = streamOnce({ url: chatUrl(), key, body: buildBody(convo, useTools) });
    r.abort = job.cancel;
    const res = await job.promise;

    if (res.toolCalls && res.toolCalls.length) {
      const assistant = { role: 'assistant', content: res.content || '' };
      if (res.reasoning) assistant.reasoning_content = res.reasoning;
      assistant.tool_calls = res.toolCalls.map((tc, i) => ({
        id: tc.id || ('call_' + round + '_' + i),
        type: 'function',
        function: {
          name: (tc.function && tc.function.name) || '',
          arguments: (tc.function && tc.function.arguments) || '{}',
        },
      }));
      convo.push(assistant);
      for (const tc of assistant.tool_calls) {
        const out = await runTool(tc);
        convo.push({ role: 'tool', tool_call_id: tc.id, content: out });
      }
      continue;
    }

    text = res.content || '';
    break;
  }

  return text;
}

/* ---------------- 收发引擎 ---------------- */

function rtOf(key) {
  if (!rt.has(key)) {
    rt.set(key, { phase: 'idle', timer: null, typing: [], abort: null, queued: false, since: 0, stopped: false });
  }
  return rt.get(key);
}

function clearTypingFx(r) {
  for (const t of r.typing) clearTimeout(t);
  r.typing = [];
}

function updateSendBtn() {
  const conv = currentConv();
  const r = conv ? rtOf(convKey(state.conv.kind, conv.id)) : null;
  const streaming = r && r.phase === 'streaming';
  sendBtn.classList.toggle('stop', !!streaming);
  sendBtn.textContent = streaming ? '停止' : '发送';
  sendBtn.disabled = false;
}

function fs(friend, key, fallback) {
  const own = friend && friend.settings ? friend.settings[key] : undefined;
  if (own !== undefined && own !== null && own !== '') return own;
  const g = state.settings[key];
  return g !== undefined ? g : fallback;
}

function delayFor(friend) {
  const s = {
    delayOn: fs(friend, 'delayOn', true),
    delayMin: fs(friend, 'delayMin', 5),
    delayMax: fs(friend, 'delayMax', 20),
  };
  if (!s.delayOn) return 400;
  const min = Math.max(0, Number(s.delayMin) || 0);
  const max = Math.max(min, Number(s.delayMax) || min);
  return (min + Math.random() * (max - min)) * 1000;
}

function scheduleReply(kind, conv, isNew) {
  const key = convKey(kind, conv.id);
  const r = rtOf(key);
  const active = isActive(kind, conv.id);

  if (r.phase === 'streaming') { r.queued = true; return; }
  if (isNew) r.since = Date.now();
  r.phase = 'waiting';
  clearTimeout(r.timer);
  clearTypingFx(r);
  if (active) { setStatus('在线'); updateSendBtn(); }

  let delay = delayFor(kind === 'friend' ? conv : null);
  const waited = Date.now() - r.since;
  const cap = Math.max(Number(state.settings.delayMax) || 30, 45) * 1000;
  if (waited + delay > cap) delay = Math.max(1200, cap - waited);

  if (active && state.settings.typingFx) typingFx(r, delay);
  r.timer = setTimeout(() => startReply(kind, conv), delay);
}

function typingFx(r, total) {
  if (total < 3500) return;
  const flashes = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < flashes; i += 1) {
    const at = 700 + Math.random() * (total - 2200);
    const dur = 900 + Math.random() * 1800;
    r.typing.push(setTimeout(() => {
      if (r.phase === 'waiting') {
        const c = currentConv();
        if (c && rtOf(convKey(state.conv.kind, c.id)) === r) setStatus('对方正在输入…');
      }
    }, at));
    r.typing.push(setTimeout(() => {
      if (r.phase === 'waiting') {
        const c = currentConv();
        if (c && rtOf(convKey(state.conv.kind, c.id)) === r) setStatus('在线');
      }
    }, at + dur));
  }
}

async function startReply(kind, conv) {
  const key = convKey(kind, conv.id);
  const r = rtOf(key);
  if (r.phase !== 'waiting') return;

  r.phase = 'streaming';
  clearTypingFx(r);
  const active = isActive(kind, conv.id);
  if (active) { setStatus('对方正在输入…'); updateSendBtn(); }

  const friend = kind === 'friend' ? conv : null;
  const authorId = kind === 'friend' ? conv.id : (conv.members[0] || conv.id);
  const k = (state.settings.apiKey || '').trim();
  const precheck = !k
    ? '还没填 API Key，点「我的」→ 设置'
    : (!state.settings.model ? '还没填模型名，试试 deepseek-flash' : '');
  if (precheck) {
    const tip = active ? renderMessage({ role: 'peer', authorId, text: precheck }, { conv, kind }) : null;
    if (tip) tip.bubble.classList.add('error');
    if (active) { setStatus('在线'); updateSendBtn(); }
    r.phase = 'idle';
    return;
  }

  const holder = active
    ? renderMessage({ role: 'peer', authorId, text: '' }, { conv, kind, typing: true })
    : null;

  // 卡住时给用户一个能看懂的结果，而不是一直挂着「正在输入」
  let watchdog = null;
  if (holder) {
    watchdog = setTimeout(() => {
      if (r.phase !== 'streaming' || !holder.bubble.isConnected) return;
      holder.bubble.classList.add('error');
      holder.bubble.textContent = '这条等太久了，可能是网络或接口卡住了。再发一次试试。';
      setStatus('在线');
      if (typeof toast === 'function') toast('回复超时');
    }, 90000);
  }

  try {
    const text = await runChat(friend, conv, r, null);
    if (holder) holder.row.remove();

    if (!text.trim()) {
      if (r.stopped) { r.stopped = false; return; }
      throw new Error('这次没收到内容，再试一次？');
    }

    r.stopped = false;
    await deliver(kind, conv, text, authorId);
  } catch (err) {
    if (r.stopped) r.stopped = false;
    else if (holder) {
      holder.bubble.classList.add('error');
      holder.bubble.textContent = err && err.message ? err.message : '出错了';
    }
  } finally {
    if (watchdog) clearTimeout(watchdog);
    r.abort = null;
    r.phase = 'idle';
    if (isActive(kind, conv.id)) {
      setStatus('在线');
      updateSendBtn();
      scrollBottom(true);
      updateFab();
    }
    if (r.queued) { r.queued = false; scheduleReply(kind, conv, true); }
  }
}

function mentionedIn(group, text) {
  const out = [];
  for (const id of group.members || []) {
    const f = friendById(id);
    if (f && text && text.includes('@' + f.name)) out.push(id);
  }
  return out;
}

function pickSpeakers(group) {
  const max = Math.max(1, Math.min(3, Number(state.settings.groupReplyMax) || 2));
  const n = 1 + Math.floor(Math.random() * max);
  const pool = group.members.filter((id) => friendById(id)).sort(() => Math.random() - 0.5);
  return pool.slice(0, Math.min(n, pool.length));
}

async function groupTurn(group) {
  if (isCloud()) return;
  const key = convKey('group', group.id);
  const r = rtOf(key);
  if (r.phase !== 'idle') { r.queued = true; return; }

  r.phase = 'streaming';
  r.since = Date.now();
  updateSendBtn();

  try {
    const lastUser = [...(group.messages || [])].reverse().find((m) => m.role === 'user');
    const mentioned = lastUser ? mentionedIn(group, lastUser.text || '') : [];
    const speakers = mentioned.length ? mentioned : pickSpeakers(group);
    const cap = Math.max(1, Math.min(10, Number(state.settings.groupBursts) || 3));
    group.turnCounts = group.turnCounts || {};

    for (const fid of speakers) {
      if (r.stopped) break;
      const f = friendById(fid);
      if (!f) continue;
      const used = Number(group.turnCounts[fid] || 0);
      if (used >= cap) continue;

      await sleep(delayFor(f));
      if (r.stopped) break;

      if (isActive('group', group.id)) setStatus(f.name + ' 正在输入…');
      const holder = isActive('group', group.id)
        ? renderMessage({ role: 'peer', authorId: f.id, text: '' }, { conv: group, kind: 'group', typing: true })
        : null;

      try {
        const k = (state.settings.apiKey || '').trim();
        if (!k) throw new Error('还没填 API Key，点「我的」→ 设置');
        const text = await runChat(f, group, r, null);
        if (holder) holder.row.remove();
        if (text.trim()) {
          const left = cap - Number(group.turnCounts[fid] || 0);
          await deliver('group', group, text, f.id, left);
          group.turnCounts[fid] = Number(group.turnCounts[fid] || 0) + Math.max(1, Math.min(left, splitReply(text, left).length));
        }
        else if (holder) holder.row.remove();
      } catch (e) {
        const msg = (e && e.message) ? e.message : '出错了';
        if (holder) {
          holder.bubble.classList.add('error');
          holder.bubble.textContent = msg;
        } else {
          toast('群聊回复失败：' + msg);
        }
      }
      await sleep(300 + Math.random() * 500);
    }

    // 她们之间接一句（不 @ 的时候才有，让群里像在对话）
    if (!mentioned.length && group.members.length > 1 && Math.random() < 0.7) {
      const last = [...(group.messages || [])].reverse().find((m) => m.role !== 'user' && m.text);
      const others = group.members.filter((id) => friendById(id)
        && (!last || id !== last.authorId)
        && Number((group.turnCounts || {})[id] || 0) < Math.max(1, Math.min(10, Number(state.settings.groupBursts) || 3)));
      const second = others[Math.floor(Math.random() * others.length)];
      if (second) {
        const f2 = friendById(second);
        await sleep(delayFor(f2));
        if (!r.stopped && f2) {
          if (isActive('group', group.id)) setStatus(f2.name + ' 正在输入…');
          const h2 = isActive('group', group.id)
            ? renderMessage({ role: 'peer', authorId: f2.id, text: '' }, { conv: group, kind: 'group', typing: true })
            : null;
          try {
            const t2 = await runChat(f2, group, r, null);
            if (h2) h2.row.remove();
            if (t2 && t2.trim()) await deliver('group', group, t2, f2.id);
          } catch (e) {
            if (h2) h2.row.remove();
          }
        }
      }
    }
  } finally {
    r.abort = null;
    r.phase = 'idle';
    if (isActive('group', group.id)) {
      setStatus('在线');
      updateSendBtn();
      scrollBottom(true);
    }
    if (r.queued) { r.queued = false; groupTurn(group); }
  }
}

function notifyPeer(name, text) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!document.hidden) return;
  try { new Notification(name, { body: text.slice(0, 60) }); } catch (_) {}
}

async function deliver(kind, conv, text, authorId, maxParts) {
  if (kind === 'group' && isCloud()) return;
  const owner = kind === 'friend' ? conv : null;
  let limit = kind === 'group'
    ? (state.settings.groupBursts || 3)
    : Math.max(1, Math.min(5, Number(fs(owner, 'bursts', 5)) || 5));

  // 群聊硬闸门：以「你上一条发言之后这个人已经说了几条」为准，不看计数器
  if (kind === 'group') {
    const cap = Math.max(1, Math.min(10, Number(state.settings.groupBursts) || 3));
    let lastUserAt = -1;
    for (let i = conv.messages.length - 1; i >= 0; i -= 1) {
      if (conv.messages[i].role === 'user') { lastUserAt = i; break; }
    }
    const replies = conv.messages.slice(lastUserAt + 1).filter((m) => m.role !== 'user');
    const sent = replies.filter((m) => m.authorId === authorId).length;
    const roundMax = Math.max(1, Math.min(60, Number(state.settings.groupRoundMax) || 10));
    const left = Math.min(cap - sent, roundMax - replies.length);
    if (left <= 0) return;
    limit = Math.min(limit, left);
  }

  if (maxParts != null) limit = Math.max(1, Math.min(limit, maxParts));
  const parts = splitReply(text, limit);
  const now = Date.now();
  const active = isActive(kind, conv.id);
  if (active) clearReadMark();

  for (let i = 0; i < parts.length; i += 1) {
    if (i > 0 && isActive(kind, conv.id)) {
      setStatus('对方正在输入…');
      await sleep(380 + Math.random() * 620);
    }
    const m = { id: uid('m'), role: 'peer', authorId, text: parts[i], ts: now + i * 1000 };
    conv.messages.push(m);

    if (isActive(kind, conv.id)) renderMessage(m, { conv, kind });
    else conv.unread = (conv.unread || 0) + 1;
  }

  if (isActive(kind, conv.id)) {
    setStatus('在线');
    lastTs = conv.messages[conv.messages.length - 1].ts;
    markRead();
  }
  lastActivity = Date.now();
  renderConversations();
  renderTabBadge();
  persist();
}

function splitReply(text, limit) {
  const max = Math.max(1, Math.min(10, Number(limit) || 1));
  const clean = (text || '').trim();
  if (max === 1) return [clean];

  let parts = clean.split(/\n+/).map((t) => t.trim()).filter(Boolean);
  if (parts.length === 1 && clean.length > 40) {
    const marks = '。！？!?…';
    const cut = [];
    let cur = '';
    for (const ch of clean) {
      cur += ch;
      if (marks.includes(ch)) { cut.push(cur.trim()); cur = ''; }
    }
    if (cur.trim()) cut.push(cur.trim());
    if (cut.length >= 2) {
      const mid = Math.ceil(cut.length / 2);
      parts = [cut.slice(0, mid).join(''), cut.slice(mid).join('')];
    }
  }
  return parts.slice(0, max);
}

function afterUserMessage(kind, conv) {
  if (kind === 'group') {
    // 云端模式下群聊统一由服务器生成，客户端不再插一手（否则两边各发各的，条数失控）
    if (isCloud()) return;
    const r = rtOf(convKey('group', conv.id));
    // 上一轮卡死超过两分钟，直接放行，别再排队等
    if (r.phase !== 'idle' && r.since && Date.now() - r.since > 120000) {
      r.phase = 'idle'; r.queued = false; r.abort = null;
    }
    if (r.phase === 'idle') groupTurn(conv);
    else r.queued = true;
    return;
  }
  scheduleReply(kind, conv, true);
}

async function send(raw) {
  const conv = currentConv();
  if (!conv) return;
  const text = (raw != null ? raw : inputEl.value).trim();
  if (!text) return;
  const kind = state.conv.kind;

  if (kind === 'group') conv.turnCounts = {};
  const msg = { id: uid('m'), role: 'user', text, ts: Date.now() };
  if (quoteFor) { msg.quote = quoteFor; quoteFor = null; showQuoteBar(); }
  conv.messages.push(msg);
  clearReadMark();
  renderMessage(msg, { conv, kind });
  scrollBottom(true);

  inputEl.value = '';
  state.drafts[convKey(kind, conv.id)] = '';
  autosize();
  closeEmoji();
  lastActivity = Date.now();
  persist();
  renderConversations();
  afterUserMessage(kind, conv);
}

async function sendImage(dataUrl) {
  const conv = currentConv();
  if (!conv) return;
  const kind = state.conv.kind;
  const msg = { id: uid('m'), role: 'user', text: '', image: dataUrl, ts: Date.now() };
  conv.messages.push(msg);
  clearReadMark();
  renderMessage(msg, { conv, kind });
  scrollBottom(true);
  lastActivity = Date.now();
  persist();
  renderConversations();
  afterUserMessage(kind, conv);
}

/* ---------------- 输入框 ---------------- */

function autosize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 108) + 'px';
}

let draftTimer = null;

function restoreDraft() {
  const conv = currentConv();
  inputEl.value = conv ? (state.drafts[convKey(state.conv.kind, conv.id)] || '') : '';
  inputEl.placeholder = state.conv && state.conv.kind === 'group'
    ? '在群里说点什么…（@名字 可以让某人先说）'
    : '说点什么…';
  autosize();
}

inputEl.addEventListener('input', () => {
  autosize();
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const conv = currentConv();
    if (!conv) return;
    state.drafts[convKey(state.conv.kind, conv.id)] = inputEl.value;
    if (NATIVE) persist();
  }, 400);
});

inputEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.isComposing || e.shiftKey) return;
  if (COARSE) return;
  e.preventDefault();
  send();
});

sendBtn.addEventListener('click', () => {
  const conv = currentConv();
  if (!conv) return;
  const r = rtOf(convKey(state.conv.kind, conv.id));
  if (r.phase === 'streaming') {
    r.stopped = true;
    if (r.abort) r.abort();
    updateSendBtn();
    return;
  }
  send();
});

/* ---------------- 表情 / 图片 ---------------- */

for (const emo of EMOJIS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = emo;
  b.addEventListener('click', () => {
    const start = inputEl.selectionStart ?? inputEl.value.length;
    const end = inputEl.selectionEnd ?? inputEl.value.length;
    const v = inputEl.value;
    inputEl.value = v.slice(0, start) + emo + v.slice(end);
    inputEl.selectionStart = inputEl.selectionEnd = start + emo.length;
    autosize();
    if (!COARSE) inputEl.focus();
  });
  emojiPanel.append(b);
}

function openEmoji() { emojiPanel.hidden = false; scrollBottom(true); }
function closeEmoji() { emojiPanel.hidden = true; }

$('#btnEmoji').addEventListener('click', () => {
  if (emojiPanel.hidden) openEmoji(); else closeEmoji();
});

$('#btnImage').addEventListener('click', async () => {
  const data = await pickImage({ max: 1024, quality: 0.8 });
  if (data) sendImage(data);
});

/* ---------------- 消息菜单 ---------------- */

let menuOpenedAt = 0;
let swallowClick = false;

function openMenu(row, x, y) {
  menuOpenedAt = Date.now();
  if (!x && !y) {
    const r = row.getBoundingClientRect();
    x = r.left + r.width / 2;
    y = r.top + r.height / 2;
  }
  const id = row.dataset.id;
  const conv = currentConv();
  if (!id || !conv) return;
  menuTargetId = id;
  const idx = conv.messages.findIndex((m) => m.id === id);
  if (idx < 0) return;
  const msg = conv.messages[idx];
  const regen = msgMenu.querySelector('[data-act="regen"]');
  regen.style.display = idx === conv.messages.length - 1 && msg.role === 'peer' ? '' : 'none';

  const rect = phone.getBoundingClientRect();
  msgMenu.hidden = false;
  const w = msgMenu.offsetWidth;
  const h = msgMenu.offsetHeight;
  msgMenu.style.left = Math.max(8, Math.min(x - rect.left, rect.width - w - 8)) + 'px';
  msgMenu.style.top = Math.max(8, Math.min(y - rect.top, rect.height - h - 8)) + 'px';
}

function closeMenu() { msgMenu.hidden = true; menuTargetId = null; }



chatEl.addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  e.preventDefault();
  openMenu(row, e.clientX, e.clientY);
});

let pressStart = null;

chatEl.addEventListener('touchstart', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  const t = e.touches[0];
  pressStart = { x: t.clientX, y: t.clientY };
  clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    swallowClick = true;
    openMenu(row, t.clientX, t.clientY);
  }, 350);
}, { passive: true });

chatEl.addEventListener('touchend', () => clearTimeout(longPressTimer));

// 手指轻微抖动不算滑动，否则长按永远触发不了
chatEl.addEventListener('touchmove', (e) => {
  if (!pressStart) return;
  const t = e.touches[0];
  if (Math.abs(t.clientX - pressStart.x) > 24 || Math.abs(t.clientY - pressStart.y) > 24) {
    clearTimeout(longPressTimer);
  }
}, { passive: true });

document.addEventListener('click', (e) => {
  if (swallowClick) { swallowClick = false; return; }   // 长按抬手后补的那次 click，直接吃掉
  if (Date.now() - menuOpenedAt < 500) return;
  if (!msgMenu.hidden && !msgMenu.contains(e.target)) closeMenu();
});

if (!msgMenu.querySelector('[data-act="quote"]')) {
  const qb = document.createElement('button');
  qb.dataset.act = 'quote';
  qb.textContent = '引用';
  msgMenu.insertBefore(qb, msgMenu.querySelector('[data-act="copy"]'));
}
if (!msgMenu.querySelector('[data-act="recall"]')) {
  const rb = document.createElement('button');
  rb.dataset.act = 'recall';
  rb.textContent = '撤回';
  rb.className = 'danger-text';
  msgMenu.appendChild(rb);
}
if (!msgMenu.querySelector('[data-act="speak"]')) {
  const b = document.createElement('button');
  b.dataset.act = 'speak';
  b.textContent = '朗读';
  msgMenu.insertBefore(b, msgMenu.querySelector('[data-act="del"]'));
}

msgMenu.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const act = btn.dataset.act;
  const id = menuTargetId;
  closeMenu();
  const conv = currentConv();
  if (!id || !conv) return;
  const idx = conv.messages.findIndex((m) => m.id === id);
  if (idx < 0) return;
  const msg = conv.messages[idx];

  if (act === 'copy') await copyText(msg.text || '');
  else if (act === 'quote') {
    quoteFor = {
      author: msg.role === 'user' ? (state.me.name || '我') : nameOf(msg.authorId),
      text: (msg.text || '').slice(0, 80),
    };
    showQuoteBar();
    inputEl.focus();
  } else if (act === 'recall') {
    if (msg.role !== 'user') return toast('只能撤回自己发的');
    msg.recalled = true; msg.text = ''; msg.image = '';
    persist(); renderChat(); renderConversations();
  }
  else if (act === 'speak') {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(msg.text || '');
      u.lang = 'zh-CN';
      speechSynthesis.speak(u);
    } catch (_) { toast('这台设备不支持朗读'); }
  }
  else if (act === 'del') {
    conv.messages.splice(idx, 1);
    rememberDeleted([id]);
    persist(); renderChat(); renderConversations();
  } else if (act === 'regen') {
    conv.messages.splice(idx, 1);
    rememberDeleted([id]);
    persist(); renderChat();
    if (state.conv.kind === 'friend') scheduleReply('friend', conv, true);
  }
});

async function copyText(text) {
  if (!text) return toast('这条没有文字');
  try {
    if (NATIVE && window.AndroidChat.copy) { window.AndroidChat.copy(text); return toast('已复制'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return toast('已复制');
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制');
  } catch (_) { toast('复制失败'); }
}

/* ---------------- 设置 ---------------- */

function fillForm() {
  const s = state.settings;
  settingsFormBase = { ...s };
  $('#fBase').value = s.baseUrl || '';
  $('#fKey').value = s.apiKey || '';
  $('#fModel').value = s.model || '';
  $('#fThinking').value = s.thinking || 'off';
  $('#fTemp').value = s.temperature ?? 0.9;
  $('#fTempOut').textContent = Number(s.temperature ?? 0.9).toFixed(1);
  $('#fCtx').value = s.contextLimit ?? 60;
  $('#fVision').checked = !!s.vision;
  $('#fSearch').checked = !!s.webSearch;
  $('#fDelayOn').checked = !!s.delayOn;
  $('#fDelayMin').value = s.delayMin ?? 5;
  $('#fDelayMax').value = s.delayMax ?? 30;
  $('#fTypingFx').checked = !!s.typingFx;
  $('#fBursts').value = s.bursts || 5;
  $('#fGroupBursts').value = s.groupBursts || 3;
  const gr = $('#fGroupRound'); if (gr) gr.value = s.groupRoundMax || 10;
  $('#fTheme').value = s.theme || 'auto';
  const freq = Number(s.momentInterval) || 43200;
  const sel = $('#fMomentFreq');
  sel.value = Array.from(sel.options).some((o) => o.value === String(freq)) ? String(freq) : '43200';
  $('#fProactive').checked = !!s.proactive;
  $('#fIdle').value = s.idleMin ?? 20;
  syncChips();
}

function syncChips() {
  const model = ($('#fModel').value || '').trim();
  $$('.chip', $('#modelChips')).forEach((c) => c.classList.toggle('active', c.dataset.model === model));
}

function openSheet() {
  fillForm();
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  closeEmoji();
}

function closeSheet() {
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
}

let settingsFormBase = null;

function saveForm() {
  const s = { ...state.settings };
  const before = settingsFormBase || state.settings;
  s.baseUrl = $('#fBase').value.trim();
  s.apiKey = $('#fKey').value.trim();
  s.model = $('#fModel').value.trim();
  s.thinking = $('#fThinking').value;
  s.temperature = Number($('#fTemp').value) || 0.9;
  s.contextLimit = Math.max(6, Math.min(2000, Number($('#fCtx').value) || 60));
  s.vision = $('#fVision').checked;
  s.webSearch = $('#fSearch').checked;
  s.delayOn = $('#fDelayOn').checked;
  s.delayMin = Math.max(0, Math.min(600, Number($('#fDelayMin').value) || 0));
  s.delayMax = Math.max(s.delayMin, Math.min(600, Number($('#fDelayMax').value) || s.delayMin));
  s.typingFx = $('#fTypingFx').checked;
  s.bursts = Math.max(1, Math.min(5, Number($('#fBursts').value) || 5));
  s.groupBursts = Math.max(1, Math.min(10, Number($('#fGroupBursts').value) || 3));
  const grEl = $('#fGroupRound');
  if (grEl) s.groupRoundMax = Math.max(1, Math.min(60, Number(grEl.value) || 10));
  s.theme = $('#fTheme').value;
  s.momentInterval = Number($('#fMomentFreq').value) || 43200;
  s.proactive = $('#fProactive').checked;
  s.idleMin = Math.max(3, Number($('#fIdle').value) || 20);
  const patch = changedFields(before, s, Object.keys(s));
  Object.assign(state.settings, patch);
  Object.assign(pendingEdits.settings, patch);
  applyTheme();
  persist();
  closeSheet();
  renderConversations();
  toast('已保存');
}

$('#btnSettings').addEventListener('click', openSheet);
$('#btnSheetClose').addEventListener('click', closeSheet);
$('#btnSheetSave').addEventListener('click', saveForm);
$('#fTemp').addEventListener('input', (e) => { $('#fTempOut').textContent = Number(e.target.value).toFixed(1); });
$('#fModel').addEventListener('input', syncChips);
$('#modelChips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  $('#fModel').value = chip.dataset.model;
  syncChips();
});

$('#btnTest').addEventListener('click', async () => {
  const base = ($('#fBase').value || '').trim().replace(/\/+$/, '');
  const key = ($('#fKey').value || '').trim();
  if (!base || !key) return toast('先填 Base URL 和 Key');
  toast('正在测试…', 8000);
  if (NATIVE && window.AndroidChat.ping) {
    const id = 'p' + Date.now();
    nativePing[id] = (ok, msg) => toast(ok ? '连通了 ✓' : '连不上：' + msg, 4000);
    window.AndroidChat.ping(id, base + '/models', key);
    return;
  }
  try {
    const res = await apiFetch('/api/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: base + '/models', key }),
    });
    const j = await res.json();
    toast(j.ok ? '连通了 ✓' : '连不上：' + (j.error || ''));
  } catch (e) { toast('连不上：' + (e.message || e)); }
});

$('#btnClearAll').addEventListener('click', () => {
  if (!confirm('清空所有聊天记录？（朋友圈会保留）')) return;
  for (const c of [...state.friends, ...state.groups]) {
    rememberDeleted(c.messages.map((m) => m.id));
    c.messages = [];
  }
  closeChat();
  renderConversations();
  persist();
  closeSheet();
  toast('已清空');
});

/* ---------------- 朋友资料 ---------------- */

function renderRelations(selected) {
  const box = $('#relationList');
  box.textContent = '';
  const others = state.friends.filter((f) => f.id !== editingFriendId);
  if (!others.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '还没有别的朋友，先建一个再说';
    box.append(p);
    return;
  }
  for (const f of others) {
    const label = document.createElement('label');
    label.className = 'rel';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.includes(f.id);
    cb.dataset.id = f.id;
    const span = document.createElement('span');
    span.className = 'rel-name';
    span.textContent = f.name;
    label.append(cb, span);
    box.append(label);
  }
}

function renderFriendRhythm(target, isMe) {
  let box = document.getElementById('rhythmBox');
  if (!box) {
    box = document.createElement('div');
    box.className = 'group';
    box.id = 'rhythmBox';
    box.innerHTML = '<div class="group-title">她自己的节奏（留空=跟随全局）</div>'
      + '<label class="field"><span>一次最多几条</span><input id="rBursts" type="number" min="1" max="5" placeholder="跟随全局"></label>'
      + '<label class="field"><span>最少隔几秒</span><input id="rDelayMin" type="number" min="0" max="300" placeholder="跟随全局"></label>'
      + '<label class="field"><span>最多隔几秒</span><input id="rDelayMax" type="number" min="0" max="300" placeholder="跟随全局"></label>'
      + '<label class="field"><span>静默多久主动找你（分钟）</span><input id="rNudge" type="number" min="10" max="1440" placeholder="跟随全局"></label>'
      + '<label class="field"><span>多久发一条朋友圈（小时）</span><input id="rMomentIv" type="number" min="0.2" max="72" step="0.5" placeholder="跟随全局"></label>'
      + '<label class="field row-inline"><span>会主动找我</span><input id="rProactive" type="checkbox" class="switch"></label>'
      + '<label class="field row-inline"><span>每天早晚问候</span><input id="rGreet" type="checkbox" class="switch"></label>';
    const anchor = document.getElementById('relationGroup');
    anchor.parentNode.insertBefore(box, anchor);
  }
  box.style.display = isMe ? 'none' : '';
  const own = (target && target.settings) || {};
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = (v === undefined || v === null) ? '' : v; };
  const chk = (id, v, dflt) => { const el = document.getElementById(id); if (el) el.checked = v === undefined ? dflt : !!v; };
  set('rBursts', own.bursts);
  set('rDelayMin', own.delayMin);
  set('rDelayMax', own.delayMax);
  set('rNudge', own.nudgeAfter);
  set('rMomentIv', own.momentInterval ? (own.momentInterval / 3600) : undefined);
  chk('rProactive', own.proactive, true);
  chk('rGreet', own.greet, true);
}

function readFriendRhythm() {
  const num = (id) => {
    const el = document.getElementById(id);
    if (!el || el.value === '') return undefined;
    const n = Number(el.value);
    return Number.isFinite(n) ? n : undefined;
  };
  const out = {
    bursts: num('rBursts'),
    delayMin: num('rDelayMin'),
    delayMax: num('rDelayMax'),
    nudgeAfter: num('rNudge'),
    momentInterval: (() => { const h = num('rMomentIv'); return h ? Math.round(h * 3600) : undefined; })(),
    proactive: document.getElementById('rProactive').checked,
    greet: document.getElementById('rGreet').checked,
  };
  Object.keys(out).forEach((k) => { if (out[k] === undefined) delete out[k]; });
  return out;
}

function openFriendSheet(friend, mode) {
  friendEditMode = mode || (friend ? 'edit' : 'new');
  editingFriendId = friend ? friend.id : null;
  const isMe = friendEditMode === 'me';
  const isNew = friendEditMode === 'new';

  const personaField = friendSheet.querySelector('.field.col');
  const presetGroup = $('#presetChips').closest('.group');

  $('#friendSheetTitle').textContent = isMe ? '我的资料' : (isNew ? '新建朋友' : '朋友资料');
  $('#btnFDelete').style.display = friendEditMode === 'edit' ? '' : 'none';
  $('#friendDanger').style.display = friendEditMode === 'edit' ? '' : 'none';
  personaField.style.display = isMe ? 'none' : '';
  presetGroup.style.display = isMe ? 'none' : '';
  $('#relationGroup').style.display = (isMe || isNew) ? 'none' : '';

  const target = isMe ? state.me : (friend || { name: '', avatar: '', persona: DEFAULT_PERSONA });
  $('#fFName').value = target.name || '';
  $('#fFPersona').value = target.persona || '';
  paintAvatar($('#fFAvatarPreview'), target.avatar, target.name);
  friendSheet.dataset.avatar = target.avatar || '';

  if (!isMe && !isNew) {
    renderRelations(target.relations || []);
    $('#fDm').checked = target.dmMoment !== false;
  }

  renderFriendRhythm(target, isMe);
  friendSheet.classList.add('open');
  friendSheet.setAttribute('aria-hidden', 'false');
}

function closeFriendSheet() {
  friendSheet.classList.remove('open');
  friendSheet.setAttribute('aria-hidden', 'true');
}

$('#btnFClose').addEventListener('click', closeFriendSheet);

$('#fFAvatarInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const data = await fileToDataUrl(file, 256, 0.86);
  if (!data) return toast('这张图读不了');
  friendSheet.dataset.avatar = data;
  paintAvatar($('#fFAvatarPreview'), data, $('#fFName').value);
});

$('#fFName').addEventListener('input', (e) => {
  paintAvatar($('#fFAvatarPreview'), friendSheet.dataset.avatar || '', e.target.value);
});

$('#presetChips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const p = PRESETS[chip.dataset.preset];
  if (!p) return;
  $('#fFName').value = p.name;
  $('#fFPersona').value = p.persona;
  paintAvatar($('#fFAvatarPreview'), friendSheet.dataset.avatar || '', p.name);
  toast('模板已填好，记得保存');
});

$('#btnFSave').addEventListener('click', () => {
  const name = $('#fFName').value.trim() || '无名';
  const avatar = friendSheet.dataset.avatar || '';
  const persona = $('#fFPersona').value;

  if (friendEditMode === 'me') {
    state.me.name = name;
    state.me.avatar = avatar;
    renderMe();
    persist();
    closeFriendSheet();
    return;
  }

  const rhythm = readFriendRhythm();

  if (friendEditMode === 'new') {
    const f = makeFriend({ name, avatar, persona, relations: [] });
    f.settings = rhythm;
    state.friends.push(f);
    persist();
    closeFriendSheet();
    renderContacts();
    renderConversations();
    openChat('friend', f.id);
    return;
  }

  const f = friendById(editingFriendId);
  if (f) {
    f.name = name;
    f.avatar = avatar;
    f.persona = persona;
    f.relations = $$('#relationList input:checked').map((cb) => cb.dataset.id);
    f.dmMoment = $('#fDm').checked;
    f.settings = readFriendRhythm();
    persist();
    renderChat();
    renderConversations();
    renderContacts();
    if (isActive('friend', f.id)) $('#peerName').textContent = f.name;
  }
  closeFriendSheet();
});

$('#btnFDelete').addEventListener('click', () => {
  const f = friendById(editingFriendId);
  if (!f) return;
  if (!confirm('删除「' + f.name + '」和所有聊天记录？')) return;
  rememberDeleted([f.id, ...f.messages.map((m) => m.id)]);
  state.friends = state.friends.filter((x) => x.id !== f.id);
  state.groups.forEach((g) => { g.members = g.members.filter((id) => id !== f.id); });
  rt.delete(convKey('friend', f.id));
  if (isActive('friend', f.id)) closeChat();
  closeFriendSheet();
  renderContacts();
  renderConversations();
  persist();
  toast('已删除');
});

/* ---------------- 群聊 ---------------- */

function openGroupSheet() {
  $('#fGName').value = '';
  const box = $('#groupMembers');
  box.textContent = '';
  if (!state.friends.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '还没有朋友，先去建一个';
    box.append(p);
  }
  for (const f of state.friends) {
    const label = document.createElement('label');
    label.className = 'rel';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.id = f.id;
    const span = document.createElement('span');
    span.className = 'rel-name';
    span.textContent = f.name;
    label.append(cb, span);
    box.append(label);
  }
  groupSheet.classList.add('open');
  groupSheet.setAttribute('aria-hidden', 'false');
}

function closeGroupSheet() {
  groupSheet.classList.remove('open');
  groupSheet.setAttribute('aria-hidden', 'true');
}

$('#btnGClose').addEventListener('click', closeGroupSheet);
$('#btnNewGroup').addEventListener('click', openGroupSheet);

$('#btnGCreate').addEventListener('click', () => {
  const members = $$('#groupMembers input:checked').map((cb) => cb.dataset.id);
  if (members.length < 2) return toast('至少选两个人');
  const name = $('#fGName').value.trim() || members.map(nameOf).join('、') + ' 的群';
  const g = makeGroup({ name, members });
  state.groups.push(g);
  persist();
  closeGroupSheet();
  renderContacts();
  renderConversations();
  openChat('group', g.id);
});

/* ---------------- 发朋友圈 ---------------- */

let momentImage = '';

function openMomentSheet() {
  $('#fMomentText').value = '';
  momentImage = '';
  if (!$('#fMomentImg')) {
    const wrap = document.createElement('div');
    wrap.className = 'field col';
    wrap.innerHTML = '<span>配图（可选）</span><input type="file" id="fMomentImg" accept="image/*">'
      + '<span style="margin-top:10px">谁能看到</span>'
      + '<select id="fMomentVis"><option value="public">所有人</option>'
      + '<option value="relations">只有我的好友</option>'
      + '<option value="private">仅自己</option></select>';
    $('#fMomentText').closest('.sheet-body').appendChild(wrap);
    wrap.querySelector('input').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) { momentImage = ''; return; }
      momentImage = await imageToDataUrl(file, 1280, 0.82);
      toast('已选择图片');
    });
  }
  momentSheet.classList.add('open');
  momentSheet.setAttribute('aria-hidden', 'false');
  setTimeout(() => $('#fMomentText').focus(), 200);
}

function closeMomentSheet() {
  momentSheet.classList.remove('open');
  momentSheet.setAttribute('aria-hidden', 'true');
}

$('#btnNewMoment').addEventListener('click', openMomentSheet);
$('#btnMClose').addEventListener('click', closeMomentSheet);
$('#btnMPost').addEventListener('click', () => postMoment($('#fMomentText').value));

/* ---------------- 标签页 ---------------- */

const PAGES = { msg: '#pageMsg', contacts: '#pageContacts', moments: '#pageMoments', me: '#pageMe' };

function switchTab(name) {
  for (const [key, sel] of Object.entries(PAGES)) $(sel).hidden = key !== name;
  $$('button', tabbar).forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'msg') renderConversations();
  if (name === 'contacts') renderContacts();
  if (name === 'moments') renderMoments();
  if (name === 'me') renderMe();
}

tabbar.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (!btn) return;
  switchTab(btn.dataset.tab);
});

/* ---------------- 导航 ---------------- */

$('#btnBack').addEventListener('click', closeChat);
$('#btnFriendInfo').addEventListener('click', () => {
  const conv = currentConv();
  if (!conv) return;
  if (state.conv.kind === 'group') return openGroupInfo(conv);
  openFriendSheet(conv, 'edit');
});

$('#btnMsgAdd').addEventListener('click', () => openFriendSheet(null, 'new'));
$('#btnAddFriend').addEventListener('click', () => openFriendSheet(null, 'new'));
$('#btnNewFriend').addEventListener('click', () => openFriendSheet(null, 'new'));
$('#meHero').addEventListener('click', () => openFriendSheet(null, 'me'));

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!msgMenu.hidden) closeMenu();
  else if (sheet.classList.contains('open')) closeSheet();
  else if (friendSheet.classList.contains('open')) closeFriendSheet();
  else if (groupSheet.classList.contains('open')) closeGroupSheet();
  else if (momentSheet.classList.contains('open')) closeMomentSheet();
  else if (pageChat.classList.contains('open')) closeChat();
  else if (!emojiPanel.hidden) closeEmoji();
});

window.qingliaoBack = function () {
  if (!msgMenu.hidden) { closeMenu(); return true; }
  if (sheet.classList.contains('open')) { closeSheet(); return true; }
  if (friendSheet.classList.contains('open')) { closeFriendSheet(); return true; }
  if (groupSheet.classList.contains('open')) { closeGroupSheet(); return true; }
  if (momentSheet.classList.contains('open')) { closeMomentSheet(); return true; }
  if (pageChat.classList.contains('open')) { closeChat(); return true; }
  if (!emojiPanel.hidden) { closeEmoji(); return true; }
  const cur = $$('button', tabbar).find((b) => b.classList.contains('active'));
  if (cur && cur.dataset.tab !== 'msg') { switchTab('msg'); return true; }
  return false;
};

/* ---------------- 导出 ---------------- */

if (!document.getElementById('btnBackup')) {
  const wrap = document.createElement('div');
  wrap.className = 'menu-group';
  wrap.innerHTML = '<button class="menu-item" id="btnBackup"><span>备份到文件</span><b>↓</b></button>'
    + '<button class="menu-item" id="btnRestore"><span>从文件恢复</span><b>↑</b></button>'
    + '<input type="file" id="restoreFile" accept="application/json,.json" hidden>';
  const anchor = document.getElementById('btnExportAll').closest('.menu-group');
  anchor.parentNode.insertBefore(wrap, anchor.nextSibling);

  document.getElementById('btnBackup').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'qingliao-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('备份已下载');
  });

  document.getElementById('btnRestore').addEventListener('click', () => {
    document.getElementById('restoreFile').click();
  });

  document.getElementById('restoreFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!confirm('用这个备份覆盖当前数据？现有的会被替换。')) { e.target.value = ''; return; }
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.friends)) throw new Error('不是轻聊的备份文件');
      state = migrate(data);
      pendingEdits = importEdits(state);
      persist();
      renderMe();
      renderConversations();
      renderContacts();
      renderMoments();
      toast('已恢复');
    } catch (err) {
      toast('恢复失败：' + ((err && err.message) || err));
    }
    e.target.value = '';
  });
}

if (!document.getElementById('btnStatus')) {
  const st = document.createElement('button');
  st.className = 'menu-item';
  st.id = 'btnStatus';
  st.innerHTML = '<span>服务器状态</span><b>›</b>';
  const grp = document.getElementById('btnSettings').closest('.menu-group');
  grp.insertBefore(st, document.getElementById('btnSettings').nextSibling);
  st.addEventListener('click', async () => {
    try {
      const r = await apiFetch('/api/status');
      const j = await r.json();
      const msg = [
        '客户端 ' + APP_BUILD + '　服务端 ' + (j.build || j.version || '-') + '　rev ' + j.rev,
        '好友 ' + j.friends + '　群 ' + j.groups + '　朋友圈 ' + j.moments,
        '上次调度 ' + (j.last_social_at ? new Date(j.last_social_at * 1000).toLocaleString() : '还没跑过'),
      ].join('\n');
      alert(msg);
    } catch (e) {
      alert('读不到状态：' + (e.message || e));
    }
  });
}

$('#btnExportAll').addEventListener('click', async () => {
  const lines = [];
  const dump = (title, msgs, nameOfPeer) => {
    if (!msgs.length) return;
    lines.push('\n===== ' + title + ' =====\n');
    for (const m of msgs) {
      const who = m.role === 'user' ? (state.me.name || '我') : (m.authorId ? nameOf(m.authorId) : nameOfPeer);
      const d = new Date(m.ts);
      lines.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${timeOf(m.ts)}  ${who}：${m.image ? '[图片]' : m.text}`);
    }
  };
  for (const f of state.friends) dump(f.name, f.messages, f.name);
  for (const g of state.groups) dump(g.name, g.messages, g.name);

  if (state.moments.length) {
    lines.push('\n===== 朋友圈 =====\n');
    for (const m of state.moments) {
      lines.push(`${m.authorId === 'me' ? (state.me.name || '我') : nameOf(m.authorId)}：${m.text}`);
      for (const c of m.comments || []) lines.push(`  ${nameOf(c.by)}：${c.text}`);
    }
  }

  if (!lines.length) return toast('还没有内容');
  const text = '轻聊 · 记录\n' + lines.join('\n');

  if (NATIVE && window.AndroidChat.copy) {
    window.AndroidChat.copy(text);
    return toast('已复制到剪贴板');
  }
  try {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `轻聊-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast('已导出');
  } catch (_) { copyText(text); }
});

/* ---------------- 她主动找你 ---------------- */

function proactiveTick() {
  if (!state.settings.proactive) return;
  const conv = currentConv();
  if (!conv || state.conv.kind !== 'friend') return;
  const r = rtOf(convKey('friend', conv.id));
  if (r.phase !== 'idle') return;
  const last = lastMessage(conv);
  if (!last || last.role !== 'user') return;
  const mins = (Date.now() - lastActivity) / 60000;
  if (mins < Math.max(3, Number(state.settings.idleMin) || 20)) return;
  if (conv.nudgeAt && Date.now() - conv.nudgeAt < 20 * 60000) return;
  conv.nudgeAt = Date.now();
  scheduleReply('friend', conv, true);
}

/* ---------------- 客户端朋友圈调度（APK 里用） ---------------- */

async function quickChat(messages) {
  const key = (state.settings.apiKey || '').trim();
  if (!key) return '';
  const job = streamOnce({ url: chatUrl(), key, body: buildBody(messages, false) });
  const res = await job.promise;
  return (res.content || '').trim();
}

function cleanLine(text, limit) {
  return (text || '').trim().replace(/^["“「]|["”」]$/g, '').split('\n')[0].trim().slice(0, limit);
}

function threadText(m, limit = 10) {
  const list = (m.comments || []).slice(-limit);
  return list.map((c) => `${nameOf(c.by)}：${c.text}`).join('\n');
}

/* 以下四个生成函数：APK 里没有服务器，朋友圈全靠这里长出来 */

async function genComment(f, authorName, momentText, thread) {
  let sys = `${f.persona}\n\n${authorName} 发了条朋友圈：\n「${momentText}」\n\n`;
  if (thread) {
    sys += `评论区已经有这些话：\n${thread}\n\n你再补一句评论。注意：\n- 别人说过的别重复\n- 对方在回你就顺着接，别再问同一个问题\n- 10~25 字，口语\n- 只输出评论本身`;
  } else {
    sys += '用一句评论回应，10~25 字，口语，像熟人随口说的。只输出评论本身。';
  }
  sys += '\n只输出你自己的一句评论（不超过 30 字），不要加人名前缀，不要写成两个人对话，不要替别人说话，也不要安慰自己。';
  return cleanLine(await quickChat([{ role: 'system', content: sys }]), 60);
}

async function genReply(f, commenterName, momentText, commentText, thread) {
  let sys = `${f.persona}\n\n你发了条朋友圈：\n「${momentText}」\n\n`;
  if (thread) sys += `评论区：\n${thread}\n\n`;
  sys += `${commenterName} 刚评论了：\n「${commentText}」\n\n回他一句。10~25 字，口语，像真人回评论。`;
  sys += '\n只输出你自己的一句话，不要加人名前缀，不要替别人说话。';
  return cleanLine(await quickChat([{ role: 'system', content: sys }]), 60);
}

async function genDm(f, ownerName, momentText) {
  const sys = `${f.persona}\n\n${ownerName} 刚发了条朋友圈：\n「${momentText}」\n\n`
    + '你想私聊跟他说一句，就为这事儿。10~25 字，口语，像微信上随手发的。不要提“朋友圈”三个字。只输出这一句。';
  return cleanLine(await quickChat([{ role: 'system', content: sys }]), 60);
}

async function genGroupLine(f, authorName, momentText, prev) {
  let sys = `${f.persona}\n\n你们在一个群里聊天。${authorName} 刚发了条朋友圈：\n「${momentText}」\n\n`;
  if (prev && prev.length) sys += `群里已经有人说：\n${prev.join('\n')}\n\n`;
  sys += '你要在群里说一句，聊的就是这条。10~25 字，口语。只输出这一句。';
  return cleanLine(await quickChat([{ role: 'system', content: sys }]), 60);
}

async function clientSocialTick(force) {
  if (!NATIVE && !force) return;
  if (!(state.settings.apiKey || '').trim()) return;

  const nowSec = Date.now() / 1000;
  let changed = false;

  for (const p of [...state.pending]) {
    if (p.dueAt > nowSec) continue;
    const m = state.moments.find((x) => x.id === p.momentId);
    const f = friendById(p.by);
    if (!m || !f) { state.pending = state.pending.filter((x) => x !== p); continue; }

    try {
      if (p.kind === 'like') {
        m.likes = m.likes || [];
        if (!m.likes.includes(p.by)) { m.likes.push(p.by); changed = true; }
      } else if (p.kind === 'comment') {
        m.comments = m.comments || [];
        if (!canComment(m, p.by)) { state.pending = state.pending.filter((x) => x !== p); continue; }
        if (m.comments.some((c) => c.by === p.by)) { state.pending = state.pending.filter((x) => x !== p); continue; }
        const author = m.authorId === 'me' ? (state.me.name || '我') : nameOf(m.authorId);
        const txt = await genComment(f, author, m.text, threadText(m));
        if (txt && !m.comments.some((c) => c.by === p.by && c.text === txt)) {
          m.comments = m.comments || [];
          m.comments.push({ id: uid('c'), by: p.by, text: txt, ts: Date.now() });
          changed = true;
        }
      } else if (p.kind === 'reply') {
        if (!canComment(m, p.by, true)) { state.pending = state.pending.filter((x) => x !== p); continue; }
        const txt = await genReply(f, state.me.name || '我', m.text, p.toComment || '', threadText(m));
        if (txt) {
          m.comments = m.comments || [];
          m.comments.push({ id: uid('c'), by: p.by, text: txt, ts: Date.now() });
          changed = true;
        }
      } else if (p.kind === 'dm') {
        const txt = await genDm(f, state.me.name || '我', m.text);
        if (txt) {
          f.messages.push({ id: uid('m'), role: 'peer', authorId: f.id, text: txt, ts: Date.now() });
          f.unread = (f.unread || 0) + 1;
          changed = true;
        }
      } else if (p.kind === 'groupchat') {
        if (isCloud()) { state.pending = state.pending.filter((x) => x !== p); continue; }
        const g = groupById(p.targetId);
        if (g) {
          const pool = g.members.map(friendById).filter(Boolean).sort(() => Math.random() - 0.5).slice(0, 2);
          const prev = [];
          for (const sp of pool) {
            const line = await genGroupLine(sp, nameOf(m.authorId), m.text, prev);
            if (!line) continue;
            g.messages.push({ id: uid('m'), role: 'peer', authorId: sp.id, text: line, ts: Date.now() });
            g.unread = (g.unread || 0) + 1;
            prev.push(`${sp.name}：${line}`);
            changed = true;
          }
        }
      }
    } catch (_) {}

    state.pending = state.pending.filter((x) => x !== p);
  }

  const social = state.social || (state.social = {});
  const interval = Number(state.settings.momentInterval) || 43200;   // 秒
  const hour = new Date().getHours();
  const nowSec2 = Date.now() / 1000;
  let nxt = Number(social.nextMomentAt) || 0;
  if (nxt > 1e12) nxt = nxt / 1000;          // 旧数据存的是毫秒
  if (nxt <= 0) {
    nxt = nowSec2 + interval * (0.8 + Math.random() * 0.7);
    social.nextMomentAt = nxt;
    changed = true;
  }
  if (!isCloud() && hour >= 8 && hour <= 23 && nowSec2 >= nxt && state.friends.length) {
    const author = state.friends[Math.floor(Math.random() * state.friends.length)];
    try {
      const text = cleanLine(await quickChat([
        { role: 'system', content: `${author.persona}\n\n现在要发一条朋友圈。要求：1~3 句，口语，像随手发的；不写配图说明，不加引号；不提“朋友圈”三个字；最多一个 emoji；只输出文字本身。` },
        { role: 'user', content: `现在是${timeOf(Date.now())}。` },
      ]), 120);
      if (text) {
        const m = { id: uid('mo'), authorId: author.id, text, ts: Date.now(), likes: [], comments: [] };
        state.moments.unshift(m);
        enqueueReactions(m);
        changed = true;
      }
    } catch (_) {}
    social.lastMomentAt = nowSec2;
    social.nextMomentAt = nowSec2 + interval * (0.8 + Math.random() * 0.7);
    changed = true;
  }

  if (changed) {
    persist();
    renderMoments();
    renderConversations();
  }
}

/* ---------------- 和服务端同步 ---------------- */

function mergeRemote(remote) {
  if (!remote || !Array.isArray(remote.friends)) return false;
  let changed = false;
  const mergeFields = (local, remoteObject, fields, dirty = {}) => {
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(dirty, field) || remoteObject[field] === undefined) continue;
      if (JSON.stringify(local[field]) !== JSON.stringify(remoteObject[field])) {
        local[field] = remoteObject[field]; changed = true;
      }
    }
  };
  mergeFields(state.settings, remote.settings || {}, Object.keys(DEFAULT_SETTINGS), pendingEdits.settings);

  if (Array.isArray(remote.deleted) && remote.deleted.length) {
    const merged = new Set([...(state.deleted || []), ...remote.deleted]);
    if (merged.size !== (state.deleted || []).length) changed = true;
    state.deleted = [...merged];
  }
  const dead = new Set(state.deleted || []);
  if (pruneDeleted(state)) changed = true;
  const mergeMsgs = (local, list, kind) => {
    const have = new Set(local.messages.map((m) => m.id));
    const byId = new Map(local.messages.map(m => [m.id, m]));
    for (const m of list || []) {
      if (dead.has(m.id)) continue;
      const existing = byId.get(m.id);
      if (kind === 'group' && existing && existing.ts !== m.ts) {
        existing.ts = m.ts; changed = true;
      }
      if (!have.has(m.id)) {
        local.messages.push(m);
        if (m.role !== 'user' && !isActive(kind, local.id)) local.unread = (local.unread || 0) + 1;
        changed = true;
      }
    }
    local.messages.sort((a, b) => a.ts - b.ts);
  };

  for (const rf of remote.friends) {
    if (dead.has(rf.id)) continue;
    const lf = friendById(rf.id);
    if (!lf) { state.friends.push(normalizeFriend(rf)); changed = true; continue; }
    mergeMsgs(lf, rf.messages, 'friend');
  }
  for (const rg of remote.groups || []) {
    if (dead.has(rg.id)) continue;
    const lg = groupById(rg.id);
    if (!lg) { state.groups.push(normalizeGroup(rg)); changed = true; continue; }
    mergeFields(lg, rg, GROUP_FIELDS, pendingEdits.groups[rg.id]);
    mergeMsgs(lg, rg.messages, 'group');
  }
  for (const rm of remote.moments || []) {
    if (dead.has(rm.id)) continue;
    const lm = state.moments.find((x) => x.id === rm.id);
    if (!lm) { state.moments.push(rm); changed = true; continue; }
    lm.likes = lm.likes || [];
    for (const x of rm.likes || []) if (!lm.likes.includes(x)) { lm.likes.push(x); changed = true; }
    lm.comments = lm.comments || [];
    const have = new Set(lm.comments.map((c) => c.id));
    for (const c of rm.comments || []) if (!have.has(c.id)) { lm.comments.push(c); changed = true; }
  }
  state.moments.sort((a, b) => b.ts - a.ts);
  // 新加入的会话也可能来自含有已删消息的旧快照。
  if (pruneDeleted(state)) changed = true;
  return changed;
}

let syncing = false;

async function syncTick() {
  if (!isCloud() || !TOKEN || syncing || Store.saving || saveTimer) return;
  syncing = true;
  const startedAt = localRevision;
  try {
    const r = await apiFetch('/api/rev');
    if (!r.ok) return;
    const info = await r.json();
    if (Number(info.rev) <= lastRev) return;
    const res = await apiFetch('/api/state');
    if (!res.ok) return;
    const remote = await res.json();
    if (localRevision !== startedAt || Store.saving || saveTimer) return;
    if (mergeRemote(remote)) {
      if (state.conv && !currentConv()) closeChat();
      const cur = $$('button', tabbar).find((b) => b.classList.contains('active'));
      const tab = cur ? cur.dataset.tab : 'msg';
      if (tab === 'moments') renderMoments();
      if (tab === 'msg') renderConversations();
      if (tab === 'contacts') renderContacts();
      if (pageChat.classList.contains('open') && currentConv()) {
        $('#peerName').textContent = currentConv().name;
        const r = rtOf(convKey(state.conv.kind, state.conv.id));
        if (r.phase === 'idle') { renderChat(); scrollBottom(true); }
      }
    }
    lastRev = Number(remote.rev);
  } catch (_) {
    // 拉取失败时保留旧版本号，下次轮询继续重试。
  } finally {
    syncing = false;
  }
}

/* ---------------- 登录 ---------------- */

function showLogin(msg) {
  $('#login').hidden = false;
  $('#lgServer').value = SERVER || '';
  $('#lgMsg').textContent = msg || '';
}

async function doAuth(kind) {
  const server = ($('#lgServer').value || '').trim().replace(/\/+$/, '');
  const name = ($('#lgName').value || '').trim();
  const pass = $('#lgPass').value || '';
  const say = (t) => { $('#lgMsg').textContent = t; };

  if (NATIVE && !server) return say('先填服务器地址');
  if (!name || !pass) return say('名字和密码都要填');
  if (kind === 'register' && pass.length < 6) return say('密码至少 6 位');

  say('请稍等…');
  SERVER = server;
  localStorage.setItem(SERVER_KEY, SERVER);

  try {
    const res = await fetch(SERVER + '/api/' + kind, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password: pass }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return say(j.error || ('HTTP ' + res.status));

    const local = localStorage.getItem('qingliao.state');
    if (local) {
      try {
        const imported = migrate(JSON.parse(local));
        await fetch(SERVER + '/api/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + j.token },
          body: JSON.stringify({ ...imported, _edits: importEdits(imported) }),
        });
      } catch (_) {}
    }

    localStorage.setItem(TOKEN_KEY, j.token);
    location.reload();
  } catch (e) {
    say('连不上：' + (e.message || e));
  }
}

$('#lgLogin').addEventListener('click', () => doAuth('login'));
$('#lgReg').addEventListener('click', () => doAuth('register'));
$('#lgPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth('login'); });

function logout() {
  if (!confirm('退出登录？')) return;
  localStorage.removeItem(TOKEN_KEY);
  location.reload();
}

if (!document.getElementById('btnSwitch')) {
  const sw = document.createElement('button');
  sw.className = 'menu-item';
  sw.id = 'btnSwitch';
  sw.innerHTML = '<span>切换账号</span><b>›</b>';
  const grp = document.getElementById('btnLogout').closest('.menu-group');
  grp.insertBefore(sw, document.getElementById('btnLogout'));
  sw.addEventListener('click', () => {
    if (!confirm('退出当前账号，换一个登录？')) return;
    localStorage.removeItem(TOKEN_KEY);
    location.reload();
  });
}

$('#btnLogout').addEventListener('click', () => {
  if (!isCloud()) return showLogin('填服务器地址，登录后数据就存在服务器上；再装 App 用同一个账号就能同步');
  logout();
});

/* ---------------- 群资料 ---------------- */

let groupInfoId = null;
let groupInfoBase = null;

function openGroupInfo(g) {
  groupInfoId = g.id;
  groupInfoBase = JSON.parse(JSON.stringify(g));
  $('#fGIName').value = g.name || '';
  $('#fGIPrompt').value = g.prompt || '';
  const box = $('#groupInfoMembers');
  box.textContent = '';
  for (const f of state.friends) {
    const label = document.createElement('label');
    label.className = 'rel';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.id = f.id;
    cb.checked = (g.members || []).includes(f.id);
    const span = document.createElement('span');
    span.className = 'rel-name';
    span.textContent = f.name;
    label.append(cb, span);
    box.append(label);
  }
  groupInfoSheet.classList.add('open');
  groupInfoSheet.setAttribute('aria-hidden', 'false');
}

function closeGroupInfo() {
  groupInfoSheet.classList.remove('open');
  groupInfoSheet.setAttribute('aria-hidden', 'true');
}

$('#btnGIClose').addEventListener('click', closeGroupInfo);

$('#btnGISave').addEventListener('click', () => {
  const g = groupById(groupInfoId);
  if (!g) return;
  const name = $('#fGIName').value.trim();
  const members = $$('#groupInfoMembers input:checked').map((cb) => cb.dataset.id);
  if (members.length < 2) return toast('至少留两个人');
  const patch = changedFields(groupInfoBase || g, {
    ...g, name: name || g.name, members, prompt: $('#fGIPrompt').value.trim(),
  }, GROUP_FIELDS);
  Object.assign(g, patch);
  pendingEdits.groups[g.id] = Object.assign(pendingEdits.groups[g.id] || {}, patch);
  persist();
  renderContacts();
  renderConversations();
  if (isActive('group', g.id)) $('#peerName').textContent = g.name;
  closeGroupInfo();
  toast('已保存');
});

$('#btnGIDelete').addEventListener('click', () => {
  const g = groupById(groupInfoId);
  if (!g) return;
  if (!confirm('删除「' + g.name + '」和群里的所有消息？')) return;
  rememberDeleted([g.id, ...g.messages.map((m) => m.id)]);
  state.groups = state.groups.filter((x) => x.id !== g.id);
  rt.delete(convKey('group', g.id));
  if (isActive('group', g.id)) closeChat();
  closeGroupInfo();
  renderContacts();
  renderConversations();
  persist();
  toast('已删除');
});

/* ---------------- 清空数据 ---------------- */

$('#btnWipe').addEventListener('click', () => {
  if (!confirm('删除所有数据？\n朋友、群、聊天记录、朋友圈全部清空，账号和设置保留。')) return;
  rememberDeleted([
    ...state.friends.flatMap((f) => [f.id, ...f.messages.map((m) => m.id)]),
    ...state.groups.flatMap((g) => [g.id, ...g.messages.map((m) => m.id)]),
    ...state.moments.map((m) => m.id),
    ...state.pending.map((p) => p.id),
  ]);
  state.friends = [];
  state.groups = [];
  state.moments = [];
  state.pending = [];
  state.drafts = {};
  state.social = {};
  closeChat();
  closeSheet();
  renderMe();
  renderConversations();
  renderContacts();
  renderMoments();
  persist();
  toast('已清空');
});

/* 桌面端滚轮兜底：光标停在非滚动区时，把滚动交给当前页的主滚动容器 */
function wheelFallback(e) {
  let el = e.target;
  let scroller = null;
  while (el && el !== document.body) {
    const st = getComputedStyle(el);
    if ((st.overflowY === 'auto' || st.overflowY === 'scroll')
        && el.scrollHeight > el.clientHeight + 1) { scroller = el; break; }
    el = el.parentElement;
  }
  if (!scroller) {
    if (pageChat.classList.contains('open')) scroller = chatEl;
    else {
      const page = [...document.querySelectorAll('.page')].find((p) => !p.hidden);
      scroller = page ? page.querySelector('.scroll') : null;
    }
  }
  if (!scroller) return;
  const before = scroller.scrollTop;
  requestAnimationFrame(() => {
    if (scroller.scrollTop === before && Math.abs(e.deltaY) > 0) {
      scroller.scrollTop = before + e.deltaY;
    }
  });
}

function showQuoteBar() {
  let bar = document.getElementById('quoteBar');
  if (!quoteFor) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'quoteBar';
    const span = document.createElement('span');
    span.id = 'quoteText';
    const x = document.createElement('button');
    x.textContent = '×';
    x.addEventListener('click', () => { quoteFor = null; showQuoteBar(); });
    bar.append(span, x);
    inputEl.closest('.composer').parentNode.insertBefore(bar, inputEl.closest('.composer'));
  }
  document.getElementById('quoteText').textContent = '引用 ' + quoteFor.author + '：' + quoteFor.text;
}

/* ---------------- 搜索聊天记录 ---------------- */

let searching = false;
let searchQuery = '';

(function initSearch() {
  const box = document.createElement('input');
  box.id = 'searchBox';
  box.placeholder = '搜索聊天记录';
  box.autocomplete = 'off';
  const page = document.getElementById('pageMsg');
  const list = document.getElementById('convList');
  page.insertBefore(box, list);

  box.addEventListener('input', () => {
    searchQuery = box.value.trim();
    searching = !!searchQuery;
    renderConversations();
  });
})();

function renderSearchResults() {
  convList.textContent = '';
  const q = searchQuery.toLowerCase();
  const hits = [];
  const scan = (conv, kind) => {
    for (const m of conv.messages || []) {
      if (!m.text) continue;
      if (m.text.toLowerCase().includes(q)) {
        hits.push({ conv, kind, m });
      }
    }
  };
  for (const f of state.friends) scan(f, 'friend');
  for (const g of state.groups) scan(g, 'group');
  hits.sort((a, b) => b.m.ts - a.m.ts);

  if (!hits.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '没找到「' + searchQuery + '」';
    convList.append(empty);
    return;
  }
  for (const h of hits.slice(0, 60)) {
    const row = document.createElement('button');
    row.className = 'conv';
    row.append(avatarEl(h.conv));
    const mid = document.createElement('div');
    mid.className = 'conv-mid';
    const nm = document.createElement('div');
    nm.className = 'conv-name';
    nm.textContent = h.conv.name;
    const pv = document.createElement('div');
    pv.className = 'conv-preview';
    pv.textContent = (h.m.role === 'user' ? '我：' : '') + h.m.text.slice(0, 60);
    mid.append(nm, pv);
    row.append(mid);
    row.addEventListener('click', () => {
      searching = false;
      searchQuery = '';
      const box = document.getElementById('searchBox');
      if (box) box.value = '';
      openChat(h.kind, h.conv.id);
    });
    convList.append(row);
  }
}

document.addEventListener('click', function askNotify() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
  document.removeEventListener('click', askNotify);
}, { once: false });

/* ---------------- 启动 ---------------- */

let clockTimer = null;
function startClock() {
  clearInterval(clockTimer);
  const tick = () => { $('#clock').textContent = timeOf(Date.now()); };
  tick();
  clockTimer = setInterval(tick, 20000);
}

function normalizeFriend(raw) {
  const f = makeFriend({
    id: raw && raw.id,
    name: raw && raw.name,
    avatar: raw && raw.avatar,
    persona: raw && raw.persona,
    messages: raw && raw.messages,
    relations: raw && raw.relations,
  });
  f.unread = Number(raw && raw.unread) || 0;
  f.dmMoment = !(raw && raw.dmMoment === false);
  f.createdAt = Number(raw && raw.createdAt) || Date.now();
  f.messages = (f.messages || []).map((m) => ({
    id: m.id || uid('m'),
    role: m.role === 'user' ? 'user' : 'peer',
    authorId: m.authorId || (m.role === 'user' ? undefined : f.id),
    text: m.text || '',
    image: m.image || '',
    ts: m.ts || Date.now(),
  }));
  return f;
}

function normalizeGroup(raw) {
  const g = makeGroup({
    ...raw,
    id: raw && raw.id,
    name: raw && raw.name,
    members: raw && raw.members,
    messages: raw && raw.messages,
    createdAt: raw && raw.createdAt,
  });
  g.unread = Number(raw && raw.unread) || 0;
  g.messages = (g.messages || []).map((m) => ({
    ...m,
    id: m.id || uid('m'),
    role: m.role === 'user' ? 'user' : 'peer',
    authorId: m.authorId,
    text: m.text || '',
    image: m.image || '',
    ts: m.ts || Date.now(),
  }));
  return g;
}

function migrate(raw) {
  const s = defaultState();
  if (!raw) return s;
  if (raw.me) { s.me.name = raw.me.name || s.me.name; s.me.avatar = raw.me.avatar || ''; }

  if (raw.settings) {
    for (const k of Object.keys(s.settings)) {
      if (raw.settings[k] !== undefined && raw.settings[k] !== null) s.settings[k] = raw.settings[k];
    }
    if (raw.settings.myName) s.me.name = raw.settings.myName;
    if (raw.settings.myAvatar) s.me.avatar = raw.settings.myAvatar;
    if (raw.settings.split === false) s.settings.bursts = 1;
  }

  if (Array.isArray(raw.friends) && raw.friends.length) {
    s.friends = raw.friends.map(normalizeFriend);
  } else if (raw.settings && (raw.settings.peerName || (raw.messages && raw.messages.length))) {
    s.friends = [normalizeFriend({
      name: raw.settings.peerName || '林小满',
      avatar: raw.settings.peerAvatar || '',
      persona: raw.settings.systemPrompt || DEFAULT_PERSONA,
      messages: raw.messages || [],
    })];
  }

  if (Array.isArray(raw.groups)) s.groups = raw.groups.map(normalizeGroup);
  if (Array.isArray(raw.moments)) s.moments = raw.moments;
  if (Array.isArray(raw.pending)) s.pending = raw.pending;
  if (Array.isArray(raw.deleted)) s.deleted = raw.deleted;
  if (raw.social) s.social = raw.social;
  if (raw.drafts) s.drafts = raw.drafts;

  s.conv = null;
  pruneDeleted(s);
  return s;
}

async function init() {
  let raw = null;

  if (isCloud()) {
    if (!TOKEN) {
      showLogin('第一次用？填个名字和密码，点「注册新账号」');
      return;
    }
    try {
      const res = await apiFetch('/api/state');
      if (res.status === 401) { showLogin('登录过期了，重新登录一下'); return; }
      if (!res.ok) throw new Error('服务器无法读取聊天数据，请稍后重试');
      raw = await res.json();
      lastRev = Number(raw.rev) || 0;
    } catch (e) {
      showLogin('连不上服务器：' + (e.message || e));
      return;
    }
  } else {
    raw = await Store.load();
  }

  state = migrate(raw);

  if (!raw && !state.friends.length) {
    state.friends.push(makeFriend({
      name: '林小满',
      messages: [
        { id: uid('m'), role: 'peer', text: '在吗？', ts: Date.now() - 60000 },
        { id: uid('m'), role: 'peer', text: '刚看到你头像亮了 👀', ts: Date.now() - 55000 },
      ],
    }));
  }

  applyTheme();
  renderMe();
  renderConversations();
  renderContacts();
  renderMoments();
  switchTab('msg');
  startClock();
  updateSendBtn();

  setInterval(proactiveTick, 30000);
  setInterval(syncTick, 4000);
  setInterval(clientSocialTick, 30000);

  document.documentElement.classList.toggle('native', NATIVE);
  if (!isCloud()) {
    $('#btnLogout').querySelector('span').textContent = '登录账号（多端同步）';
  } else if (TOKEN) {
    apiFetch('/api/me').then((r) => r.json()).then((j) => {
      if (j && j.name) $('#btnLogout').querySelector('span').textContent = '退出登录（' + j.name + '）';
    }).catch(() => {});
  }

  if (!state.settings.apiKey) openSheet();

  const q = new URLSearchParams(location.search);
  if (q.has('sheet')) openSheet();
  if (q.has('tick')) setTimeout(() => clientSocialTick(true), 800);
  if (q.has('moments')) switchTab('moments');
  if (q.has('newmoment')) openMomentSheet();
  if (q.has('newgroup')) openGroupSheet();
  if (q.has('chat')) { const f = state.friends[0]; if (f) openChat('friend', f.id); }
  if (q.has('group') && state.groups[0]) openChat('group', state.groups[0].id);
}

document.addEventListener('wheel', wheelFallback, { passive: true });
init();
