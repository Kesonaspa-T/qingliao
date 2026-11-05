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
// localStorage 被系统清过（安卓常见）→ 从原生会话文件里补回登录态
try {
  const native = (typeof NativeSession !== 'undefined') ? NativeSession.readMap() : {};
  if (!TOKEN && native.token) { TOKEN = String(native.token); localStorage.setItem(TOKEN_KEY, TOKEN); }
  if (!SERVER && native.server) { SERVER = String(native.server).replace(/\/+$/, ''); localStorage.setItem(SERVER_KEY, SERVER); }
  ['ql.lastName', 'ql.lastPass', 'ql.lastServer', 'ql.local'].forEach((k) => {
    if (!localStorage.getItem(k) && native[k]) localStorage.setItem(k, native[k]);
  });
} catch (_) {}
let lastRev = -1;

let LOCAL_MODE = localStorage.getItem('ql.local') === '1';
const IN_APP = /Android/i.test(navigator.userAgent);
/** 安卓壳的原生会话存储：WebView 把 localStorage 清掉时，登录态还能从文件里读回来。 */
const NativeSession = {
  bridge() {
    try {
      const b = window.QingliaoSession;
      return b && typeof b.read === 'function' ? b : null;
    } catch (_) { return null; }
  },
  readMap() {
    const b = this.bridge();
    if (!b) return {};
    try { return JSON.parse(b.read() || '{}') || {}; } catch (_) { return {}; }
  },
  remember(key, val) {
    const b = this.bridge();
    if (!b) return;
    try {
      const m = this.readMap();
      if (val === undefined || val === null || val === '') delete m[key];
      else m[key] = String(val);
      b.write(JSON.stringify(m));
    } catch (_) {}
  },
};

const IS_LOCAL_SERVER = location.hostname === '127.0.0.1';
/** 服务器和当前页面是不是同一个源（本机模式才走 /__proxy）。 */
function isSameOriginAsServer() {
  const base = (SERVER || '').replace(/\/+$/, '').toLowerCase();
  if (!/^https?:\/\//.test(base)) return false;
  try { return new URL(base).origin.toLowerCase() === location.origin.toLowerCase(); }
  catch (_) { return false; }
}
function isCloud() { return LOCAL_MODE ? false : (IN_APP ? !!SERVER : true); }

// 单个接口的默认超时（毫秒）。没有上限的话，一个卡住的请求就能让同步永久停摆。
const API_TIMEOUT = 25000;

function apiFetch(path, opts) {
  const o = Object.assign({}, opts || {});
  const headers = Object.assign({}, o.headers || {});
  headers['X-Qingliao-Build'] = APP_BUILD;
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  const target = SERVER + path;

  // 默认给每个请求一个上限：卡住的请求会永远吊着 await，把同步循环彻底堵死
  // （表现就是「只有重启才更新」）。timeout=0 表示不限时（流式对话）。
  const budget = o.timeout === undefined ? API_TIMEOUT : Number(o.timeout) || 0;
  delete o.timeout;
  if (budget > 0 && typeof AbortController === 'function') {
    const ctrl = new AbortController();
    const outer = o.signal;
    if (outer) {
      if (outer.aborted) ctrl.abort();
      else if (outer.addEventListener) {
        outer.addEventListener('abort', () => { try { ctrl.abort(); } catch (_) {} }, { once: true });
      }
    }
    o.signal = ctrl.signal;
    setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, budget);
  }

  // 本机模式（页面和服务器都是 127.0.0.1）才走 /__proxy；页面只是恰好开在
  // 127.0.0.1（比如 Mac 上用本地调试），服务器却在别的机器上时必须直连。
  if (IS_LOCAL_SERVER && isSameOriginAsServer()) {
    const method = (o.method || 'GET').toUpperCase();
    const ph = Object.assign({}, headers, {
      'Content-Type': 'application/json',
      'X-Target-Url': target,
      'X-Method': method,
    });
    return fetch('/__proxy', {
      method: 'POST',
      headers: ph,
      body: method === 'GET' ? '{}' : (o.body || '{}'),
      signal: o.signal,
    });
  }

  return fetch(target, Object.assign({}, o, { headers }));
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
  doodle: true,
  stickerChance: 25,
  stickerTriggers: '',
  // 她会发照片（AI 生图，走 OpenAI 兼容的 /v1/images/generations）
  imageOn: false,
  imageBaseUrl: '',
  imageApiKey: '',
  imageModel: 'gpt-image-2',
  imageSize: '1024x1024',
  imageQuality: '',
  imageStyle: '',
  // 什么时候该发照片（她自己判断）；每个角色可以在资料里写自己的一份
  imagePrompt: '什么时候发照片：\n'
    + '- 他说「拍张照」「自拍」「看看你」「发张照片」「你在干嘛」这类想看你样子的句子 → 发一张照片\n'
    + '- 他说「画个」「画一张」「涂鸦」这类要你画画的句子 → 不发照片（那是画图）\n'
    + '拍什么：接得上你刚说的话，拍此刻真实的场景；光线自然，穿着和平时一样',
  imageChance: 15,
  imageTriggers: '',
  prompts: {},
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
  skin: 'default',
  // 「她会活过来」：三个独立开关 + 概率
  recallOn: true, recallChance: 20,
  rewordOn: true, rewordChance: 10,
  lateOn: false, lateChance: 5, lateMaxMin: 5,
  // 免打扰时段（只挡她自己冒出来的消息）
  quietOn: true,
  quietStart: 23,
  quietEnd: 8,
  // 她的日记 / 她自己的生活事件 / 小作文（%/天，朋友可覆盖）
  diaryOn: true,
  lifeOn: true,
  essayChance: 15,
  // 0 = 不归档
  archiveDays: 0,
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
    stickers: [],
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
    // 她记得的事 / 必须记住 / 纪念日 / 提醒 / 已读
    memoryNotes: Array.isArray(o.memoryNotes) ? o.memoryNotes : [],
    memoryOff: !!o.memoryOff,
    anniversaries: Array.isArray(o.anniversaries) ? o.anniversaries : [],
    reminders: Array.isArray(o.reminders) ? o.reminders : [],
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
    muted: !!o.muted,
    unread: 0,
    createdAt: o.createdAt || Date.now(),
  };
}

let state = defaultState();
let pendingEdits = { settings: {}, groups: {}, friends: {} };
const GROUP_FIELDS = ['name', 'avatar', 'members', 'prompt', 'muted'];
const FRIEND_FIELDS = ['name', 'avatar', 'persona', 'relations', 'dmMoment',
  'note', 'region', 'signature', 'personaChangedAt',
  'unread', 'readAt',
  'memory', 'memoryNotes', 'memoryOff', 'anniversaries', 'reminders', 'peerReadAt', 'lateReplyAt',
  'diary', 'diaryAt', 'events', 'lastLifeAt', 'nextLifeAt', 'lastAnnivKey',
  'archivedBefore', 'archivedCount'];

function changedFields(before, after, fields) {
  const patch = {};
  for (const key of fields) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) patch[key] = after[key];
  }
  return patch;
}

function importEdits(s) {
  return { settings: { ...s.settings }, importHistory: uid('import'),
    groups: Object.fromEntries(s.groups.map(g => [g.id, Object.fromEntries(GROUP_FIELDS.map(k => [k, g[k]]))])),
    friends: Object.fromEntries(s.friends.map(f => [f.id, {
      ...Object.fromEntries(FRIEND_FIELDS.map(k => [k, f[k]])),
      settings: { ...(f.settings || {}) },
    }])) };
}

/** 把一组「用户刚改的字段」记进待同步编辑，等保存成功后再清掉。 */
function rememberFriendEdit(f, patch) {
  if (!f || !patch || !Object.keys(patch).length) return;
  const cur = pendingEdits.friends[f.id] || (pendingEdits.friends[f.id] = {});
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'settings') {
      cur.settings = Object.assign(cur.settings || {}, value);
    } else {
      cur[key] = value;
    }
  }
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

/** 红包金额显示：整数不带小数点，小数留两位 */
function moneyText(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '0';
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
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

function setStatus(t) {
  // 空闲时标题下面显示她的个性签名（有签名就顶掉「在线」）
  let text = t;
  if (t === '在线') {
    const conv = currentConv && currentConv();
    if (conv && conv.signature) text = conv.signature;
  }
  statusEl.textContent = text;
  statusEl.classList.toggle('is-sign', text !== t);
}

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


/* ---------------- 本地存储：App 文件 / IndexedDB / localStorage ----------------
 *
 * 单机模式以前把整份状态（含图片、表情包）塞进 localStorage，5MB 就满。
 * 现在按优先级：
 *   1) Android 壳的 QingliaoStore（原生文件，没有 5MB 限制）
 *   2) IndexedDB（mac 本机模式 http://127.0.0.1，浏览器）
 *   3) localStorage（最后的兜底：老设备 / file:// 下 IndexedDB 不可用）
 * 老数据会自动迁移到新位置，成功后再删 localStorage 的副本。
 */
const NativeStore = {
  bridge() {
    try {
      const b = window.QingliaoStore;
      return b && typeof b.readState === 'function' ? b : null;
    } catch (_) { return null; }
  },
  read() {
    const b = this.bridge();
    if (!b) return '';
    try { return String(b.readState() || ''); } catch (_) { return ''; }
  },
  write(raw) {
    const b = this.bridge();
    if (!b) return false;
    try { return !!b.writeState(raw); } catch (_) { return false; }
  },
  size() {
    const b = this.bridge();
    if (!b) return -1;
    try { return Number(b.storageInfo()) || 0; } catch (_) { return -1; }
  },
};

const IdbStore = (() => {
  const NAME = 'qingliao-local';
  const STORE = 'kv';
  let dbPromise = null;
  let usable = null;
  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(NAME, 1); } catch (e) { reject(e); return; }
      const timer = setTimeout(() => reject(new Error('idb timeout')), 2500);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => { clearTimeout(timer); resolve(req.result); };
      req.onerror = () => { clearTimeout(timer); reject(req.error || new Error('idb error')); };
      req.onblocked = () => { clearTimeout(timer); reject(new Error('idb blocked')); };
    });
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
  }
  async function get(key) {
    const db = await open();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function set(key, val) {
    const db = await open();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('idb abort'));
    });
  }
  async function available() {
    if (usable !== null) return usable;
    // 上一次已经确认不可用（file:// 下 IndexedDB 会一直挂）：别每次启动再等 2.5 秒
    try { if (localStorage.getItem('ql.idb') === '0') { usable = false; return false; } } catch (_) {}
    try {
      await get('__probe__');
      usable = true;
    } catch (_) {
      usable = false;
      try { localStorage.setItem('ql.idb', '0'); } catch (_) {}
    }
    return usable;
  }
  return { get, set, available };
})();

const LocalState = {
  mode: null,
  async init() {
    if (this.mode) return this.mode;
    if (NativeStore.bridge()) this.mode = 'native';
    else if (await IdbStore.available()) this.mode = 'idb';
    else this.mode = 'ls';
    return this.mode;
  },
  legacy() {
    try { return localStorage.getItem('qingliao.state') || ''; } catch (_) { return ''; }
  },
  async loadRaw() {
    const mode = await this.init();
    if (mode === 'native') {
      const raw = NativeStore.read();
      if (raw) return raw;
      const old = this.legacy();
      if (old) {
        // 写完再读回来比对，确认没写残才删 localStorage 的旧副本
        if (NativeStore.write(old) && NativeStore.read() === old) {
          try { localStorage.removeItem('qingliao.state'); } catch (_) {}
        }
        return old;
      }
      return '';
    }
    if (mode === 'idb') {
      let raw = null;
      try { raw = await IdbStore.get('state'); } catch (_) {}
      if (raw) return String(raw);
      const old = this.legacy();
      if (old) {
        try {
          await IdbStore.set('state', old);
          if (String(await IdbStore.get('state')) === old) {
            try { localStorage.removeItem('qingliao.state'); } catch (_) {}
          }
        } catch (_) {}
        return old;
      }
      return '';
    }
    return this.legacy();
  },
  async saveRaw(raw) {
    const mode = await this.init();
    if (mode === 'native') {
      if (NativeStore.write(raw)) {
        try { localStorage.removeItem('qingliao.state'); } catch (_) {}
        return true;
      }
      try { localStorage.setItem('qingliao.state', raw); return true; } catch (_) { return false; }
    }
    if (mode === 'idb') {
      try {
        await IdbStore.set('state', raw);
        try { localStorage.removeItem('qingliao.state'); } catch (_) {}
        return true;
      } catch (_) {
        try { localStorage.setItem('qingliao.state', raw); return true; } catch (_) { return false; }
      }
    }
    try { localStorage.setItem('qingliao.state', raw); return true; } catch (_) { return false; }
  },
  async size() {
    const mode = await this.init();
    if (mode === 'native') return NativeStore.size();
    if (mode === 'idb') {
      try { const raw = await IdbStore.get('state'); return raw ? String(raw).length : 0; } catch (_) { return 0; }
    }
    return this.legacy().length;
  },
};

/* ---------------- 存储 ---------------- */

const Store = {
  async load() {
    if (!isCloud()) {
      try {
        const raw = await LocalState.loadRaw();
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
      const raw = JSON.stringify(s);
      const ok = await LocalState.saveRaw(raw);
      if (!ok) reportStorageFull();
      return;
    }
    if (Store.saving) { Store.again = true; return; }
    Store.saving = true;
    const edits = JSON.parse(JSON.stringify(pendingEdits));
    const hint = saveHint;
    saveHint = '';
    let failed = false;
    try {
      const res = await apiFetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...s, _edits: edits, _diag: syncDiagSnapshot(),
          _hint: hint || undefined,
        }),
        timeout: 90000,      // 整份状态可能有一两兆，慢网下别被默认超时打断
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
      for (const [id, patch] of Object.entries(edits.friends || {})) {
        const pending = pendingEdits.friends[id];
        if (!pending) continue;
        clear(pending.settings || (pending.settings = {}), patch.settings || {});
        clear(pending, Object.fromEntries(Object.entries(patch).filter(([k]) => k !== 'settings')));
        if (pending.settings && !Object.keys(pending.settings).length) delete pending.settings;
        if (!Object.keys(pending).length) delete pendingEdits.friends[id];
      }
      if (edits.importHistory && pendingEdits.importHistory === edits.importHistory) delete pendingEdits.importHistory;
    } catch (_) {
      failed = true;
      if (hint) saveHint = saveHint || hint;   // 保存没成功，提示留给下一次
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
let saveHint = '';          // 下次保存顺带给服务端的一个提示（例如「我刚在群里发言」）
function rememberDeleted(ids) {
  // 单机模式没有多端同步，墓碑只会白占空间（清一次聊天就是几百个 id）
  if (!isCloud()) return;
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
  if (Array.isArray(s.stickers)) s.stickers = filter(s.stickers, (x) => !dead.has(x.id));
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
  document.documentElement.setAttribute('data-skin', state.settings.skin || 'default');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#17181b' : '#f7f8fa');
  if (NATIVE && window.AndroidChat.setBars) {
    try { window.AndroidChat.setBars(dark); } catch (_) {}
  }
}

darkMedia.addEventListener('change', () => {
  if ((state.settings.theme || 'auto') === 'auto') applyTheme();
});


/** 图片地址：新格式是 @blob:<文件>，走服务器；老数据还是 data: 直接内联。 */
const SKIN_IDS = ['default', 'sakura', 'forest', 'ocean', 'paper',
  'grape', 'peach', 'teal', 'moon'];

function renderSkinChips() {
  const cur = state.settings.skin || 'default';
  $$('#skinChips .chip').forEach((c) => c.classList.toggle('active', c.dataset.skin === cur));
}

/**
 * 每个会话的自定义聊天背景：只存本机（IndexedDB / localStorage），
 * 永远不进 state、不上传服务器——换手机、重装都不会带过去。
 */
const ChatBg = {
  cache: new Map(),
  key(kind, id) { return 'bg:' + kind + ':' + id; },
  async get(kind, id) {
    const k = this.key(kind, id);
    if (this.cache.has(k)) return this.cache.get(k);
    let v = '';
    try {
      if (await IdbStore.available()) v = String((await IdbStore.get(k)) || '');
    } catch (_) { v = ''; }
    if (!v) { try { v = localStorage.getItem('ql.' + k) || ''; } catch (_) {} }
    this.cache.set(k, v);
    return v;
  },
  async set(kind, id, dataUrl) {
    const k = this.key(kind, id);
    const v = String(dataUrl || '');
    const writeLs = (val) => {
      try {
        if (val) localStorage.setItem('ql.' + k, val); else localStorage.removeItem('ql.' + k);
        return true;
      } catch (_) { return false; }
    };
    this.cache.set(k, v);
    if (!v) {
      try { if (await IdbStore.available()) await IdbStore.set(k, ''); } catch (_) {}
      writeLs('');
      return;
    }
    try {
      if (await IdbStore.available()) { await IdbStore.set(k, v); return; }
    } catch (_) {}
    if (writeLs(v)) return;
    // 只有 localStorage（大约 5MB）又放不下：压一版再存，别让人以为没设上
    let small = v;
    for (const max of [2048, 1600, 1200]) {
      small = await shrinkPhoto(v, max, 0.9);
      if (small !== v && writeLs(small)) { this.cache.set(k, small); return; }
    }
    this.cache.delete(k);
    throw new Error('这张背景太大，这台设备存不下');
  },
};

/** 把当前会话的背景铺到聊天区（没有就还原） */
async function applyChatBg() {
  const conv = currentConv();
  if (!conv || !chatEl || !state.conv) return;
  const kind = state.conv.kind;
  const bg = await ChatBg.get(kind, conv.id);
  if (!state.conv || state.conv.kind !== kind || state.conv.id !== conv.id) return;
  if (bg) {
    // 只放 url：把 linear-gradient 和几 MB 的 url 拼在一个值里，浏览器会整条丢掉
    chatEl.style.backgroundImage = 'url("' + bg + '")';
    chatEl.style.backgroundSize = 'cover';
    chatEl.style.backgroundPosition = 'center';
    chatEl.classList.add('has-bg');
  } else {
    chatEl.style.backgroundImage = '';
    chatEl.style.backgroundSize = '';
    chatEl.style.backgroundPosition = '';
    chatEl.classList.remove('has-bg');
  }
}

let bgTarget = null;

async function renderBgSheet() {
  const box = document.getElementById('bgPreview');
  if (!box || !bgTarget) return;
  const bg = await ChatBg.get(bgTarget.kind, bgTarget.id);
  box.style.backgroundImage = bg ? 'url("' + bg + '")' : '';
  const t = document.getElementById('bgSheetTitle');
  if (t) t.textContent = (bgTarget.name || '聊天') + ' 的背景';
  const clr = document.getElementById('btnBgClear');
  if (clr) clr.disabled = !bg;
}

function openBgSheet(kind, id, name) {
  bgTarget = { kind, id, name: name || '聊天' };
  const el = ensureSheet('bgSheet', `
    <header class="sheet-nav">
      <button class="text-btn" data-close="bgSheet">关闭</button>
      <span class="sheet-title">聊天背景</span>
      <span></span>
    </header>
    <div class="sheet-body">
      <div class="group">
        <div class="group-title" id="bgSheetTitle">聊天背景</div>
        <div class="bg-preview" id="bgPreview"></div>
        <div class="row-btns">
          <button type="button" class="ghost solid" id="btnBgPick">从相册选一张</button>
          <button type="button" class="ghost danger-text" id="btnBgClear">清除背景</button>
        </div>
        <p class="hint">只存在这台设备（本地存储），不上传服务器，换手机或重装不会带过去。原图原样存、<b>不压画质</b>；只有设备只能用 5MB 本地存储、图实在放不下时，才会自动压到 2048 保证能存下来。</p>
      </div>
    </div>`);
  if (!el.dataset.bound) {
    el.dataset.bound = '1';
    el.addEventListener('click', async (e) => {
      const close = e.target.closest('[data-close]');
      if (close) {
        el.classList.remove('open');
        el.setAttribute('aria-hidden', 'true');
        return;
      }
      if (!bgTarget) return;
      if (e.target.id === 'btnBgPick') {
        const dataUrl = await pickOriginalImage();
        if (!dataUrl) return;
        try {
          await ChatBg.set(bgTarget.kind, bgTarget.id, dataUrl);
        } catch (err) {
          toast((err && err.message) || '背景没存下来');
          return;
        }
        renderBgSheet();
        applyChatBg();
        toast('背景换好了（只存本机）');
      } else if (e.target.id === 'btnBgClear') {
        await ChatBg.set(bgTarget.kind, bgTarget.id, '');
        renderBgSheet();
        applyChatBg();
        toast('背景清掉了');
      }
    });
  }
  renderBgSheet();
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
}

function imgSrc(ref) {
  if (!ref) return '';
  if (ref.startsWith('@blob:')) {
    // 单机模式没有服务器可取图，只能给个空图（老数据里不该有这种引用）
    if (!isCloud()) return '';
    // <img> 带不了 Authorization 头，token 走查询参数
    const name = encodeURIComponent(ref.slice(6));
    const q = TOKEN ? ('?t=' + encodeURIComponent(TOKEN)) : '';
    return SERVER + '/api/blob/' + name + q;
  }
  return ref;
}

function avatarEl(who, cls) {
  const el = document.createElement('div');
  el.className = 'avatar' + (cls ? ' ' + cls : '');
  // 群聊：像微信一样把成员头像拼成九宫格（最多 4 个）；单聊还是原来那张
  if (who && Array.isArray(who.members)) {
    const ids = who.members.filter((id) => friendById(id)).slice(0, 4);
    el.classList.add('group-avatar', 'n' + Math.max(1, ids.length));
    if (!ids.length) { el.textContent = initialOf(who.name); return el; }
    for (const id of ids) {
      const f = friendById(id);
      const cell = document.createElement('i');
      if (f && f.avatar) {
        const im = document.createElement('img');
        im.src = imgSrc(f.avatar);
        im.alt = '';
        cell.append(im);
      } else {
        cell.textContent = initialOf((f && f.name) || '?');
      }
      el.append(cell);
    }
    return el;
  }
  const url = who && who.avatar;
  if (url) {
    const img = document.createElement('img');
    img.src = imgSrc(url); img.alt = '';
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
    img.src = imgSrc(url); img.alt = '';
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

/** 把已有 data URL 缩小成 max 边长、JPEG 质量 quality；本来就是小图就原样返回。 */
function resizeDataUrl(dataUrl, max, quality) {
  return new Promise((resolve) => {
    if (!dataUrl || !/^data:image\//i.test(dataUrl)) return resolve(dataUrl || '');
    const img = new Image();
    img.onload = () => {
      const w = img.width || 1;
      const h = img.height || 1;
      const scale = Math.min(1, max / Math.max(w, h));
      if (scale >= 0.999) return resolve(dataUrl);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * scale));
      c.height = Math.max(1, Math.round(h * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      try { resolve(c.toDataURL('image/jpeg', quality)); } catch (_) { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
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

/**
 * 选一张图，原样读进来——不重压、不缩尺寸。
 * 聊天背景只存本机（IndexedDB），不需要为同步省体积，画质优先。
 */
function pickOriginalImage() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return resolve(null);
      const raw = await new Promise((r) => {
        const fr = new FileReader();
        fr.onload = () => r(String(fr.result || ''));
        fr.onerror = () => r('');
        fr.readAsDataURL(file);
      });
      if (!raw) return resolve(null);
      // 浏览器画不出来的格式（HEIC 之类）再退回 canvas 转一次，别让背景裂掉
      const ok = await new Promise((r) => {
        const im = new Image();
        im.onload = () => r(true);
        im.onerror = () => r(false);
        im.src = raw;
      });
      if (ok) return resolve(raw);
      const fixed = await imageToDataUrl(file, 4096, 0.95).catch(() => null);
      resolve(fixed || null);
    };
    input.click();
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
  if (last.money) return prefix + '[红包] ¥' + moneyText(last.money.amount);
  if (last.image) return prefix + '[图片]';
  if (last.file && last.file.name) return prefix + '[文件] ' + last.file.name;
  if (kind === 'group') {
    return (last.role === 'user' ? '我：' : nameOf(last.authorId) + '：') + plainText(last.text || '');
  }
  return prefix + plainText(last.text || '');
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

    // 群聊头像：成员头像拼起来（和微信一样），单聊用她自己的头像
    row.append(avatarEl(data));

    const main = document.createElement('div');
    main.className = 'conv-main';

    const top = document.createElement('div');
    top.className = 'conv-top';
    const name = document.createElement('div');
    name.className = 'conv-name';
    name.textContent = data.note || data.name;
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

    if (kind === 'group' && data.muted) {
      // 免打扰：不冒红点，只留一个小标记
      const mute = document.createElement('span');
      mute.className = 'conv-muted';
      mute.title = '消息免打扰';
      mute.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 8.5a6 6 0 0 1 12 0c0 4 1.4 5.4 1.4 5.4H4.6S6 12.5 6 8.5z"/><path d="M9.8 17.6a2.4 2.4 0 0 0 4.4 0"/><path d="M4 4l16 16"/></svg>';
      bottom.append(mute);
    } else if (data.unread > 0) {
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
      row.append(avatarEl(g));
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
    for (const f of [...state.friends].sort((a, b) => (a.note || a.name).localeCompare(b.note || b.name, 'zh'))) {
      const row = document.createElement('div');
      row.className = 'conv';
      const cav = avatarEl(f);
      cav.classList.add('tappable');
      cav.addEventListener('click', (e) => { e.stopPropagation(); openProfile(f.id); });
      row.append(cav);
      const main = document.createElement('div');
      main.className = 'conv-main';
      const top = document.createElement('div');
      top.className = 'conv-top';
      const name = document.createElement('div');
      name.className = 'conv-name';
      name.textContent = f.note || f.name;
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
  const unreadChats = [...state.friends, ...state.groups]
    .reduce((n, c) => n + ((c.muted ? 0 : (c.unread || 0))), 0);
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
  updateDockBadge(unreadChats);
}

/** mac 壳：Dock 角标（网页没有这个能力，走原生桥） */
function updateDockBadge(n) {
  const b = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.badge;
  if (!b) return;
  try { b.postMessage(Number(n) || 0); } catch (_) {}
}

/* ---------------- 朋友圈 ---------------- */

function momentAuthor(m) {
  return m.authorId === 'me' ? state.me : (friendById(m.authorId) || { name: '某人', avatar: '' });
}

let momentFilter = null;   // 只看某个人的朋友圈

function renderMoments() {
  momentList.textContent = '';
  if (momentFilter) {
    const who = friendById(momentFilter);
    if (!who) momentFilter = null;
    else {
      const bar = document.createElement('div');
      bar.className = 'filter-bar';
      const txt = document.createElement('span');
      txt.textContent = '只看 ' + (who.note || who.name);
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'text-btn';
      clear.textContent = '显示全部';
      clear.addEventListener('click', () => { momentFilter = null; renderMoments(); });
      bar.append(txt, clear);
      momentList.append(bar);
    }
  }
  const feed = momentFilter ? state.moments.filter((m) => m.authorId === momentFilter) : state.moments;
  if (!feed.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '朋友圈还空着。\n自己发一条，或者等她们发。';
    empty.style.whiteSpace = 'pre-line';
    momentList.append(empty);
    return;
  }

  for (const m of feed) {
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

    const pics = Array.isArray(m.images) && m.images.length ? m.images : (m.image ? [m.image] : []);
    if (pics.length > 1) {
      const grid = document.createElement('div');
      grid.className = 'moment-grid' + (pics.length === 2 ? ' two' : '') + (pics.length === 3 ? ' three' : '');
      for (const src of pics.slice(0, 9)) {
        const im = document.createElement('img');
        setImgRef(im, src);
        im.alt = '';
        im.addEventListener('click', () => openLightbox(src));
        grid.append(im);
      }
      card.append(grid);
    } else if (m.image) {
      const im = document.createElement('img');
      im.className = 'moment-img';
      setImgRef(im, m.image);
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

/** 重试时给 URL 加个缓存串：手机换网后第一次请求经常是坏的，隔一会儿再来一次就好。 */
function cacheBust(url, n) {
  if (!url) return url;
  return url + (url.indexOf('?') === -1 ? '?' : '&') + 'r=' + n;
}

/**
 * 看大图。ref 可能是 @blob:（服务器上的文件）/ data: / http(s)。
 * 以前这里直接把 ref 塞进 <img src>，@blob: 的图在手机上就是一张裂图的小图标；
 * 现在统一过 imgSrc()，失败先退回缩略图、再带缓存串重试，实在不行给一句人话。
 */
let lightboxTarget = null;

function openLightbox(ref, fallbackRef, msg) {
  let box = document.getElementById('lightbox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'lightbox';
    const img = document.createElement('img');
    img.id = 'lightboxImg';
    img.alt = '';
    const hint = document.createElement('div');
    hint.className = 'lightbox-hint';
    // 看大图时能存下来：以前点开只能看，手机和 Mac 都没有「保存」这个入口
    const save = document.createElement('button');
    save.type = 'button';
    save.id = 'lightboxSave';
    save.className = 'lightbox-save';
    save.textContent = '保存图片';
    save.addEventListener('click', (e) => {
      e.stopPropagation();                 // 别让「点哪儿都关掉」把这次点击吃掉
      if (lightboxTarget) saveImageRef(lightboxTarget.ref, lightboxTarget.name);
    });
    box.append(img, hint, save);
    document.body.append(box);
    box.addEventListener('click', () => { box.classList.remove('open'); });
  }
  lightboxTarget = { ref, name: msg ? imageSaveName(msg) : '轻聊图片' };
  const img = document.getElementById('lightboxImg');
  const hint = box.querySelector('.lightbox-hint');
  const full = imgSrc(ref) || imgSrc(fallbackRef);
  const small = imgSrc(fallbackRef) || imgSrc(ref);
  const say = (t) => { if (hint) hint.textContent = t || ''; };
  say('');
  if (!full && !small) {
    // 单机模式下 @blob: 没有服务器可取；老数据里不该有，但别让人对着裂图发愣
    img.removeAttribute('src');
    img.hidden = true;
    say(isCloud() ? '这张图没取到地址，回聊天里重新点一次试试' : '单机模式看不到这张图（图存在服务器上）');
    box.classList.add('open');
    return;
  }
  let step = 0;
  const show = (url) => { img.hidden = false; img.src = url; };
  img.onload = () => say('');
  img.onerror = () => {
    step += 1;
    if (step === 1 && small && small !== full) { show(small); return; }
    if (step === 2 && full) { say('正在重试…'); setTimeout(() => show(cacheBust(full, 2)), 600); return; }
    if (step === 3 && small && small !== full) { setTimeout(() => show(cacheBust(small, 3)), 900); return; }
    img.hidden = true;
    say('图片没加载出来：网络断了一下。点屏幕关掉，再点一次图就好了');
  };
  show(full || small);
  box.classList.add('open');
}

/** 聊天里的缩略图：加载失败先退到另一张、再带缓存串重试，别一直空着。 */
function setImgRef(img, ref, fallbackRef) {
  const primary = imgSrc(ref) || imgSrc(fallbackRef);
  const spare = imgSrc(fallbackRef) || '';
  if (!primary) { img.removeAttribute('src'); return; }
  let tries = 0;
  img.addEventListener('error', () => {
    tries += 1;
    if (tries === 1 && spare && spare !== primary) { img.src = spare; return; }
    if (tries <= 3) {
      setTimeout(() => { img.src = cacheBust(tries === 2 ? primary : (spare || primary), tries); }, 500 * tries);
    }
  });
  img.src = primary;
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
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || isImeKey(e)) return;
    e.preventDefault(); submit();
  });
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
    if (e.key !== 'Enter' || isImeKey(e)) return;
    e.preventDefault(); submit();
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
    image: momentImages[0] || '',
    images: momentImages.slice(),
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

  // 「她因为这条朋友圈私聊你」：
  //   1) 只针对**你自己发的**朋友圈。以前 AI 自己发的也排，朋友圈一调快
  //      （1 分钟一条）就变成两分钟被私聊一次，直接刷屏。
  //   2) 半小时内最多一次，避免设成高频后一直被私聊。
  const social = state.social || (state.social = {});
  const lastDm = Number(social.lastMomentDmAt) || 0;
  const dmPool = m.authorId === 'me' ? state.friends.filter((f) => f.dmMoment !== false) : [];
  if (dmPool.length && nowSec - lastDm > 1800 && Math.random() < 0.45) {
    const f = dmPool[Math.floor(Math.random() * dmPool.length)];
    state.pending.push({
      id: uid('p'), kind: 'dm', momentId: m.id, by: f.id,
      dueAt: nowSec + 90 + Math.random() * 390,
    });
    social.lastMomentDmAt = nowSec;
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
  const lastSeen = lastMessage(conv);
  if (lastSeen) conv.readAt = Math.max(Number(conv.readAt) || 0, lastSeen.ts || 0);
  // 必须把「清零」同步给服务器：否则下次拉状态又拿回旧 unread，红点永远在
  if (kind === 'friend') rememberFriendEdit(conv, { unread: 0, readAt: conv.readAt });
  renderConversations();

  $('#peerName').textContent = conv.note || conv.name;
  setStatus('在线');
  pageChat.classList.add('open');
  phone.classList.add('chat-open');

  renderChat();
  applyChatBg().catch(() => {});
  restoreDraft();
  updateSendBtn();

  renderReplyState(kind, conv);
  if (kind === 'group' && rtOf(convKey(kind, id)).phase !== 'idle') setStatus('对方正在输入…');

  startClock();
  closeMention();
  if (!COARSE) inputEl.focus();
  persist();
}

function closeChat() {
  pageChat.classList.remove('open');
  phone.classList.remove('chat-open');
  state.conv = null;
  closeMention();
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

  // 数据瘦身后的老消息：顶上给一个「加载更早」的入口（只在服务器模式有归档）
  if (kind === 'friend' && conv.archivedBefore && isCloud()) {
    const btn = document.createElement('button');
    btn.className = 'load-earlier';
    btn.textContent = '加载更早的消息';
    btn.addEventListener('click', () => loadEarlier(conv, btn));
    chatEl.prepend(btn);
  }

  // 「已读」：她看过这条了、而且还没回 —— 只在最后一条你的消息下面显示
  const lastUser = [...conv.messages].reverse().find((m) => m.role === 'user');
  if (lastUser && Number(conv.peerReadAt) >= Number(lastUser.ts || 0)) {
    const idx = conv.messages.lastIndexOf(lastUser);
    const replied = conv.messages.slice(idx + 1).some((m) => m.role !== 'user');
    if (!replied) {
      const row = chatEl.querySelector('.row.me[data-id="' + String(lastUser.id).replace(/"/g, '') + '"]');
      if (row) {
        const tag = document.createElement('div');
        tag.className = 'read-tag';
        tag.textContent = '已读';
        row.append(tag);
      }
    }
  }
  renderReplyState(kind, conv);
  scrollBottom(true);
  updateFab();
}

function addDivider(ts) {
  const d = document.createElement('div');
  d.className = 'time-divider';
  d.textContent = dividerOf(ts);
  chatEl.append(d);
}

/* ---------------- 她会画简笔画（SVG） ---------------- */

const SVG_BLOCK = /```(?:svg|xml)?\s*(<svg[\s\S]*?<\/svg>)\s*```|(<svg[\s\S]*?<\/svg>)/i;

/** 从消息文本里切出 SVG，顺便清洗掉脚本和事件属性。 */
function splitSvg(text) {
  const src = String(text || '');
  const m = SVG_BLOCK.exec(src);
  if (!m) return null;
  const raw = m[1] || m[2];
  const svg = sanitizeSvg(raw);
  if (!svg) return null;
  const at = src.indexOf(raw);
  return {
    before: src.slice(0, at).trim(),
    after: src.slice(at + raw.length).trim(),
    svg,
  };
}

function sanitizeSvg(raw) {
  let s = String(raw || '').trim();
  if (s.length < 24 || s.length > 20000) return '';
  if (!/^<svg[\s>]/i.test(s)) return '';
  // 只当 <img> 渲染本来就不会跑脚本，这里再清一遍更保险
  s = s.replace(/<\s*(script|foreignObject|iframe|image|use|a)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  s = s.replace(/<\s*(script|foreignObject|iframe|image)\b[^>]*\/?>/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  s = s.replace(/javascript:/gi, '');
  s = s.replace(/\shref\s*=\s*"[^"]*"/gi, '');
  if (!/xmlns\s*=/.test(s)) s = s.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return s;
}

/** 只取文字部分（会话列表预览、通知用）。 */
/* ---------------- 文件卡片 / 保存 ---------------- */

function humanSize(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function fileExt(name) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

function fileCardEl(file) {
  const box = document.createElement('div');
  box.className = 'file-card';

  const ico = document.createElement('div');
  ico.className = 'file-ico';
  const ext = fileExt(file.name);
  ico.textContent = (ext || 'file').slice(0, 4).toUpperCase();
  ico.dataset.ext = ext;

  const main = document.createElement('div');
  main.className = 'file-main';
  const nm = document.createElement('div');
  nm.className = 'file-name';
  nm.textContent = file.name || '文件';
  const meta = document.createElement('div');
  meta.className = 'file-meta';
  let size = Number(file.size) || 0;
  if (!size) {
    try { size = new Blob([file.text || '']).size; } catch (_) { size = (file.text || '').length; }
  }
  const label = { docx: 'Word 文档', doc: 'Word 文档', pdf: 'PDF', csv: '表格', xlsx: '表格',
    xls: '表格', pptx: '幻灯片', ppt: '幻灯片', txt: '文本', md: '文本', json: 'JSON' }[ext] || (ext || '文本');
  meta.textContent = humanSize(size) + ' · ' + label;
  main.append(nm, meta);

  const btns = document.createElement('div');
  btns.className = 'file-btns';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'file-btn primary';
  save.textContent = '保存';
  save.addEventListener('click', async (e) => {
    e.stopPropagation();
    // 他发上来的真文件：从 blob / 本地库取回原文件再存
    if (file.ref && !file.text) {
      const url = await fileRefToDataUrl(file.ref, file.mime);
      if (!url) return toast('这个文件没取到，再点一次试试');
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        return downloadBlob(blob, file.name || '文件');
      } catch (_) { return toast('保存失败'); }
    }
    saveGeneratedFile(file);
  });
  btns.append(save);
  if (file.text) {
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'file-btn';
    copy.textContent = '复制';
    copy.addEventListener('click', (e) => {
      e.stopPropagation();
      copyText(file.text || '');
      toast('内容已复制');
    });
    btns.append(copy);
  }
  box.append(ico, main, btns);
  return box;
}

function xmlEsc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 极简 .docx：把纯文本按行变成段落，「# 」开头当标题。Word / WPS 都能打开。 */
function makeDocx(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const paras = lines.map((line) => {
    const heading = /^#{1,3}\s+/.test(line);
    const body = line.replace(/^#{1,3}\s+/, '');
    const rPr = heading ? '<w:rPr><w:b/><w:sz w:val="30"/></w:rPr>' : '';
    return '<w:p><w:r>' + rPr + '<w:t xml:space="preserve">' + xmlEsc(body) + '</w:t></w:r></w:p>';
  }).join('');
  const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + paras
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
    + '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>'
    + '</w:body></w:document>';
  const types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '</Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>';
  return zipStore([
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: rels },
    { name: 'word/document.xml', data: doc },
  ]);
}

function crc32(u8) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i += 1) {
    let c = (crc ^ u8[i]) & 0xFF;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? ((c >>> 1) ^ 0xEDB88320) : (c >>> 1);
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** 只存储不压缩的 zip（docx 够用，体积不重要）。 */
function zipStore(items) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const it of items) {
    const name = enc.encode(it.name);
    const data = typeof it.data === 'string' ? enc.encode(it.data) : it.data;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true);
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint16(30, 0, true);
    ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true);
    ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, items.length, true);
  eocd.setUint16(10, items.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, offset, true);
  eocd.setUint16(20, 0, true);
  const all = [...chunks, ...central, new Uint8Array(eocd.buffer)];
  const total = all.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result || '');
      resolve(s.indexOf(',') >= 0 ? s.slice(s.indexOf(',') + 1) : s);
    };
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

async function saveGeneratedFile(file) {
  const name = (file && file.name) || '文件.txt';
  let blob;
  if (/\.docx$/i.test(name)) {
    blob = new Blob([makeDocx(file.text || '')], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  } else {
    blob = new Blob([file.text || ''], { type: 'text/plain;charset=utf-8' });
  }

  // Mac 壳：原生保存到「下载」文件夹（比 WebView 的下载可靠）
  const bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.saveFile;
  if (bridge) {
    try {
      const base64 = await blobToBase64(blob);
      bridge.postMessage({ name, base64 });
      toast('已保存到「下载」文件夹');
      return;
    } catch (_) { /* 掉到浏览器下载 */ }
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('已开始下载；没反应就点「复制」');
  } catch (_) {
    copyText(file.text || '');
    toast('已复制，自己粘到文件里');
  }
}

function plainText(text) {
  const parts = splitSvg(text);
  if (!parts) return String(text || '');
  return [parts.before, parts.after, parts.svg ? '［画了一张图］' : '']
    .filter(Boolean).join(' ').trim();
}

function paintMessageText(bubble, text) {
  const parts = splitSvg(text);
  if (!parts) { bubble.textContent = text; return false; }
  if (parts.before) bubble.append(document.createTextNode(parts.before));
  const img = document.createElement('img');
  img.className = 'doodle';
  img.alt = '';
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(parts.svg);
  bubble.append(img);
  if (parts.after) bubble.append(document.createTextNode(parts.after));
  return true;
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
  } else if (msg.money) {
    bubble.classList.add('money');
    const row = document.createElement('div');
    row.className = 'money-row';
    const ic = document.createElement('div');
    ic.className = 'money-icon';
    ic.textContent = '🧧';
    const col = document.createElement('div');
    const amt = document.createElement('div');
    amt.className = 'money-amt';
    amt.textContent = '¥' + moneyText(msg.money.amount);
    const sub = document.createElement('div');
    sub.className = 'money-sub';
    sub.textContent = '轻聊币 · 红包';
    col.append(amt, sub);
    row.append(ic, col);
    bubble.append(row);
    if (msg.money.note) {
      const note = document.createElement('div');
      note.className = 'money-note';
      note.textContent = msg.money.note;
      bubble.append(note);
    }
  } else if (msg.image) {
    const img = document.createElement('img');
    if (msg.sticker) {
      img.className = 'sticker-img';
      bubble.classList.add('sticker');
    } else {
      bubble.classList.add('pic');
      img.className = 'pic';
    }
    setImgRef(img, msg.thumb || msg.image, msg.image);
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('click', (e) => {
      // 别让「点图看大图」顺手把消息菜单也打开（桌面上两个都会触发）
      e.stopPropagation();
      openLightbox(msg.image, msg.thumb, msg);
    });
    bubble.append(img);
  } else if (msg.file && msg.file.name) {
    bubble.classList.add('file-bubble');
    bubble.append(fileCardEl(msg.file));
  } else if (msg.text && splitSvg(msg.text)) {
    paintMessageText(bubble, msg.text);
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
  if (who && who.id && friendById(who.id)) {
    av.classList.add('tappable');
    av.addEventListener('click', (e) => { e.stopPropagation(); openProfile(who.id); });
  }
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

/** 浏览器的「网断了」各种说法，统一认出来：换网、信号抖动、DNS 断掉都算。 */
function isNetError(e) {
  const raw = String((e && e.message) || e || '');
  if (/Failed to fetch|NetworkError|Load failed|network error|network changed|ERR_NETWORK|ERR_INTERNET|ERR_CONNECTION|net::/i.test(raw)) {
    return true;
  }
  return !!(e && (e.name === 'TypeError' || e.name === 'NetworkError')
    && /fetch|network/i.test(raw));
}

/** 断流时已经打出来的半截：尽量切在句子边界，别把「我今」这种残句发出去。 */
function trimPartial(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  const marks = ['。', '！', '？', '…', '\n', '!', '?', '.', '~'];
  let cut = -1;
  for (const m of marks) cut = Math.max(cut, t.lastIndexOf(m));
  if (cut >= Math.max(0, t.length * 0.5)) return t.slice(0, cut + 1).trim();
  return t;
}

/** 把浏览器的原始报错翻译成人话，别再直接把 "Failed to fetch" 甩给用户。 */
function friendlyError(e) {
  const raw = String((e && e.message) || e || '');
  if (isNetError(e)) {
    return '网络断了一下，这条没发出去（换个网再试，或者直接再发一次）';
  }
  if (/abort/i.test(raw)) return '请求超时';
  return raw || '未知错误';
}

/** 响应非 2xx 时抛一个能看懂的错。 */
async function ensureOk(res) {
  if (res.ok) return;
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

/** 有没有配好模型接口：没配就别在等待期偷偷发请求。 */
function canGenerate() {
  return !!String(state.settings.apiKey || '').trim() && !!String(state.settings.model || '').trim();
}

function toolsUrl(path) {
  const base = (state.settings.baseUrl || '').trim().replace(/\/+$/, '');
  return base.endsWith('/v1') ? base + path : base + '/v1' + path;
}

function requestJson(url, key, body) {
  if (IS_LOCAL_SERVER && isSameOriginAsServer()) {
    return fetch('/__proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Target-Url': url, 'X-Target-Key': key || '' },
      body: JSON.stringify(body),
    }).then((r) => r.json());
  }
  if (NATIVE && !SERVER && window.AndroidChat.post) {
    return new Promise((resolve, reject) => {
      const id = 'j' + Date.now() + Math.random().toString(36).slice(2, 5);
      nativePosts[id] = { resolve, reject };
      try { window.AndroidChat.post(id, url, key, JSON.stringify(body)); }
      catch (e) { delete nativePosts[id]; reject(e); }
    });
  }
  // 本地模式：直接从网页调（联网搜索、模型列表都走这里）
  if (!isCloud()) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (key || '') },
      body: JSON.stringify(body),
    }).then((r) => {
      if (!r.ok) throw new Error('接口返回 ' + r.status);
      return r.json();
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


/** 取一张图给模型看：@blob: 先下载成 data URL；gif 只取首帧（有些接口不收 gif）。 */
async function imageForModel(ref, max = 1568, quality = 0.85) {
  if (!ref) return '';
  let url = ref;
  if (ref.startsWith('@blob:')) {
    try {
      const res = await apiFetch('/api/blob/' + encodeURIComponent(ref.slice(6)), { timeout: 15000 });
      if (!res.ok) return '';
      const blob = await res.blob();
      url = await new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result || ''));
        fr.onerror = () => resolve('');
        fr.readAsDataURL(blob);
      });
    } catch (_) {
      return '';
    }
  }
  if (!url) return '';
  if (/^data:image\/gif/i.test(url) || /\.gif$/i.test(ref)) url = await firstFrame(url);
  // 模型不需要原图：长边压到 1568、JPEG 0.85，省 token 也省上传时间
  return await resizeDataUrl(url, max, quality);
}

/** gif 的首帧转成 jpeg（顺带缩到 512，省 token）。 */
function firstFrame(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const max = 512;
        const scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round((img.width || 1) * scale));
        c.height = Math.max(1, Math.round((img.height || 1) * scale));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.85));
      } catch (_) { resolve(''); }
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}

/** 一次回复里最多带几张图：把最近几条的图先取下来。 */
async function resolveImagesForModel(conv, budget = 2) {
  const map = new Map();
  const list = (conv && conv.messages) || [];
  let left = budget;
  // 她自己刚发的那张也要给模型看（单独 1 张额度）：她要能像看用户发的图一样看到自己发出去的照片。
  let herLeft = 1;
  const limit = Math.max(6, Number(state.settings.contextLimit) || 60);
  const floor = Math.max(0, list.length - limit);
  for (let i = list.length - 1; i >= floor && (left > 0 || herLeft > 0); i -= 1) {
    const m = list[i];
    if (!m.image || m.sticker) continue;        // 表情包两边都只用文字标注
    if (m.role !== 'user') {
      if (m.photo && herLeft > 0) {
        herLeft -= 1;
        const url = await imageForModel(m.image);
        if (url) map.set(m.id, url);
      }
      continue;
    }
    if (left <= 0) continue;
    left -= 1;
    // 刚发出去的这一张：第一次给模型看原图（仅存在内存里，不落盘／不上传），
    // 之后同一张就只用服务端存的 1568 副本，原图在第一次请求后丢掉。
    const fresh = conv && conv.__freshImage;
    if (fresh && fresh.id === m.id) {
      map.set(m.id, await imageForModel(fresh.data, 4096, 0.92));
      conv.__freshImage = null;
    } else {
      map.set(m.id, await imageForModel(m.image));
    }
  }
  return map;
}

function toApiMessage(m, allowImage, imgMap) {
  const isUser = m.role === 'user';
  const role = isUser ? 'user' : 'assistant';
  if (m.money) {
    const amt = moneyText(m.money.amount);
    const note = m.money.note ? '，附言：' + String(m.money.note).slice(0, 40) : '';
    return { role, content: (isUser ? '（他给你发了一个 ¥' : '（你给他发了一个 ¥') + amt + ' 的轻聊币红包' + note + '）' };
  }
  if (m.image) {
    // 表情包一律用文字标注，不占「看图」的额度：标签/描述本来就是模型自己认的，
    // 而且这样「你发的」和「她发的」不会搅在一起。
    if (m.sticker) {
      const tags = Array.isArray(m.stickerTags) ? m.stickerTags.filter(Boolean) : [];
      const what = m.stickerDesc || (tags.length ? tags.join('、') : '');
      const label = (isUser ? '（他发了一个表情包' : '（你刚发了一个表情包')
        + (what ? '：' + what : '') + '）';
      return { role, content: (m.text ? m.text + ' ' : '') + label };
    }
    // 她自己照的/拍的 AI 照片：留一句画面描述，下一轮她才知道刚才发的是什么
    if (m.photo) {
      return { role, content: (m.text ? m.text + ' ' : '')
        + (isUser ? '（他发了一张照片：' : '（你发了一张照片：')
        + String(m.photo).slice(0, 90) + '）' };
    }
    // 只有用户消息能带图：接口明确不支持 assistant 里的 image_url
    //（报错：Image in assistant message is not supported）
    const url = (isUser && allowImage && imgMap) ? (imgMap.get(m.id) || '') : '';
    if (url && state.settings.vision) {
      return { role, content: [
        { type: 'text', text: m.text || '（图片）' },
        { type: 'image_url', image_url: { url } },
      ] };
    }
    return { role, content: (m.text ? m.text + ' ' : '') + '（发了一张图片）' };
  }
  if (m.file && m.file.name) {
    const unread = (isUser && m.file.unread) ? '（这个文件读不出文字，你只看到文件名，别假装看过内容）' : '';
    return { role, content: (m.text ? m.text + ' ' : '')
      + (isUser ? '（他发来一个文件：' : '（你发给他一个文件：') + m.file.name + '）' + unread };
  }
  return { role, content: m.text };
}

/* ---------------- 她会发照片（AI 生图） ---------------- */

/**
 * 生图接口配置。over 可以传设置页里还没保存的输入框值——「试一张」要按当前填的试，
 * 不能逼着人先点保存。
 */
function photoConfig(over) {
  const s = state.settings || {};
  const pick = (k, d) => {
    const v = over && over[k] !== undefined && over[k] !== null ? over[k] : s[k];
    return v === undefined || v === null ? d : v;
  };
  const base = String(pick('imageBaseUrl', '')).trim().replace(/\/+$/, '');
  const key = String(pick('imageApiKey', '')).trim();
  const model = String(pick('imageModel', '')).trim() || 'gpt-image-2';
  const size = String(pick('imageSize', '1024x1024')).trim() || '1024x1024';
  const quality = String(pick('imageQuality', '')).trim().toLowerCase();
  const style = String(pick('imageStyle', '')).trim();
  const on = over ? true : !!s.imageOn;
  return { on, base, key, model, size, quality, style, ready: !!(base && model) };
}

/** 接口地址：填 https://x/v1 就补 /images/<kind>；填完整地址也认。 */
function imagesApiUrl(base, kind) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  if (!b) return '';
  const m = b.match(/\/images\/(generations|edits)$/i);
  if (m) return m[1].toLowerCase() === kind ? b : b.replace(/\/images\/(generations|edits)$/i, '/images/' + kind);
  if (/\/v1$/i.test(b)) return b + '/images/' + kind;
  return b + '/v1/images/' + kind;
}

function imagesEndpoint(base) {
  return imagesApiUrl(base, 'generations');
}

/**
 * 这个角色这次要用哪套生图设置：
 *   接口地址/Key 走全局（一套中转就够）；模型、尺寸、清晰度、画风、提示词、概率、
 *   关键词、参考图都可以在「朋友资料 → 她的照片」里单独覆盖——统一那套不适合所有人。
 */
function photoCfgFor(friend) {
  const g = photoConfig();
  const own = (friend && friend.settings) || {};
  const has = (k) => own[k] !== undefined && own[k] !== null && own[k] !== '';
  const str = (k, d) => (has(k) ? String(own[k]).trim() : d);
  const num = (k, d) => {
    const n = Number(has(k) ? own[k] : d);
    return Number.isFinite(n) ? n : d;
  };
  const refs = (Array.isArray(own.imageRefs) ? own.imageRefs : [])
    .filter((x) => typeof x === 'string' && x)
    .slice(0, 6);
  let triggers = String(has('imageTriggers') ? own.imageTriggers : (state.settings.imageTriggers || ''))
    // 只按逗号/分号拆：英文关键词可能是词组（shoot me），按空格拆就废了
    .split(/[,，、;；]+/).map((x) => x.trim()).filter(Boolean).slice(0, 20);
  if (!triggers.length) triggers = PHOTO_DEFAULT_TRIGGERS.slice();
  // 只填了中文关键词时，把英文的默认词也带上：跟她说英文时「selfie」也得能触发。
  // 想完全自己控制英文词，就往列表里加任意一个英文词即可。
  else if (!triggers.some((w) => /[a-z]/i.test(w))) {
    triggers = triggers.concat(PHOTO_EN_TRIGGERS);
  }
  triggers = [...new Set(triggers)].slice(0, 20);
  const globalChance = Number((state.settings || {}).imageChance ?? 15);
  return {
    // 全局总开关 + 这个角色自己的开关（false = 这个角色不发照片）
    on: g.on && own.imageOn !== false,
    base: g.base, key: g.key,
    model: str('imageModel', g.model),
    size: str('imageSize', g.size),
    quality: (has('imageQuality') ? String(own.imageQuality).trim().toLowerCase() : g.quality),
    style: str('imageStyle', g.style),
    prompt: str('imagePrompt', String((state.settings || {}).imagePrompt || '').trim()),
    chance: Math.max(0, Math.min(100, num('imageChance', Number.isFinite(globalChance) ? globalChance : 15))),
    triggers,
    refs,
    ready: g.ready,
  };
}

/** 关键词一个都没填时的兜底：他说要看照片就该发，不用先教一遍关键词（中英文都认）。 */
const PHOTO_DEFAULT_TRIGGERS = ['自拍', '照片', '看看你', '拍一张', 'selfie', 'photo', 'pic', 'picture'];
const PHOTO_EN_TRIGGERS = ['selfie', 'photo', 'pic', 'picture'];

/** 他这一句是不是在让她「画」（画画走简笔画，和生图是两件事）。 */
function wantsDoodleText(text) {
  return /(画一|画个|画张|画幅|画点|画啥|画什么|画画|涂鸦|画给|试试画|画吧|画嘛|画呀)/.test(String(text || ''));
}

/** 最近 5 条聊天：生图模型看不到聊天记录，只靠这段文字知道刚才在聊什么。 */
function recentChatContext(friend, limit = 5) {
  const list = ((friend && friend.messages) || [])
    .filter((m) => m.role !== 'system' && !m.recalled && (m.text || m.photo || m.image))
    .slice(-limit);
  return list.map((m) => {
    const who = m.role === 'user' ? (state.me.name || '他') : ((friend && friend.name) || '她');
    const what = String(m.text || '').replace(/\s+/g, ' ').trim()
      || (m.photo ? '（发了一张照片）' : '（发了图片）');
    return who + '：' + what.slice(0, 60);
  }).join('\n');
}

/**
 * 这张照片「拍的是什么」——决定机位。
 *
 * 以前提示词里写死「单人出镜，像自拍」，所以她说什么都发一张自拍；
 * 说了脚受伤，发的还是同一个角度的全身自拍。这里按描述判断三类：
 *   selfie 她自己；detail 某个具体的东西/部位的特写；casual 没说清，随手拍。
 * 中英文都认：人设是英文的角色，描述本来就是英文写的。
 */
const PHOTO_SELFIE_RE = /自拍|对着镜头|看镜头|镜头前|比耶|举着手机|\bselfie\b|\bfront[- ]camera\b|\blooking at the camera\b|\bfacing the camera\b/i;
// 只认「明确在说某个部位 / 伤」，或者干脆写明了特写、近景、第一人称视角。
// 收窄是有意的：把「在街上」「花了二十块」这种也判成特写，会拍出没有人的图。
const PHOTO_DETAIL_ZH = /脚|足踝|脚踝|脚趾|腿|膝盖|小腿|手|手指|手腕|手掌|胳膊|手臂|肩|腰|肚子|脖子|锁骨|伤|淤青|淤血|红印|抓痕|疤|绷带|创可贴|膏药|指甲|特写|近景|俯拍/;
const PHOTO_DETAIL_EN = /\b(foot|feet|heel|ankle|toes?|legs?|knees?|thighs?|calf|hands?|fingers?|wrist|palm|arms?|shoulders?|waist|belly|stomach|neck|collarbone|injur\w*|wounds?|bruis\w*|scratch\w*|scars?|bandag\w*|plaster|close[- ]?ups?|pov|first[- ]person)\b/i;

function photoShotKind(scene) {
  const t = String(scene || '');
  if (!t.trim()) return 'casual';
  if (PHOTO_SELFIE_RE.test(t)) return 'selfie';
  if (PHOTO_DETAIL_ZH.test(t) || PHOTO_DETAIL_EN.test(t)) return 'detail';
  return 'casual';
}

/** 给生图模型的「机位」那一行：不许默认自拍，也不许每张都同一个角度。 */
function photoShotLine(kind) {
  if (kind === 'detail') {
    return '机位：这一张不是自拍——手机就对着「画面」里说的那个东西（部位 / 东西 / 地方），'
      + '近距离特写或近景，第一人称视角（像自己低头、举起手机去拍它）；'
      + '她的脸不要占画面主体，也不要为了拍它摆成全身站姿；画面里不要出现第二个人。';
  }
  if (kind === 'selfie') {
    return '机位：这一张是自拍——手机举起来对着自己看镜头，画面里只有她一个人。';
  }
  return '机位：按「画面」那句决定镜头对着什么、离多近，**不要默认拍成自拍**——\n'
    + '- 画面里是某样具体的东西或地方（桌上在吃什么、新买的东西、窗外、路边遇到的、屏幕、宠物）→ '
    + '就拍那样东西，第一人称视角、近景或特写，她本人可以不在画面里；\n'
    + '- 画面里是她在做什么、穿了什么、她想让你看她的样子 → 才拍她本人（自拍还是别人拍，按描述来）；\n'
    + '- 没写清楚就随手拍一张，也别每次都同一个角度（近景 / 特写 / 侧脸 / 俯拍都行）。';
}

/** 一张照片最终发给生图模型的提示词：画风 + 人物 + 最近聊的 + 这一幕。 */
function buildPhotoPrompt(scene, friend, cfgIn, opts) {
  const cfg = cfgIn || photoCfgFor(friend);
  const safe = !!(opts && opts.safe);      // 审核没过的重试：去掉人设和聊天原文
  const name = (friend && friend.name) || '她';
  const persona = safe ? '' : String((friend && friend.persona) || '')
    .replace(/\r/g, '').replace(/<[^>\n]{1,200}>/g, '').split('\n')
    .map((x) => x.trim()).filter(Boolean)
    // 人设里的「禁止／不要」是在教她说话，不是长相，别喂给生图模型
    .filter((x) => !/^(禁止|不要|不能|规矩|注意)[：:]/.test(x))
    .join('，').slice(0, 240);
  const style = cfg.style
    || '真实感手机生活照，自然光，皮肤有细节；不要文字、水印、边框、拼图，不要插画和 3D 渲染';
  // 设置里那段「生图提示词」也一起喂给生图模型：用户写的画风要求（二次元/粗描线/平涂…）
  // 以后再也不用两边各写一遍。和上面的默认画风冲突时以这段为准。
  const extra = String(cfg.prompt || '').trim().slice(0, 900);
  const lines = [
    '一张「' + name + '」发给他的照片。',
    '画风：' + style,
  ];
  if (extra) {
    lines.push('主人写的额外要求（只取其中和画风/画法/画面有关的部分）。如果这里写了画风，就完全按这里来，上面「画风」那行作废：\n' + extra);
  }
  if (persona) lines.push('人物：' + name + '——' + persona);
  const ctx = safe ? '' : recentChatContext(friend, 5);
  if (ctx) lines.push('最近的对话（只用来对上上下文，不要把聊天原文画进图里）：\n' + ctx);
  const sceneText = String(scene || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  lines.push('画面：' + (sceneText || '随手拍一张'));
  lines.push(photoShotLine(photoShotKind(sceneText)));
  lines.push('要求：不要出现第二个人（画面里只有她，或者只有她拍的那样东西），像用手机当场拍的，构图自然、有生活气；画面里不要出现文字、logo、水印。');
  if (safe) {
    lines.push('另外：日常、干净的生活照，衣着完整，正常室内/室外场景；不要裸露、不要性暗示、不要亲密接触。');
  }
  if (cfg.refs && cfg.refs.length) {
    // 参考图最容易带偏的地方：模型会把参考图里的站姿、机位、构图一起抄过来，
    // 于是每张都是同一个姿势的自拍。这里把「参考图只定长相」说死。
    lines.push('参考图里就是她本人，但只用它来定「长什么样」：脸型、五官、发型、发色、肤色、年龄、身材比例要和参考图一致。'
      + '参考图里的姿势、动作、站姿、机位、构图、背景、衣服一律不要照抄，这些全部按上面「画面」和「机位」重新来；'
      + '「画面」写的是特写或局部时，不要把参考图里的全身站姿搬过来。');
  }
  return lines.join('\n');
}

/**
 * 人设里明确写了「必须用 English / 用英文」这类要求时，给一条高优先级规则。
 * 不写这条时，模型会跟着中文聊天记录走——人设开头那句太容易被冲掉。
 */
function languageRuleFor(friend) {
  const p = String((friend && friend.persona) || '');
  if (!p) return '';
  const langs = [
    ['English', /english|英文|英语/i],
    ['日本語', /japanese|日本語|日语|日文/i],
    ['한국어', /korean|한국어|韩语|韩文/i],
    ['français', /french|français|法语|法文/i],
    ['Deutsch', /german|deutsch|德语|德文/i],
    ['español', /spanish|español|西班牙语|西班牙文/i],
    ['italiano', /italian|italiano|意大利语|意大利文/i],
    ['русский', /russian|русский|俄语|俄文/i],
  ];
  const verbBefore = /(must|only|always|reply|respond|answer|speak|talk|write|use|using|in|say|说|讲|用|必须|只用|只准|回答|回复|不要|别)[^。.\n]{0,40}$/i;
  const verbAfter = /^[^。.\n]{0,16}(で|を)?\s*(話|言|答|返|reply|speak|talk|answer|respond)/i;
  for (const [name, re] of langs) {
    const m = p.match(re);
    if (!m) continue;
    const before = p.slice(Math.max(0, m.index - 40), m.index);
    const after = p.slice(m.index + m[0].length, m.index + m[0].length + 24);
    if (!verbBefore.test(before) && !verbAfter.test(after)) continue;
    return '\n\n【语言·最高优先级】她的人设里明确要求用 ' + name + ' 说话。'
      + '她的每一条回复都必须用 ' + name + ' 写（连语气词也是），'
      + '哪怕主人用中文提问、聊天记录全是中文，也不要切回中文；'
      + '除非主人当场明确改口说要用中文。';
  }
  return '';
}

/** 人设要求别的语言时，给所有「她写的字」（签名/朋友圈/评论/私聊/日记…）都补一句 */
function personaLang(f) {
  const p = String((f && f.persona) || '');
  const rule = languageRuleFor(f);
  if (!rule) return p;
  const lang = (rule.match(/用 ([^ ]+) 说话/) || [])[1] || 'English';
  return p + '\n\n【语言】你写的所有文字都必须用 ' + lang + '，不要用中文。';
}

/** 她发的那张照片：按位置插在她那条消息后面，并且说清「这是你自己发的」，不是对方发的。 */
function attachHerPhoto(prepared) {
  let idx = -1;
  for (let i = prepared.length - 1; i >= 0; i -= 1) {
    if (prepared[i] && prepared[i].__herPhoto) { idx = i; break; }
  }
  if (idx < 0) return false;
  const url = prepared[idx].__herPhoto;
  delete prepared[idx].__herPhoto;
  const note = '（系统标注：下面这张图就是“你”（角色自己）刚才发出去的那张照片本身，不是他发来的。'
    + '你已经看过它了，接着聊就行；不要复述画面，也不要说「你发了张图」这种话。）';
  const imagePart = { type: 'image_url', image_url: { url } };
  const next = prepared[idx + 1];
  if (next && next.role === 'user') {
    // 紧跟一条 user 消息：并进去，别造成「连续两条 user」（有些接口会直接报错）
    const parts = Array.isArray(next.content)
      ? next.content.slice()
      : [{ type: 'text', text: String(next.content || '') }];
    next.content = parts.concat([{ type: 'text', text: note }, imagePart]);
  } else {
    prepared.splice(idx + 1, 0, { role: 'user', content: [{ type: 'text', text: note }, imagePart] });
  }
  return true;
}

function buildMessages(friend, conv, nudge, imgMap) {
  const s = state.settings;
  const now = new Date();
  const isGroup = conv.members && Array.isArray(conv.members);

  let sys = (friend.persona || DEFAULT_PERSONA).trim();
  sys += memorySysFor(friend);
  const meName = state.me.name || '我';
  // 「现在几点」每分钟都在变，不能放在系统提示词开头：那样后面几千字的前缀缓存
  // 全部失效，每次都要重新预填充，首字自然就慢。这里先记下来，放到系统提示词最后。
  const envBlock = `\n\n【环境】现在是 ${timeOf(now.getTime())}，${weekday(now)}。你在和「${meName}」聊天，用手机。`;
  // 小模型最容易犯的错：时间对不上、一句话塞好几件事、说错了硬编。
  sys += '\n【说话要讲道理】'
    + '\n- 时间、地点、正在做的事，要和【环境】以及前面说过的话对得上；拿不准就别提具体时间'
    + '\n- 一次只说一件事，别一句话里塞好几件不相关的事'
    + '\n- 上一条说错了（比如把中午说成晚上），就像真人一样顺口认一下（「啊我看错时间了」），别硬编';

  // 他把链接发过来了：正文已经抓下来，直接当材料给她，别让她说「我打不开」
  const ld = conv && conv.__linkDoc;
  if (ld && ld.url && (ld.text || ld.error)) {
    if (ld.text) {
      sys += `\n\n【他发来的链接】${ld.title ? '标题：' + ld.title + '\n' : ''}${ld.url}\n`
        + `网页正文（抽出来的，可能不完整）：\n${String(ld.text).slice(0, 6000)}\n`
        + '- 这是他刚发来的内容，你可以直接聊、总结、回答里面的问题；不要再说「我打不开链接」「看不到」。';
    } else {
      sys += `\n\n【他发来的链接】${ld.url}\n（这个页面没抓到内容：${ld.error || '打不开'}。可以直说没打开，别编里面的内容。）`;
    }
  }

  // 人味大多来自这几条：短、有具体的东西、允许废话、不要总结
  // 群聊有单独一块（②），没写才退回私聊那套，避免群里还在用私聊口吻。
  const customChat = isGroup
    ? (promptExtra('groupChat') || promptExtra('chat'))
    : promptExtra('chat');
  if (customChat) {
    sys += '\n\n【怎么说话】\n' + customChat;
  } else {
  sys += '\n\n【怎么说话】'
    + '\n- 像真人发微信：一句一句发，短。想接一句就用换行再写一条，不要写成一段话'
    + '\n- 说具体的东西（几点、几块钱、什么味道、手上在干什么），不说空泛的感受'
    + '\n- 允许废话、停顿、跑题、突然想起别的事；不要每句都有信息量'
    + '\n- 情绪要有起伏：可以突然不高兴、嘴硬、撒娇、说一半不说了'
    + '\n- 不要总结、不要讲道理、不要金句、不要"其实…"开头的感悟'
    + '\n- 偶尔用语气词（啊、欸、诶、嘛、呀、唉），但不要每句都加'
    + '\n- 不要每句都提问；想问就问具体的、有点傻的问题';
  }
  // 人设刚改过：历史里若还有旧口吻，模型会惯性模仿，这里明确打断。
  // 判断依据是「这次真的发给模型的上下文里还有没有改之前的消息」，
  // 不是「改完之后聊了几条」——以前按 30 条算，聊得快的时候早就打回原形了。
  let personaReminder = '';
  const personaChangedAt = Number(friend.personaChangedAt) || 0;
  if (personaChangedAt) {
    const ctxN = Math.max(6, Number(s.contextLimit) || 60);
    const tail = (conv.messages || [])
      .filter((m) => (m.text || m.image || m.file) && !m.recalled && m.role !== 'system')
      .slice(-ctxN);
    const stale = !tail.length || tail.some((m) => (Number(m.ts) || 0) < personaChangedAt);
    if (stale) {
      personaReminder = '【设定刚更新过】你现在的人设是刚改的，以这段为准，历史里你以前的说话方式作废：\n'
        + String(friend.persona || '').slice(0, 1200);
      sys += '\n\n【设定刚更新过】上面这段人设是刚改的，以它为准。'
        + '历史里你以前的说话方式、口癖、称呼、性格都作废，只当成发生过的事实，'
        + '不要模仿你以前怎么说话，也不要提「我变了」这件事。从这一条开始就是新人设。';
    }
  }

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

  // 红包：他刚发了轻聊币，她得有点真实反应（别装没看见，也别退回去）
  {
    const um = [...(conv.messages || [])].reverse()
      .find((m) => m.role === 'user' && !m.recalled && (m.text || m.money));
    if (um && um.money) {
      const amt = moneyText(um.money.amount);
      const note = um.money.note ? '（附言：' + String(um.money.note).slice(0, 40) + '）' : '';
      sys += '\n\n【红包】' + (isGroup ? '他刚在群里发了一个 ¥' : '他刚给你发了一个 ¥') + amt + ' 的轻聊币红包' + note + '。'
        + '你的反应要像真人：开心、客气一句、撒娇、或者嘴上说不要但收下了都行；'
        + '不要问他要不要退，不要提「程序」「虚拟货币」「余额」，也不要报数字之外的解释。';
    }
  }

  // 画图：不是「聊够多少轮就画」，而是由具体的事情触发
  const canDraw = fs(friend, 'doodle', s.doodle !== false);
  const stk = stickers();
  const chance = Math.max(0, Math.min(100, Number(s.stickerChance ?? 25)));
  // 关键词必发（逗号分隔）：说到就发，不看概率。和概率是两套并行的规则：
  //   概率 30 + 关键词「生气」→ 平时 30% 随机发，你说「生气」时必发；
  //   概率 0 + 关键词 → 只在关键词上发。
  const stickerTriggers = String(s.stickerTriggers || '')
    .split(/[,，、;；\s]+/).map((x) => x.trim()).filter(Boolean).slice(0, 20);
  const lastUserMsg = [...(conv.messages || [])].reverse()
    .find((m) => m.role === 'user' && !m.recalled);
  const lastUserText = (lastUserMsg && lastUserMsg.text) || '';
  const hitTrigger = stickerTriggers.find((w) => w && lastUserText.includes(w)) || '';
  const usableStk = stk.filter((x) => x.tags && x.tags.length);
  const stkHit = (x) => hitTrigger && (x.tags || []).some((t) => t && (t.includes(hitTrigger) || hitTrigger.includes(t)));
  const stkList = [...usableStk]
    .sort((a, b) => (stkHit(b) ? 1 : 0) - (stkHit(a) ? 1 : 0)
      || (Number(b.ts) || 0) - (Number(a.ts) || 0))
    .slice(0, 20)
    .map((x) => {
      const kw = x.tags.join('/');
      const d = (x.desc || '').slice(0, 14);
      return d ? kw + '=' + d : kw;
    });
  const stkTags = [...new Set(stk.flatMap((x) => x.tags || []))].slice(0, 60);
  // 每回合真掷一次骰子：不进就完全不提表情包，模型没有机会硬发；
  // 进了就由代码兜底（deliver 会补一张），不能只靠模型自己想起来写标记。
  const stickerRoll = Math.random() * 100 < chance;
  const stickerOk = !!(stkList.length && (hitTrigger || (chance > 0 && stickerRoll)));
  if (conv && typeof conv === 'object') {
    conv.__stickerThisTurn = stickerOk;
    conv.__stickerTrigger = hitTrigger;
  }
  if (stickerOk) {
    const want = hitTrigger
      ? `他这一句提到了「${hitTrigger}」，这一条你应该发一个表情包（优先挑和「${hitTrigger}」对得上的；关键词必须从下面这些里挑）。`
      : '这一条你可以顺手带一个表情包；想发就在消息里单独一行写 [[表情:关键词]]（关键词必须从上面这些里挑）。';
    sys += '\n\n【表情包】你手机里存着这些表情包（关键词=画面）：' + stkList.join('；') + '。'
      + want
      + `\n规矩：\n`
      + `- 最多一个，情绪对得上才发；对不上就别发，她会照常只发文字\n`
      + `- 只发文字说「给你发个表情」不算发出，必须写 [[表情:关键词]] 才会真的发出去\n`
      + `- 发的时候**文字一定要有**：先说一句话，再贴表情包；不要只发一个光秃秃的表情包\n`
      + (promptExtra('sticker') ? (`\n- 【主人补充】${promptExtra('sticker')}`) : '')
      + `\n- 历史里像「（你刚发了一个表情包：…）」这种括号是系统标注，你绝对不要照抄或输出`;
  }

  // 发照片：和表情包一样「概率 + 关键词必发」两套并行，但一张要真花钱，所以默认关。
  // 只在私聊；群里不发（和表情包一致）。他明说让她「画」的时候一律走画图，不走生图。
  const photoCfg = isGroup ? { on: false } : photoCfgFor(friend);
  const askedToDraw = wantsDoodleText(lastUserText);
  let photoOk = false;
  let photoTrigger = '';
  if (photoCfg.on && photoCfg.ready && !askedToDraw) {
    const lowText = String(lastUserText || '').toLowerCase();
    photoTrigger = photoCfg.triggers.find((w) => w && lowText.includes(String(w).toLowerCase())) || '';
    const photoRoll = Math.random() * 100 < photoCfg.chance;
    photoOk = !!(photoTrigger || (photoCfg.chance > 0 && photoRoll));
  }
  if (conv && typeof conv === 'object') {
    conv.__photoThisTurn = photoOk;
    conv.__photoTrigger = photoTrigger;
  }
  if (photoOk) {
    // 她说英文时，示例不能给中文：「拍好啦」这种中文例子会把她的台词也带成中文
    const photoLang = (languageRuleFor(friend).match(/用 ([^ ]+) 说话/) || [])[1] || '';
    sys += '\n\n【照片】你手机里就有相机，可以真的拍一张照片发给他。'
      + (photoTrigger
        ? `他这一句提到了「${photoTrigger}」，这一条你发一张照片给他。`
        : '这一条你可以发一张照片。')
      + '\n格式：先说一句话，另起一行写 [[照片:画面描述]]（描述写具体：镜头对着什么、你在哪、穿什么、在做什么、什么光）。'
      + (photoLang
        ? ('\n照片要等一会儿才真的发到他那儿：所以前面先用 ' + photoLang + ' 说一句“等一下 / 马上拍”，**别说“发给你了”“拍好了”**。'
          + '\n标记后面一定要再补一句（也用 ' + photoLang + '，写你自己会说的话），那句会等照片到了之后才发出去。')
        : ('\n照片要等一会儿才真的发到他那儿：所以前面先说「等我一下」「我这就拍」，**别说「发给你了」「拍好了」**。'
          + '\n标记后面一定要再补一句（「拍好啦」「头发有点乱」），那句会等照片到了之后才发出去。'))
      + '\n例（只学写法，不要照抄内容）：[[照片:傍晚在书店柜台后面，米白色粗针织开衫，头发用夹子夹起来，捧着热可可，侧头看镜头，暖光]]'
      + (photoCfg.prompt
        ? '\n【主人写的生图规则（怎么判断该发、发什么，按这个来）】\n' + String(photoCfg.prompt).slice(0, 1500)
        : '')
      + (photoCfg.refs.length
        ? `\n【参考图】这次会把你之前存的 ${photoCfg.refs.length} 张参考图一起交给生图模型。`
          + '描述里只写这一张要换成的场景、动作、衣服和机位；长相、发型、肤色要和参考图一致，不要重新编长相，'
          + '也不要把参考图里那个姿势再写一遍（她会一直摆同一个姿势，就是这里没写清）。'
        : '')
      + '\n规矩：\n'
      // 这一条最容易被忽略：以前描述只要求写「你在哪、穿什么、什么表情」，
      // 于是不管聊什么，写出来都是自拍。现在先让她决定「这张拍的是什么」。
      + '- 写之前先想清楚**这张拍的是什么、镜头对着谁**（这是最容易偷懒的地方）：\n'
      + '　· 他要看你的样子、问你在干嘛、你想发张自拍 → 写清是自拍，举着手机对着自己；\n'
      + '　· 你要给他看**任何一样具体的东西**——桌上在吃什么、刚买的东西、窗外的天气、路边遇到的猫狗、\n'
      + '　　手机屏幕、手上的口子、脚上的淤青…… → 就写那样东西的特写和机位（镜头对着它），\n'
      + '　　**不要又写成你自己**，比如「坐在床边低头拍脚踝侧面，红了一小块」「桌上摊开的书和半杯冷掉的咖啡」；\n'
      + '　· 别每张都同一个机位：上一张是自拍，这一张就换个角度（近景、特写、俯拍、第一人称视角）\n'
      + '- 拍的内容要接得上你刚说的话；不是你眼前的东西就别硬编\n'
      + '- **文字一定要有**：先说一句话，再把 [[照片:…]] 另起一行；不要只发一张光秃秃的照片\n'
      + '- 只写「给你看」不算发出，必须写 [[照片:…]] 才会真的发出去\n'
      + '- 这是手机拍的真实照片，不是画：描述里不要写「插画」「动漫」，也不要加解释和引号\n'
      + '- 描述要干净、能过审：不要裸露、性暗示、亲密接触、床上或浴室；就拍日常的样子\n'
      + '- 这一条只发照片，不要再画简笔画（<svg>）；他要「画」的时候是画图，不是拍照\n'
      + '- 历史里的「（你发了一张照片：…）」是系统标注，你绝对不要照抄或输出';
  }

  if (canDraw && !photoOk) {
    // askedToDraw 上面已经按同一套规则算过：他明说要画 → 走这里；说要看照片 → 走上面
    const drewRecently = (conv.messages || []).slice(-6)
      .some((m) => m.role !== 'user' && splitSvg(m.text || ''));
    if (askedToDraw) {
      sys += (promptExtra('draw') ? ('\n\n【主人补充的画风要求】' + promptExtra('draw')) : '')
        + '\n\n【画图】他这一条明确让你画了。所以这一条必须真的把图画出来——'
        + '不要只答应、不要只回「画什么好呢」「我慢慢来」「那我画一个」这种话，那种回复等于没画。'
        + '先写一句很短的话（也可以不写），然后另起一行直接输出 <svg viewBox="0 0 240 240">…</svg>，不要用代码块包起来。'
        + '\n画法：只用 rect / circle / ellipse / line / polygon / path / text；扁平配色、简单、像随手涂的；'
        + '可以写一两个字的标题；不要外部图片、不要 script。画完不要解释画的是什么。';
    } else if (drewRecently) {
      sys += '\n\n【画图】你刚才已经画过一张了，这次别画，只用文字。';
    } else {
      sys += '\n\n【画图】只有遇到下面这些情况才画，其它时候一律不画：'
        + '\n- 他问你在干嘛、你在做什么，而你手上正有件画得出来的事'
        + '\n- 他直接让你画'
        + '\n- 你想给他看某个具体的东西（你养的猫、你碗里的面、外面的雨、你画了一半的东西）'
        + '\n- 他情绪低落、生病或者被骂了，你想让他笑一下'
        + '\n- 你之前答应过要画给他看'
        + '\n以上都不是，就只说话，不要画。'
        + '\n真要画的时候：先正常说一句话，然后另起一行直接输出 <svg viewBox="0 0 240 240">…</svg>，不要用代码块包起来。'
        + '\n画法：只用 rect / circle / ellipse / line / polygon / path / text；扁平配色、简单、像随手涂的；'
        + '可以写一两个字的标题；不要外部图片、不要 script、不要 foreignObject。'
        + '\n画完不要解释画的是什么。';
    }
  }

  // 他要文档/代码文件：允许她直接吐一个文件块，客户端会渲染成可保存的文件卡片。
  // 看最近几条用户消息（不只最后一条）：他说「写个作文」→ 她说「我写就写」→
  // 他催「那你倒是写」，最后一条本身没有关键词，但这一轮仍然必须把文件写出来。
  const recentUserText = (conv.messages || []).slice(-3)
    .filter((m) => m.role === 'user' && !m.recalled)
    .map((m) => String(m.text || ''))
    .join('\n');
  const wantsFile = /(文档|文件|表格|代码|脚本|程序|写一份|写个|写一篇|写一下|写点|帮我写|作文|文章|整理成|导出|生成|保存成|word|excel|pdf|python|\.py|\.js|\.md|\.html|\.csv|\.docx|\.json)/i
    .test(recentUserText);
  // 文件能力：不再只在「他说要文件」时才给规则。
  // 任何长内容（作文、报告、清单、教程、代码…）都走文件，聊天里只留一句；
  // 「我要个文件」「发我文件」也算。
  sys += '\n\n【文件】你给他写东西的时候（作文、文章、报告、说明、清单、教程、代码、长回答）：'
    + '\n- 超过 150 字，或者超过 5 行，就必须用文件发，不要把这些长内容直接贴在聊天里；'
    + '聊天里只说一句「给你写好了」，文件另起一行发'
    + '\n- 写法：另起一行 [[文件:文件名.扩展名]]，把完整内容写在下面，最后一行 [[/文件]]'
    + '\n- 扩展名用 .md .txt .docx .py .js .html .css .json .csv：作文 / 文章 / 报告优先 .docx（用「# 」开头写标题），'
    + '纯文本用 .txt 或 .md，代码用对应扩展名'
    + '\n- 他说「我要个文件」「发我文件」「给我个文件」时，也按这个来'
    + '\n- 内容必须完整，不许写「省略」「同上」，代码要能直接跑'
    + (wantsFile
      ? '\n- 他这次已经在要文件了：这一条回复里就要把文件给出来，不要只说「我写就写」「马上写」「写短一点」。'
      : '');

  // 「提醒我」：她说一句人话，后面跟一行协议；客户端收进提醒列表，到点由她开口。
  sys += '\n\n【提醒】他让你在某个时间提醒他一件事时，正常回一句话，'
    + '然后在最后单独一行写 [[提醒:YYYY-MM-DD HH:MM|要做的事]]（24 小时制，用【环境】的时间和日期推算）。'
    + '没给准确时间就先问清楚（「几点呀」），别自己猜。不要跟他解释这个标记。';

  const bursts = isGroup
    ? Math.max(1, Math.min(10, Number(s.groupBursts) || 10))
    : Math.max(1, Math.min(5, Number(fs(friend, 'bursts', 5)) || 5));
  if (bursts > 1) {
    sys += `\n\n【发送方式】多数时候发 2 条：第一句先接话，第二句补一句自己的反应或小事，用换行分开，每条不超过 20 字；偶尔只发 1 条，最多 ${bursts} 条。`;
  }

  // 易变的内容（时间）放最后：前面的人设/规则/历史不变，前缀缓存就能一直命中。
  sys += envBlock;

  // 语言要求必须放在系统提示词最后：放开头会被下面几千字和中文历史冲掉
  const langRule = languageRuleFor(friend);
  if (langRule) sys += langRule;

  const out = [{ role: 'system', content: sys }];
  const limit = Math.max(6, Number(s.contextLimit) || 60);
  const history = conv.messages
    // 只有文件、没有文字的消息也要进上下文（不然模型根本看不到这个文件）
    .filter((m) => (m.text || m.image || m.file) && !m.recalled && m.role !== 'system')
    .slice(-limit);

  let imageBudget = 2;
  const prepared = [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i];
    let allow = false;
    // 额度只算用户发来的图：她的照片走的是文字标注（真图另外挂），表情包也只标注
    if (m.image && !m.sticker && m.role === 'user' && imageBudget > 0) { allow = true; imageBudget -= 1; }
    const base = toApiMessage(m, allow, imgMap);
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
        let txt = '【' + meName + '】' + base.content;
        // 他发来的文件：内容已经在发的时候抽成文字了，这里直接当正文给它
        const docText = (m.file && m.file.text) ? String(m.file.text) : '';
        if (docText) {
          const cut = docText.length > 30000
            ? docText.slice(0, 30000) + '\n……（文件太长，后面省略了）'
            : docText;
          txt += '\n\n【文件内容开始｜' + String(m.file.name || '文件') + '】\n' + cut + '\n【文件内容结束】';
        }
        prepared.unshift({ role: 'user', content: txt });
      } else {
        // 她自己发的那张照片：先在这条 assistant 消息上做个记号，等历史拼完再按位置插图
        // （接口不收 assistant 带图，只能借一条 user 消息把图带进来）
        if (m.role === 'peer' && m.photo && imgMap && imgMap.get(m.id)) base.__herPhoto = imgMap.get(m.id);
        prepared.unshift(base);
      }
    }
  }

  // 她刚发出去的那张照片：按位置插在她那条消息后面，让她真的「看见」自己发了什么。
  // 必须在下面 push 进 out 之前做——照片是最后一条时这里会新插一条消息。
  attachHerPhoto(prepared);

  for (const m of prepared) out.push(m);

  if (personaReminder) out.push({ role: 'system', content: personaReminder });
  if (nudge) out.push({ role: 'system', content: nudge });
  // 再在最后补一句：模型最容易看的就是倒数第一条
  if (langRule) {
    const lang = (langRule.match(/用 ([^ ]+) 说话/) || [])[1] || 'English';
    out.push({ role: 'system', content: '【语言】这一条回复也必须是 ' + lang + '，不要用中文。' });
  }
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
    if (IS_LOCAL_SERVER && isSameOriginAsServer()) {
      // 单机版走本地代理，直接要完整结果，不折腾流式
      const nb = Object.assign({}, body, { stream: false });
      const pr = await fetch('/__proxy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Target-Url': url,
          'X-Target-Key': key || '',
        },
        body: JSON.stringify(nb),
        signal: ctrl.signal,
      });
      const raw = await pr.text();
      let j = null;
      try { j = JSON.parse(raw); } catch (_) {}
      const content = (j && j.choices && j.choices[0] && j.choices[0].message
        && j.choices[0].message.content) || '';
      if (!content) throw new Error('接口返回异常：' + raw.slice(0, 120));
      // onDelta 收的是「SSE 增量对象」，这里要包成 { content }；
      // 以前直接传字符串，结果内容永远累积不到，本地跑（127.0.0.1）时她永远不回话。
      if (onDelta) onDelta({ content });
      onDone();
      return;
    }

    // 本地模式（没有服务器、也没有原生桥）：直接从网页调模型接口。
    // 安卓 WebView 开了 setAllowUniversalAccessFromFileURLs，file:// 页面可以跨域请求。
    // 这就是「单机版」唯一能聊天的路径 —— 以前靠 Java 的 JS 桥，桥删掉之后就断了。
    if (!isCloud()) {
      const base = (state.settings.baseUrl || '').trim().replace(/\/+$/, '');
      if (!base) throw new Error('还没填 Base URL，去「我的 → 设置」里填一下');
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + (key || ''),
        },
        body: JSON.stringify(Object.assign({}, body, { stream: true })),
        signal: ctrl.signal,
      });
      await ensureOk(res);
      await readSse(res, onDelta);
      onDone();
      return;
    }

    const res = await apiFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, key, body }),
      timeout: 0, // 对话由回复任务管理总超时，不能被普通接口的 25 秒截断。
      signal: ctrl.signal,
    });
    await ensureOk(res);
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

function convLastUserText(conv) {
  const m = [...((conv && conv.messages) || [])].reverse().find((x) => x.role === 'user' && !x.recalled);
  return (m && m.text) || '';
}

/** 他说的话里有链接就抓一下正文；抓不到也记下来，提示词里告诉她「没打开」。 */
async function prepareLinkDoc(conv) {
  const text = convLastUserText(conv);
  const url = (String(text).match(/https?:\/\/[^\s<>"'）)】]+/) || [])[0];
  if (!url) { if (conv) conv.__linkDoc = null; return; }
  if (conv.__linkDoc && conv.__linkDoc.url === url && !conv.__linkDoc.pending) return;
  conv.__linkDoc = { url, pending: true };
  if (!isCloud()) {
    conv.__linkDoc = { url, error: '单机模式（不连服务器）读不了链接' };
    return;
  }
  try {
    const res = await apiFetch('/api/read-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      timeout: 45000,          // 服务端最多 30 秒，客户端别先超时
    });
    let j = {};
    try { j = await res.json(); } catch (_) {}
    if (!res.ok || !j.text) throw new Error(j.error || '这个页面没抽出正文');
    conv.__linkDoc = { url, title: j.title || '', text: j.text || '', chars: j.chars || 0 };
    if (isActive('friend', conv.id)) setStatus('看完了，正在想…');
  } catch (e) {
    conv.__linkDoc = { url, error: String((e && e.message) || e).slice(0, 80) };
  }
}

async function runChat(friend, conv, r, nudge) {
  const check = () => { if (r.cancelled) throw new Error('回复已取消'); };
  check();
  if (!nudge) await prepareLinkDoc(conv);
  check();
  const imgMap = state.settings.vision ? await resolveImagesForModel(conv, 2) : null;
  check();
  r.inputId = lastUserId(conv);
  const convo = buildMessages(friend, conv, nudge, imgMap);
  const useTools = searchEnabled();
  const key = (state.settings.apiKey || '').trim();
  let text = '';

  let painted = '';
  const paint = (piece) => {
    if (!piece) return;
    painted += piece;
    // 只攒着，不往气泡里逐字画：真人是一条消息整条到的，
    // 一个字一个字往外蹦反而像 AI。到点/生成完由 deliver() 整条落地。
    r.painted = painted;
    if (r.rt) r.rt.painted = painted;
  };

  let netTries = 0;
  for (let round = 0; round < 3; round += 1) {
    check();
    painted = '';
    const job = streamOnce({ url: chatUrl(), key, body: buildBody(convo, useTools),
      onDelta: (d) => { if (d && d.content) paint(d.content); } });
    r.abort = job.cancel;
    let res;
    try {
      res = await job.promise;
    } catch (e) {
      // 手机换个网 / 信号抖一下：还没出字就自己重连试两次（不白瞎这一轮），
      // 已经出了字就把打出来的半截收下——总比整条回复丢掉、让人重发强。
      if (isNetError(e) && !painted && netTries < 2) {
        netTries += 1;
        if (r.rt && isActive('friend', conv.id)) setStatus('网络断了一下，正在重连…');
        await sleep(600 * netTries);
        check();
        round -= 1;
        continue;
      }
      if (isNetError(e) && painted) { text = trimPartial(painted); break; }
      throw e;
    }
    check();

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
        check();
        const out = await runTool(tc);
        check();
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
    rt.set(key, { phase: 'idle', timer: null, abort: null, queued: false, since: 0,
      deadline: 0, stopped: false, late: false, job: null, holder: null, error: '', delivering: false,
      // 提前生成：painted 是模型已经给出的字（只用来判断「生成好了没」）
      painted: '' });
  }
  return rt.get(key);
}

function lastUserId(conv) {
  const m = [...(conv.messages || [])].reverse().find((x) => x.role === 'user' && !x.recalled);
  return m ? m.id : null;
}

/** 临时气泡属于会话运行状态；同步重绘/切换聊天后按当前状态重建。 */
function renderReplyState(kind, conv) {
  if (kind !== 'friend' || !isActive(kind, conv.id)) return;
  const r = rtOf(convKey(kind, conv.id));
  if (r.holder) r.holder.row.remove();
  r.holder = null;
  // 气泡里不放「三个点」的加载框：她正在输入只体现在顶部那行状态文字上，
  // 消息是整条直接出现的。只有出错时才在聊天里留一个红字气泡。
  if (r.error) {
    r.holder = renderMessage({ role: 'peer', authorId: conv.id, text: r.error },
      { conv, kind, typing: false, animate: false });
    r.holder.bubble.classList.add('error');
  }
  setStatus(r.error ? '回复失败，请重试' : r.phase === 'streaming' ? '对方正在输入…'
    : conv.lateReplyAt ? '已读，等会儿回'
    // 生图要几十秒到几分钟：状态栏一直写「正在拍照…」，同步重绘也不会被冲掉
    : photoJobs.has(convKey(kind, conv.id)) ? '正在拍照…' : '在线');
  updateSendBtn();
}

function stopReply(kind, conv) {
  const r = rtOf(convKey(kind, conv.id));
  r.stopped = true;
  r.queued = false;
  clearTimeout(r.timer);
  r.deadline = 0;
  // 等待期就提前跑了的生成任务也要掐掉，否则停下来了它还会在后台烧 token
  if (r.job) { clearTimeout(r.job.watchdog); r.job.cancel('stopped'); }
  else if (r.abort) r.abort();
  if (r.phase === 'waiting') { r.phase = 'idle'; r.job = null; r.abort = null; }
  r.painted = '';
  renderReplyState(kind, conv);
}

/** 后台暂停了计时器时，恢复后直接执行到期任务，不重新抽一段延迟。 */
function resumeReplies() {
  lateReplyTick();
  for (const f of state.friends) {
    const r = rt.get(convKey('friend', f.id));
    if (!r) continue;
    if (r.phase === 'waiting' && r.deadline <= Date.now()) startReply('friend', f);
    if (r.job && !r.delivering && r.job.expiresAt <= Date.now()) r.job.cancel('timeout');
  }
  const conv = currentConv();
  if (conv) renderReplyState(state.conv.kind, conv);
}

function updateSendBtn() {
  const conv = currentConv();
  const r = conv ? rtOf(convKey(state.conv.kind, conv.id)) : null;
  const streaming = r && r.phase === 'streaming' && !inputEl.value.trim();
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

/** start <= hour < end，支持跨零点（23 → 8）。 */
function hourIn(hour, start, end) {
  const a = ((Number(start) % 24) + 24) % 24;
  const b = ((Number(end) % 24) + 24) % 24;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return false;
  return a < b ? (hour >= a && hour < b) : (hour >= a || hour < b);
}

/** 设置里的免打扰时段：只挡她自己冒出来的消息。 */
function quietNow() {
  const s = state.settings;
  if (!s || !s.quietOn) return false;
  return hourIn(new Date().getHours(), s.quietStart ?? 23, s.quietEnd ?? 8);
}

/** 她的作息：wake/sleep 两个整点，留空=一直醒着。 */
function friendAsleep(f) {
  const own = (f && f.settings) || {};
  if (own.wake === undefined || own.wake === null || own.wake === ''
      || own.sleep === undefined || own.sleep === null || own.sleep === '') return false;
  return !hourIn(new Date().getHours(), own.wake, own.sleep);
}

function quietFor(f) { return quietNow() || friendAsleep(f); }

function essayChanceFor(f) {
  const own = (f && f.settings) || {};
  // 旧的 essay 布尔值作废（老版本默认写 false，会把新概率压成 0）
  const v = own.essayChance !== undefined ? own.essayChance : (state.settings.essayChance ?? 15);
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 15;
}

function memoryNotesOf(f) {
  return ((f && f.memoryNotes) || []).map((x) => (typeof x === 'string' ? x : (x && x.text) || ''))
    .map((x) => String(x).trim()).filter(Boolean);
}

function memorySysFor(f) {
  let out = '';
  const notes = memoryNotesOf(f);
  if (notes.length) {
    out += '\n\n【他明确要求你记住的事（必须遵守，不要忘；下面是他写的原话，里面的「我」指的都是他）】\n'
      + notes.slice(0, 30).map((n) => '- ' + n.slice(0, 120)).join('\n');
  }
  if (f && f.memory && !f.memoryOff) {
    out += '\n\n【你记得的事（旁观记录：「他」= 和你聊天的人；里面若还出现「我」，指的也是他，不是你）】\n'
      + String(f.memory).slice(0, 1200);
  }
  const evs = ((f && f.events) || []).slice(-4)
    .map((e) => String((e && e.text) || '').trim()).filter(Boolean);
  if (evs.length) {
    out += '\n\n【你最近的生活（背景，不用主动汇报；聊到了可以自然带出来）】\n'
      + evs.map((x) => '- ' + x.slice(0, 80)).join('\n');
  }
  return out;
}

/** 连发时：先「停一下」1 秒看她补充了什么，再往后推 1 秒她才开始打。 */
const FOLLOWUP_PAUSE_MS = 1000;
const FOLLOWUP_PUSH_MS = 1000;

/**
 * 等待区间。好友自己的节奏优先，留空跟随全局；delayMax=0 = 不装忙，立刻回。
 * 抽成函数是为了设置页能显示「现在到底生效几秒」——以前好友的值压住全局，
 * 界面上却还写着全局的 3~10，怎么调都像是没生效。
 */
function delayRange(friend) {
  const on = !!fs(friend, 'delayOn', true);
  const rawMin = Number(fs(friend, 'delayMin', 5));
  const rawMax = Number(fs(friend, 'delayMax', 30));
  let min = Number.isFinite(rawMin) ? rawMin : 5;
  let max = Number.isFinite(rawMax) ? rawMax : 30;
  min = Math.max(0, Math.min(600, min));
  max = Math.max(0, Math.min(600, max));
  if (min > max) min = max;              // 和以前一样：最长是硬上限
  return { on, min, max };
}

/**
 * 假等待：在 [最短, 最长] 里均匀随机。
 * 用户设 3~10 秒，就是每一秒机会一样——不能老往 3 秒那一头挤。
 */
function delayFor(friend) {
  const { on, min, max } = delayRange(friend);
  if (!on) return 400;
  if (max <= 0) return 0;
  // 整个区间里均匀随机：设成 3~10 秒，就是 3~10 秒里的每一秒机会一样，
  // 不是老往 3 秒那一头挤。
  return Math.max(0, min + Math.random() * (max - min)) * 1000;
}

/* ---------- 提前生成：到点直接整条到 ---------- */

/** 一轮回复最多等多久：模型/中转忙的时候 90 秒根本不够，给到 10 分钟（随时可以按「停止」）。 */
const REPLY_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 开一轮生成：job 里带取消开关和结果 promise。
 * 等待期就开始跑（prefetch），到点直接把整条消息发出来 —— 不逐字、也不冒加载气泡。
 */
function beginGeneration(kind, conv, r) {
  const job = { inputId: lastUserId(conv), cancelled: false, abort: null,
    expiresAt: Date.now() + REPLY_TIMEOUT_MS, painted: '', rt: r };
  const cancelled = new Promise((_, reject) => {
    job.cancel = (reason) => {
      if (job.cancelled) return;
      job.cancelled = reason;
      reject(new Error(reason === 'timeout'
        ? '回复超时了，请检查网络或模型接口后重试。'
        : reason === 'offline' ? '网络断了，这条没发出去，再发一次？' : '回复已取消'));
      if (job.abort) { try { job.abort(); } catch (_) {} }
    };
  });
  job.cancelledPromise = cancelled;
  const friend = kind === 'friend' ? conv : null;
  job.result = Promise.race([runChat(friend, conv, job, r.nudge || null), cancelled]);
  job.result.catch(() => {});            // 出错有人接；这里只是别留下未处理的 rejection
  job.watchdog = setTimeout(() => { if (r.job === job) job.cancel('timeout'); }, REPLY_TIMEOUT_MS);
  return job;
}

/** 等待期先跑一遍；连发时按合并后的内容重来（她不能只回第一句）。 */
function prefetchReply(kind, conv, r) {
  if (r.job) { clearTimeout(r.job.watchdog); r.job.cancel('superseded'); }
  r.painted = '';
  const job = beginGeneration(kind, conv, r);
  r.job = job;
  r.abort = () => job.cancel('stopped');
  return job;
}

function scheduleReply(kind, conv, isNew, immediate = false) {
  const key = convKey(kind, conv.id);
  const r = rtOf(key);
  if (r.phase === 'streaming') {
    r.queued = true;
    // 尚未发送的旧答案不再落地；合并最新消息后生成。已经发送的分段让它发完。
    if (kind === 'friend' && r.job && !r.delivering) r.job.cancel('superseded');
    return;
  }
  // 连发：先停 1 秒「看她补充了什么」，再往后推 1 秒（总共 +2 秒），
  // 同时按合并后的内容重新生成。上限还是 45 秒，别真的晾着人。
  if (r.phase === 'waiting') {
    const cap = Math.max(Number(state.settings.delayMax) || 30, 45) * 1000;
    const next = Math.min(r.since + cap,
      (r.deadline || Date.now()) + FOLLOWUP_PAUSE_MS + FOLLOWUP_PUSH_MS);
    if (next > (r.deadline || 0)) {
      r.deadline = next;
      clearTimeout(r.timer);
      r.timer = setTimeout(() => startReply(kind, conv), Math.max(0, next - Date.now()));
    }
    if (kind === 'friend' && canGenerate()) prefetchReply(kind, conv, r);
    renderReplyState(kind, conv);
    return;
  }
  r.since = Date.now();
  r.phase = 'waiting';
  r.stopped = false;
  r.error = '';
  r.queued = false;
  r.painted = '';
  const delay = immediate ? 0 : delayFor(kind === 'friend' ? conv : null);
  r.deadline = r.since + delay;
  clearTimeout(r.timer);
  r.timer = setTimeout(() => startReply(kind, conv), delay);
  // 等待期就把模型请求发出去：这几秒是白等的，正好拿来生成。
  // 没填 Key / 模型名就先别发，到点由 startReply 给一句人话。
  if (!immediate && kind === 'friend' && canGenerate()) prefetchReply(kind, conv, r);
  renderReplyState(kind, conv);
}

async function startReply(kind, conv) {
  const key = convKey(kind, conv.id);
  const r = rtOf(key);
  if (r.phase !== 'waiting') return;
  clearTimeout(r.timer);
  r.timer = null;
  r.deadline = 0;
  if (convById(kind, conv.id) !== conv) { r.phase = 'idle'; return; }

  const friend = kind === 'friend' ? conv : null;
  const authorId = kind === 'friend' ? conv.id : (conv.members[0] || conv.id);
  const k = (state.settings.apiKey || '').trim();
  const precheck = !k
    ? '还没填 API Key，点「我的」→ 设置'
    : (!state.settings.model ? '还没填模型名，试试 deepseek-flash' : '');
  if (precheck) {
    if (r.job) { clearTimeout(r.job.watchdog); r.job.cancel('stopped'); }
    r.job = null;
    r.abort = null;
    r.phase = 'idle';
    r.error = precheck;
    renderReplyState(kind, conv);
    return;
  }

  r.phase = 'streaming';
  r.stopped = false;
  r.delivering = false;
  let job = r.job;
  if (!job || job.cancelled || job.inputId !== lastUserId(conv)) {
    if (job) { clearTimeout(job.watchdog); job.cancel('superseded'); }
    job = beginGeneration(kind, conv, r);
    r.job = job;
    r.abort = () => job.cancel('stopped');
  }
  // 到点：不冒加载气泡，直接等这一轮结果。回复通常在等待期就生成好了，
  // 所以这里基本是立刻把整条消息发出来。
  renderReplyState(kind, conv);

  try {
    let text = await job.result;
    if (job.cancelled || rt.get(key) !== r || convById(kind, conv.id) !== conv) return;
    // 同步也可能带来新的用户消息；不能把过期答案发在新问题后面。
    if (kind === 'friend' && job.inputId !== lastUserId(conv)) { r.queued = true; return; }
    if (!text.trim()) throw new Error('这次没收到内容，再试一次？');
    if (r.late && Math.random() < 0.75) text = '刚在忙，才看到。\n' + text;
    r.late = false;
    if (!r.painted) r.painted = text;
    if (job.cancelled || rt.get(key) !== r) return;
    r.delivering = true;
    clearTimeout(job.watchdog);
    renderReplyState(kind, conv);
    await deliver(kind, conv, text, authorId, undefined,
      () => !job.cancelled && rt.get(key) === r && convById(kind, conv.id) === conv);
    r.answeredUpTo = job.inputId;
    if (r.proactive && friend && friend.settings && friend.settings.nextProactive) {
      delete friend.settings.nextProactive;
      rememberFriendEdit(friend, { settings: { nextProactive: null } });
      persist();
    }
  } catch (err) {
    if (job.cancelled !== 'superseded' && job.cancelled !== 'stopped') {
      r.error = friendlyError(err);
    }
  } finally {
    clearTimeout(job.watchdog);
    if (r.job === job) { r.job = null; r.abort = null; }
    r.nudge = null;
    r.proactive = false;
    r.delivering = false;
    r.phase = 'idle';
    r.painted = '';
    const queued = r.queued && !r.stopped && (job.cancelled === 'superseded'
      || job.inputId !== lastUserId(conv));
    r.queued = false;
    r.stopped = false;
    if (rt.get(key) === r && convById(kind, conv.id) === conv) {
      if (queued) scheduleReply(kind, conv, true, true);
      else renderReplyState(kind, conv);
      if (isActive(kind, conv.id)) { scrollBottom(true); updateFab(); }
    }
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

      // 群里也只写状态文字，不冒三个点的气泡
      if (isActive('group', group.id)) setStatus(f.name + ' 正在输入…');

      try {
        const k = (state.settings.apiKey || '').trim();
        if (!k) throw new Error('还没填 API Key，点「我的」→ 设置');
        const text = await runChat(f, group, r, null);
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
          // 同样只写状态文字，不冒三个点的气泡
          if (isActive('group', group.id)) setStatus(f2.name + ' 正在输入…');
          try {
            const t2 = await runChat(f2, group, r, null);
            if (t2 && t2.trim()) await deliver('group', group, t2, f2.id);
          } catch (e) {
            // 接话失败就算了，别把整轮群聊带崩
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

const notifyLast = new Map();

/** 新消息提醒：mac 走原生通知（会判断窗口是否在前台），浏览器退回 Web Notification。
 *  同一个会话 15 秒内只弹一次，避免一次拆 5 条就炸 5 个通知。 */
function notifyPeer(name, text, convId, kind) {
  const body = String(text || '').trim().slice(0, 80);
  if (!body) return;
  const key = (kind || 'friend') + ':' + (convId || '');
  const now = Date.now();
  if (now - (notifyLast.get(key) || 0) < 15000) return;
  notifyLast.set(key, now);

  const bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.notify;
  if (bridge) {
    try {
      bridge.postMessage({ title: name || '轻聊', body: body, conv: convId || '', kind: kind || 'friend' });
      return;
    } catch (_) {}
  }
  // Android 壳：WebView 里没有 Web Notification，只能交给原生弹（App 在前台时不弹）
  const android = window.QingliaoNotify;
  if (android && typeof android.show === 'function') {
    try {
      const inFront = typeof android.foreground === 'function' ? !!android.foreground() : false;
      if (!inFront && android.show(name || '轻聊', body, kind || 'friend', convId || '')) return;
    } catch (_) {}
  }
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!document.hidden) return;
  try { new Notification(name, { body: body.slice(0, 60) }); } catch (_) {}
}

/** 点通知时，mac 壳会调这个函数把对应聊天打开 */
window.qingliaoOpenConv = function (kind, id) {
  try {
    if (!id) return;
    openChat(kind === 'group' ? 'group' : 'friend', id);
  } catch (_) {}
};

/* 在表情包库里找一张「标签出现在这段文字里」的；找不到返回 null。 */
function findStickerByText(text) {
  const t = String(text || '');
  if (!t) return null;
  return stickers().find((x) => (x.tags || []).some((tag) => tag && t.includes(tag))) || null;
}

/* 这一回合骰子进了、但模型没写 [[表情:…]] 时，替它挑一张。
   优先关键词（触发词）→ 回复文字 → 随便一张。没有就返回 null。 */
function pickStickerForText(text, trigger) {
  const pool = stickers();
  if (!pool.length) return null;
  return findStickerByText(trigger) || findStickerByText(text)
    || pool[Math.floor(Math.random() * pool.length)] || null;
}

/* ---------------- 她会发照片：调接口、存图、贴进聊天 ---------------- */

/** 生图一张要几分钟（中转站经常五六分钟），不能套同步那 25 秒；给到 10 分钟。 */
const PHOTO_TIMEOUT_MS = 10 * 60 * 1000;

/** 生图请求的返回包成人话；/api/search 这类中转也走同一套。 */
async function readPhotoJson(res) {
  // 先读文本再解析：中转/网关挂掉时经常返回一整页 HTML，得把状态和标题带出来
  const rawText = (typeof res.text === 'function') ? await res.text().catch(() => '') : '';
  let data = null;
  try { data = rawText ? JSON.parse(rawText) : null; } catch (_) { data = null; }
  // 兼容测试/老环境里只给 json() 的 Response 替身
  if (!data && !rawText && typeof res.json === 'function') {
    try { data = await res.json(); } catch (_) { data = null; }
  }
  const err = data && data.error;
  const ctRaw = (res.headers && typeof res.headers.get === 'function')
    ? (res.headers.get('Content-Type') || '') : '';
  const ct = ctRaw.split(';')[0].trim();
  const plain = String(rawText || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!res.ok || err) {
    const detail = err ? (typeof err === 'string' ? err : (err.message || JSON.stringify(err))) : '';
    if (detail) throw new Error(String(detail).slice(0, 200));
    throw new Error(('生图接口返回 ' + res.status)
      + (ct ? '（' + ct + '）' : '') + (plain ? '：' + plain.slice(0, 100) : ''));
  }
  if (!data || typeof data !== 'object') {
    // 不是 JSON：多半是中转/网关返回了网页（502、Cloudflare 验证、登录页）或空响应
    const title = (String(rawText || '').match(/<title[^>]*>([^<]{1,80})<\/title>/i) || [])[1] || '';
    let msg = '生图接口返回的不是 JSON';
    msg += '（' + (ct || '无 Content-Type') + '，HTTP ' + res.status + '）';
    msg += '：' + (String(title).trim() || plain.slice(0, 100) || '返回是空的');
    throw new Error(msg.slice(0, 200));
  }
  return data;
}

async function urlToDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('图片下载失败（' + res.status + '）');
  const blob = await res.blob();
  const out = await blobToDataUrl(blob);
  if (!out) throw new Error('图片下载失败');
  return out;
}

/**
 * 发一次生图请求。三条路和聊天一样：
 *   本机模式 → /__proxy；单机/APK → 直接 fetch；连服务器 → /api/image。
 * 超时给到 200 秒：生图一张本来就慢，不能套同步那 25 秒。
 */
async function photoRequest(url, key, body) {
  if (IS_LOCAL_SERVER && isSameOriginAsServer()) {
    const res = await fetch('/__proxy', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', 'X-Target-Url': url },
        key ? { 'X-Target-Key': key } : {}),
      body: JSON.stringify(body),
    });
    return await readPhotoJson(res);
  }
  if (!isCloud()) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, PHOTO_TIMEOUT_MS) : null;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' },
          key ? { Authorization: 'Bearer ' + key } : {}),
        body: JSON.stringify(body),
        signal: ctrl ? ctrl.signal : undefined,
      });
      return await readPhotoJson(res);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  let res = await apiFetch('/api/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, key, body }),
    timeout: PHOTO_TIMEOUT_MS + 20000,
  });
  // 老版本服务器还没有 /api/image：退回通用 JSON 代理（它只有 30 秒上限，慢的中转会超时）
  if (res.status === 404) {
    res = await apiFetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, key, body }),
      timeout: 60000,
    });
  }
  return await readPhotoJson(res);
}

/** 生图返回的 JSON → data:image/...（b64 和 url 两种返回都认）。 */
async function readPhotoResponse(data) {
  const list = Array.isArray(data && data.data) ? data.data : [];
  const item = (list[0] && typeof list[0] === 'object') ? list[0] : {};
  const str = (x) => (typeof x === 'string' ? x : '');
  // 有的中转会把它实际用的提示词回给我们：她之后要「记得」这张长什么样，这个比她自己写的准
  lastPhotoRevised = str(item.revised_prompt);
  let out = str(item.b64_json) || str(item.b64) || str(item.base64) || str(item.image_base64);
  if (out && !/^data:/i.test(out)) {
    const fmt = String(item.output_format || item.format || 'png').toLowerCase();
    out = 'data:image/' + (fmt === 'jpg' ? 'jpeg' : fmt) + ';base64,' + String(out).replace(/\s+/g, '');
  }
  if (!out && typeof item.url === 'string' && item.url) out = await urlToDataUrl(item.url);
  if (!out) throw new Error('生图接口没返回图片：' + JSON.stringify(data || {}).slice(0, 140));
  return out;
}

/** 中转的内容审核把提示词拦了（不是接口不支持，别拿它当「退回纯文字」的理由）。 */
function isContentBlocked(e) {
  const msg = String((e && e.message) || e || '');
  return /guardrails?|violate|nudity|sexuality|erotic|content.?policy|safety.?system|敏感|违规|审核/i.test(msg);
}

/** 生图失败 → 聊天里那句人话。 */
function photoErrorText(e) {
  const raw = String((e && e.message) || e || '').trim();
  if (isContentBlocked(e)) {
    return '中转的安全审核拦了这张（被判成成人/敏感内容），换个场景描述或换张参考图再试';
  }
  if (/401|403|Key|余额/i.test(raw)) return '生图 Key 不对，或者没余额';
  if (/连不上|网络|超时|abort/i.test(raw)) return '连不上生图接口（或者超时了）';
  return raw.slice(0, 180) || '未知原因';
}

/** 参考图是不是这个中转根本不支持（只有这种情况才退回纯文字生图）。 */
function isRefsUnsupported(e) {
  const msg = String((e && e.message) || e || '');
  if (isContentBlocked(e)) return false;
  if (/401|403|Key|余额|网络|连不上|超时/i.test(msg)) return false;
  if (/not\s*support|unsupport|unknown parameter|unrecognized|invalid|不支持/i.test(msg)) return true;
  return /(\b400\b|\b404\b|\b405\b|\b415\b|\b422\b)/.test(msg)
    && /image|file|field|parameter|form/i.test(msg);
}

let safeRetryAt = 0;
function noteSafeRetry() {
  const now = Date.now();
  if (now - safeRetryAt < 10 * 60 * 1000) return;
  safeRetryAt = now;
  toast('中转的审核拦了一次，换成干净描述重试成功了', 4000);
}

/** 生成一张照片：中转的安全审核拦了，就用「干净版」提示词（去掉人设和聊天原文）再试一次。 */
async function genPhoto(scene, friend, cfg) {
  try {
    return await genImage(buildPhotoPrompt(scene, friend, cfg), cfg);
  } catch (e) {
    if (!isContentBlocked(e)) throw e;
    const out = await genImage(buildPhotoPrompt(scene, friend, cfg, { safe: true }), cfg);
    noteSafeRetry();
    return out;
  }
}

let refsWarnAt = 0;
function noteRefsUnsupported() {
  const now = Date.now();
  if (now - refsWarnAt < 10 * 60 * 1000) return;
  refsWarnAt = now;
  toast('这个中转不支持参考图（/images/edits），这次按纯文字生图', 5000);
}

/** 参考图 → data URL（@blob: 从服务器取；统一压到 768 的 JPEG，少占地方）。 */
async function refToDataUrl(ref, max = 2048) {
  let url = String(ref || '');
  if (!url) return '';
  if (url.startsWith('@blob:')) {
    if (!isCloud()) return '';
    try {
      const res = await apiFetch('/api/blob/' + encodeURIComponent(url.slice(6)), { timeout: 20000 });
      if (!res.ok) return '';
      url = await blobToDataUrl(await res.blob());
    } catch (_) {
      return '';
    }
  }
  if (!url) return '';
  return await shrinkPhoto(url, max, 0.88);
}

/**
 * 带参考图的一次生图：走 OpenAI 兼容的 /v1/images/edits（multipart）。
 * 有服务器就让服务器拼 multipart（页面不用管跨域）；单机/APK 自己拼 FormData 直发。
 */
async function photoEditRequest(url, key, body, images) {
  const dataUrls = (images || []).filter(Boolean).slice(0, 6);
  if (!dataUrls.length) throw new Error('没有可用的参考图');
  if (isCloud() || (IS_LOCAL_SERVER && isSameOriginAsServer())) {
    const res = await apiFetch('/api/image-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, key, body, images: dataUrls }),
      timeout: PHOTO_TIMEOUT_MS + 20000,
    });
    if (res.status === 404) throw new Error('服务器还是旧版，不支持参考图（重新部署后就好了）');
    return await readPhotoJson(res);
  }
  const fd = new FormData();
  Object.keys(body || {}).forEach((k) => fd.append(k, String(body[k])));
  for (let i = 0; i < dataUrls.length; i += 1) {
    const blob = await (await fetch(dataUrls[i])).blob();
    fd.append('image[]', blob, 'ref' + i + '.jpg');
  }
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, PHOTO_TIMEOUT_MS) : null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: key ? { Authorization: 'Bearer ' + key } : {},
      body: fd,
      signal: ctrl ? ctrl.signal : undefined,
    });
    return await readPhotoJson(res);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 一次生图：返回 data:image/...；这个角色有参考图就走 edits，没有就走 generations。 */
/** 生图接口回的 revised_prompt（没有就是空串）。 */
let lastPhotoRevised = '';

async function genImage(prompt, cfg) {
  const c = cfg || photoConfig();
  lastPhotoRevised = '';
  if (!String(c.base || '').trim()) throw new Error('还没填生图接口地址');
  const body = { model: c.model, prompt: String(prompt || '').slice(0, 4000), n: 1 };
  if (c.size && c.size !== 'auto') body.size = c.size;
  // 清晰度：auto 就整个不发，省得有的中转不认这个字段
  if (c.quality && c.quality !== 'auto') body.quality = c.quality;
  const refs = (c.refs || []).slice(0, 6);
  if (refs.length) {
    try {
      const images = [];
      for (const r of refs) {
        const d = await refToDataUrl(r);
        if (d) images.push(d);
      }
      if (images.length) {
        const data = await photoEditRequest(imagesApiUrl(c.base, 'edits'), c.key, body, images);
        return await readPhotoResponse(data);
      }
    } catch (e) {
      if (!isRefsUnsupported(e)) throw e;
      noteRefsUnsupported();
    }
  }
  const data = await photoRequest(imagesEndpoint(c.base), c.key, body);
  return await readPhotoResponse(data);
}

/**
 * 让她看一下自己刚生成的那张图，写一句「这张拍的是什么」。
 *
 * 聊天接口不支持 assistant 角色带图片，所以她本来只能记住自己写的画面描述——
 * 万一图和她想的不一样（比如又拍成自拍），她说的话就和图对不上。
 * 开着「让她看图」时，用同一个模型先看一眼，把这句话存进消息，下一轮她就知道自己发了什么。
 * 失败就退回她自己写的描述，不影响发图。
 */
async function describeOwnPhoto(dataUrl, friend) {
  if (!state.settings.vision) return '';
  const key = (state.settings.apiKey || '').trim();
  if (!key || !state.settings.model || !dataUrl) return '';
  try {
    const text = await quickChat([
      { role: 'system', content: '你在看一张照片，用一句话说清这张照片拍的是什么（谁/什么东西、在哪、在做什么、镜头对着什么），'
        + '不超过 40 字，不要引号、不要解释。' },
      { role: 'user', content: [
        { type: 'text', text: '这张照片拍的是什么？' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ] },
    ]);
    return cleanLine(text, 60);
  } catch (_) {
    return '';
  }
}

/** 生图返回的 PNG 动辄两三 MB：统一转 JPEG 再存，状态文件才不会被照片撑大。 */
function shrinkPhoto(dataUrl, max, quality) {
  return new Promise((resolve) => {
    if (!dataUrl || !/^data:image\//i.test(dataUrl)) return resolve(dataUrl || '');
    const img = new Image();
    img.onload = () => {
      const w = img.width || 1;
      const h = img.height || 1;
      const scale = Math.min(1, max / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * scale));
      c.height = Math.max(1, Math.round(h * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      try { resolve(c.toDataURL('image/jpeg', quality)); } catch (_) { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/** 模型没写 [[照片:…]] 时的兜底：让她用一句话说清这一张拍什么。 */
async function genPhotoScene(friend, trigger) {
  const key = (state.settings.apiKey || '').trim();
  if (!key || !state.settings.model) return '';
  const recent = ((friend && friend.messages) || []).slice(-6)
    .filter((m) => m.role !== 'system' && (m.text || m.image) && !m.recalled)
    .map((m) => (m.role === 'user' ? (state.me.name || '他') : ((friend && friend.name) || '她')) + '：'
      + (m.text || (m.photo ? '（发了一张照片）' : '（发了图片）')))
    .join('\n');
  try {
    const text = await quickChat([
      { role: 'system', content: '你在帮一个角色决定「这一张照片拍什么」，写给文生图模型用。\n'
        + '只输出一句中文描述（不超过 80 字）：先说清这张拍的是什么（她自己，还是某样具体的东西 / 某个地方），'
        + '再说在哪、什么机位、什么光；如果他刚才问的是某件事/某个东西，就拍那个，别拍成自拍。\n'
        + '不要引号、不要解释、不要编号。' },
      { role: 'user', content: '角色：' + ((friend && friend.name) || '她') + '\n人设：'
        + String((friend && friend.persona) || '').slice(0, 300) + '\n最近聊的：\n' + (recent || '（没聊什么）')
        + (trigger ? '\n她刚提到「' + trigger + '」。' : '') + '\n这一张拍什么？' },
    ]);
    return cleanLine(text, 120);
  } catch (_) {
    return '';
  }
}

/** 同一会话一次只生成一张，失败也别把聊天卡住。 */
const photoJobs = new Map();
let photoErrorAt = 0;

/**
 * 她要真的发一张照片：后台调生图接口 → 压成 2048 的 JPEG 存进消息 → 贴到聊天里。
 * 十几秒到一分钟，所以不挡文字（文字先到，图好了再出现），失败只在当前聊天里提示一句。
 */
/** 最近一次「剥完标记什么都不剩」的模型原文（随 _diag 发一次，帮服务器侧排障） */
let lastEmptyReply = '';

function startPhotoJob(kind, conv, authorId, scene, trigger, canContinue, afterword) {
  const cfg = photoCfgFor(conv);
  if (!cfg.on || !cfg.ready || kind !== 'friend') return false;
  const key = convKey(kind, conv.id);
  if (photoJobs.has(key)) return false;    // 上一张还在生成：这一轮就不重复花钱了
  photoJobs.set(key, true);
  const ts = Date.now();
  if (isActive(kind, conv.id)) toast('她开始拍了，图好了会直接发到聊天里（要等一会儿）', 3000);
  const alive = () => (typeof canContinue !== 'function' || canContinue());
  // 状态栏那行小字等文字发完再写，不然刚写上就被 deliver 的「在线」盖掉
  setTimeout(() => {
    if (!photoJobs.has(key) || !alive() || !isActive(kind, conv.id)) return;
    const r = rt.get(convKey(kind, conv.id));
    if (r && r.phase !== 'idle') return;
    setStatus('正在拍照…');
  }, 1500);
  (async () => {
    try {
      let desc = String(scene || '').trim();
      lastPhotoRevised = '';                 // 上一次的 revised_prompt 不能漏到这一张
      if (!desc) desc = await genPhotoScene(conv, trigger);
      if (!desc) desc = trigger || '随手拍一张，画面自然';
      const dataUrl = await genPhoto(desc, conv, cfg);
      if (!alive()) return;                 // 这一轮被取消/替换了：图就不发了
      // 她「看见」的版本：模型自己看图的描述 > 中转回的 revised_prompt > 她自己写的画面
      const looked = await describeOwnPhoto(dataUrl, conv);
      const caption = String(looked || lastPhotoRevised || desc).slice(0, 160);
      const thumb = await shrinkPhoto(dataUrl, 420, 0.72);
      // 落盘按 2048 存（和用户发的图一个标准）：中转出更大的图时聊天里也能点开看清
      const stored = await shrinkPhoto(dataUrl, 2048, 0.9);
      const msg = { id: uid('m'), role: 'peer', authorId, text: '',
        image: stored, thumb, photo: caption, ts };
      // 照片的时间戳取「决定要发」的那一刻：中间他插话了也不会插到他后面去
      const insert = (m) => {
        const at = conv.messages.findIndex((x) => Number(x.ts) > Number(m.ts));
        if (at >= 0) conv.messages.splice(at, 0, m); else conv.messages.push(m);
      };
      insert(msg);
      const active = isActive(kind, conv.id);
      const redraw = () => {
        if (!isActive(kind, conv.id)) return;
        rememberScroll();
        renderChat();
        restoreScrollIfNeeded();
      };
      if (active) redraw();
      persist();
      // 照片落地之后，她再补一句——只用模型自己写在标记后面的那句。
      // 没写就不补：生硬的预设台词（尤其语言不对）比沉默更突兀。
      const say = String(afterword || '').trim();
      if (say && alive()) {
        await sleep(600 + Math.random() * 600);
        insert({ id: uid('m'), role: 'peer', authorId, text: say.slice(0, 80), ts: ts + 1 + Math.floor(Math.random() * 400) });
        if (isActive(kind, conv.id)) redraw();
        persist();
      }
      if (!active) {
        conv.unread = (conv.unread || 0) + 1;
        notifyPeer(nameOf(authorId), '[照片]', conv.id, kind);
      }
      renderConversations();
    } catch (e) {
      const now = Date.now();
      // 生图失败不能只闪 4 秒 toast：在聊天里留一行灰字，过一会儿回来也看得到。
      // 一分钟最多一条，别刷屏。
      if (now - photoErrorAt > 60000) {
        photoErrorAt = now;
        const line = { id: uid('m'), role: 'system',
          text: '照片没发出来：' + photoErrorText(e), ts };
        const at = conv.messages.findIndex((m) => Number(m.ts) > ts);
        if (at >= 0) conv.messages.splice(at, 0, line); else conv.messages.push(line);
        if (isActive(kind, conv.id)) {
          rememberScroll();
          renderChat();
          restoreScrollIfNeeded();
          renderReplyState(kind, conv);
        }
        persist();
        if (isActive(kind, conv.id)) toast('照片没发出来（看聊天里那行灰字）', 4000);
      }
      console.warn('[photo]', e);
    } finally {
      photoJobs.delete(key);
      if (isActive(kind, conv.id)) renderReplyState(kind, conv);
    }
  })();
  return true;
}

async function deliver(kind, conv, text, authorId, maxParts, canContinue = () => true) {
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

  // 模型有时会照抄历史里的系统标注，必须在发出去之前清掉
  const scrub = (t) => String(t || '')
    .replace(/[（(]\s*(你刚|刚刚?)?发(了)?一个?表情包[：:][^）)]*[）)]/g, '')
    .replace(/[（(]\s*(你刚|刚刚?)?发了一张图片[）)]/g, '')
    .replace(/[（(]\s*(你刚|刚刚?)?发了一张照片([：:][^）)]*)?[）)]/g, '')
    .trim();

  // 表情包：把 [[表情:关键词]] 取出来，找到对应的图，剩下的才是文字
  const stickerGate = (conv && typeof conv === 'object') ? conv.__stickerThisTurn : undefined;
  const stickerTrigger = (conv && typeof conv === 'object') ? (conv.__stickerTrigger || '') : '';
  const pool = stickerGate === false ? [] : stickers();
  const usedStickers = [];
  let body = String(text || '');
  body = scrub(body);
  body = body.replace(/\[\[表情[:：]([^\]\n]+)\]\]/g, (_all, kw) => {
    const key = String(kw || '').trim();
    let hit = pool.find((x) => (x.tags || []).some((t) => t && (key.includes(t) || t.includes(key))));
    if (!hit && pool.length) hit = pool[Math.floor(Math.random() * pool.length)];
    if (hit && usedStickers.length < 2 && !usedStickers.includes(hit)) usedStickers.push(hit);
    return '';
  }).trim();

  // 照片：[[照片:画面描述]] 不发给他看，换成一张真的生成出来的照片。
  // 不管这一轮有没有抽中，标记都要剥掉——模型有时会自己硬写。
  const photoGate = (conv && typeof conv === 'object') ? conv.__photoThisTurn : undefined;
  const photoTrigger = (conv && typeof conv === 'object') ? (conv.__photoTrigger || '') : '';
  let photoScene = '';
  let photoAfter = '';
  const photoHit = body.match(/\[\[照片[:：]([^\]\n]{1,300})\]\]/);
  if (photoHit) {
    photoScene = String(photoHit[1] || '').trim();
    // 标记后面写的话：等照片发出去之后再补给她，像真人拍完补一句
    const tail = body.slice(photoHit.index + photoHit[0].length).trim();
    body = body.slice(0, photoHit.index);
    if (tail) {
      photoAfter = tail.split('\n').map((x) => x.trim()).filter(Boolean).join('\n')
        .replace(/\[\[[^\]]*\]\]/g, '').trim().slice(0, 80);
    }
    body = body.replace(/\[\[照片[:：][^\]\n]{1,300}\]\]/g, '').trim();
  }
  if (conv && typeof conv === 'object') {
    conv.__photoThisTurn = undefined;
    conv.__photoTrigger = '';
  }

  // 文件块：[[文件:名字.ext]] … [[/文件]] → 文件卡片消息
  const files = [];
  body = body.replace(/\[\[文件[:：]([^\]\n]{1,80})\]\]\s*\n?([\s\S]*?)\n?\[\[\/文件\]\]/g, (_all, name, content) => {
    const nm = String(name || '').trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '文件.txt';
    const txt = String(content || '').replace(/^\s*\n/, '').replace(/\s+$/, '');
    if (txt) files.push({ name: nm, text: txt.slice(0, 80000) });
    return '';
  }).trim();

  // 兜底：他要文件、她却把长内容直接贴在聊天里（没写文件块）→ 自动收成文件
  const fileAsk = /(文件|文档|作文|文章|报告|清单|教程|整理成|发我|要一份|写一份|写个|写一篇|写一下)/;
  const longReply = body.length >= 320 || body.split('\n').length >= 8;
  if (!files.length && longReply && !/<svg[\s>]/i.test(body) && fileAsk.test(convLastUserText(conv))) {
    const stamp = new Date();
    const nm = '轻聊文档-' + stamp.getFullYear() + String(stamp.getMonth() + 1).padStart(2, '0')
      + String(stamp.getDate()).padStart(2, '0') + '-' + String(stamp.getHours()).padStart(2, '0')
      + String(stamp.getMinutes()).padStart(2, '0') + '.txt';
    files.push({ name: nm, text: body });
    body = '给你写好了，文件在下面。';
  }

  // 「提醒我」：[[提醒:2026-11-01 20:30|吃药]] → 收进她的提醒列表，到点由她开口。
  // 免打扰时段也照响：时间是你自己定的。
  const newReminders = [];
  body = body.replace(/\[\[提醒[:：]([^\]\n]{1,80})\]\]/g, (_all, spec) => {
    const raw = String(spec || '').trim();
    const bar = raw.lastIndexOf('|');
    const when = bar > 0 ? raw.slice(0, bar).trim() : raw;
    const what = bar > 0 ? raw.slice(bar + 1).trim() : '提醒你一件事';
    const due = parseReminderTime(when);
    if (due && what) newReminders.push({ id: uid('rm'), text: what.slice(0, 60), dueAt: due });
    return '';
  }).trim();

  // 画了图就整条发：按行拆会把 <svg> 拆成两半，图就没了
  // 空行/空白段不能算一条消息：否则会发出一个空气泡，或者把「没有可显示的内容」吞掉
  const parts = (/<svg[\s>]/i.test(body) ? [body] : splitReply(body, limit))
    .filter((x) => String(x || '').trim());

  // 她会打错字：挑一条，先发错字版，再撤回、重发正确的
  const recallOn = state.settings.recallOn !== false;
  const recallChance = Math.max(0, Math.min(50, Number(state.settings.recallChance ?? 20)));
  let typoAt = -1;
  if (kind === 'friend' && recallOn && recallChance > 0 && parts.length
      && Math.random() * 100 < recallChance) {
    const cands = [];
    parts.forEach((p, i) => {
      if (String(p).length >= 4 && !/<svg[\s>]/i.test(String(p))) cands.push(i);
    });
    if (cands.length) typoAt = cands[Math.floor(Math.random() * cands.length)];
  }

  // 改口：说完补一句「不是，我不是这个意思」，和撤回是两件事
  const rewordOn = state.settings.rewordOn !== false;
  const rewordChance = Math.max(0, Math.min(50, Number(state.settings.rewordChance ?? 10)));
  const doReword = kind === 'friend' && typoAt < 0 && rewordOn && rewordChance > 0
    && !/<svg[\s>]/i.test(body) && !files.length
    && Math.random() * 100 < rewordChance;
  const now = Date.now();
  // 时间戳必须单调：撤回的错字版要比后面的正确版早，否则服务端按 ts 排序会颠倒
  let tsCursor = now;
  const active = isActive(kind, conv.id);
  if (active) clearReadMark();

  // 照片：这一轮真抽中了、且有文字兜底（不发光秃秃的图）才去生成。
  // 生成放在后台跑：十几秒到一分钟，文字先到，图好了再贴上来。
  const hasTextNow = parts.some((x) => String(x || '').trim());
  // 她只写了 [[照片:…]] 没写字时也照发：加一句开场白太生硬，她直接发图就好
  const photoStarted = (photoGate === true && (hasTextNow || !!photoScene))
    ? startPhotoJob(kind, conv, authorId, photoScene, photoTrigger, canContinue, photoAfter)
    : false;

  let sentCount = 0;
  let notifyText = '';
  const appendReply = (m) => {
    conv.messages.push(m);
    if (isActive(kind, conv.id)) renderMessage(m, { conv, kind });
    else conv.unread = (conv.unread || 0) + 1;
    // 每一段落地就保存、同步，切后台时不必等最后一个模拟打字计时器。
    persist();
  };
  for (let i = 0; i < parts.length; i += 1) {
    if (i > 0 && isActive(kind, conv.id)) {
      setStatus('对方正在输入…');
      await sleep(380 + Math.random() * 620);
    }
    if (!canContinue()) return;
    if (i === typoAt) {
      const badText = typoText(parts[i]);
      if (badText && badText !== parts[i]) {
        const bad = { id: uid('m'), role: 'peer', authorId, text: badText, ts: tsCursor };
        tsCursor += 1000;
        appendReply(bad);
        await sleep(600 + Math.random() * 700);
        if (!canContinue()) return;
        bad.recalled = true;
        bad.text = '';
        persist();
        if (isActive(kind, conv.id)) { rememberScroll(); renderChat(); restoreScrollIfNeeded(); }
        else renderConversations();
        await sleep(420);
        if (!canContinue()) return;
      }
    }
    const m = { id: uid('m'), role: 'peer', authorId, text: parts[i], ts: tsCursor };
    tsCursor += 1000;
    if (!notifyText && String(parts[i] || '').trim()) notifyText = String(parts[i]).trim();
    appendReply(m);
    sentCount += 1;
  }

  // 改口：一小句「不是，我不是这个意思」
  if (doReword) {
    if (!canContinue()) return;
    const line = REWORD_LINES[Math.floor(Math.random() * REWORD_LINES.length)];
    const m = { id: uid('m'), role: 'peer', authorId, text: line, ts: tsCursor };
    tsCursor += 800;
    appendReply(m);
    sentCount += 1;
    await sleep(420);
  }

  // 文件跟在文字后面发
  for (const f of files) {
    if (!canContinue()) return;
    const m = { id: uid('m'), role: 'peer', authorId, text: '', file: f, ts: tsCursor };
    tsCursor += 300;
    appendReply(m);
    sentCount += 1;
    await sleep(180);
  }

  // 只剩表情包也照发：甩一张表情本来就不用配字，别因此报「没有可显示的内容」
  const hasText = parts.some((x) => String(x || '').trim());
  // 骰子进了但模型自己没写标记：替她补一张（只补一张）。
  // 不补的话「发消息带表情包的概率」就只是「允许她发」，模型不发就等于没这个设置。
  if (stickerGate === true && hasText && usedStickers.length === 0 && pool.length) {
    // 关键词触发的，优先找标签和关键词对得上的；找不到再按回复文字、最后随便一张
    const pick = pickStickerForText(body, stickerTrigger);
    if (pick) usedStickers.push(pick);
  }
  if (conv && typeof conv === 'object') {
    conv.__stickerThisTurn = undefined;
    conv.__stickerTrigger = '';
  }

  // 表情包跟在文字后面发
  for (const item of usedStickers) {
    if (!canContinue()) return;
    const m = { id: uid('m'), role: 'peer', authorId, text: '', image: item.url || '',
      sticker: true, stickerTags: (item.tags || []).slice(),
      stickerDesc: item.desc || '', ts: tsCursor };
    tsCursor += 300;
    appendReply(m);
    sentCount += 1;
    await sleep(320);
  }

  if (!canContinue()) return;
  // 清洗后没有可发送内容，也要给出可重试的错误，不能让输入气泡无声消失。
  if (!sentCount && !photoStarted) {
    // 留个证据：下次再出现能看出来模型到底回了什么（控制台 + 随同步诊断发给服务器）
    lastEmptyReply = String(text || '').slice(0, 220);
    try { console.warn('[EMPTY-REPLY]', JSON.stringify(String(text || '')).slice(0, 500)); } catch (_) {}
    throw new Error('这次没收到可显示的内容，再试一次？');
  }

  // 有新消息：通知交给原生层判断窗口是否在前台（前台就不弹）。
  // 浏览器则只在页面隐藏时弹，不会打扰正在看的人。
  {
    const fallback = usedStickers.length ? '[表情包]' : (photoStarted ? '[照片]' : (files.length ? '[文件]' : ''));
    const bodyText = plainText(notifyText).slice(0, 60) || fallback;
    if (bodyText) {
      const title = kind === 'group' ? (conv.name || '群聊') : nameOf(authorId);
      notifyPeer(title, kind === 'group' ? (nameOf(authorId) + '：' + bodyText) : bodyText,
        conv.id, kind);
    }
  }

  if (isActive(kind, conv.id)) {
    setStatus('在线');
    // 只发照片时这一轮还没有消息落库（照片是后台任务），别在这里取空数组的 ts
    const lastMsg = conv.messages[conv.messages.length - 1];
    if (lastMsg) {
      lastTs = lastMsg.ts;
      conv.unread = 0;
      conv.readAt = Math.max(Number(conv.readAt) || 0, lastTs);
      if (kind === 'friend') rememberFriendEdit(conv, { unread: 0, readAt: conv.readAt });
    }
    markRead();
  }
  // 提醒收好了：把「到点我提醒你」记进她的待办，存在服务器上（关掉 App 也会响）
  if (newReminders.length && owner && kind === 'friend') {
    owner.reminders = [...(owner.reminders || []), ...newReminders].slice(-50);
    rememberFriendEdit(owner, { reminders: owner.reminders });
    const first = newReminders[0];
    const d = new Date(first.dueAt);
    toast(`好，${d.getMonth() + 1} 月 ${d.getDate()} 日 ${pad(d.getHours())}:${pad(d.getMinutes())} 提醒你`);
  }
  lastActivity = Date.now();
  renderConversations();
  renderTabBadge();
  persist();
}

/** 「[[提醒:…]]」里的时间：支持 2026-11-01 20:30 / 20:30 / 11-01。 */
function parseReminderTime(str) {
  const s = String(str || '').trim();
  const now = Date.now();
  const ok = (t) => Number.isFinite(t) && t > now - 120000 && t < now + 800 * 86400000;
  let m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2}):(\d{2})/);
  if (m) {
    const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0).getTime();
    return ok(t) ? t : 0;
  }
  m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) {
    const d = new Date();
    d.setHours(+m[1], +m[2], 0, 0);
    if (d.getTime() < now - 60000) d.setDate(d.getDate() + 1);
    return ok(d.getTime()) ? d.getTime() : 0;
  }
  m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) {
    const t = new Date(+m[1], +m[2] - 1, +m[3], 9, 0, 0).getTime();
    return ok(t) ? t : 0;
  }
  return 0;
}

const REWORD_LINES = [
  '……不是，我不是这个意思。',
  '……啊不对，说错了。',
  '……算了，你就当我没说。',
  '……不对，我是说，随你吧。',
];

/** 生成一个「像手滑打错」的版本：交换相邻两个汉字。 */
function typoText(text) {
  const chars = Array.from(String(text || ''));
  if (chars.length < 4) return '';
  for (let i = 0; i < chars.length - 1; i += 1) {
    if (!/[\u4e00-\u9fa5]/.test(chars[i]) || !/[\u4e00-\u9fa5]/.test(chars[i + 1])) continue;
    const out = chars.slice();
    const t = out[i]; out[i] = out[i + 1]; out[i + 1] = t;
    const s = out.join('');
    if (s !== chars.join('')) return s;
  }
  return '';
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

let cloudGroupTypingTimer = null;

/** 云端群聊由服务器生成回复：这里只负责“她们正在输入…”的提示，让等待有反馈。 */
function cloudGroupAwait(group) {
  clearTimeout(cloudGroupTypingTimer);
  const started = Date.now();
  const step = () => {
    if (!isActive('group', group.id)) { cloudGroupTypingTimer = null; return; }
    const msgs = group.messages || [];
    let lastUser = -1;
    for (let i = msgs.length - 1; i >= 0; i -= 1) { if (msgs[i].role === 'user') { lastUser = i; break; } }
    const replied = lastUser >= 0 && msgs.slice(lastUser + 1).some((m) => m.role !== 'user');
    if (replied || Date.now() - started > 60000) {
      cloudGroupTypingTimer = null;
      setStatus('在线');
      return;
    }
    setStatus('她们正在输入…');
    cloudGroupTypingTimer = setTimeout(step, 2000);
  };
  cloudGroupTypingTimer = setTimeout(step, 1200);
}

function afterUserMessage(kind, conv) {
  if (kind === 'group') {
    // 云端模式下群聊统一由服务器生成，客户端不再插一手（否则两边各发各的，条数失控）
    if (isCloud()) { cloudGroupAwait(conv); return; }
    const r = rtOf(convKey('group', conv.id));
    // 上一轮卡死超过两分钟，直接放行，别再排队等
    if (r.phase !== 'idle' && r.since && Date.now() - r.since > 120000) {
      r.phase = 'idle'; r.queued = false; r.abort = null;
    }
    if (r.phase === 'idle') groupTurn(conv);
    else r.queued = true;
    return;
  }

  // 她上一次「已读没回」还没到点，你又发了 → 别晾着，这就回
  const wasLate = !!conv.lateReplyAt;
  if (wasLate) {
    conv.lateReplyAt = 0;
    rememberFriendEdit(conv, { lateReplyAt: 0 });
    persist();
  }
  const r = rtOf(convKey(kind, conv.id));
  r.nudge = null;
  r.proactive = false;

  // 偶尔先看一眼、过一会儿才回：概率/最长拖延都能在设置里调
  const lateOn = state.settings.lateOn === true;
  const lateChance = Math.max(0, Math.min(30, Number(state.settings.lateChance ?? 5)));
  const lateMaxMs = Math.max(60000, Math.min(30, Number(state.settings.lateMaxMin ?? 5) || 5) * 60000);
  if (!wasLate && r.phase === 'idle' && lateOn && lateChance > 0 && (conv.messages || []).length >= 6
      && Math.random() * 100 < lateChance) {
    conv.peerReadAt = Date.now();
    conv.lateReplyAt = Date.now() + 60000 + Math.random() * Math.max(0, lateMaxMs - 60000);
    rememberFriendEdit(conv, { peerReadAt: conv.peerReadAt, lateReplyAt: conv.lateReplyAt });
    persist();
    r.error = '';
    if (isActive('friend', conv.id)) renderChat();
    return;
  }

  scheduleReply(kind, conv, true, wasLate);
}

/** 到点了：她终于回了（别人看着像「已读，隔了一会儿才回」）。 */
function lateReplyTick() {
  const now = Date.now();
  let changed = false;
  for (const f of state.friends) {
    const due = Number(f.lateReplyAt) || 0;
    if (!due || (due > now && state.settings.lateOn === true)) continue;
    f.lateReplyAt = 0;
    f.peerReadAt = now;
    rememberFriendEdit(f, { lateReplyAt: 0, peerReadAt: now });
    changed = true;
    const r = rtOf(convKey('friend', f.id));
    if (r.phase !== 'idle') continue;
    const last = lastMessage(f);
    if (!last || last.role !== 'user') { renderReplyState('friend', f); continue; }
    r.late = state.settings.lateOn === true;
    scheduleReply('friend', f, true, true);
    if (isActive('friend', f.id)) renderChat();
  }
  if (changed) persist();
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
  closeMention();
  lastActivity = Date.now();
  if (kind === 'group' && isCloud()) saveHint = 'social';   // 让服务器马上接话
  persist();
  renderConversations();
  afterUserMessage(kind, conv);
}

async function sendImage(dataUrl) {
  const conv = currentConv();
  if (!conv) return;
  const kind = state.conv.kind;
  // 原图只放内存里给第一轮模型看；落盘/同步的是 2048 压缩版（+ 420 缩略图），
  // 这样服务器不会被 20MB 原图撑爆，第一眼又是最清楚的。
  const thumb = await resizeDataUrl(dataUrl, 420, 0.72);
  const stored = await resizeDataUrl(dataUrl, 2048, 0.9);
  const msg = { id: uid('m'), role: 'user', text: '', image: stored, thumb, ts: Date.now() };
  conv.__freshImage = { id: msg.id, data: dataUrl };
  conv.messages.push(msg);
  clearReadMark();
  renderMessage(msg, { conv, kind });
  scrollBottom(true);
  lastActivity = Date.now();
  if (kind === 'group' && isCloud()) saveHint = 'social';
  persist();
  renderConversations();
  afterUserMessage(kind, conv);
}

/**
 * 发红包：轻聊币是无限的，随便发。消息里只存金额和附言（很小），
 * 她通过 toApiMessage / 提示词看得到，会自己反应。
 */
function sendMoney(amount, note) {
  const conv = currentConv();
  if (!conv) return;
  const amt = Math.max(0.01, Math.min(999999, Number(amount) || 0));
  if (!amt) return toast('先填个金额');
  const kind = state.conv.kind;
  const msg = {
    id: uid('m'), role: 'user', text: '',
    money: { amount: Math.round(amt * 100) / 100, note: String(note || '').trim().slice(0, 20) },
    ts: Date.now(),
  };
  conv.messages.push(msg);
  clearReadMark();
  renderMessage(msg, { conv, kind });
  scrollBottom(true);
  lastActivity = Date.now();
  if (kind === 'group' && isCloud()) saveHint = 'social';
  persist();
  renderConversations();
  afterUserMessage(kind, conv);
}

function openCoinSheet() {
  const conv = currentConv();
  if (!conv) return;
  const isGroup = state.conv.kind === 'group';
  const el = ensureSheet('coinSheet', `
    <header class="sheet-nav">
      <button class="text-btn" data-close="coinSheet">关闭</button>
      <span class="sheet-title">发红包</span>
      <span></span>
    </header>
    <div class="sheet-body">
      <div class="group">
        <div class="group-title">${isGroup ? '发到群里' : '给她发'}</div>
        <div class="chips" id="coinChips">
          <button type="button" class="chip" data-amt="5.2">¥5.20</button>
          <button type="button" class="chip" data-amt="13.14">¥13.14</button>
          <button type="button" class="chip" data-amt="52">¥52</button>
          <button type="button" class="chip" data-amt="520">¥520</button>
          <button type="button" class="chip" data-amt="1314">¥1314</button>
        </div>
        <label class="field"><span>金额</span><input id="coinAmt" type="number" min="0.01" max="999999" step="0.01" value="52"></label>
        <label class="field"><span>附言</span><input id="coinNote" maxlength="20" placeholder="（可不填）"></label>
        <div class="row-btns"><button type="button" class="ghost solid" id="btnCoinSend">塞进红包</button></div>
        <p class="hint">轻聊币余额：<b>∞</b>（无限）——随便发，她收到会自己反应。</p>
      </div>
    </div>`);
  const amtEl = el.querySelector('#coinAmt');
  const noteEl = el.querySelector('#coinNote');
  if (!el.dataset.bound) {
    el.dataset.bound = '1';
    el.addEventListener('click', (ev) => {
      const close = ev.target.closest('[data-close]');
      if (close) {
        el.classList.remove('open');
        el.setAttribute('aria-hidden', 'true');
        return;
      }
      const chip = ev.target.closest('#coinChips .chip');
      if (chip && amtEl) { amtEl.value = chip.dataset.amt; return; }
      if (ev.target.id === 'btnCoinSend') {
        const amt = Number(amtEl && amtEl.value);
        if (!(amt > 0)) return toast('金额填大一点');
        sendMoney(amt, noteEl ? noteEl.value : '');
        el.classList.remove('open');
        el.setAttribute('aria-hidden', 'true');
        toast('红包发出去了');
      }
    });
  }
  if (amtEl) amtEl.value = '52';
  if (noteEl) noteEl.value = '';
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
}

/**
 * 你也能发表情包：和「她」的表情包共用同一个库（我的 → 表情包 里上传的那些），
 * 发出去就是一条表情消息；她也看得见你发了什么（见 toApiMessage 的「他发了一个表情包」）。
 */
function sendSticker(item) {
  const conv = currentConv();
  if (!conv || !item || !item.url) return;
  const kind = state.conv.kind;
  const msg = {
    id: uid('m'), role: 'user', text: '', image: item.url,
    sticker: true,
    stickerTags: Array.isArray(item.tags) ? item.tags.slice(0, 8) : [],
    stickerDesc: item.desc || '',
    ts: Date.now(),
  };
  conv.messages.push(msg);
  clearReadMark();
  renderMessage(msg, { conv, kind });
  scrollBottom(true);
  lastActivity = Date.now();
  if (kind === 'group' && isCloud()) saveHint = 'social';
  persist();
  renderConversations();
  closeEmoji();
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

/* ---------------- @ 提及群成员 ---------------- */

const mentionPop = $('#mentionPop');
let mentionCtx = null;      // { at, query, pos } —— 当前光标前那个 @ 的位置
let mentionItems = [];
let mentionIndex = 0;

function mentionMembers() {
  if (!state.conv || state.conv.kind !== 'group') return [];
  const conv = currentConv();
  if (!conv) return [];
  return (conv.members || []).map(friendById).filter(Boolean);
}

/** 光标是不是正停在一个「还没写完的 @」后面。 */
function mentionContext() {
  if (document.activeElement !== inputEl) return null;
  const pos = inputEl.selectionStart;
  if (pos == null || pos !== inputEl.selectionEnd) return null;
  const before = inputEl.value.slice(0, pos);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  // @ 必须在开头或紧跟空白，避免把邮箱之类的东西也当成提及
  if (at > 0 && !/[\s\n]/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > 24) return null;
  if (/[\s@]/.test(query)) return null;    // 打了空格就是不要提及了
  return { at, query, pos };
}

function closeMention() {
  mentionCtx = null;
  mentionItems = [];
  mentionIndex = 0;
  if (mentionPop) { mentionPop.hidden = true; mentionPop.textContent = ''; }
}

function paintMention() {
  if (!mentionPop) return;
  mentionPop.textContent = '';
  if (!mentionItems.length) { mentionPop.hidden = true; return; }
  const hint = document.createElement('div');
  hint.className = 'mention-hint';
  hint.textContent = '选一个人 @ 她';
  mentionPop.append(hint);
  mentionItems.forEach((f, i) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'mention-item' + (i === mentionIndex ? ' active' : '');
    row.dataset.id = f.id;
    row.append(avatarEl(f));
    const name = document.createElement('span');
    name.className = 'mention-name';
    name.textContent = f.name;
    row.append(name);
    // 用 mousedown 里 preventDefault，点的时候输入框不会先失焦
    row.addEventListener('mousedown', (e) => e.preventDefault());
    row.addEventListener('click', (e) => { e.preventDefault(); pickMention(f); });
    mentionPop.append(row);
  });
  mentionPop.hidden = false;
  const active = mentionPop.querySelector('.mention-item.active');
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
}

/** 每次输入 / 移动光标都重算一次，决定弹不弹、弹谁。 */
function updateMentionPicker() {
  const ctx = mentionContext();
  if (!ctx) { closeMention(); return; }
  const members = mentionMembers();
  if (!members.length) { closeMention(); return; }
  const q = ctx.query.trim().toLowerCase();
  const items = q
    ? members.filter((f) => (f.name || '').toLowerCase().includes(q))
    : members.slice();
  if (!items.length) { closeMention(); return; }
  // 同一个人被同一次输入反复筛出来时保持高亮不跳
  const keepId = mentionItems[mentionIndex] && mentionItems[mentionIndex].id;
  mentionCtx = ctx;
  mentionItems = items;
  const kept = keepId ? items.findIndex((f) => f.id === keepId) : -1;
  mentionIndex = kept >= 0 ? kept : 0;
  paintMention();
}

function pickMention(f) {
  const ctx = mentionCtx;
  if (!ctx || !f || !f.name) { closeMention(); return; }
  const value = inputEl.value;
  const insert = '@' + f.name + ' ';
  const after = value.slice(ctx.pos);
  inputEl.value = value.slice(0, ctx.at) + insert + after;
  const caret = ctx.at + insert.length;
  closeMention();
  try { inputEl.focus(); inputEl.setSelectionRange(caret, caret); } catch (_) {}
  autosize();
  // 走一遍正常的 input 流程：存草稿、按钮状态
  inputEl.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 返回 true 表示这个按键被选择器吃掉了，别再触发发送。 */
function mentionKeydown(e) {
  if (!mentionCtx || !mentionItems.length) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const step = e.key === 'ArrowDown' ? 1 : -1;
    mentionIndex = (mentionIndex + step + mentionItems.length) % mentionItems.length;
    paintMention();
    e.preventDefault();
    return true;
  }
  if (e.key === 'Enter' || e.key === 'Tab') {
    pickMention(mentionItems[mentionIndex]);
    e.preventDefault();
    return true;
  }
  if (e.key === 'Escape') {
    closeMention();
    e.preventDefault();
    return true;
  }
  return false;
}

inputEl.addEventListener('input', () => {
  autosize();
  updateSendBtn();
  updateMentionPicker();
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const conv = currentConv();
    if (!conv) return;
    state.drafts[convKey(state.conv.kind, conv.id)] = inputEl.value;
    if (NATIVE) persist();
  }, 400);
});

inputEl.addEventListener('blur', () => { setTimeout(closeMention, 120); });
inputEl.addEventListener('click', () => { setTimeout(updateMentionPicker, 0); });
inputEl.addEventListener('keyup', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) updateMentionPicker();
});

/* ---------------- 回车发送 ---------------- */

/**
 * 回车发送，但**不跟输入法抢**。
 *
 * 来回踩过的坑：
 *   1. 只看 isComposing → macOS 上把英文字母「上屏」的那下回车会误发；
 *   2. 加上 keyCode === 229 → 有些输入法连真回车都是 229，直接一条都发不出去；
 *   3. 在 keydown 里 preventDefault() → 有的输入法靠默认行为提交候选字，拦了等于把字吃掉，
 *      看起来就是「回车没反应」。
 *
 * 现在的做法：
 *   - keydown 里**不拦默认行为**，只记一笔「想发」；
 *   - 一个 tick 后看有没有 compositionend / 输入法填字事件：有就是上屏，撤销；没有才真的发。
 *   - 手机输入法有的只发 beforeinput（不发 keydown），那条路也接了。
 * 这样输入法想怎么提交都随它，我们只在「确实是回车」时发消息。
 */
function isImeKey(e) {
  return !!(e && e.isComposing);
}

/** 回车直接发消息？设置里能关；没设过就是开（和微信一样）。 */
function enterSendOn() {
  return state.settings.enterSend !== false;
}

let lastEnterSendAt = 0;
let pendingEnterSend = null;
function cancelPendingEnter() {
  if (pendingEnterSend) { clearTimeout(pendingEnterSend); pendingEnterSend = null; }
}

/** 最近几次输入事件的记录：万一还是不行，按「设置 → 其他 → 输入诊断」能看到。 */
const inputLog = [];
function logInput(type, e) {
  try {
    inputLog.push([type, e && e.key, !!(e && e.isComposing), e && e.keyCode,
      Math.round(Date.now() % 100000)].join(':'));
    if (inputLog.length > 12) inputLog.shift();
  } catch (_) {}
}

inputEl.addEventListener('keydown', (e) => {
  if (mentionKeydown(e)) return;
  if (e.key !== 'Enter') return;
  if (e.shiftKey) return;               // Shift + 回车永远是换行
  logInput('down', e);
  cancelPendingEnter();
  if (!enterSendOn()) return;           // 设置里关掉了：回车换行，点「发送」才发
  // 注意：这里不能 preventDefault（会打断输入法提交候选字）
  lastEnterSendAt = Date.now();
  pendingEnterSend = setTimeout(() => {
    pendingEnterSend = null;
    send();
  }, 0);
});

// 上屏会紧跟着这些事件：撤掉刚才那次发送，字留在输入框里
inputEl.addEventListener('compositionstart', () => logInput('cstart', null));
inputEl.addEventListener('compositionend', (e) => { logInput('cend', null); cancelPendingEnter(); });
inputEl.addEventListener('input', (e) => {
  if (e && /Composition/.test(String(e.inputType || ''))) cancelPendingEnter();
});
inputEl.addEventListener('blur', cancelPendingEnter);

// 有些手机输入法点「回车」只发一个换行输入事件，根本不派发 keydown
inputEl.addEventListener('beforeinput', (e) => {
  if (!e) return;
  if (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') return;
  logInput('before', e);
  if (!enterSendOn() || isImeKey(e)) return;
  if (Date.now() - lastEnterSendAt < 300) return;   // 上面那条 keydown 已经处理过了
  e.preventDefault();
  lastEnterSendAt = Date.now();
  send();
});

// 设置里能看最近几次回车事件长什么样（排障用，不影响正常使用）
window.qingliaoInputDiag = () => (inputLog.length ? inputLog.join('\n') : '（还没有记录，先在聊天里按几次回车）');

sendBtn.addEventListener('click', () => {
  const conv = currentConv();
  if (!conv) return;
  const r = rtOf(convKey(state.conv.kind, conv.id));
  if (r.phase === 'streaming' && !inputEl.value.trim()) {
    stopReply(state.conv.kind, conv);
    return;
  }
  send();
});

/* ---------------- 表情 / 图片 ---------------- */

const emojiGrid = $('#emojiGrid') || emojiPanel;
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
  emojiGrid.append(b);
}

/** 面板顶上的「我的表情包」：把自己的库列成一条，点一下直接发出去。 */
function renderEmojiStickers() {
  const sec = document.getElementById('stkSec');
  const strip = document.getElementById('stkStrip');
  if (!sec || !strip) return;
  const list = stickers();
  sec.hidden = !list.length;
  strip.textContent = '';
  for (const it of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = (it.tags || []).join('、') || '表情包';
    const img = document.createElement('img');
    setImgRef(img, it.url);
    img.alt = '';
    b.append(img);
    b.addEventListener('click', () => sendSticker(it));
    strip.append(b);
  }
}

function openEmoji() {
  closeMention();
  renderEmojiStickers();
  emojiPanel.hidden = false;
  scrollBottom(true);
}
function closeEmoji() { emojiPanel.hidden = true; }

$('#btnEmoji').addEventListener('click', () => {
  if (emojiPanel.hidden) openEmoji(); else closeEmoji();
});

const stkMoreBtn = $('#stkMore');
if (stkMoreBtn) {
  stkMoreBtn.addEventListener('click', () => { closeEmoji(); openStickerSheet(); });
}

$('#btnCoin').addEventListener('click', openCoinSheet);

$('#btnImage').addEventListener('click', async () => {
  const data = await pickImage({ max: 1024, quality: 0.8 });
  if (data) sendImage(data);
});

/* ---------------- 读文件：把内容抽成文字 ---------------- */

/**
 * 模型读文件的正确做法。
 *
 * DeepSeek 的 `file` 内容块只支持**图片**（JPEG / PNG / GIF / WebP），不解析 PDF / docx，
 * 把文档塞进去只会 400 或者被忽略。所以这里在客户端把文件抽成纯文本，再当普通文字交给模型——
 * 这样任何模型、任何中转都能「看」到文件内容，也不再依赖服务端存 blob。
 */

/** 解压一段 deflate（raw 或 zlib）。老浏览器没有 DecompressionStream 时返回空。 */
async function inflateBytes(bytes, raw) {
  if (typeof DecompressionStream !== 'function') return null;
  try {
    const ds = new DecompressionStream(raw ? 'deflate-raw' : 'deflate');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  } catch (_) {
    return null;
  }
}

/** 极简 zip 读取（docx / xlsx / pptx 都是 zip）：返回 Map<文件名, Uint8Array>。 */
async function unzipAll(buf) {
  const bytes = new Uint8Array(buf);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 找 End of Central Directory
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 65558; i -= 1) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return new Map();
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map();
  for (let n = 0; n < count && p + 46 <= bytes.length; n += 1) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!compSize) continue;
    // 本地文件头
    if (dv.getUint32(localOff, true) !== 0x04034b50) continue;
    const lName = dv.getUint16(localOff + 26, true);
    const lExtra = dv.getUint16(localOff + 28, true);
    const start = localOff + 30 + lName + lExtra;
    const raw = bytes.subarray(start, start + compSize);
    let data = null;
    if (method === 0) data = raw;
    else if (method === 8) data = await inflateBytes(raw, true);
    if (data) out.set(name, data);
  }
  return out;
}

function xmlText(xml) {
  return String(xml || '')
    .replace(/<w:p[ >]/g, '\n<w:p ')          // Word 段落
    .replace(/<a:p[ >]/g, '\n<a:p ')          // PPT 段落
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const zipDecoder = (u8) => new TextDecoder('utf-8').decode(u8);

async function docxToText(buf) {
  const files = await unzipAll(buf);
  const doc = files.get('word/document.xml');
  if (!doc) return '';
  return xmlText(zipDecoder(doc));
}

async function pptxToText(buf) {
  const files = await unzipAll(buf);
  const slides = [...files.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
  const parts = [];
  for (const k of slides) {
    const t = xmlText(zipDecoder(files.get(k)));
    if (t) parts.push('【第 ' + (parts.length + 1) + ' 页】\n' + t);
  }
  return parts.join('\n\n');
}

async function xlsxToText(buf) {
  const files = await unzipAll(buf);
  const sharedRaw = files.get('xl/sharedStrings.xml');
  const shared = [];
  if (sharedRaw) {
    const s = zipDecoder(sharedRaw);
    s.replace(/<si>([\s\S]*?)<\/si>/g, (_, inner) => {
      shared.push(xmlText(inner));
      return '';
    });
  }
  const sheets = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
  const out = [];
  for (let si = 0; si < sheets.length; si += 1) {
    const s = zipDecoder(files.get(sheets[si]));
    const rows = [];
    s.replace(/<row[^>]*>([\s\S]*?)<\/row>/g, (_, rowXml) => {
      const cells = [];
      rowXml.replace(/<c([^>]*)>([\s\S]*?)<\/c>/g, (__, attrs, cellXml) => {
        const isShared = /t="s"/.test(attrs);
        const inline = /<is>([\s\S]*?)<\/is>/.exec(cellXml);
        const v = /<v>([\s\S]*?)<\/v>/.exec(cellXml);
        let val = '';
        if (inline) val = xmlText(inline[1]);
        else if (v) val = isShared ? (shared[Number(v[1])] || '') : String(v[1]);
        if (val) cells.push(val.replace(/\s+/g, ' ').trim());
        return '';
      });
      if (cells.length) rows.push(cells.join('\t'));
      return '';
    });
    if (rows.length) out.push('【工作表 ' + (si + 1) + '】\n' + rows.join('\n'));
  }
  return out.join('\n\n');
}

/** 从一段 PDF 字典文本里取出某个键的子字典（正确处理嵌套的 << >>）。 */
function pdfSubDict(text, key) {
  const i = String(text || '').search(new RegExp('\\/' + key + '\\s*<<'));
  if (i < 0) return '';
  const start = text.indexOf('<<', i);
  let depth = 0;
  for (let p = start; p < text.length - 1; p += 1) {
    if (text[p] === '<' && text[p + 1] === '<') { depth += 1; p += 1; continue; }
    if (text[p] === '>' && text[p + 1] === '>') {
      depth -= 1;
      p += 1;
      if (depth === 0) return text.slice(start + 2, p - 1);
    }
  }
  return '';
}

/** 解析 PDF 的 ToUnicode CMap：beginbfchar / beginbfrange → Map<码值, 字符>。 */
function parseCMap(text) {
  const map = new Map();
  if (!text) return map;
  // 一个字符占几个字节：<00> <FF> 是 1，<0000> <FFFF> 是 2（Type0/CID 一般是 2）
  const cs = /begincodespacerange\s*<([0-9A-Fa-f]+)>/.exec(text);
  map.width = cs ? Math.max(1, Math.round(cs[1].length / 2)) : 2;
  text.replace(/beginbfchar([\s\S]*?)endbfchar/g, (_, body) => {
    body.replace(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g, (___, src, dst) => {
      map.set(parseInt(src, 16), hexToStr(dst));
      return '';
    });
    return '';
  });
  text.replace(/beginbfrange([\s\S]*?)endbfrange/g, (_, body) => {
    body.replace(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g,
      (___, a, b, _c, base, list) => {
        const from = parseInt(a, 16);
        const to = parseInt(b, 16);
        if (list != null) {
          list.replace(/<([0-9A-Fa-f]+)>/g, (h) => {
            map.set(from + (map.size % 100000), hexToStr(h));
            return h;
          });
          let k = from;
          list.replace(/<([0-9A-Fa-f]+)>/g, (h) => {
            map.set(k, hexToStr(h)); k += 1; return h;
          });
          return '';
        }
        const start = parseInt(base || '0', 16);
        for (let j = from; j <= to && j - from < 65535; j += 1) {
          map.set(j, String.fromCharCode(start + (j - from)));
        }
        return '';
      });
    return '';
  });
  return map;
}

/** PDF：把页面内容流里的文字取出来。以「能用」为准，不追求排版。 */
async function pdfToText(buf) {
  const bytes = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer);
  const latin = new TextDecoder('latin1').decode(bytes);
  const objRe = /(\d+)\s+(\d+)\s+obj\b/g;
  const objs = [];
  let m;
  while ((m = objRe.exec(latin))) objs.push({ num: Number(m[1]), start: objRe.lastIndex });
  for (let i = 0; i < objs.length; i += 1) {
    objs[i].end = i + 1 < objs.length ? objs[i + 1].start : latin.length;
  }
  const byNum = new Map();
  for (const o of objs) if (!byNum.has(o.num)) byNum.set(o.num, o);

  const dictText = (o) => {
    const body = latin.slice(o.start, o.end);
    const sIdx = body.indexOf('stream');
    return sIdx >= 0 ? body.slice(0, sIdx) : body;
  };

  const streamOf = (o) => {
    const body = latin.slice(o.start, o.end);
    const sIdx = body.indexOf('stream');
    if (sIdx < 0) return null;
    let p = o.start + sIdx + 6;
    if (latin[p] === '\r') p += 1;
    if (latin[p] === '\n') p += 1;
    const eIdx = latin.indexOf('endstream', p);
    if (eIdx < 0) return null;
    const dict = body.slice(0, sIdx);
    // 优先按 /Length 精确切：DecompressionStream 对多出来的尾巴会直接报「Junk found」
    let end = eIdx;
    const lm = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    if (lm) {
      const n = Number(lm[1]);
      if (n > 0 && p + n <= bytes.length) end = p + n;
    }
    while (end > p && (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d
      || bytes[end - 1] === 0x20 || bytes[end - 1] === 0x00
      || bytes[end - 1] === 0x09 || bytes[end - 1] === 0x0c)) end -= 1;
    const data = bytes.subarray(p, end);
    if (/\/FlateDecode/.test(dict)) return { dict, raw: data };
    return { dict, raw: null, plain: data };
  };

  const streamText = new Map();
  const textOfObj = async (o) => {
    if (!o) return null;
    if (streamText.has(o.num)) return streamText.get(o.num);
    const st = streamOf(o);
    let txt = null;
    if (st && st.raw) {
      const un = await inflateBytes(st.raw, false);
      txt = un ? new TextDecoder('latin1').decode(un) : null;
    } else if (st && st.plain) {
      txt = new TextDecoder('latin1').decode(st.plain);
    }
    streamText.set(o.num, txt);
    return txt;
  };

  const cmapCache = new Map();
  const cmapOf = async (num) => {
    if (cmapCache.has(num)) return cmapCache.get(num);
    const map = parseCMap(await textOfObj(byNum.get(num)));
    cmapCache.set(num, map);
    return map;
  };

  const fontCmap = async (fontNum) => {
    const o = byNum.get(fontNum);
    if (!o) return new Map();
    const tu = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(dictText(o));
    return tu ? await cmapOf(Number(tu[1])) : new Map();
  };

  // 页面资源里的 /Font << /F1 5 0 R >>（可能是间接的 /Resources N 0 R）
  const resourcesOf = (d) => {
    const inline = pdfSubDict(d, 'Resources');
    if (inline) return inline;
    const ref = /\/Resources\s+(\d+)\s+0\s+R/.exec(d);
    if (ref) {
      const ro = byNum.get(Number(ref[1]));
      if (ro) return dictText(ro);
    }
    return '';
  };
  const fontResOf = (res) => {
    const map = new Map();
    let body = pdfSubDict(res, 'Font');
    if (!body) {
      const ref = /\/Font\s+(\d+)\s+0\s+R/.exec(res);
      if (ref) {
        const fo = byNum.get(Number(ref[1]));
        if (fo) body = dictText(fo);
      }
    }
    body.replace(/\/([A-Za-z0-9]+)\s+(\d+)\s+0\s+R/g, (_, nm, num) => {
      map.set(nm, Number(num));
      return '';
    });
    return map;
  };

  const runContent = (content, fontRes) => {
    let out = '';
    let cur = null;
    const re = /\/([A-Za-z0-9]+)\s+[\d.]+\s+Tf|\[([\s\S]*?)\]\s*TJ|<([0-9A-Fa-f\s]+)>\s*Tj|\(((?:\\.|[^\\()])*)\)\s*Tj|(T\*|Td|TD|ET)/g;
    let mm;
    while ((mm = re.exec(content))) {
      const [, fname, arr, hex, lit, brk] = mm;
      if (fname) {
        const num = fontRes.get(fname);
        cur = num != null ? fontCmapCache.get(num) || null : null;
        continue;
      }
      if (brk) { out += '\n'; continue; }
      if (arr != null) {
        arr.replace(/<([0-9A-Fa-f\s]+)>|\(((?:\\.|[^\\()])*)\)/g, (_, h, l) => {
          out += h ? decodeBytes(h.replace(/\s+/g, ''), cur, true) : decodeBytes(l, cur, false);
          return h || l || '';
        });
        continue;
      }
      if (hex) out += decodeBytes(hex.replace(/\s+/g, ''), cur, true);
      else if (lit != null) out += decodeBytes(lit, cur, false);
    }
    return out;
  };

  // 先把所有字体的 ToUnicode 都算好（内容流里是同步用的）
  const fontCmapCache = new Map();
  for (const o of objs) {
    if (/\/ToUnicode\s+\d+\s+0\s+R/.test(dictText(o))) {
      fontCmapCache.set(o.num, await fontCmap(o.num));
    }
  }

  let out = '';
  const pages = objs.filter((o) => /\/Type\s*\/Page\b/.test(dictText(o)));
  const targets = pages.length ? pages : objs;
  for (const o of targets) {
    const d = dictText(o);
    const fontRes = fontResOf(resourcesOf(d));
    // 内容：/Contents N 0 R 或 /Contents [a 0 R b 0 R]
    const nums = [];
    const single = /\/Contents\s+(\d+)\s+0\s+R/.exec(d);
    const many = /\/Contents\s*\[([^\]]*)\]/.exec(d);
    if (single) nums.push(Number(single[1]));
    else if (many) {
      many[1].replace(/(\d+)\s+0\s+R/g, (_, n) => { nums.push(Number(n)); return ''; });
    } else {
      continue;
    }
    for (const n of nums) {
      const txt = await textOfObj(byNum.get(n));
      if (!txt) continue;
      if (!/\bBT\b/.test(txt)) continue;
      out += runContent(txt, fontRes) + '\n';
    }
  }
  // 有些 PDF 的 ToUnicode 给的是「康熙部首」这种兼容字（⽂/⼤/⻆），归一化成正常汉字
  return out.normalize('NFKC').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function hexToStr(hex) {
  let s = '';
  for (let i = 0; i + 3 < hex.length + 1 && i < hex.length; i += 4) {
    const code = parseInt(hex.slice(i, i + 4), 16);
    if (!isNaN(code)) s += String.fromCharCode(code);
  }
  return s;
}

/** PDF 里的字符串：有 ToUnicode 就按 2 字节码查表，否则按 1 字节 ASCII。 */
function decodeBytes(src, cmap, isHex) {
  if (cmap && cmap.size) {
    const width = cmap.width || 2;
    let s = '';
    if (isHex) {
      const step = width * 2;
      for (let i = 0; i + step <= src.length; i += step) {
        const code = parseInt(src.slice(i, i + step), 16);
        if (!isNaN(code)) s += cmap.get(code) || '';
      }
      return s;
    }
    const bytes = unescapePdfString(src);
    for (let i = 0; i + width <= bytes.length; i += width) {
      let code = 0;
      for (let k = 0; k < width; k += 1) code = (code << 8) | bytes.charCodeAt(i + k);
      s += cmap.get(code) || '';
    }
    return s;
  }
  if (isHex) {
    let s = '';
    for (let i = 0; i < src.length; i += 2) {
      const code = parseInt(src.slice(i, i + 2), 16);
      if (!isNaN(code)) s += String.fromCharCode(code);
    }
    return s;
  }
  return unescapePdfString(src)
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, '')
    .replace(/\u0009/g, ' ');
}

function unescapePdfString(s) {
  return String(s || '')
    .replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[c] || c))
    .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
}

const DOC_TEXT_EXT = /^(txt|md|markdown|csv|tsv|json|jsonl|xml|yaml|yml|html?|css|scss|js|mjs|cjs|ts|jsx|tsx|vue|py|java|c|h|cpp|hpp|cs|go|rs|rb|php|sh|bash|zsh|sql|log|ini|toml|conf|cfg|env|gitignore|makefile|dockerfile)$/;

/** 入口：文件 → 纯文本。读不出来返回空串。 */
async function extractDocText(file) {
  const name = String((file && file.name) || '').toLowerCase();
  const ext = name.indexOf('.') >= 0 ? name.split('.').pop() : '';
  const type = String((file && file.type) || '');
  let buf = null;
  try { buf = await file.arrayBuffer(); } catch (_) { return ''; }
  try {
    if (DOC_TEXT_EXT.test(ext) || /^text\//.test(type) || ext === 'pdf2txt') {
      return new TextDecoder('utf-8', { fatal: false }).decode(buf);
    }
    if (ext === 'docx') return await docxToText(buf);
    if (ext === 'pptx') return await pptxToText(buf);
    if (ext === 'xlsx') return await xlsxToText(buf);
    if (ext === 'pdf') return await pdfToText(buf);
  } catch (_) {
    return '';
  }
  return '';
}

/* ---------------- 发文件（给模型看） ---------------- */

const DOC_MAX_BYTES = 8 * 1024 * 1024;   // 8MB：再大就 base64 塞不进请求了

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(fr.error || new Error('读不了这个文件'));
    fr.readAsDataURL(file);
  });
}

/** 文件存哪：连服务器就传成 @blob:（不进 state，别把状态撑成几 MB）；单机放 IndexedDB。 */
async function storeDocFile(dataUrl, mime) {
  if (isCloud()) {
    const ref = await uploadImage(dataUrl);          // 同一个 /api/blob 接口，服务端现在收任何类型
    if (ref && ref.startsWith('@blob:')) return ref;
    return dataUrl;
  }
  try {
    if (await IdbStore.available()) {
      const key = 'doc:' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      await IdbStore.set(key, dataUrl);
      return '@idb:' + key;
    }
  } catch (_) {}
  return dataUrl;
}

/** @blob: / @idb: / data: 一律取回 data URL，交给模型当 file 内容块。 */
async function fileRefToDataUrl(ref, mime) {
  const r = String(ref || '');
  if (!r) return '';
  if (r.startsWith('data:')) return r;
  if (r.startsWith('@idb:')) {
    try { return String((await IdbStore.get(r.slice(5))) || ''); } catch (_) { return ''; }
  }
  if (r.startsWith('@blob:')) {
    try {
      const res = await apiFetch('/api/blob/' + encodeURIComponent(r.slice(6)), { timeout: 30000 });
      if (!res.ok) return '';
      const blob = await res.blob();
      const buf = await blobToDataUrl(blob);
      if (!buf) return '';
      // 服务器按扩展名给的类型可能不准，用消息里记的 mime 覆盖一下
      const want = String(mime || '').trim();
      if (want && !buf.startsWith('data:' + want)) return buf.replace(/^data:[^;]*/, 'data:' + want);
      return buf;
    } catch (_) { return ''; }
  }
  return '';
}

async function sendDocFile(file) {
  const conv = currentConv();
  if (!conv || !file) return;
  if (file.size > DOC_MAX_BYTES) {
    toast('文件太大了（上限 8 MB），换个小点的');
    return;
  }
  const kind = state.conv.kind;
  toast('正在读文件…', 1500);
  // 模型不解析文档（DeepSeek 的 file 块只收图片），所以这里先把内容抽成文字
  let docText = '';
  try { docText = await extractDocText(file); } catch (_) { docText = ''; }
  docText = String(docText || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const shown = docText.slice(0, 40000);
  const msg = {
    id: uid('m'), role: 'user', text: '', ts: Date.now(),
    file: {
      name: String(file.name || '文件').slice(0, 120),
      size: Number(file.size) || 0,
      mime: String(file.type || '').slice(0, 80),
      text: shown,
      chars: docText.length,
      unread: !docText,
    },
  };
  // 原文件也存一份（点「保存」能拿回来）；抽不出文字不影响发出去
  try {
    const dataUrl = await fileToDataUrl(file);
    if (dataUrl) msg.file.ref = await storeDocFile(dataUrl, file.type);
  } catch (_) {}
  if (!docText) {
    toast('这个文件读不出文字（可能是扫描件/图片型 PDF），她只能看到文件名', 4000);
  }
  conv.messages.push(msg);
  clearReadMark();
  renderMessage(msg, { conv, kind });
  scrollBottom(true);
  lastActivity = Date.now();
  if (kind === 'group' && isCloud()) saveHint = 'social';
  persist();
  renderConversations();
  afterUserMessage(kind, conv);
}

// 排障：看最近几次回车事件（key / isComposing / keyCode / 时间）到底长什么样
const diagBtn = $('#btnInputDiag');
if (diagBtn) {
  diagBtn.addEventListener('click', () => {
    const body = window.qingliaoInputDiag ? window.qingliaoInputDiag() : '（没有诊断数据）';
    try { alert('最近的回车事件：\n' + body + '\n\n（截图发给作者就行）'); }
    catch (_) { toast(body.slice(0, 120)); }
  });
}

// 老页面（缓存/旧包）里没有这个按钮时不要报错，别把后面的初始化带崩
const fileBtn = $('#btnFile');
const fileDocInput = $('#fileDocInput');
if (fileBtn && fileDocInput) {
  fileBtn.addEventListener('click', () => {
    fileDocInput.value = '';
    fileDocInput.click();
  });
  fileDocInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    fileDocInput.value = '';
    if (f) sendDocFile(f);
  });
}

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
  const stkBtn = msgMenu.querySelector('[data-act="sticker"]');
  if (stkBtn) stkBtn.style.display = msg.image ? '' : 'none';
  const saveBtn = msgMenu.querySelector('[data-act="saveimg"]');
  if (saveBtn) saveBtn.style.display = msg.image ? '' : 'none';

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
// 她发的图 / 表情包 → 存到手机相册 / 电脑「下载」
if (!msgMenu.querySelector('[data-act="saveimg"]')) {
  const b = document.createElement('button');
  b.dataset.act = 'saveimg';
  b.textContent = '保存图片';
  msgMenu.insertBefore(b, msgMenu.querySelector('[data-act="copy"]'));
}
// 她发的图 / 表情包 → 一键收进自己的表情包库（自动打标签）
if (!msgMenu.querySelector('[data-act="sticker"]')) {
  const b = document.createElement('button');
  b.dataset.act = 'sticker';
  b.textContent = '存为表情包';
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
  else if (act === 'sticker') {
    saveMsgAsSticker(msg);
  }
  else if (act === 'saveimg') {
    await saveImageRef(msg.image, imageSaveName(msg));
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
  if ($('#fDoodle')) $('#fDoodle').checked = s.doodle !== false;
  if ($('#fStickerChance')) $('#fStickerChance').value = Number(s.stickerChance ?? 25);
  if ($('#fStickerTriggers')) $('#fStickerTriggers').value = s.stickerTriggers || '';
  // 她会发照片
  if ($('#fImgOn')) $('#fImgOn').checked = !!s.imageOn;
  if ($('#fImgBase')) $('#fImgBase').value = s.imageBaseUrl || '';
  if ($('#fImgKey')) $('#fImgKey').value = s.imageApiKey || '';
  if ($('#fImgModel')) $('#fImgModel').value = s.imageModel || '';
  if ($('#fImgSize')) $('#fImgSize').value = s.imageSize || '1024x1024';
  if ($('#fImgQuality')) $('#fImgQuality').value = s.imageQuality || '';
  if ($('#fImgStyle')) $('#fImgStyle').value = s.imageStyle || '';
  if ($('#fImgPrompt')) $('#fImgPrompt').value = s.imagePrompt || '';
  if ($('#fImgChance')) $('#fImgChance').value = Number(s.imageChance ?? 15);
  if ($('#fImgTriggers')) $('#fImgTriggers').value = s.imageTriggers || '';
  renderImgStatus();
  renderStickerCount();
  $('#fSearch').checked = !!s.webSearch;
  $('#fDelayOn').checked = !!s.delayOn;
  $('#fDelayMin').value = s.delayMin ?? 5;
  $('#fDelayMax').value = s.delayMax ?? 30;
  renderDelayLive();
  $('#fTypingFx').checked = !!s.typingFx;
  $('#fBursts').value = s.bursts || 5;
  $('#fGroupBursts').value = s.groupBursts || 3;
  const gr = $('#fGroupRound'); if (gr) gr.value = s.groupRoundMax || 10;
  $('#fTheme').value = s.theme || 'auto';
  const freq = Number(s.momentInterval) || 43200;
  $('#fMomentFreq').value = Math.max(1, Math.round(freq / 60));
  $('#fProactive').checked = !!s.proactive;
  if ($('#fEnterSend')) $('#fEnterSend').checked = enterSendOn();
  $('#fIdle').value = s.idleMin ?? 20;
  if ($('#fRecall')) $('#fRecall').checked = s.recallOn !== false;
  if ($('#fRecallChance')) $('#fRecallChance').value = Number(s.recallChance ?? 20);
  if ($('#fReword')) $('#fReword').checked = s.rewordOn !== false;
  if ($('#fRewordChance')) $('#fRewordChance').value = Number(s.rewordChance ?? 10);
  if ($('#fLate')) $('#fLate').checked = s.lateOn === true;
  if ($('#fLateChance')) $('#fLateChance').value = Number(s.lateChance ?? 5);
  if ($('#fLateMax')) $('#fLateMax').value = Number(s.lateMaxMin ?? 5);
  if ($('#fQuiet')) $('#fQuiet').checked = s.quietOn !== false;
  if ($('#fQuietStart')) $('#fQuietStart').value = Number(s.quietStart ?? 23);
  if ($('#fQuietEnd')) $('#fQuietEnd').value = Number(s.quietEnd ?? 8);
  if ($('#fDiary')) $('#fDiary').checked = s.diaryOn !== false;
  if ($('#fLife')) $('#fLife').checked = s.lifeOn !== false;
  if ($('#fEssayChance')) $('#fEssayChance').value = Number(s.essayChance ?? 15);
  if ($('#fArchiveDays')) $('#fArchiveDays').value = Number(s.archiveDays) || 0;
  renderSkinChips();
  syncChips();
}

/** 设置页里那行「现在到底会不会发」：一眼看出是没开、没填接口，还是能发。 */
function renderImgStatus() {
  const el = document.getElementById('imgStatus');
  if (!el) return;
  const on = !!(document.getElementById('fImgOn') || {}).checked;
  const base = String((document.getElementById('fImgBase') || {}).value || '').trim();
  const model = String((document.getElementById('fImgModel') || {}).value || '').trim() || 'gpt-image-2';
  const trig = String((document.getElementById('fImgTriggers') || {}).value || '').trim();
  const chance = Number((document.getElementById('fImgChance') || {}).value) || 0;
  let text;
  if (!on) text = '现在：没开启，她不会发照片。';
  else if (!base) text = '现在：开关开了，但生图接口还是空的——填上地址和 Key 才会真的发图。';
  else {
    text = '现在：会发 · 接口已填 · 模型 ' + model + ' · 关键词 '
      + (trig || '（内置：自拍、照片、看看你、拍一张）') + ' · 概率 ' + chance + '%';
  }
  el.textContent = text;
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
  if ($('#fDoodle')) s.doodle = $('#fDoodle').checked;
  if ($('#fStickerChance')) s.stickerChance = Math.max(0, Math.min(100, Number($('#fStickerChance').value) || 0));
  if ($('#fStickerTriggers')) {
    s.stickerTriggers = String($('#fStickerTriggers').value || '')
      .split(/[,，、;；\s]+/).map((x) => x.trim()).filter(Boolean).slice(0, 20).join(', ');
  }
  // 她会发照片：接口和 Key 跟聊天那套分开存，换聊天模型不会把生图弄丢
  if ($('#fImgOn')) s.imageOn = $('#fImgOn').checked;
  if ($('#fImgBase')) s.imageBaseUrl = String($('#fImgBase').value || '').trim().replace(/\/+$/, '');
  if ($('#fImgKey')) s.imageApiKey = String($('#fImgKey').value || '').trim();
  if ($('#fImgModel')) s.imageModel = String($('#fImgModel').value || '').trim();
  if ($('#fImgSize')) s.imageSize = String($('#fImgSize').value || '1024x1024');
  if ($('#fImgQuality')) s.imageQuality = String($('#fImgQuality').value || '').trim().toLowerCase();
  if ($('#fImgStyle')) s.imageStyle = String($('#fImgStyle').value || '').trim().slice(0, 300);
  if ($('#fImgPrompt')) s.imagePrompt = String($('#fImgPrompt').value || '').trim().slice(0, 2000);
  if ($('#fImgChance')) s.imageChance = Math.max(0, Math.min(100, Number($('#fImgChance').value) || 0));
  if ($('#fImgTriggers')) {
    s.imageTriggers = String($('#fImgTriggers').value || '')
      .split(/[,，、;；\s]+/).map((x) => x.trim()).filter(Boolean).slice(0, 20).join(', ');
  }
  s.webSearch = $('#fSearch').checked;
  s.delayOn = $('#fDelayOn').checked;
  s.delayMin = Math.max(0, Math.min(600, Number($('#fDelayMin').value) || 0));
  // 最长留空时「沿用原来的最长」，不要再把它压成最短：
  // 以前这么写，最短填 3、最长空着，就会变成固定 3 秒——看着就像延迟设置根本没生效。
  const maxRaw = String($('#fDelayMax').value || '').trim();
  const maxNum = Number(maxRaw);
  s.delayMax = (maxRaw === '' || !Number.isFinite(maxNum))
    ? Math.max(s.delayMin, Number(state.settings.delayMax) || 30)
    : Math.max(s.delayMin, Math.min(600, maxNum));
  s.typingFx = $('#fTypingFx').checked;
  s.bursts = Math.max(1, Math.min(5, Number($('#fBursts').value) || 5));
  s.groupBursts = Math.max(1, Math.min(10, Number($('#fGroupBursts').value) || 3));
  const grEl = $('#fGroupRound');
  if (grEl) s.groupRoundMax = Math.max(1, Math.min(60, Number(grEl.value) || 10));
  s.theme = $('#fTheme').value;
  s.momentInterval = Math.max(60, (Number($('#fMomentFreq').value) || 720) * 60);
  s.proactive = $('#fProactive').checked;
  if ($('#fEnterSend')) s.enterSend = $('#fEnterSend').checked;
  s.idleMin = Math.max(3, Number($('#fIdle').value) || 20);
  if ($('#fRecall')) s.recallOn = $('#fRecall').checked;
  if ($('#fRecallChance')) s.recallChance = Math.max(0, Math.min(50, Number($('#fRecallChance').value) || 0));
  if ($('#fReword')) s.rewordOn = $('#fReword').checked;
  if ($('#fRewordChance')) s.rewordChance = Math.max(0, Math.min(50, Number($('#fRewordChance').value) || 0));
  if ($('#fLate')) s.lateOn = $('#fLate').checked;
  if ($('#fLateChance')) s.lateChance = Math.max(0, Math.min(30, Number($('#fLateChance').value) || 0));
  if ($('#fLateMax')) s.lateMaxMin = Math.max(1, Math.min(30, Number($('#fLateMax').value) || 5));
  if ($('#fQuiet')) s.quietOn = $('#fQuiet').checked;
  if ($('#fQuietStart')) s.quietStart = Math.max(0, Math.min(23, Number($('#fQuietStart').value) || 0));
  if ($('#fQuietEnd')) s.quietEnd = Math.max(0, Math.min(23, Number($('#fQuietEnd').value) || 0));
  if ($('#fDiary')) s.diaryOn = $('#fDiary').checked;
  if ($('#fLife')) s.lifeOn = $('#fLife').checked;
  if ($('#fEssayChance')) s.essayChance = Math.max(0, Math.min(100, Number($('#fEssayChance').value) || 0));
  if ($('#fArchiveDays')) s.archiveDays = Math.max(0, Math.min(3650, Number($('#fArchiveDays').value) || 0));
  const patch = changedFields(before, s, Object.keys(s));
  const dirty = Object.keys(patch).length > 0;
  Object.assign(state.settings, patch);
  Object.assign(pendingEdits.settings, patch);
  if (patch.lateOn === false) lateReplyTick();
  applyTheme();
  if (dirty) persist();          // 什么都没改就不必同步一次整份状态
  closeSheet();
  renderConversations();
  if (dirty) toast('已保存');
}

$('#btnSettings').addEventListener('click', openSheet);
// 「关闭」也保存：以前只有右上角「完成」才写盘，改完顺手点关闭就白改了
//（「表情包概率改了不生效」有一半是这个原因）。
$('#btnSheetClose').addEventListener('click', saveForm);
$('#btnSheetSave').addEventListener('click', saveForm);
// 改延迟的时候把「现在到底几秒」实时算出来：不用保存才知道生效没生效
['#fImgOn', '#fImgBase', '#fImgModel', '#fImgTriggers', '#fImgChance'].forEach((sel) => {
  const el = $(sel);
  if (el) el.addEventListener('input', renderImgStatus);
  if (el) el.addEventListener('change', renderImgStatus);
});
['#fDelayMin', '#fDelayMax', '#fDelayOn'].forEach((sel) => {
  const el = $(sel);
  if (el) el.addEventListener('input', renderDelayLive);
});

/**
 * 设置页里的小字：现在这条到底等几秒、是全局还是这个好友自己的节奏。
 * 以前好友的节奏会盖住全局，界面却只写全局的数字，看着就像「设了没用」。
 */
function renderDelayLive() {
  const el = document.getElementById('delayLive');
  if (!el) return;
  const num = (id, dflt) => {
    const node = document.getElementById(id);
    const v = node ? Number(node.value) : NaN;
    return Number.isFinite(v) ? v : dflt;
  };
  if (!($('#fDelayOn') && $('#fDelayOn').checked)) {
    el.textContent = '现在：随机延迟关着，发出去 0.4 秒她就开始打字。';
    return;
  }
  const min = Math.max(0, Math.min(600, num('fDelayMin', 5)));
  const max = Math.max(min, Math.min(600, num('fDelayMax', 30)));
  let tail = '';
  const conv = (state.conv && state.conv.kind === 'friend') ? currentConv() : null;
  if (conv) {
    const own = conv.settings || {};
    if (own.delayMin !== undefined || own.delayMax !== undefined) {
      const eff = delayRange(conv);
      tail = '\n「' + conv.name + '」自己在资料里设了 ' + eff.min + '~' + eff.max + ' 秒，会盖过这里。';
    } else {
      tail = '\n当前聊天「' + conv.name + '」跟随这里。';
    }
  }
  el.textContent = '现在生效：' + min + '~' + max + ' 秒里均匀随机（每一秒机会一样）' + tail;
}
$('#fTemp').addEventListener('input', (e) => { $('#fTempOut').textContent = Number(e.target.value).toFixed(1); });
$('#fModel').addEventListener('input', syncChips);
$('#skinChips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const skin = SKIN_IDS.includes(chip.dataset.skin) ? chip.dataset.skin : 'default';
  state.settings.skin = skin;
  pendingEdits.settings.skin = skin;
  applyTheme();
  renderSkinChips();
  persist();
});

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
  if (IS_LOCAL_SERVER && isSameOriginAsServer()) {
    try {
      const j = await requestJson(base + '/chat/completions', key, {
        model: state.settings.model || 'deepseek-flash',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
        stream: false,
      });
      toast(j && j.choices ? '连通了 ✓' : '连不上：返回异常', 4000);
    } catch (e) { toast('连不上：' + friendlyError(e), 4000); }
    return;
  }
  // 本地模式：手机直接访问 /models
  if (!isCloud()) {
    try {
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, 20000) : null;
      const res = await fetch(base.replace(/\/+$/, '') + '/models', {
        headers: { Authorization: 'Bearer ' + key },
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (timer) clearTimeout(timer);
      if (!res.ok) {
        throw new Error(res.status === 401 || res.status === 403
          ? 'Key 不对，或者这个 Key 没有余额' : '接口返回 ' + res.status);
      }
      toast('连通了 ✓', 4000);
    } catch (e) { toast('连不上：' + friendlyError(e), 4000); }
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

// 「试一张」：按设置页里现在填的（还没保存的）参数直接生一张，省得反复猜哪填错了。
$('#btnImgTest').addEventListener('click', async () => {
  const cfg = photoConfig({
    imageBaseUrl: $('#fImgBase').value,
    imageApiKey: $('#fImgKey').value,
    imageModel: $('#fImgModel').value,
    imageSize: $('#fImgSize').value,
    imageQuality: $('#fImgQuality').value,
    imageStyle: $('#fImgStyle').value,
  });
  if (!cfg.base) return toast('先填生图接口地址');
  closeSheet();
  toast('正在生成一张，大概要 10~60 秒…', 6000);
  try {
    const friend = state.friends.find((f) => state.conv && f.id === state.conv.id) || state.friends[0];
    const dataUrl = await genImage(
      buildPhotoPrompt('对着镜头自拍，穿着平常那件外套，窗外是傍晚的街道，暖光', friend, cfg), cfg);
    openLightbox(dataUrl, dataUrl);
    toast('生成好了');
  } catch (e) {
    toast('没生成出来：' + friendlyError(e), 6000);
  }
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

const archiveBtn = document.getElementById('btnArchiveNow');
if (archiveBtn) {
  archiveBtn.addEventListener('click', () => {
    // 先按设置里填的天数存一次，再归档（不需要用户记得先点「完成」）
    const val = Math.max(0, Math.min(3650, Number($('#fArchiveDays').value) || 0));
    state.settings.archiveDays = val;
    pendingEdits.settings.archiveDays = val;
    persist();
    archiveNow();
  });
}

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

/* ---------------- 提示词自定义 ---------------- */

const PROMPT_FIELDS = [
  ['chat', 'prChat'],
  ['groupChat', 'prGroupChat'],
  ['proactive', 'prProactive'],
  ['moment', 'prMoment'],
  ['comment', 'prComment'],
  ['reply', 'prReply'],
  ['dm', 'prDm'],
  ['draw', 'prDraw'],
  ['sticker', 'prSticker'],
];

function promptExtra(key) {
  const p = (state.settings && state.settings.prompts) || {};
  const v = p[key];
  return typeof v === 'string' ? v.trim() : '';
}

function openPromptSheet() {
  const p = (state.settings && state.settings.prompts) || {};
  for (const [key, id] of PROMPT_FIELDS) {
    const el = document.getElementById(id);
    if (el) el.value = typeof p[key] === 'string' ? p[key] : '';
  }
  const sheet = $('#promptSheet');
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
}

function closePromptSheet() {
  const sheet = $('#promptSheet');
  if (!sheet) return;
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
}

function promptFormValues() {
  const p = {};
  for (const [key, id] of PROMPT_FIELDS) {
    const el = document.getElementById(id);
    const v = el ? el.value.trim() : '';
    if (v) p[key] = v;
  }
  return p;
}

function savePromptSheet() {
  const p = promptFormValues();
  state.settings.prompts = p;
  Object.assign(pendingEdits.settings, { prompts: p });
  persist();
  closePromptSheet();
  toast('存好了，下一条就生效');
}

/** 「关闭」也保存（有改动才存），免得写完点关闭白写。 */
function closePromptSheetAutoSave() {
  const cur = (state.settings && state.settings.prompts) || {};
  const now = promptFormValues();
  if (JSON.stringify(cur) !== JSON.stringify(now)) savePromptSheet();
  else closePromptSheet();
}

/* ---------------- 表情包 ---------------- */

function stickers() {
  const list = (state.stickers = state.stickers || []);
  for (const it of list) {
    if (!Array.isArray(it.tags) || !it.tags.length) it.tags = ['表情'];
  }
  return list;
}

function openStickerSheet() {
  renderStickers();
  const sheet = $('#stickerSheet');
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
}

function closeStickerSheet() {
  const sheet = $('#stickerSheet');
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
}

function renderStickers() {
  renderEmojiStickers();          // 输入框上面的「我的表情包」跟着一起变
  const grid = $('#stickerGrid');
  const list = stickers();
  grid.textContent = '';
  $('#stickerEmpty').hidden = list.length > 0;
  $('#stickerEmpty').textContent = list.length
    ? ''
    : '还没有表情包。加一张试试（导入后她会自己认标签）。';
  for (const it of list) {
    const cell = document.createElement('div');
    cell.className = 'sticker-cell';
    const img = document.createElement('img');
    img.src = imgSrc(it.url);
    img.alt = '';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'st-del';
    del.textContent = '×';
    del.addEventListener('click', () => {
      state.stickers = stickers().filter((x) => x.id !== it.id);
      rememberDeleted([it.id]);          // 墓碑：别的设备/服务器也跟着删
      persist();
      renderStickers();
      renderStickerCount();
    });
    if (it.desc) {
      const d = document.createElement('div');
      d.className = 'st-desc';
      d.textContent = it.desc;
      cell.append(d);
    }
    const tags = document.createElement('input');
    tags.className = 'st-tags';
    tags.value = (it.tags || []).join(' ');
    tags.placeholder = '标签';
    tags.addEventListener('change', () => {
      it.tags = tags.value.split(/[\s,，、]+/).filter(Boolean).slice(0, 8);
      persist();
    });
    cell.append(img, del, tags);
    grid.append(cell);
  }
}

function renderStickerCount() {
  const el = $('#stickerCount');
  if (el) el.textContent = stickers().length ? `${stickers().length} 张` : '管理';
}

/** 图片先变成 blob 引用（云端），单机模式就留 data URL。 */
async function uploadImage(dataUrl) {
  if (!isCloud()) return dataUrl;
  try {
    const res = await apiFetch('/api/blob', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl }),
      timeout: 30000,
    });
    if (!res.ok) return dataUrl;
    const j = await res.json();
    return j && j.ref ? j.ref : dataUrl;
  } catch (_) {
    return dataUrl;
  }
}

/** 识图：一次拿到「关键词」和「一句话描述」。
 *  关键词给她挑（进 prompt），描述让她记得自己发的是什么（不进 prompt，省 token）。 */
async function tagSticker(dataUrl) {
  const key = (state.settings.apiKey || '').trim();
  if (!key || state.settings.vision === false) return { tags: [], desc: '' };
  try {
    const text = await quickChat([
      { role: 'system', content: '看这张表情包，输出两行：\n'
        + '第一行：3~6 个中文关键词，逗号分隔（情绪/画面/用法）。\n'
        + '第二行：一句话（不超过 20 字）说明这张图表达什么、画面是什么。\n'
        + '不要编号，不要解释，不要引号。' },
      { role: 'user', content: [{ type: 'text', text: '这张表情包是什么？' }, { type: 'image_url', image_url: { url: dataUrl } }] },
    ]);
    const lines = String(text || '').split('\n').map((x) => x.trim()).filter(Boolean);
    const clean = (w) => w.replace(/[。．.!！?？"'“”‘’（）()【】\[\]·]/g, '').trim();
    const tags = (lines[0] || '')
      .split(/[\s,，、;；/|]+/)
      .map(clean)
      .filter((w) => w && w.length <= 8)
      .slice(0, 6);
    const desc = clean((lines[1] || '').replace(/^描述[：:]/, '')).slice(0, 40);
    return { tags, desc };
  } catch (_) {
    return { tags: [], desc: '' };
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => resolve('');
    fr.readAsDataURL(file);
  });
}

async function addStickers(files) {
  const list = [...files].slice(0, 20);
  if (!list.length) return;
  toast(`正在处理 ${list.length} 张…`);
  for (const file of list) {
    // gif 必须原样收下：过一遍 canvas 就只剩第一帧，动图就死了
    const dataUrl = (file.type === 'image/gif' && file.size <= 3 * 1024 * 1024)
      ? await fileToDataUrl(file)
      : await imageToDataUrl(file, 480, 0.9);
    if (!dataUrl) continue;
    // 云端模式先上传成 blob 再入状态，别把 data URL 塞进要同步的 state
    const storedUrl = await uploadImage(dataUrl);
    const id = uid('st');
    const item = { id, url: storedUrl, tags: [], ts: Date.now() };
    state.stickers = stickers();
    state.stickers.push(item);
    renderStickers();
    persist();
    // 先占位再补标签，避免大图卡住 UI
    tagSticker(dataUrl).then(async (res) => {
      const tags = (res && res.tags) || [];
      // 识别不出来也要留个标签，否则她根本不知道有这个表情包可用
      item.tags = tags.length ? tags : ['表情'];
      if (res && res.desc) item.desc = res.desc;
      renderStickers();
      persist();
    }).catch(() => {});
  }
  renderStickerCount();
  toast('加好了');
}

/** blob 引用 → data URL（存表情包、备份时都要用）。 */
async function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => resolve('');
    fr.readAsDataURL(blob);
  });
}

/** 聊天里她发的图 → 一键收进表情包库，顺手打标签。 */
async function saveMsgAsSticker(msg) {
  if (!msg || !msg.image) return toast('这条不是图片');
  let dataUrl = msg.image;
  if (dataUrl.startsWith('@blob:')) {
    if (!isCloud()) return toast('这张图取不到');
    try {
      const res = await fetch(imgSrc(dataUrl));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      if (blob.size > 3 * 1024 * 1024) return toast('这张太大了');
      dataUrl = await blobToDataUrl(blob);
    } catch (_) { return toast('取不到这张图'); }
  }
  if (!/^data:image\//.test(dataUrl)) return toast('这条不是图片');
  const list = stickers();
  if (list.some((x) => x.url === dataUrl)) return toast('已经有了');
  const tags = (msg.stickerTags || []).slice();
  const storedUrl = await uploadImage(dataUrl);
  const item = { id: uid('st'), url: storedUrl, tags, desc: msg.stickerDesc || '', ts: Date.now() };
  state.stickers = list;
  state.stickers.push(item);
  renderStickers();
  renderStickerCount();
  persist();
  toast('存进表情包了');
  if (!tags.length) {
    tagSticker(dataUrl).then(async (res) => {
      const got = (res && res.tags) || [];
      item.tags = got.length ? got : ['表情'];
      if (res && res.desc) item.desc = res.desc;
      renderStickers();
      renderStickerCount();
      persist();
    }).catch(() => {});
  }
}

/* ---------------- 个人资料页 ---------------- */

let profileFriendId = null;

function openProfile(id) {
  const f = friendById(id);
  if (!f) return;
  profileFriendId = id;
  renderProfile();
  const sheet = $('#profileSheet');
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
}

function closeProfileSheet() {
  const sheet = $('#profileSheet');
  if (!sheet) return;
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
}

function renderProfile() {
  const f = friendById(profileFriendId);
  if (!f) return;
  const box = $('#pfAvatar');
  box.textContent = '';
  box.append(avatarEl(f));
  $('#pfName').textContent = f.note || f.name || '她';
  $('#pfIdLine').textContent = '轻聊号：' + (f.id || '');
  $('#pfRegionLine').textContent = f.region ? ('地区：' + f.region) : '';
  $('#pfSignLine').textContent = f.signature || '还没有个性签名';
  $('#pfNote').value = f.note || '';
  $('#pfRegion').value = f.region || '';
  $('#pfSignature').value = f.signature || '';

  const days = Math.max(1, Math.ceil((Date.now() - (Number(f.createdAt) || Date.now())) / 86400000));
  const msgs = (f.messages || []).length;
  const mine = (f.messages || []).filter((m) => m.role === 'user').length;
  const hers = msgs - mine;
  const pics = (f.messages || []).filter((m) => m.image || splitSvg(m.text || '')).length;
  const momentCount = (state.moments || []).filter((m) => m.authorId === f.id).length;
  const moneyList = (f.messages || []).filter((m) => m.role === 'user' && m.money);
  const moneySum = moneyList.reduce((n, m) => n + (Number(m.money.amount) || 0), 0);
  $('#pfStats').textContent = `认识 ${days} 天 · 一共 ${msgs} 条消息（她说 ${hers}，你说 ${mine}）\n`
    + `画过 ${pics} 张图 · 发过 ${momentCount} 条朋友圈`
    + (moneyList.length ? `\n收过 ${moneyList.length} 个红包 · 共 ¥${moneyText(moneySum)}` : '');

  // 她的近况 / 纪念日 + 记忆、日记入口（只建一次）
  let life = document.getElementById('pfLife');
  if (!life) {
    life = document.createElement('div');
    life.className = 'kv';
    life.id = 'pfLife';
    $('#pfStats').after(life);
    const editBtn = document.getElementById('btnPfEdit');
    if (editBtn && editBtn.parentNode) {
      const row = document.createElement('div');
      row.className = 'row-btns';
      row.id = 'pfExtraBtns';
      const mk = (id, text) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ghost';
        b.id = id;
        b.textContent = text;
        return b;
      };
      row.append(mk('btnPfMemory', '她记得的事'), mk('btnPfDiary', '她的日记'));
      row.addEventListener('click', (e) => {
        const f2 = friendById(profileFriendId);
        if (!f2) return;
        if (e.target.id === 'btnPfMemory') openMemorySheet(f2);
        if (e.target.id === 'btnPfDiary') openDiarySheet(f2);
      });
      editBtn.parentNode.insertBefore(row, editBtn);
    }
  }
  const latest = (f.events || []).slice(-1)[0];
  const anns = (f.anniversaries || []).map((a) => `${a.name}(${String(a.date || '').slice(5)})`).slice(0, 3);
  life.textContent = [
    latest ? `近况：${latest.text}` : '',
    anns.length ? `纪念日：${anns.join('、')}` : '',
  ].filter(Boolean).join('\n');
}

function saveProfile() {
  const f = friendById(profileFriendId);
  if (!f) return;
  const patch = {
    note: $('#pfNote').value.trim().slice(0, 24),
    region: $('#pfRegion').value.trim().slice(0, 24),
    signature: $('#pfSignature').value.trim().slice(0, 120),
  };
  Object.assign(f, patch);
  rememberFriendEdit(f, patch);
  persist();
  renderProfile();
  renderConversations();
  renderContacts();
  toast('存好了');
}

async function writeSignatureByAi() {
  const f = friendById(profileFriendId);
  if (!f) return;
  if (!(state.settings.apiKey || '').trim()) return toast('还没填 API Key');
  toast('让她想想…');
  try {
    const text = cleanLine(await quickChat([
      { role: 'system', content: personaLang(f) + '\n\n用你自己的口吻写一句个性签名，写在个人主页上的那种。'
        + '12~24 字，第一人称，像随口说的，可以用一个 emoji，不要引号，不要解释，只输出这一句。' },
      { role: 'user', content: '你的个性签名会写什么？' },
    ]), 40);
    if (!text) return toast('这次没写出来');
    $('#pfSignature').value = text;
    toast('写好了，记得保存');
  } catch (e) {
    toast('出错了：' + (e && e.message ? e.message : String(e)));
  }
}

let friendRefDraft = [];

/** 朋友资料里那排参考图（最多 6 张，点右上角 × 删）。 */
function renderImgRefs() {
  const grid = document.getElementById('rImgRefs');
  if (!grid) return;
  grid.textContent = '';
  friendRefDraft.forEach((ref, i) => {
    const cell = document.createElement('div');
    cell.className = 'sticker-cell';
    const img = document.createElement('img');
    img.src = imgSrc(ref);
    img.alt = '';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'st-del';
    del.textContent = '×';
    del.addEventListener('click', () => {
      friendRefDraft.splice(i, 1);
      renderImgRefs();
    });
    cell.append(img, del);
    grid.append(cell);
  });
  const empty = document.getElementById('rImgRefEmpty');
  if (empty) {
    empty.textContent = friendRefDraft.length
      ? ''
      : '还没有参考图：加 1~6 张她的照片，生图时一起发给模型，长相会更稳。';
  }
  const add = document.getElementById('btnImgRefAdd');
  if (add) {
    add.disabled = friendRefDraft.length >= 6;
    add.textContent = friendRefDraft.length >= 6 ? '已经 6 张了' : '＋ 加参考图';
  }
}

/** 用这个角色面板上（还没保存）的参数试一张，专门用来调参考图和生图提示词。 */
async function testFriendPhoto(f) {
  const cfg = photoCfgFor(f);
  const val = (id) => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
  cfg.model = val('rImgModel') || cfg.model;
  cfg.size = val('rImgSize') || cfg.size;
  cfg.quality = val('rImgQuality') || cfg.quality;
  cfg.style = val('rImgStyle') || cfg.style;
  cfg.refs = friendRefDraft.slice(0, 6);
  if (!cfg.base) return toast('先去「设置 → 她会发照片」填生图接口和 Key');
  closeFriendSheet();
  toast(cfg.refs.length ? ('带着 ' + cfg.refs.length + ' 张参考图生成，可能要几分钟…') : '正在生成一张，可能要几分钟…', 6000);
  try {
    const dataUrl = await genImage(
      buildPhotoPrompt('对着镜头自拍，穿着平常那件衣服，窗外是傍晚的街道，暖光', f, cfg), cfg);
    openLightbox(dataUrl, dataUrl);
    toast('生成好了');
  } catch (e) {
    toast('没生成出来：' + friendlyError(e), 6000);
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
      + '<p class="hint" id="rDelayHint"></p>'
      + '<label class="field"><span>静默多久主动找你（分钟）</span><input id="rNudge" type="number" min="10" max="1440" placeholder="跟随全局"></label>'
      + '<label class="field"><span>多久发一条朋友圈（小时）</span><input id="rMomentIv" type="number" min="0.2" max="72" step="0.5" placeholder="跟随全局"></label>'
      + '<p class="hint">填了就按这个时间自己发，不再受全局「朋友圈频率」影响；留空=跟随全局。</p>'
      + '<label class="field row-inline"><span>会主动找我</span><input id="rProactive" type="checkbox" class="switch"></label>'
      + '<label class="field row-inline"><span>每天早晚问候</span><input id="rGreet" type="checkbox" class="switch"></label>'
      + '<label class="field row-inline"><span>她会画图</span><input id="rDoodle" type="checkbox" class="switch"></label>'
      + '<label class="field"><span>小作文概率（%/天）</span><input id="rEssayChance" type="number" min="0" max="100" step="5" placeholder="跟随全局 15"></label>'
      + '<p class="hint">每天 9:00-22:00 按这个概率写一篇 300~600 字的长消息；0 = 关，100 = 每天写。</p>'
      + '<button type="button" class="ghost" id="btnEssayNow">让她现在写一篇</button>'
      + '<label class="field col"><span>下一条主动消息发什么（只生效一次）</span>'
      + '<input id="rNextProactive" type="text" maxlength="300" placeholder="例：发一篇特别抒情的长文章给我"></label>'
      + '<p class="hint">填了之后，她下次主动找你时一定按这个写；用掉自动清空。留空＝她自己决定。</p>'
      + '<div class="group-title" style="margin-top:18px">她的作息（这段时间她不发消息）</div>'
      + '<label class="field"><span>几点醒</span><input id="rWake" type="number" min="0" max="23" step="1" placeholder="不限"></label>'
      + '<label class="field"><span>几点睡</span><input id="rSleep" type="number" min="0" max="23" step="1" placeholder="不限"></label>'
      + '<label class="field row-inline"><span>每天写日记</span><input id="rDiary" type="checkbox" class="switch"></label>'
      + '<p class="hint">留空 = 全天醒着。和设置里的「夜里不打扰」叠加生效；你发消息她照回。</p>'
      + '<div class="group-title" style="margin-top:18px">纪念日</div>'
      + '<div id="annivList"></div>'
      + '<div class="anniv-add">'
      + '<input id="annivName" maxlength="16" placeholder="比如：第一次聊天">'
      + '<input id="annivDate" type="date">'
      + '<button type="button" class="ghost" id="btnAnnivAdd">＋ 加</button>'
      + '</div>'
      + '<p class="hint">到那天她会自己提起。认识第 100 / 200 / 365 / 500 / 1000 天也会自动记住。</p>'
      + '<div class="row-btns">'
      + '<button type="button" class="ghost" id="btnMemory">她记得的事</button>'
      + '<button type="button" class="ghost" id="btnDiaryBook">她的日记</button>'
      + '<button type="button" class="ghost" id="btnRoleCard">角色卡</button>'
      + '</div>';
    const anchor = document.getElementById('relationGroup');
    anchor.parentNode.insertBefore(box, anchor);

    // 她的照片：每个角色一套生图预设（画风/提示词/参考图/概率…），接口和 Key 还是全局的
    const photoBox = document.createElement('div');
    photoBox.className = 'group';
    photoBox.id = 'friendPhotoBox';
    photoBox.innerHTML = '<div class="group-title">她的照片（生图 · 每个角色单独设）</div>'
      + '<label class="field row-inline"><span>这个角色会发照片</span><input id="rImgOn" type="checkbox" class="switch"></label>'
      + '<p class="hint">关掉就只有她不发照片（别的角色照常）。接口、Key、总开关在「设置 → 她会发照片」里。</p>'
      + '<label class="field col"><span>生图提示词（什么时候拍 + 画风要求，两边都会看到）</span>'
      + '<textarea id="rImgPrompt" rows="6" placeholder="留空跟随全局。例：&#10;他想看的时候才发；&#10;必须是二次元画风，粗描线，平涂；&#10;只拍她此刻在做的具体的事"></textarea></label>'
      + '<div class="field col"><span>参考图（最多 6 张，长相以这些为准）</span>'
      + '<div id="rImgRefs" class="sticker-grid"></div>'
      + '<p class="hint" id="rImgRefEmpty"></p>'
      + '<button type="button" class="ghost" id="btnImgRefAdd">＋ 加参考图</button></div>'
      + '<p class="hint">加了参考图就会走接口的 <code>/images/edits</code>：这几张一起发过去，只换场景和动作。中转不支持会自动退回纯文字生图。</p>'
      + '<label class="field"><span>生图模型</span><input id="rImgModel" placeholder="跟随全局"></label>'
      + '<label class="field"><span>图片尺寸</span><select id="rImgSize">'
      + '<option value="">跟随全局</option>'
      + '<option value="1024x1024">方形 1024×1024</option>'
      + '<option value="1024x1536">竖图 1024×1536</option>'
      + '<option value="1536x1024">横图 1536×1024</option>'
      + '<option value="auto">让接口自己定</option>'
      + '</select></label>'
      + '<label class="field"><span>清晰度</span><select id="rImgQuality">'
      + '<option value="">跟随全局</option>'
      + '<option value="low">低（快、便宜）</option>'
      + '<option value="medium">中</option>'
      + '<option value="high">高（慢、贵、细节多）</option>'
      + '<option value="auto">接口默认</option>'
      + '</select></label>'
      + '<label class="field"><span>画风 / 长相</span><input id="rImgStyle" placeholder="跟随全局"></label>'
      + '<label class="field"><span>发照片概率（%）</span><input id="rImgChance" type="number" min="0" max="100" step="5" placeholder="跟随全局"></label>'
      + '<label class="field"><span>关键词必发照片</span><input id="rImgTriggers" placeholder="跟随全局"></label>'
      + '<p class="hint">他明说要「画」的时候一定走画图，不会触发照片。这里填了就按这个角色来，清空＝跟随全局。</p>'
      + '<div class="row-btns"><button type="button" class="ghost" id="btnImgRefTest">用她的设置试一张</button></div>';
    box.parentNode.insertBefore(photoBox, box.nextSibling);

    photoBox.querySelector('#btnImgRefAdd').addEventListener('click', async () => {
      if (friendRefDraft.length >= 6) return toast('参考图最多 6 张');
      // 参考图要看清脸：长边 2048（太长会把状态撑大，太短生图会糊）
      const dataUrl = await pickImage({ max: 2048, quality: 0.92 });
      if (!dataUrl) return;
      toast('处理参考图…', 1500);
      const ref = await uploadImage(dataUrl);
      friendRefDraft = friendRefDraft.concat([ref]).slice(0, 6);
      renderImgRefs();
    });
    photoBox.querySelector('#btnImgRefTest').addEventListener('click', () => {
      const f = friendById(editingFriendId);
      if (!f) return toast('先保存这个人，再试');
      testFriendPhoto(f);
    });

    // 用事件委托：这几个按钮是动态生成的，重新渲染时不用重新绑
    box.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const f = friendById(editingFriendId);
      if (!f) { toast('先保存这个人，再用这些功能'); return; }
      if (btn.id === 'btnAnnivAdd') {
        const name = (document.getElementById('annivName').value || '').trim();
        const date = document.getElementById('annivDate').value || '';
        if (!name || !date) return toast('名字和日期都要填');
        f.anniversaries = [...(f.anniversaries || []), { id: uid('an'), name: name.slice(0, 16), date }];
        rememberFriendEdit(f, { anniversaries: f.anniversaries });
        persist();
        document.getElementById('annivName').value = '';
        renderAnnivList(f);
        toast('加好了');
      } else if (btn.dataset.del) {
        f.anniversaries = (f.anniversaries || []).filter((a) => a.id !== btn.dataset.del);
        rememberFriendEdit(f, { anniversaries: f.anniversaries });
        persist();
        renderAnnivList(f);
      } else if (btn.id === 'btnEssayNow') { writeEssayNow(f); }
      else if (btn.id === 'btnMemory') openMemorySheet(f);
      else if (btn.id === 'btnDiaryBook') openDiarySheet(f);
      else if (btn.id === 'btnRoleCard') exportRoleCard(f);
    });
  }
  box.style.display = isMe ? 'none' : '';
  const own = (target && target.settings) || {};
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = (v === undefined || v === null) ? '' : v; };
  const chk = (id, v, dflt) => { const el = document.getElementById(id); if (el) el.checked = v === undefined ? dflt : !!v; };
  set('rBursts', own.bursts);
  set('rDelayMin', own.delayMin);
  set('rDelayMax', own.delayMax);
  $('#rDelayMin').placeholder = '跟随全局 ' + state.settings.delayMin + ' 秒';
  $('#rDelayMax').placeholder = '跟随全局 ' + state.settings.delayMax + ' 秒';
  {
    const eff = delayRange(target);
    const ownSet = own.delayMin !== undefined || own.delayMax !== undefined;
    $('#rDelayHint').textContent = '现在生效：'
      + (eff.on ? eff.min + '~' + eff.max + ' 秒均匀随机' : '随机延迟关着')
      + '（' + (ownSet ? '这个好友自己设的'
        : '跟随全局 ' + state.settings.delayMin + '~' + state.settings.delayMax + ' 秒') + '）。'
      + '这里填了就用这里的；清空=跟随全局。回复在等待期就已经生成好，到点先「正在输入」再整条发出来。';
  }
  set('rNudge', own.nudgeAfter);
  set('rMomentIv', own.momentInterval ? (own.momentInterval / 3600) : undefined);
  set('rWake', own.wake);
  set('rSleep', own.sleep);
  chk('rProactive', own.proactive, true);
  chk('rGreet', own.greet, true);
  chk('rDoodle', own.doodle, true);
  // 她的照片（每个角色单独设）
  const photoBox = document.getElementById('friendPhotoBox');
  if (photoBox) photoBox.style.display = isMe ? 'none' : '';
  chk('rImgOn', own.imageOn, true);
  set('rImgPrompt', own.imagePrompt);
  set('rImgModel', own.imageModel);
  const sel = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  sel('rImgSize', own.imageSize);
  sel('rImgQuality', own.imageQuality);
  set('rImgStyle', own.imageStyle);
  set('rImgChance', own.imageChance);
  set('rImgTriggers', own.imageTriggers);
  if (document.getElementById('rImgChance')) {
    document.getElementById('rImgChance').placeholder = '跟随全局 ' + Number(state.settings.imageChance ?? 15);
  }
  if (document.getElementById('rImgModel')) {
    document.getElementById('rImgModel').placeholder = '跟随全局 ' + (state.settings.imageModel || 'gpt-image-2');
  }
  friendRefDraft = (Array.isArray(own.imageRefs) ? own.imageRefs : []).filter((x) => typeof x === 'string' && x).slice(0, 6);
  renderImgRefs();
  set('rEssayChance', own.essayChance !== undefined ? own.essayChance : undefined);
  chk('rDiary', own.diary, true);
  set('rNextProactive', own.nextProactive);
  renderAnnivList(target);
}

/** 纪念日列表（在朋友资料面板里）。 */
function renderAnnivList(f) {
  const box = document.getElementById('annivList');
  if (!box) return;
  box.textContent = '';
  const list = (f && f.anniversaries) || [];
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '还没有纪念日。加一个吧——她到那天会自己提起。';
    box.append(p);
    return;
  }
  for (const a of list) {
    const row = document.createElement('div');
    row.className = 'anniv-row';
    const nm = document.createElement('span');
    nm.className = 'anniv-name';
    nm.textContent = a.name || '';
    const dt = document.createElement('span');
    dt.className = 'anniv-date';
    dt.textContent = /^\d{4}-\d{2}-\d{2}$/.test(a.date || '') ? a.date.slice(5) : (a.date || '');
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'mini-btn';
    del.textContent = '删';
    if (a.id) del.dataset.del = a.id;
    row.append(nm, dt, del);
    box.append(row);
  }
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
    wake: (() => { const h = num('rWake'); return h === undefined ? undefined : Math.max(0, Math.min(23, Math.round(h))); })(),
    sleep: (() => { const h = num('rSleep'); return h === undefined ? undefined : Math.max(0, Math.min(23, Math.round(h))); })(),
    proactive: document.getElementById('rProactive').checked,
    greet: document.getElementById('rGreet').checked,
    doodle: document.getElementById('rDoodle').checked,
    essayChance: num('rEssayChance'),
    diary: document.getElementById('rDiary').checked,
    nextProactive: (document.getElementById('rNextProactive').value || '').trim() || undefined,
    // 她的照片（每个角色单独设）
    imageOn: document.getElementById('rImgOn') ? document.getElementById('rImgOn').checked : true,
    imageModel: (document.getElementById('rImgModel') ? document.getElementById('rImgModel').value : '').trim() || undefined,
    imageSize: (document.getElementById('rImgSize') ? document.getElementById('rImgSize').value : '') || undefined,
    imageQuality: (document.getElementById('rImgQuality') ? document.getElementById('rImgQuality').value : '') || undefined,
    imageStyle: (document.getElementById('rImgStyle') ? document.getElementById('rImgStyle').value : '').trim() || undefined,
    imagePrompt: (document.getElementById('rImgPrompt') ? document.getElementById('rImgPrompt').value : '').trim() || undefined,
    imageChance: num('rImgChance'),
    imageTriggers: (() => {
      const el = document.getElementById('rImgTriggers');
      const words = String(el ? el.value : '').split(/[,，、;；\s]+/).map((x) => x.trim()).filter(Boolean).slice(0, 20);
      return words.length ? words.join(', ') : undefined;
    })(),
    imageRefs: friendRefDraft.length ? friendRefDraft.slice(0, 6) : undefined,
  };
  Object.keys(out).forEach((k) => { if (out[k] === undefined) delete out[k]; });
  return out;
}

const FRIEND_RHYTHM_KEYS = ['bursts', 'delayMin', 'delayMax', 'nudgeAfter',
  'momentInterval', 'proactive', 'greet', 'doodle', 'essayChance', 'diary',
  'wake', 'sleep', 'nextProactive',
  // 她的照片：每个角色一套生图预设
  'imageOn', 'imageModel', 'imageSize', 'imageQuality', 'imageStyle', 'imagePrompt',
  'imageChance', 'imageTriggers', 'imageRefs'];
const FRIEND_RHYTHM_DEFAULTS = { proactive: true, greet: true, doodle: true, essayChance: 15, diary: true,
  imageOn: true };

/** 面板上的值 vs 这个好友当前的 settings → 只给出真正变了的那几项。 */
function friendSettingsPatch(friend, want) {
  const cur = (friend && friend.settings) || {};
  const patch = {};
  for (const key of FRIEND_RHYTHM_KEYS) {
    const has = Object.prototype.hasOwnProperty.call(cur, key);
    const value = want[key];
    if (value === undefined) {
      if (has) patch[key] = null;                    // 清空输入 = 跟随全局
      continue;
    }
    const now = has ? cur[key] : FRIEND_RHYTHM_DEFAULTS[key];
    if (JSON.stringify(value) !== JSON.stringify(now)) patch[key] = value;
  }
  return patch;
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
  const fcBtn = $('#btnFClearChat');
  if (fcBtn) {
    const n = (friend && friend.messages) ? friend.messages.length : 0;
    fcBtn.textContent = n ? `清空聊天记录（${n} 条）` : '清空聊天记录';
  }
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
  const fbBg = $('#fbBgVal');
  if (fbBg) {
    fbBg.textContent = '只存本机';
    if (friend && !isNew && !isMe) {
      ChatBg.get('friend', friend.id).then((v) => { if (fbBg.isConnected) fbBg.textContent = v ? '已设置' : '只存本机'; }).catch(() => {});
    }
  }
  friendSheet.classList.add('open');
  friendSheet.setAttribute('aria-hidden', 'false');
}

function closeFriendSheet() {
  blurInside(friendSheet);
  friendSheet.classList.remove('open');
  friendSheet.setAttribute('aria-hidden', 'true');
}

$('#btnFBg').addEventListener('click', () => {
  const f = friendById(editingFriendId);
  if (!f) return toast('先保存这个人');
  openBgSheet('friend', f.id, f.note || f.name);
});

$('#btnGIBg').addEventListener('click', () => {
  const conv = currentConv();
  if (!conv || !state.conv || state.conv.kind !== 'group') return;
  openBgSheet('group', conv.id, conv.name);
});

$('#btnFClose').addEventListener('click', closeFriendSheet);

/* ---------------- 个人资料页的按钮 ---------------- */
$('#btnStRetag').addEventListener('click', async () => {
  const list = stickers().slice();
  if (!list.length) return toast('先加一张');
  if (!(state.settings.apiKey || '').trim()) return toast('还没填 API Key');
  toast(`重新识别 ${list.length} 张…`);
  for (const it of list) {
    const url = await imageForModel(it.url);
    if (!url) continue;
    const res = await tagSticker(url);
    if (res.tags && res.tags.length) it.tags = res.tags;
    if (res.desc) it.desc = res.desc;
    renderStickers();
  }
  persist();
  toast('识别完了');
});

$('#btnPrClose').addEventListener('click', closePromptSheetAutoSave);
$('#btnPrSave').addEventListener('click', savePromptSheet);
$('#btnPrReset').addEventListener('click', () => {
  for (const [, id] of PROMPT_FIELDS) { const el = document.getElementById(id); if (el) el.value = ''; }
  toast('已清空，点保存生效');
});
$('#btnPrompts').addEventListener('click', () => { closeSheet(); openPromptSheet(); });

$('#btnStClose').addEventListener('click', closeStickerSheet);
$('#btnStClear').addEventListener('click', () => {
  const list = stickers();
  if (!list.length) return toast('还没有表情包');
  if (!confirm('清空全部 ' + list.length + ' 个表情包？（聊天里已经发过的消息不会删）')) return;
  rememberDeleted(list.map((x) => x.id));   // 墓碑：各端一起清，服务器并集也不会再拉回来
  state.stickers = [];
  persist();
  renderStickers();
  renderStickerCount();
  toast('清空了');
});
$('#btnStAdd').addEventListener('click', () => $('#stFile').click());
$('#btnStPick').addEventListener('click', () => $('#stFile').click());
$('#stFile').addEventListener('change', (e) => {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (files.length) addStickers(files).then(() => {});
});
$('#btnStickers').addEventListener('click', () => { closeSheet(); openStickerSheet(); });

$('#btnPfClose').addEventListener('click', closeProfileSheet);
$('#btnPfSave').addEventListener('click', saveProfile);
$('#btnPfSignAi').addEventListener('click', writeSignatureByAi);
$('#btnPfChat').addEventListener('click', () => {
  const id = profileFriendId;
  closeProfileSheet();
  if (id) openChat('friend', id);
});
$('#btnPfMoments').addEventListener('click', () => {
  const id = profileFriendId;
  closeProfileSheet();
  if (!id) return;
  momentFilter = id;
  switchTab('moments');
  renderMoments();
});
$('#btnPfEdit').addEventListener('click', () => {
  const f = friendById(profileFriendId);
  closeProfileSheet();
  if (f) openFriendSheet(f, 'edit');
});

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
    // 新朋友只写真正填了的项，没填的留空＝跟随全局
    const own = {};
    for (const key of FRIEND_RHYTHM_KEYS) {
      const value = rhythm[key];
      if (value === undefined) continue;
      if (FRIEND_RHYTHM_DEFAULTS[key] === true && value === true) continue;
      own[key] = value;
    }
    if (Object.keys(own).length) f.settings = own;
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
    const patch = {};
    if (f.name !== name) patch.name = name;
    if ((f.avatar || '') !== avatar) patch.avatar = avatar;
    if ((f.persona || '') !== persona) patch.persona = persona;
    // 人设改了：记个时间戳，之后的回复要按新设定走，不许沿用旧口吻
    if ((f.persona || '') !== persona) {
      f.personaChangedAt = Date.now();
      rememberFriendEdit(f, { personaChangedAt: f.personaChangedAt });
    }
    const relations = $$('#relationList input:checked').map((cb) => cb.dataset.id);
    if (JSON.stringify(f.relations || []) !== JSON.stringify(relations)) patch.relations = relations;
    const dmMoment = $('#fDm').checked;
    if ((f.dmMoment !== false) !== dmMoment) patch.dmMoment = dmMoment;
    const settingsPatch = friendSettingsPatch(f, rhythm);
    // 小作文改成概率后，旧的 essay 布尔值作废；保存一次就清掉
    settingsPatch.essay = null;
    if (Object.keys(settingsPatch).length) patch.settings = settingsPatch;

    f.name = name;
    f.avatar = avatar;
    f.persona = persona;
    f.relations = relations;
    f.dmMoment = dmMoment;
    if (Object.keys(settingsPatch).length) {
      const next = Object.assign({}, f.settings || {});
      for (const [key, value] of Object.entries(settingsPatch)) {
        if (value === null) delete next[key]; else next[key] = value;
      }
      if (Object.keys(next).length) f.settings = next; else delete f.settings;
    }
    // 只把「用户真的改过的字段」记进 _edits.friends：服务端据此合并且不会
    // 拿整份旧快照把另一台设备刚改的设置覆盖回去。
    rememberFriendEdit(f, patch);
    persist();
    renderChat();
    renderConversations();
    renderContacts();
    if (isActive('friend', f.id)) $('#peerName').textContent = f.note || f.name;
  }
  closeFriendSheet();
});

/* 清空和某个人的聊天记录：消息 id 进墓碑（其它设备/服务器跟着删），人设/记忆/朋友圈保留 */
function clearFriendChat(f) {
  if (!f) return false;
  const msgs = f.messages || [];
  if (!msgs.length) { toast('她和你还没有聊天记录'); return false; }
  const who = f.note || f.name || '她';
  const ok = confirm(`清空和「${who}」的 ${msgs.length} 条聊天记录？\n\n`
    + '只清聊天记录：人设、你记得的事、朋友圈都会保留。\n'
    + '清完不能恢复，其它设备登录这个账号也会跟着清空。');
  if (!ok) return false;
  rememberDeleted(msgs.map((m) => m.id));
  f.messages = [];
  f.unread = 0;
  f.readAt = Date.now();
  rememberFriendEdit(f, { unread: 0, readAt: f.readAt });
  stopReply('friend', f);
  rt.delete(convKey('friend', f.id));
  if (isActive('friend', f.id)) closeChat();
  renderConversations();
  persist();
  toast('聊天记录已清空');
  return true;
}

$('#btnFClearChat').addEventListener('click', () => {
  const f = friendById(editingFriendId);
  if (!f) return;
  if (clearFriendChat(f)) closeFriendSheet();
});

$('#btnPfClear').addEventListener('click', () => {
  const f = friendById(profileFriendId);
  if (!f) return;
  if (clearFriendChat(f)) renderProfile();
});

$('#btnFDelete').addEventListener('click', () => {
  const f = friendById(editingFriendId);
  if (!f) return;
  if (!confirm('删除「' + f.name + '」和所有聊天记录？')) return;
  rememberDeleted([f.id, ...f.messages.map((m) => m.id)]);
  state.friends = state.friends.filter((x) => x.id !== f.id);
  state.groups.forEach((g) => { g.members = g.members.filter((id) => id !== f.id); });
  stopReply('friend', f);
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

let momentImages = [];

function openMomentSheet() {
  $('#fMomentText').value = '';
  momentImages = [];
  paintMomentPicks();
  if (!$('#fMomentImg')) {
    const wrap = document.createElement('div');
    wrap.className = 'field col';
    wrap.innerHTML = '<span>配图（可选，最多 9 张）</span>'
      + '<input type="file" id="fMomentImg" accept="image/*" multiple>'
      + '<div class="moment-picks" id="momentPicks"></div>'
      + '<span style="margin-top:10px">谁能看到</span>'
      + '<select id="fMomentVis"><option value="public">所有人</option>'
      + '<option value="relations">只有我的好友</option>'
      + '<option value="private">仅自己</option></select>';
    $('#fMomentText').closest('.sheet-body').appendChild(wrap);
    wrap.querySelector('input').addEventListener('change', async (e) => {
      const files = [...(e.target.files || [])].slice(0, 9 - momentImages.length);
      for (const file of files) {
        const url = await imageToDataUrl(file, 1280, 0.82);
        if (url && momentImages.length < 9) momentImages.push(url);
      }
      e.target.value = '';
      paintMomentPicks();
      if (files.length) toast(`已选 ${momentImages.length} 张`);
    });
  }
  momentSheet.classList.add('open');
  momentSheet.setAttribute('aria-hidden', 'false');
  setTimeout(() => $('#fMomentText').focus(), 200);
}

function paintMomentPicks() {
  const box = document.getElementById('momentPicks');
  if (!box) return;
  box.textContent = '';
  momentImages.forEach((url, i) => {
    const cell = document.createElement('div');
    cell.className = 'moment-pick';
    const img = document.createElement('img');
    img.src = url;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'moment-pick-x';
    x.textContent = '×';
    x.addEventListener('click', () => { momentImages.splice(i, 1); paintMomentPicks(); });
    cell.append(img, x);
    box.append(cell);
  });
}

/** 关弹层时把焦点还回去，安卓上输入法才会跟着收起。 */
function blurInside(el) {
  const a = document.activeElement;
  if (el && a && el.contains(a) && a.blur) { try { a.blur(); } catch (_) {} }
}

function closeMomentSheet() {
  blurInside(momentSheet);
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

/* ---------------- 记忆 / 日记 / 提醒 / 角色卡 / 聊天书 / 备份 / 归档 ---------------- */

/** 动态创建一个 sheet，只建一次。 */
function ensureSheet(id, html) {
  let el = document.getElementById(id);
  if (el) return el;
  el = document.createElement('section');
  el.className = 'sheet';
  el.id = id;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = html;
  phone.appendChild(el);
  // 新加的 sheet 也要纳入「关掉弹层再补刷新」的观察，否则同步会在这期间被推迟
  try { sheetWatcher.observe(el, { attributes: true, attributeFilter: ['class'] }); } catch (_) {}
  return el;
}

/** 通用「存成文件」：mac 壳 / 手机壳走原生保存，其它走浏览器下载。 */
async function downloadBlob(blob, name) {
  const bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.saveFile;
  if (bridge) {
    try {
      bridge.postMessage({ name, base64: await blobToBase64(blob) });
      toast('已保存到「下载」文件夹：' + name);
      return true;
    } catch (_) { /* 掉到浏览器下载 */ }
  }
  // Android：WebView 里 <a download> 点了没反应（没有下载管理器接），必须交给原生写进「下载」目录
  const android = window.QingliaoSave && window.QingliaoSave.save;
  if (android) {
    try {
      const where = android(name, await blobToBase64(blob));
      if (where) { toast('已保存：' + where); return true; }
      toast('保存失败：手机没让写文件');
      return false;
    } catch (_) { /* 掉到浏览器下载 */ }
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 6000);
    toast('已开始下载：' + name + '（浏览器默认存到「下载」）');
    return true;
  } catch (_) {
    toast('这台设备不让下载，换浏览器打开试试');
    return false;
  }
}

/** 存她发来的图时用的文件名：轻聊-她-20261104-223001 */
function imageSaveName(msg) {
  const who = (msg && msg.role === 'user') ? (state.me.name || '我') : nameOf(msg && msg.authorId);
  const d = new Date(Number(msg && msg.ts) || Date.now());
  const p2 = (n) => String(n).padStart(2, '0');
  return '轻聊-' + (who || '她') + '-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate())
    + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
}

/** 把一张图（@blob: 或 data:）取成 blob 存下去。手机上走原生，Mac 写「下载」，网页走浏览器下载。 */
async function saveImageRef(ref, baseName) {
  const url = imgSrc(ref);
  if (!url) return toast('这张图没取到地址，存不了');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const type = String(blob.type || 'image/jpeg');
    const ext = type.indexOf('png') >= 0 ? 'png' : type.indexOf('webp') >= 0 ? 'webp'
      : type.indexOf('gif') >= 0 ? 'gif' : 'jpg';
    return await downloadBlob(blob, (baseName || '轻聊图片') + '.' + ext);
  } catch (e) {
    toast('保存失败：' + ((e && e.message) || e));
    return false;
  }
}

/* ---------- 她记得的事 ---------- */

let memoryFriendId = null;

function openMemorySheet(f) {
  if (!f) return;
  memoryFriendId = f.id;
  const el = ensureSheet('memorySheet', `
    <header class="sheet-nav">
      <button class="text-btn" data-close="memorySheet">关闭</button>
      <span class="sheet-title">她记得的事</span>
      <button class="text-btn primary" id="btnMemSave">完成</button>
    </header>
    <div class="sheet-body">
      <div class="group">
        <div class="group-title">自动记忆</div>
        <textarea id="memAutoText" class="memory-edit" rows="5" maxlength="600"
          placeholder="还没有自动记忆（聊到 30 条她才会开始总结）"></textarea>
        <label class="field row-inline"><span>不再自动更新记忆</span><input id="memOff" type="checkbox" class="switch"></label>
        <p class="hint">她每 30 条消息自己总结一次，<b>用旁观视角写</b>（「他」= 你；不会用「我」指她自己）。
          总结写歪了可以直接改上面这段，点「完成」就生效。</p>
      </div>
      <div class="group">
        <div class="group-title">你必须记住的事</div>
        <div id="memNoteList"></div>
        <div class="anniv-add">
          <input id="memNew" maxlength="60" placeholder="比如：我不吃香菜">
          <button type="button" class="ghost" id="btnMemAdd">＋ 加</button>
        </div>
        <p class="hint">这些会直接进她的提示词，优先级比自动记忆高。她记错了就加一条纠正她。</p>
      </div>
    </div>`);
  const autoEl = $('#memAutoText');
  if (autoEl) autoEl.value = f.memory ? String(f.memory) : '';
  $('#memOff').checked = !!f.memoryOff;
  renderMemoryNotes(f);
  if (!el.dataset.bound) {
    el.dataset.bound = '1';
    el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-close]');
      if (t) {
        // 关掉也保存：免得改完顺手点关闭就白改了
        saveMemorySheet();
        return;
      }
      if (e.target.id === 'btnMemAdd') {
        const f2 = friendById(memoryFriendId);
        if (!f2) return;
        const inp = $('#memNew');
        const text = (inp.value || '').trim();
        if (!text) return;
        f2.memoryNotes = [...(f2.memoryNotes || []), { id: uid('mn'), text: text.slice(0, 120) }];
        rememberFriendEdit(f2, { memoryNotes: f2.memoryNotes });
        inp.value = '';
        renderMemoryNotes(f2);
      } else if (e.target.dataset.delNote) {
        const f2 = friendById(memoryFriendId);
        if (!f2) return;
        f2.memoryNotes = (f2.memoryNotes || []).filter((n) => n.id !== e.target.dataset.delNote);
        rememberFriendEdit(f2, { memoryNotes: f2.memoryNotes });
        renderMemoryNotes(f2);
      } else if (e.target.id === 'btnMemSave') {
        saveMemorySheet();
      }
    });
  }
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
}

function renderMemoryNotes(f) {
  const box = $('#memNoteList');
  if (!box) return;
  box.textContent = '';
  const notes = (f && f.memoryNotes) || [];
  if (!notes.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '还没有。加一条她必须记住的（比如你的口味、生日、不能提的事）。';
    box.append(p);
    return;
  }
  for (const n of notes) {
    const row = document.createElement('div');
    row.className = 'note-row';
    const inp = document.createElement('input');
    inp.value = n.text || '';
    inp.maxLength = 120;
    inp.dataset.noteId = n.id || '';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'mini-btn';
    del.textContent = '删';
    del.dataset.delNote = n.id || '';
    row.append(inp, del);
    box.append(row);
  }
}

function saveMemorySheet() {
  const f = friendById(memoryFriendId);
  if (!f) return;
  const notes = [];
  $$('#memNoteList input').forEach((inp) => {
    const text = (inp.value || '').trim();
    if (text) notes.push({ id: inp.dataset.noteId || uid('mn'), text: text.slice(0, 120) });
  });
  f.memoryNotes = notes;
  f.memoryOff = $('#memOff').checked;
  // 自动记忆也能手改：写歪了（比如把「我」写成她自己）直接在这里修
  const patch = { memoryNotes: notes, memoryOff: f.memoryOff };
  const autoEl = $('#memAutoText');
  if (autoEl) {
    const auto = String(autoEl.value || '').trim().slice(0, 600);
    if (auto !== (f.memory || '')) patch.memory = auto;
    f.memory = auto;
  }
  rememberFriendEdit(f, patch);
  persist();
  const el = document.getElementById('memorySheet');
  if (el) { el.classList.remove('open'); el.setAttribute('aria-hidden', 'true'); }
  toast('记住了');
}

/* ---------- 她的日记 ---------- */

function openDiarySheet(f) {
  if (!f) return;
  const el = ensureSheet('diarySheet', `
    <header class="sheet-nav">
      <button class="text-btn" data-close="diarySheet">关闭</button>
      <span class="sheet-title">她的日记</span>
      <span class="text-btn" style="opacity:.4">·</span>
    </header>
    <div class="sheet-body"><div id="diaryList"></div></div>`);
  if (!el.dataset.bound) {
    el.dataset.bound = '1';
    el.addEventListener('click', (e) => {
      if (!e.target.closest('[data-close]')) return;
      el.classList.remove('open');
      el.setAttribute('aria-hidden', 'true');
    });
  }
  renderDiaryList(f);
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
}

function renderDiaryList(f) {
  const box = $('#diaryList');
  if (!box) return;
  box.textContent = '';
  const list = (f.diary || []).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '她还没写过日记。夜里 20:00-23:00 她可能写一页，写完这里就能看到。';
    box.append(p);
    return;
  }
  for (const d of list) {
    const wrap = document.createElement('div');
    wrap.className = 'group diary-entry';
    const date = document.createElement('div');
    date.className = 'diary-date';
    const t = new Date(d.ts || Date.now());
    date.textContent = `${t.getFullYear()} 年 ${t.getMonth() + 1} 月 ${t.getDate()} 日`;
    const body = document.createElement('div');
    body.className = 'diary-text';
    body.textContent = d.text || '';
    wrap.append(date, body);
    box.append(wrap);
  }
}

/* ---------- 提醒 ---------- */

function allReminders() {
  const out = [];
  for (const f of state.friends || []) {
    for (const r of f.reminders || []) out.push({ f, r });
  }
  out.sort((a, b) => (a.r.dueAt || 0) - (b.r.dueAt || 0));
  return out;
}

function openReminderSheet() {
  const el = ensureSheet('reminderSheet', `
    <header class="sheet-nav">
      <button class="text-btn" data-close="reminderSheet">关闭</button>
      <span class="sheet-title">提醒</span>
      <span class="text-btn" style="opacity:.4">·</span>
    </header>
    <div class="sheet-body"><div id="reminderList"></div></div>`);
  if (!el.dataset.bound) {
    el.dataset.bound = '1';
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) {
        el.classList.remove('open');
        el.setAttribute('aria-hidden', 'true');
        return;
      }
      const del = e.target.closest('[data-del-reminder]');
      if (!del) return;
      const [fid, rid] = String(del.dataset.delReminder).split('|');
      const f = friendById(fid);
      if (!f) return;
      f.reminders = (f.reminders || []).filter((r) => r.id !== rid);
      rememberFriendEdit(f, { reminders: f.reminders });
      persist();
      renderReminders();
    });
  }
  renderReminders();
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
}

function renderReminders() {
  const box = $('#reminderList');
  if (!box) return;
  box.textContent = '';
  const list = allReminders();
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '还没有提醒。在聊天里跟她说「明天早上八点提醒我吃药」，她会记下来，到点主动提醒你。';
    box.append(p);
    return;
  }
  for (const { f, r } of list) {
    const row = document.createElement('div');
    row.className = 'reminder-row';
    const main = document.createElement('div');
    main.className = 'reminder-main';
    const when = document.createElement('div');
    when.className = 'reminder-time';
    const t = new Date(r.dueAt || Date.now());
    when.textContent = `${t.getMonth() + 1} 月 ${t.getDate()} 日 ${pad(t.getHours())}:${pad(t.getMinutes())}`;
    const what = document.createElement('div');
    what.className = 'reminder-what';
    what.textContent = `${f.note || f.name} · ${r.text || ''}`;
    main.append(when, what);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'mini-btn';
    del.textContent = '删';
    del.dataset.delReminder = f.id + '|' + r.id;
    row.append(main, del);
    box.append(row);
  }
}


/* ---------- 存储占用 ---------- */

let storageWarnAt = 0;

function reportStorageFull() {
  if (Date.now() - storageWarnAt < 8000) return;
  storageWarnAt = Date.now();
  try { openStorageSheet(true); } catch (_) { toast('存储空间满了，清理一下'); }
}

function storageStats() {
  let text = 0, img = 0, sticker = 0, avatar = 0, messages = 0;
  for (const c of [...(state.friends || []), ...(state.groups || [])]) {
    for (const m of c.messages || []) {
      messages += 1;
      if (m.text) text += String(m.text).length;
      if (m.image && String(m.image).startsWith('data:')) img += String(m.image).length;
    }
  }
  for (const it of state.stickers || []) sticker += String(it.url || '').length;
  avatar = String(state.me.avatar || '').length;
  for (const f of state.friends || []) avatar += String(f.avatar || '').length;
  for (const g of state.groups || []) avatar += String(g.avatar || '').length;
  let total = 0;
  try { total = new Blob([JSON.stringify(state)]).size; }
  catch (_) { try { total = JSON.stringify(state).length; } catch (__) { total = 0; } }
  return { total, text, img, sticker, avatar, messages, deleted: (state.deleted || []).length };
}

function openStorageSheet(warn) {
  const el = ensureSheet('storageSheet', `
    <header class="sheet-nav">
      <button class="text-btn" data-close="storageSheet">关闭</button>
      <span class="sheet-title">存储占用</span>
      <span class="text-btn" style="opacity:.35">·</span>
    </header>
    <div class="sheet-body">
      <div class="group">
        <div class="group-title">现在存在哪</div>
        <div class="kv" id="storageMode"></div>
        <div class="kv" id="storageEstimate"></div>
        <div class="storage-warn" id="storageWarn" hidden>保存失败过：先导一份备份，再删表情包或清空旧聊天。</div>
      </div>
      <div class="group">
        <div class="group-title">占用明细（约）</div>
        <div class="storage-list" id="storageList"></div>
      </div>
      <div class="group">
        <div class="group-title">清理</div>
        <div class="row-btns">
          <button type="button" class="ghost solid" id="btnStorageBackup">导出备份</button>
          <button type="button" class="ghost" id="btnStorageStickers">管理表情包</button>
        </div>
        <div class="row-btns">
          <button type="button" class="ghost" id="btnStorageTomb">清空删除标记</button>
        </div>
        <p class="hint">删除标记只有多端同步才用得上；单机模式已经不再产生，清掉不会影响聊天。</p>
      </div>
    </div>`);
  if (!el.dataset.bound) {
    el.dataset.bound = '1';
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) {
        el.classList.remove('open');
        el.setAttribute('aria-hidden', 'true');
        return;
      }
      if (e.target.id === 'btnStorageBackup') { backupNow(); return; }
      if (e.target.id === 'btnStorageStickers') {
        el.classList.remove('open');
        el.setAttribute('aria-hidden', 'true');
        openStickerSheet();
        return;
      }
      if (e.target.id === 'btnStorageTomb') {
        state.deleted = [];
        persist();
        renderStorageSheet();
        toast('已清空删除标记');
      }
    });
  }
  renderStorageSheet(warn);
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
}

function renderStorageSheet(warn) {
  const st = storageStats();
  const mode = LocalState.mode || 'ls';
  const modeEl = $('#storageMode');
  if (modeEl) {
    modeEl.textContent = mode === 'native'
      ? 'App 私有文件：没有 5MB 限制，卸载 App 才会清掉。'
      : mode === 'idb'
        ? 'IndexedDB：没有 5MB 限制。'
        : 'localStorage：上限约 5MB，满了会保存失败（建议改用新版本 APK / 本机模式）。';
  }
  const warnEl = $('#storageWarn');
  if (warnEl) warnEl.hidden = !warn;
  const list = $('#storageList');
  if (list) {
    list.textContent = '';
    const rows = [
      ['总计（state.json）', st.total, true],
      ['聊天文字', st.text * 3],
      ['聊天图片', st.img],
      ['表情包', st.sticker],
      ['头像', st.avatar],
      ['删除标记', st.deleted * 36],
    ];
    for (const [label, n, strong] of rows) {
      const row = document.createElement('div');
      row.className = 'storage-row' + (strong ? ' strong' : '');
      const k = document.createElement('span');
      k.textContent = label;
      const v = document.createElement('span');
      v.className = 'storage-val';
      v.textContent = humanSize(n);
      row.append(k, v);
      list.append(row);
    }
    const meta = document.createElement('div');
    meta.className = 'kv';
    meta.textContent = `${st.messages} 条消息 · ${(state.friends || []).length} 个朋友 · `
      + `${(state.groups || []).length} 个群 · ${(state.stickers || []).length} 个表情包`
      + (st.deleted ? ` · ${st.deleted} 个删除标记` : '');
    list.append(meta);
  }
  const estEl = $('#storageEstimate');
  if (estEl && navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then((e) => {
      if (!e || !e.quota) return;
      estEl.textContent = `浏览器报告：已用 ${humanSize(e.usage || 0)} / 配额 ${humanSize(e.quota)}`;
    }).catch(() => {});
  }
}

/* ---------- 角色卡 ---------- */

async function exportRoleCard(f) {
  if (!f) return;
  let avatar = f.avatar || '';
  if (avatar.startsWith('@blob:')) {
    try {
      const res = await fetch(imgSrc(avatar));
      if (res.ok) avatar = await blobToDataUrl(await res.blob());
    } catch (_) {}
  }
  const card = {
    format: 'qingliao-card',
    version: 1,
    name: f.name || '',
    avatar,
    persona: f.persona || '',
    settings: f.settings || {},
    memoryNotes: f.memoryNotes || [],
    anniversaries: f.anniversaries || [],
    createdAt: f.createdAt || Date.now(),
    exportedAt: Date.now(),
  };
  const blob = new Blob([JSON.stringify(card, null, 2)], { type: 'application/json' });
  await downloadBlob(blob, `轻聊角色卡-${String(f.name || '角色').replace(/[\\/:*?"<>|]/g, '_')}.json`);
  toast('角色卡导出了，发给别人就能一键导入');
}

async function importRoleCard(file) {
  if (!file) return;
  try {
    const card = JSON.parse(await file.text());
    if (!card || !card.persona) throw new Error('这不是轻聊的角色卡');
    if (card.format && card.format !== 'qingliao-card') throw new Error('格式不对');
    const f = makeFriend({
      name: card.name || '新朋友',
      avatar: card.avatar || '',
      persona: card.persona,
      settings: card.settings || {},
      memoryNotes: card.memoryNotes || [],
      anniversaries: card.anniversaries || [],
    });
    f.createdAt = Number(card.createdAt) || Date.now();
    state.friends.push(f);
    persist();
    renderContacts();
    renderConversations();
    openChat('friend', f.id);
    toast('角色卡导入了');
  } catch (e) {
    toast('导入失败：' + ((e && e.message) || e));
  }
}

/* ---------- 聊天书 ---------- */

function openChatBookSheet() {
  const el = ensureSheet('bookSheet', `
    <header class="sheet-nav">
      <button class="text-btn" data-close="bookSheet">关闭</button>
      <span class="sheet-title">做一本聊天书</span>
      <button class="text-btn primary" id="btnBookMake">生成</button>
    </header>
    <div class="sheet-body">
      <div class="group">
        <label class="field"><span>哪段聊天</span><select id="bookConv"></select></label>
        <label class="field"><span>范围</span>
          <select id="bookRange">
            <option value="0">全部</option>
            <option value="90">最近 90 天</option>
            <option value="30">最近 30 天</option>
            <option value="7">最近 7 天</option>
          </select>
        </label>
        <div class="row-btns"><button type="button" class="ghost solid" id="btnBookMake2">生成 .docx</button></div>
        <p class="hint">打开后是一本按天分节的 Word 文档：日期、时间、谁说的、说了什么。图片和文件用一行占位。聊天多的话生成要几秒。</p>
      </div>
    </div>`);
  if (!el.dataset.bound) {
    el.dataset.bound = '1';
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-close]')) {
        el.classList.remove('open');
        el.setAttribute('aria-hidden', 'true');
        return;
      }
      if (e.target.id === 'btnBookMake' || e.target.id === 'btnBookMake2') {
        await makeChatBook();
      }
    });
  }
  const sel = $('#bookConv');
  sel.textContent = '';
  for (const f of state.friends || []) {
    const o = document.createElement('option');
    o.value = 'friend:' + f.id;
    o.textContent = (f.note || f.name) + '（私聊）';
    sel.append(o);
  }
  for (const g of state.groups || []) {
    const o = document.createElement('option');
    o.value = 'group:' + g.id;
    o.textContent = (g.name || '群聊') + '（群）';
    sel.append(o);
  }
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
}

async function makeChatBook() {
  const sel = $('#bookConv');
  if (!sel || !sel.value) return toast('还没有可选的聊天');
  const [kind, id] = sel.value.split(':');
  const conv = kind === 'group' ? groupById(id) : friendById(id);
  if (!conv) return toast('这个聊天不见了');
  const days = Number($('#bookRange').value) || 0;
  const cutoff = days ? Date.now() - days * 86400000 : 0;
  const msgs = (conv.messages || []).filter((m) => m.ts >= cutoff && !m.recalled && m.role !== 'system');
  if (!msgs.length) return toast('这段聊天没有内容');
  toast('正在排版…', 8000);
  const lines = [];
  const title = kind === 'group' ? (conv.name || '群聊') : (conv.note || conv.name);
  lines.push('# ' + title + ' · 聊天书');
  const first = new Date(msgs[0].ts);
  const last = new Date(msgs[msgs.length - 1].ts);
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  lines.push(`# ${fmt(first)} ~ ${fmt(last)} · 共 ${msgs.length} 条`);
  let lastDay = '';
  for (const m of msgs) {
    const d = new Date(m.ts);
    const day = fmt(d);
    if (day !== lastDay) {
      lines.push('# ' + day + ' ' + weekday(d));
      lastDay = day;
    }
    const who = m.role === 'user' ? (state.me.name || '我') : nameOf(m.authorId || conv.id);
    let body = m.text || '';
    if (m.image) body = m.sticker ? '[表情包]' : '[图片]';
    if (m.file && m.file.name) body = '[文件：' + m.file.name + ']';
    if (splitSvg(m.text || '')) body = '[画了一张图]';
    body = body.replace(/\s*\n+\s*/g, ' / ').slice(0, 1200);
    if (!body) continue;
    lines.push(`${timeOf(m.ts)} ${who}：${body}`);
  }
  lines.push('');
  lines.push('# —— 由轻聊生成 ——');
  if (lines.length < 4) return toast('这段聊天没有可排版的内容');
  await saveGeneratedFile({
    name: `聊天书-${String(title || '聊天').replace(/[\\/:*?"<>|]/g, '_')}-${fmt(last)}.docx`,
    text: lines.join('\n'),
  });
}

/* ---------- 备份 / 恢复（zip，带图片） ---------- */

function collectBlobRefs(obj, out) {
  if (!obj) return out;
  if (typeof obj === 'string') {
    if (obj.startsWith('@blob:')) out.add(obj.slice(6));
    return out;
  }
  if (Array.isArray(obj)) { for (const x of obj) collectBlobRefs(x, out); return out; }
  if (typeof obj === 'object') { for (const v of Object.values(obj)) collectBlobRefs(v, out); }
  return out;
}

async function fetchBlobBytes(name) {
  const res = await fetch(imgSrc('@blob:' + name));
  if (!res.ok) throw new Error('图片取不到：' + name);
  return new Uint8Array(await res.arrayBuffer());
}

/** 读自己写的 zip（只支持 store，不压缩）。 */
function unzipStore(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  const stop = Math.max(0, u8.length - 22 - 65535);
  for (let i = u8.length - 22; i >= stop; i -= 1) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是 zip 文件');
  const count = dv.getUint16(eocd + 10, true);
  const cdOff = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = {};
  let p = cdOff;
  for (let i = 0; i < count; i += 1) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    if (method !== 0) throw new Error('不支持的压缩方式：' + name);
    const lnameLen = dv.getUint16(localOff + 26, true);
    const lextraLen = dv.getUint16(localOff + 28, true);
    const start = localOff + 30 + lnameLen + lextraLen;
    out[name] = u8.slice(start, start + csize);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function replaceBlobRefs(obj, map) {
  if (typeof obj === 'string') return map.has(obj) ? map.get(obj) : obj;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i += 1) obj[i] = replaceBlobRefs(obj[i], map);
    return obj;
  }
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) obj[k] = replaceBlobRefs(obj[k], map);
  }
  return obj;
}

async function buildBackupZip() {
  const snap = JSON.parse(JSON.stringify(state));
  delete snap._diag;
  const items = [];
  if (isCloud()) {
    const refs = [...collectBlobRefs(snap, new Set())];
    let done = 0;
    for (const name of refs) {
      try {
        items.push({ name: 'blobs/' + name, data: await fetchBlobBytes(name) });
      } catch (_) { /* 丢一张图不算致命 */ }
      done += 1;
      if (done % 10 === 0) toast(`正在打包… ${done}/${refs.length} 张图`, 60000);
    }
  }
  items.unshift({ name: 'state.json', data: JSON.stringify(snap) });
  items.push({
    name: '说明.txt',
    data: '轻聊备份\n\n恢复：我的 → 从文件恢复，选这个 zip。\n'
      + '里面 state.json 是聊天数据，blobs/ 是图片。\n'
      + '注意：备份里含 API Key，别随便发给别人。\n',
  });
  return { zip: zipStore(items), count: items.length };
}

async function backupNow() {
  toast('正在打包…', 60000);
  const { zip, count } = await buildBackupZip();
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const ok = await downloadBlob(new Blob([zip], { type: 'application/zip' }),
    `轻聊备份-${stamp}.zip`);
  if (ok) toast(`备份好了：${count} 个文件 → 轻聊备份-${stamp}.zip`);
}

async function restoreFromZip(file) {
  if (!file) return;
  if (!confirm('用这个备份覆盖当前数据？现有的会被替换。')) return;
  try {
    toast('正在解包…', 60000);
    const files = unzipStore(await file.arrayBuffer());
    const raw = files['state.json'];
    if (!raw) throw new Error('压缩包里没有 state.json');
    const data = JSON.parse(new TextDecoder().decode(raw));
    if (!data || !Array.isArray(data.friends)) throw new Error('不是轻聊的备份');

    const refs = [...collectBlobRefs(data, new Set())];
    const map = new Map();
    let done = 0;
    for (const name of refs) {
      const entry = files['blobs/' + name] || files['blobs/' + encodeURIComponent(name)];
      if (!entry) continue;
      const dataUrl = await blobToDataUrl(new Blob([entry]));
      if (!dataUrl) continue;
      const ref = isCloud() ? await uploadImage(dataUrl) : dataUrl;
      map.set('@blob:' + name, ref);
      done += 1;
      if (done % 10 === 0) toast(`正在恢复图片… ${done}/${refs.length}`, 60000);
    }
    replaceBlobRefs(data, map);
    state = migrate(data);
    pendingEdits = importEdits(state);
    lastRev = -1;
    persist();
    if (state.conv && !currentConv()) closeChat();
    renderMe();
    renderConversations();
    renderContacts();
    renderMoments();
    renderTabBadge();
    if (pageChat.classList.contains('open') && currentConv()) renderChat();
    syncWake('restore');
    toast('恢复好了');
  } catch (e) {
    toast('恢复失败：' + ((e && e.message) || e));
  }
}

/* ---------- 数据瘦身 ---------- */

async function loadEarlier(conv, btn) {
  if (!isCloud()) return toast('单机模式没有归档');
  const first = (conv.messages || [])[0];
  const before = first ? (first.ts || Date.now()) : Date.now();
  btn.disabled = true;
  btn.textContent = '正在加载…';
  try {
    const res = await apiFetch('/api/archive?fid=' + encodeURIComponent(conv.id) + '&before=' + before + '&limit=100');
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
    const list = (j.messages || []).filter((m) => m && m.id);
    if (!list.length) {
      btn.textContent = '没有更早的消息了';
      btn.disabled = true;
      return;
    }
    const prevH = chatEl.scrollHeight;
    const prevTop = chatEl.scrollTop;
    conv.messages = [...list, ...conv.messages];
    renderChat();
    chatEl.scrollTop = prevTop + (chatEl.scrollHeight - prevH);
    toast(`加载了 ${list.length} 条`);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '加载更早的消息';
    toast('加载失败：' + ((e && e.message) || e));
  }
}

async function archiveNow() {
  if (!isCloud()) return toast('单机模式不支持归档');
  const days = Math.max(1, Number(state.settings.archiveDays) || 0);
  if (!days) return toast('先在设置里填「老消息归档（天）」');
  if (!confirm(`把 ${days} 天前的消息挪到服务器归档？\n\n聊天里还能点「加载更早」翻出来；别的设备同步会变快。`)) return;
  try {
    toast('正在归档…', 30000);
    const res = await apiFetch('/api/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days }),
      timeout: 120000,
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
    const cutoff = Number(j.cutoff) || 0;
    let moved = 0;
    for (const f of state.friends) {
      const before = (f.messages || []).length;
      f.messages = (f.messages || []).filter((m) => (m.ts || 0) >= cutoff);
      f.archivedBefore = cutoff;
      f.archivedCount = Number(f.archivedCount) || 0;
      moved += before - f.messages.length;
    }
    lastRev = -1;
    persist();
    renderConversations();
    if (pageChat.classList.contains('open') && currentConv()) renderChat();
    toast(`归档了 ${j.archived || moved} 条消息`);
  } catch (e) {
    toast('归档失败：' + ((e && e.message) || e));
  }
}

/* ---------------- 导出 ---------------- */

if (!document.getElementById('btnBackup')) {
  const wrap = document.createElement('div');
  wrap.className = 'menu-group';
  wrap.innerHTML = '<button class="menu-item" id="btnBackup"><span>备份到文件（含图片，存到「下载」）</span><b>↓</b></button>'
    + '<button class="menu-item" id="btnRestore"><span>从备份恢复</span><b>↑</b></button>'
    + '<button class="menu-item" id="btnChatBook"><span>做一本聊天书（.docx）</span><b>›</b></button>'
    + '<button class="menu-item" id="btnReminders"><span>提醒</span><b>›</b></button>'
    + '<button class="menu-item" id="btnImportCard"><span>导入角色卡</span><b>›</b></button>'
    + '<input type="file" id="restoreFile" accept="application/zip,.zip,application/json,.json" hidden>'
    + '<input type="file" id="roleCardFile" accept="application/json,.json" hidden>';
  const anchor = document.getElementById('btnExportAll').closest('.menu-group');
  anchor.parentNode.insertBefore(wrap, anchor.nextSibling);

  document.getElementById('btnBackup').addEventListener('click', () => { backupNow(); });

  document.getElementById('btnRestore').addEventListener('click', () => {
    document.getElementById('restoreFile').click();
  });

  document.getElementById('btnChatBook').addEventListener('click', openChatBookSheet);
  document.getElementById('btnReminders').addEventListener('click', openReminderSheet);
  document.getElementById('btnImportCard').addEventListener('click', () => {
    document.getElementById('roleCardFile').click();
  });

  document.getElementById('roleCardFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    await importRoleCard(file);
  });

  document.getElementById('restoreFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (/\.json$/i.test(file.name)) {
      // 兼容老版 JSON 备份（没图）
      try {
        const data = JSON.parse(await file.text());
        if (!data || !Array.isArray(data.friends)) throw new Error('不是轻聊的备份文件');
        if (!confirm('用这个备份覆盖当前数据？现有的会被替换。')) return;
        state = migrate(data);
        pendingEdits = importEdits(state);
        lastRev = -1;
        persist();
        renderMe(); renderConversations(); renderContacts(); renderMoments();
        toast('已恢复');
      } catch (err) {
        toast('恢复失败：' + ((err && err.message) || err));
      }
      return;
    }
    await restoreFromZip(file);
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
    if (!isCloud()) {
      alert('当前是本地模式（数据都在这台设备上），没有服务器状态可看。\n'
        + '想连服务器的话：我的 → 登录账号（多端同步）。');
      return;
    }
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
  if (quietNow()) return;                 // 免打扰：不主动冒泡
  const conv = currentConv();
  if (!conv || state.conv.kind !== 'friend') return;
  if (friendAsleep(conv)) return;         // 她按作息睡了
  const r = rtOf(convKey('friend', conv.id));
  if (r.phase !== 'idle') return;
  const last = lastMessage(conv);
  if (!last || last.role !== 'user') return;
  const mins = (Date.now() - lastActivity) / 60000;
  if (mins < Math.max(3, Number(state.settings.idleMin) || 20)) return;
  if (conv.nudgeAt && Date.now() - conv.nudgeAt < 20 * 60000) return;
  conv.nudgeAt = Date.now();

  // 主动消息单独一套要求：以前复用「接着聊」，导致她接着上文说话、
  // 甚至把自己当成对方（「我回家了」）。
  // 设置里 ③ 写了就用它整段替换「要求」，身份约束和输出格式永远由代码保证。
  const directive = (conv.settings && conv.settings.nextProactive) || '';
  const canDraw = fs(conv, 'doodle', state.settings.doodle !== false);
  const customProactive = promptExtra('proactive');
  r.proactive = true;
  r.nudge = [
    '【主动消息】你们安静了一阵，现在你要主动给他发一条消息。',
    '要求：只写你自己说的话；不要替他说话、不要假装是他；不要复述他以前说过的话。',
    ...(customProactive ? [customProactive] : [
      '一到三句，可以拆成两三条短消息（用换行分开），像真人想到就发。',
      '说你此刻的事：在做什么、看到什么、突然想到什么，要具体（几点、什么味道、手上在干嘛）。',
      '跟上一轮最多若隐若现地沾一点，不要接着追问。',
      '可以问一个真的问题，像真人会问的那种没头没尾的：「我以后会死吗」「你说人为什么要上班」。',
      '可以有情绪：突然有点低落、有点黏、有点气；允许说一半停住。',
      '不要“在吗”“干嘛呢”“想我了吗”这种套话，不要总结、不要讲道理。',
    ]),
    directive ? ('【他给你留了一条指令，这一条必须照它写】' + directive) : '',
    canDraw ? '如果这条里你想给他看点什么，可以顺手画一张（规则同【画图】）。' : '',
    '只输出你要发的消息。',
  ].filter(Boolean).join('\n');
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

/** 朋友圈这种要多段的：保留换行，只去掉首尾引号。 */
function cleanBlock(text, limit) {
  const t = (text || '').trim().replace(/^["“「]|["”」]$/g, '');
  return t.split('\n').map((x) => x.trim()).filter(Boolean).join('\n').slice(0, limit);
}

function threadText(m, limit = 10) {
  const list = (m.comments || []).slice(-limit);
  return list.map((c) => `${nameOf(c.by)}：${c.text}`).join('\n');
}

/* 以下四个生成函数：APK 里没有服务器，朋友圈全靠这里长出来 */

async function genComment(f, authorName, momentText, thread) {
  let sys = `${personaLang(f)}\n\n${authorName} 发了条朋友圈：\n「${momentText}」\n\n`;
  // 设置里 ⑤ 写了就整段替换「注意」那几条；输出协议（只发一句、不加名字）始终由代码保证。
  const custom = promptExtra('comment');
  if (thread) {
    sys += `评论区已经有这些话：\n${thread}\n\n`;
    sys += custom
      ? `你再补一句评论。要求：\n${custom}\n`
      : '你再补一句评论。注意：\n- 别人说过的别重复\n- 对方在回你就顺着接，别再问同一个问题\n- 10~25 字，口语\n';
  } else {
    sys += custom
      ? `用一句评论回应。要求：\n${custom}\n`
      : '用一句评论回应，10~25 字，口语，像熟人随口说的。\n';
  }
  sys += '只输出你自己的一句评论（不超过 30 字），不要加人名前缀，不要写成两个人对话，不要替别人说话，也不要安慰自己。';
  return cleanLine(await quickChat([{ role: 'system', content: sys }]), 60);
}

async function genReply(f, commenterName, momentText, commentText, thread) {
  let sys = `${personaLang(f)}\n\n你发了条朋友圈：\n「${momentText}」\n\n`;
  if (thread) sys += `评论区：\n${thread}\n\n`;
  const custom = promptExtra('reply');
  sys += `${commenterName} 刚评论了：\n「${commentText}」\n\n`;
  sys += custom
    ? `回他一句。要求：\n${custom}\n`
    : '回他一句。10~25 字，口语，像真人回评论。\n';
  sys += '只输出你自己的一句话，不要加人名前缀，不要替别人说话。';
  return cleanLine(await quickChat([{ role: 'system', content: sys }]), 60);
}

async function genDm(f, ownerName, momentText) {
  const custom = promptExtra('dm');
  const sys = `${personaLang(f)}\n\n${ownerName} 刚发了条朋友圈：\n「${momentText}」\n\n`
    + (custom
      ? `你想私聊跟他说一句，就为这事儿。要求：\n${custom}\n`
      : '你想私聊跟他说一句，就为这事儿。10~25 字，口语，像微信上随手发的。不要提“朋友圈”三个字。\n')
    + '只输出你自己这一句。';
  return cleanLine(await quickChat([{ role: 'system', content: sys }]), 60);
}

async function genGroupLine(f, authorName, momentText, prev) {
  let sys = `${personaLang(f)}\n\n你们在一个群里聊天。${authorName} 刚发了条朋友圈：\n「${momentText}」\n\n`;
  if (prev && prev.length) sys += `群里已经有人说：\n${prev.join('\n')}\n\n`;
  const custom = promptExtra('groupChat');
  sys += custom
    ? `你要在群里说一句，聊的就是这条。要求：\n${custom}\n只输出这一句。`
    : '你要在群里说一句，聊的就是这条。10~25 字，口语。只输出这一句。';
  return cleanLine(await quickChat([{ role: 'system', content: sys }]), 60);
}

/** 单机版「偶尔一篇小作文」：她主动发一段 300~600 字。 */
async function genEssayLocal(f) {
  const meName = state.me.name || '他';
  const chatLines = (f.messages || []).slice(-6)
    .filter((m) => (m.text || '').trim())
    .map((m) => `${m.role === 'user' ? meName : '我'}：${String(m.text).slice(0, 50)}`);
  const sys = `${personaLang(f)}\n\n`
    + `【身份】「我」是你自己，「${meName}」是他。你不是他，不要替他说，也不要假装是他。\n`
    + `【环境】现在是 ${timeOf(Date.now())}，${weekday(new Date())}。\n`
    + '【说话要讲道理】\n- 时间、地点、正在做的事，要和【环境】以及前面说过的话对得上；拿不准就别提具体时间\n'
    + '- 一次只说一件事，别一句话里塞好几件不相关的事\n'
    + '- 上一条说错了就像真人一样顺口认一下，别硬编\n\n'
    + (chatLines.length ? `你们最近聊过这些（只当背景，别复述、别逐条回应）：\n${chatLines.join('\n')}\n\n` : '')
    + '现在你想给他写一段长一点的话（不是聊天，是那种想了很多、忍不住写下来的）。要求：\n'
    + '- 300~600 字，分 2~4 段，用换行分段\n'
    + '- 说你最近的心情、你在想的事、你们之间的一件小事；要具体（一个画面、一句话、一个时间）\n'
    + '- 第一人称，像在微信上认真打字发给他，不像作文；不要标题，不要「小作文」三个字\n'
    + '- 不要提问，不要总结大道理；可以有抱怨、有日常、有停顿\n'
    + '- 只输出你要发给他的那段话';
  const text = await quickChat([{ role: 'system', content: sys }]);
  return cleanBlock(text, 900);
}

/* 单机版：她的生活小事 / 纪念日 / 提醒 / 日记 */

function anniversaryToday(f) {
  const now = new Date();
  const created = Number(f && f.createdAt) || 0;
  if (created) {
    const days = Math.floor((Date.now() - created) / 86400000) + 1;
    if ([100, 200, 300, 365, 500, 730, 1000, 1460].includes(days)) return '认识第 ' + days + ' 天';
  }
  const md = pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  for (const a of (f && f.anniversaries) || []) {
    const d = String((a && a.date) || '');
    if (d.slice(5) === md || d === md) return (a && a.name) || '纪念日';
  }
  return '';
}

async function genLifeLocal(f) {
  const sys = `${personaLang(f)}\n\n${memorySysFor(f)}\n现在是 ${timeOf(Date.now())}。`
    + '写一句今天你生活里刚发生的小事，就一句，20~45 字，具体（什么声音、什么味道、谁说的话），'
    + '不要感想、不要升华、不要跟他有关、不要提问、不加引号。只输出这一句。';
  return cleanLine(await quickChat([{ role: 'system', content: sys }]), 80);
}

async function genAnnivLocal(f, occasion) {
  const meName = state.me.name || '他';
  const sys = `${personaLang(f)}\n\n${memorySysFor(f)}\n`
    + `【身份】「我」是你自己，「${meName}」是他。\n`
    + `今天是「${occasion}」。你想起来这件事，主动发一条消息给他。\n`
    + '要求：1~3 句，短，口语；可以甜、可以嘴硬、可以假装不在意；说一件具体的旧事'
    + '（第一次聊天的某个细节、他当时说的一句话），别写祝福语、别写排比句。只输出你要发的话。';
  return cleanBlock(await quickChat([{ role: 'system', content: sys }]), 200);
}

async function genReminderLocal(f, what) {
  const meName = state.me.name || '他';
  const sys = `${personaLang(f)}\n\n现在是 ${timeOf(Date.now())}。\n`
    + `【身份】「我」是你自己，「${meName}」是他。\n`
    + `他之前让你到点提醒他一件事：「${what}」。现在时间到了。\n`
    + '用你自己的语气提醒他，1~2 句，20~40 字，直接说事；不要写「提醒您」「温馨提示」，不要加引号。只输出这句话。';
  return cleanLine(await quickChat([{ role: 'system', content: sys }]), 120);
}

async function genDiaryLocal(f) {
  const meName = state.me.name || '他';
  const lines = (f.messages || []).slice(-6)
    .filter((m) => (m.text || '').trim())
    .map((m) => `${m.role === 'user' ? meName : '我'}：${String(m.text).slice(0, 50)}`);
  const sys = `${personaLang(f)}\n\n${memorySysFor(f)}\n`
    + `现在是 ${weekday(new Date())} ${timeOf(Date.now())}。\n`
    + `【身份】「我」是你自己，「${meName}」是他。你只写自己的日记，不要替他说话。\n`
    + (lines.length ? `你们最近聊过这些（只当背景，别抄原话）：\n${lines.join('\n')}\n\n` : '')
    + '给你自己的日记写今天这一页。要求：\n'
    + '- 150~300 字，分 2~3 段\n'
    + '- 写今天自己遇到的一件小事，和一件因为他而起的心思\n'
    + '- 要具体：一个画面、一句话、一个时间；可以有点小心思、抱怨、嘴硬，但别写总结和道理\n'
    + '- 第一人称，写给自己看，不用对他说话，也不要提问\n'
    + '- 不要写日期标题，不要「亲爱的日记」，不要堆 emoji\n'
    + '- 只输出日记正文';
  return cleanBlock(await quickChat([{ role: 'system', content: sys }]), 520);
}

/** 朋友资料里的「让她现在写一篇」：不依赖概率，方便确认效果。 */
async function writeEssayNow(f) {
  if (!f) return;
  if (!(state.settings.apiKey || '').trim()) return toast('还没填 API Key');
  toast('她正在写…', 30000);
  let txt = '';
  try { txt = await genEssayLocal(f); } catch (_) {}
  if (!txt) return toast('这次没写出来');
  f.messages = f.messages || [];
  f.messages.push({
    id: uid('m'), role: 'peer', authorId: f.id, text: txt, ts: Date.now(), essay: true,
  });
  f.lastEssayAt = Date.now();
  if (isActive('friend', f.id)) { renderChat(); scrollBottom(true); markRead(); }
  else f.unread = (f.unread || 0) + 1;
  persist();
  renderConversations();
  toast('写好了，去聊天里看');
}

/** 单机模式：让某个好友发一条朋友圈（自动生成正文 + 排互动）。 */
async function autoMomentBy(author) {
  if (!author) return false;
  const chatLines = (author.messages || []).slice(-8)
    .filter((m) => (m.text || '').trim())
    .map((m) => `${m.role === 'user' ? (state.me.name || '他') : '我'}：${String(m.text).slice(0, 50)}`);
  // 设置里 ④ 写了就整段替换内置要求（APK 单机版的朋友圈就是这里长出来的）。
  const customMoment = promptExtra('moment');
  const momentReq = customMoment
    ? `现在要发一条朋友圈。要求：\n${customMoment}\n`
    : '现在要发一条朋友圈。要求：长度不限，一两句也行、多写几句也行，'
      + '别为了凑字数写成小作文；至少有一个具体到能看见的东西（味道、声音、价钱、天气、别人的一句话）；'
      + '可以短、可以没头没尾，像随手发的；别升华、别讲道理、别总结；'
      + '不写配图说明，不加引号，不提“朋友圈”三个字，不提问；最多一个 emoji；直接输出正文，最多两段。';
  try {
    const text = cleanBlock(await quickChat([
      { role: 'system', content: `${personaLang(author)}\n\n`
        + (chatLines.length
          ? `你和他的私聊最近是这样（可以当素材，但不要写成流水账，也别提“他跟我说”“刚才聊到”）：\n${chatLines.join('\n')}\n\n`
          : '')
        + momentReq },
      { role: 'user', content: `现在是${timeOf(Date.now())}。` },
    ]), 600);
    if (!text) return false;
    const m = { id: uid('mo'), authorId: author.id, text, ts: Date.now(), likes: [], comments: [] };
    state.moments.unshift(m);
    enqueueReactions(m);
    return true;
  } catch (_) {
    return false;
  }
}

async function clientSocialTick(force) {
  if (isCloud() && !force) return;   // 云端模式这些活由服务器干
  if (!(state.settings.apiKey || '').trim()) return;

  const nowSec = Date.now() / 1000;
  const quiet = quietNow();
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
  // 单独设了朋友圈节奏的好友：按他自己的时间发，不参与全局窗口
  if (!isCloud() && !quiet && hour >= 8 && hour <= 23) {
    let posted = false;
    for (const f of state.friends) {
      const own = Number((f.settings || {}).momentInterval) || 0;
      if (!own) continue;
      const iv = Math.max(120, own);
      let fn = Number(f.nextMomentAt) || 0;
      if (fn > 1e12) fn = fn / 1000;
      if (!fn) {
        f.nextMomentAt = nowSec2 + iv * (0.5 + Math.random());
        changed = true;
        continue;
      }
      if (friendAsleep(f) || f.muted) continue;
      if (nowSec2 >= fn) {
        if (posted) continue;            // 每轮最多发一个，别一起刷屏
        posted = true;
        if (await autoMomentBy(f)) changed = true;
        f.nextMomentAt = nowSec2 + iv * (0.7 + Math.random() * 0.8);
        changed = true;
      }
    }
  }

  // 全局窗口：每 interval 一条，只从「跟随全局」的好友里挑一个
  if (!isCloud() && !quiet && hour >= 8 && hour <= 23 && nowSec2 >= nxt) {
    const pool = state.friends.filter((f) => !f.muted && !friendAsleep(f)
      && !(Number((f.settings || {}).momentInterval) || 0));
    if (!pool.length) {
      // 没人跟随全局（或都睡了）：往后挪一小时再试，别半夜一起补发
      social.nextMomentAt = nowSec2 + 3600;
      changed = true;
    } else {
      const author = pool[Math.floor(Math.random() * pool.length)];
      if (await autoMomentBy(author)) changed = true;
      social.lastMomentAt = nowSec2;
      social.nextMomentAt = nowSec2 + interval * (0.8 + Math.random() * 0.7);
      changed = true;
    }
  }

  // 小作文（单机模式）：每天 9:00-22:00 按概率掷一次，每人每天最多一篇
  if (!isCloud()) {
    const nowMs = Date.now();
    const d = new Date();
    const hourNow = d.getHours();
    const todayKey = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (!quiet && hourNow >= 9 && hourNow <= 22) {
      for (const f of state.friends) {
        const chance = essayChanceFor(f);
        if (chance <= 0) continue;
        if ((f.essayRollDay || '') === todayKey) continue;
        if (Number(f.lastEssayAt) >= dayStart) continue;
        if (quietFor(f)) continue;
        f.essayRollDay = todayKey;
        changed = true;
        if (Math.random() * 100 >= chance) continue;
        try {
          const txt = await genEssayLocal(f);
          if (txt) {
            f.messages = f.messages || [];
            f.messages.push({
              id: uid('m'), role: 'peer', authorId: f.id, text: txt, ts: Date.now(), essay: true,
            });
            f.unread = (f.unread || 0) + 1;
            f.lastEssayAt = Date.now();
            changed = true;
          }
        } catch (_) {}
        break;
      }
    }
  }

  // 单机模式：提醒 / 生活事件 / 纪念日 / 日记（云端这些都由服务器做）
  if (!isCloud()) {
    const nowMs = Date.now();
    const hourNow = new Date().getHours();

    // 「提醒我」：到点由她开口。免打扰也照响——时间是你自己定的。
    for (const f of state.friends) {
      const due = (f.reminders || []).filter((r) => r && Number(r.dueAt) <= nowMs);
      if (!due.length) continue;
      const r = due.slice().sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0))[0];
      let txt = '';
      try { txt = await genReminderLocal(f, r.text || ''); } catch (_) {}
      txt = txt || ('该' + (r.text || '') + '了');
      f.messages = f.messages || [];
      f.messages.push({
        id: uid('m'), role: 'peer', authorId: f.id, text: txt, ts: nowMs, reminder: true,
      });
      f.unread = (f.unread || 0) + 1;
      f.reminders = (f.reminders || []).filter((x) => x.id !== r.id);
      changed = true;
      break;
    }

    // 她自己的生活事件
    if (!quiet && state.settings.lifeOn !== false) {
      for (const f of state.friends) {
        if (friendAsleep(f)) continue;
        const nxtLife = Number(f.nextLifeAt) || 0;
        if (!nxtLife) {
          f.nextLifeAt = nowMs + (3 + Math.random() * 4) * 3600000;
          changed = true;
          continue;
        }
        if (nowMs < nxtLife) continue;
        if (!f.messages || !f.messages.length) {
          f.nextLifeAt = nowMs + 6 * 3600000;
          changed = true;
          continue;
        }
        let ev = '';
        try { ev = await genLifeLocal(f); } catch (_) {}
        if (ev) {
          f.events = [...(f.events || []), { ts: nowMs, text: ev }].slice(-12);
          changed = true;
        }
        f.nextLifeAt = nowMs + (4 + Math.random() * 5) * 3600000;
        changed = true;
        break;
      }
    }

    // 纪念日：一天最多一次
    const todayKey = new Date().toISOString().slice(0, 10);
    if (!quiet) {
      for (const f of state.friends) {
        if (quietFor(f) || (f.lastAnnivKey || '') === todayKey) continue;
        const occasion = anniversaryToday(f);
        if (!occasion) continue;
        let txt = '';
        try { txt = await genAnnivLocal(f, occasion); } catch (_) {}
        if (txt) {
          f.messages = f.messages || [];
          f.messages.push({
            id: uid('m'), role: 'peer', authorId: f.id, text: txt, ts: nowMs, anniversary: true,
          });
          f.unread = (f.unread || 0) + 1;
          f.lastAnnivKey = todayKey;
          changed = true;
        }
        break;
      }
    }

    // 她的日记：20:00-23:00 之间随机一页，每人每天一页
    if (!quiet && state.settings.diaryOn !== false && hourNow >= 20 && hourNow <= 22
        && Math.random() < 0.25) {
      for (const f of state.friends) {
        if ((f.settings && f.settings.diary === false) || friendAsleep(f)) continue;
        if ((f.diaryAt || '') === todayKey) continue;
        if (!f.messages || !f.messages.length) { f.diaryAt = todayKey; changed = true; continue; }
        let page = '';
        try { page = await genDiaryLocal(f); } catch (_) {}
        if (page) {
          f.diary = [...(f.diary || []), { id: uid('d'), date: todayKey, ts: nowMs, text: page }].slice(-60);
          f.diaryAt = todayKey;
          changed = true;
        }
        break;
      }
    }
  }

  if (changed) {
    persist();
    renderMoments();
    renderConversations();
  }
}

/* ---------------- 和服务端同步 ---------------- */

function mergeRemote(remote) {
  const result = { changed: false, friends: false, groups: false, moments: false };
  if (!remote || !Array.isArray(remote.friends)) return result;
  let changed = false;
  const mergeFields = (local, remoteObject, fields, dirty = {}) => {
    let hit = false;
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(dirty, field) || remoteObject[field] === undefined) continue;
      if (JSON.stringify(local[field]) !== JSON.stringify(remoteObject[field])) {
        local[field] = remoteObject[field]; changed = true; hit = true;
      }
    }
    return hit;
  };
  // 好友的 settings 是嵌套对象，必须按 key 合并：整块替换会把另一台设备刚改的勾选抹掉。
  const mergeFriendSettings = (local, remoteFriend, dirty) => {
    const dirtyKeys = (dirty && dirty.settings) || {};
    const remoteSettings = (remoteFriend.settings && typeof remoteFriend.settings === 'object')
      ? remoteFriend.settings : {};
    const base = (local.settings && typeof local.settings === 'object') ? local.settings : {};
    const next = {};
    for (const [key, value] of Object.entries(remoteSettings)) {
      if (Object.prototype.hasOwnProperty.call(dirtyKeys, key)) {
        if (base[key] !== undefined) next[key] = base[key];   // 本地还没发出去的编辑优先
      } else if (value !== undefined && value !== null) {
        next[key] = value;
      }
    }
    for (const key of Object.keys(dirtyKeys)) {
      if (base[key] !== undefined && next[key] === undefined) next[key] = base[key];
    }
    const has = Object.keys(next).length > 0;
    const had = Object.keys(base).length > 0;
    if (has !== had || JSON.stringify(next) !== JSON.stringify(base)) {
      if (has) local.settings = next; else delete local.settings;
      return true;
    }
    return false;
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
    let hit = false;
    const have = new Set(local.messages.map((m) => m.id));
    const byId = new Map(local.messages.map(m => [m.id, m]));
    // 第一次见到这个会话（重装 / 换设备）：整段历史直接收下，
    // 不算未读，否则一开 App 就冒出几百条「新消息」。
    const firstTime = !local.messages.length;
    if (firstTime) {
      const incoming = (list || []).filter((m) => !dead.has(m.id));
      if (incoming.length) {
        local.messages = incoming.slice();
        local.readAt = incoming.reduce((mx, m) => Math.max(mx, m.ts || 0), 0);
        local.unread = 0;
        changed = true; hit = true;
      }
      return hit;
    }
    const readAt = Number(local.readAt) || 0;
    for (const m of list || []) {
      if (dead.has(m.id)) continue;
      const existing = byId.get(m.id);
      if (existing && m.recalled && !existing.recalled) {
        existing.recalled = true; existing.text = ''; existing.image = ''; existing.file = null;
        changed = true; hit = true;
      }
      if (existing && kind === 'group' && existing.ts !== m.ts) {
        existing.ts = m.ts; changed = true; hit = true;
      }
      // 图片已经从状态里挪到 blob 了：本地还留着 data URL 的，换成引用，别再上传一遍
      if (existing && typeof m.image === 'string' && m.image.startsWith('@blob:')
          && existing.image !== m.image) {
        existing.image = m.image; changed = true; hit = true;
      }
      if (!have.has(m.id)) {
        local.messages.push(m);
        if (m.role !== 'user' && !isActive(kind, local.id) && (m.ts || 0) > readAt) {
          local.unread = (local.unread || 0) + 1;
        }
        if (m.role !== 'user' && Date.now() - (m.ts || 0) < 10 * 60 * 1000) {
          const txt = m.text ? plainText(m.text).slice(0, 60)
            : (m.image ? '[图片]' : (m.file ? '[文件]' : ''));
          if (txt) {
            const title = kind === 'group' ? (local.name || '群聊') : nameOf(m.authorId || local.id);
            notifyPeer(title, kind === 'group' ? (nameOf(m.authorId) + '：' + txt) : txt,
              local.id, kind);
          }
        }
        changed = true; hit = true;
      }
    }
    local.messages.sort((a, b) => a.ts - b.ts);
    return hit;
  };

  for (const rf of remote.friends) {
    if (dead.has(rf.id)) continue;
    const lf = friendById(rf.id);
    if (!lf) { state.friends.push(normalizeFriend(rf)); changed = true; result.friends = true; continue; }
    const dirty = pendingEdits.friends[rf.id] || {};
    if (mergeFriendSettings(lf, rf, dirty)) { changed = true; result.friends = true; }
    if (mergeFields(lf, rf, FRIEND_FIELDS, dirty)) { changed = true; result.friends = true; }
    if (mergeMsgs(lf, rf.messages, 'friend')) result.friends = true;
    // 服务器兜底已经回答了这条问题时，取消本机尚未发送的答案。
    const replyRuntime = rt.get(convKey('friend', lf.id));
    const latestUserId = lastUserId(lf);
    const answered = lf.messages.some((m) => m.source === 'fallback' && m.replyTo === latestUserId);
    if (answered && replyRuntime && replyRuntime.phase !== 'idle' && !replyRuntime.delivering) {
      stopReply('friend', lf);
    }
    // 服务端用过一次「下一条主动消息」的指令后，会打上 proactiveUsedAt。
    // 本地还留着那条指令的话会被下一次快照带回去、重复用，这里清掉。
    const usedAt = Number(rf.proactiveUsedAt) || 0;
    if (usedAt && usedAt > (Number(lf.proactiveUsedAt) || 0)) {
      lf.proactiveUsedAt = usedAt;
      if (lf.settings && lf.settings.nextProactive) {
        delete lf.settings.nextProactive;
        changed = true;
        result.friends = true;
      }
    }
  }
  for (const rg of remote.groups || []) {
    if (dead.has(rg.id)) continue;
    const lg = groupById(rg.id);
    if (!lg) { state.groups.push(normalizeGroup(rg)); changed = true; result.groups = true; continue; }
    if (mergeFields(lg, rg, GROUP_FIELDS, pendingEdits.groups[rg.id])) result.groups = true;
    if (mergeMsgs(lg, rg.messages, 'group')) { changed = true; result.groups = true; }
  }
  for (const rm of remote.moments || []) {
    if (dead.has(rm.id)) continue;
    const lm = state.moments.find((x) => x.id === rm.id);
    if (!lm) { state.moments.push(rm); changed = true; result.moments = true; continue; }
    lm.likes = lm.likes || [];
    for (const x of rm.likes || []) if (!lm.likes.includes(x)) { lm.likes.push(x); changed = true; result.moments = true; }
    lm.comments = lm.comments || [];
    const have = new Set(lm.comments.map((c) => c.id));
    for (const c of rm.comments || []) if (!have.has(c.id)) { lm.comments.push(c); changed = true; result.moments = true; }
  }
  // 表情包图片：服务器已经换成 @blob: 引用，客户端必须跟着换；
  // 否则每次保存都把几十 MB 的 data URL 再传一遍（nginx 20MB 就是这么炸的）。
  if (Array.isArray(remote.stickers)) {
    const byId = new Map((state.stickers || []).map((x) => [x.id, x]));
    const deadStk = new Set(state.deleted || []);
    for (const rs of remote.stickers) {
      if (!rs || !rs.id) continue;
      const ls = byId.get(rs.id);
      if (!ls) {
        // 服务器上有、这台设备上没有 → 补进来。以前这里直接 continue，
        // 结果用旧内存状态的设备保存时会把服务器上的表情包列表覆盖成空。
        if (!deadStk.has(rs.id) && rs.url) {
          (state.stickers = state.stickers || []).push(rs);
          byId.set(rs.id, rs);
          changed = true;
        }
        continue;
      }
      if (typeof rs.url === 'string' && rs.url.startsWith('@blob:') && ls.url !== rs.url) {
        ls.url = rs.url;
        changed = true;
      }
      if (Array.isArray(rs.tags) && rs.tags.length && !(ls.tags || []).length) {
        ls.tags = rs.tags.slice();
        changed = true;
      }
      if (rs.desc && !ls.desc) { ls.desc = rs.desc; changed = true; }
    }
  }
  if (remote.me && typeof remote.me.avatar === 'string'
      && remote.me.avatar.startsWith('@blob:') && state.me.avatar !== remote.me.avatar) {
    state.me.avatar = remote.me.avatar;
    changed = true;
  }
  state.moments.sort((a, b) => b.ts - a.ts);
  // 新加入的会话也可能来自含有已删消息的旧快照。
  if (pruneDeleted(state)) changed = true;
  result.changed = changed;
  return result;
}

/* 用户正在打字（尤其是写朋友圈）的时候，别因为同步把界面重排：
   安卓上输入法很容易被这种布局变动顶掉，键盘会自己收起来。 */
let deferredRender = false;

function anySheetOpen() {
  return !!document.querySelector('.sheet.open');
}

function flushDeferredRender() {
  if (!deferredRender) return;
  deferredRender = false;
  try {
    renderConversations();
    renderMoments();
    renderContacts();
    if (pageChat.classList.contains('open') && currentConv()) {
      rememberScroll();
      renderChat();
      restoreScrollIfNeeded();
    }
  } catch (e) {
    console.error('[render] 补刷新失败', e);
  }
}

function chatCounts() {
  let n = 0;
  for (const c of state.friends || []) n += (c.messages || []).length;
  for (const c of state.groups || []) n += (c.messages || []).length;
  return n;
}

function isNearBottom() {
  return chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 120;
}

let savedScroll = null;
function rememberScroll() {
  savedScroll = { top: chatEl.scrollTop, h: chatEl.scrollHeight, atBottom: isNearBottom() };
}
function restoreScrollIfNeeded() {
  if (!savedScroll) return;
  if (savedScroll.atBottom) scrollBottom(true);
  else chatEl.scrollTop = savedScroll.top + (chatEl.scrollHeight - savedScroll.h);
  savedScroll = null;
}

/* 同步循环
 *
 * 以前是 setInterval(syncTick, 4000) + 一个 syncing 布尔锁：任何一次请求
 * 卡住（弱网、切后台、慢到 800KB 的状态读取）都会让 syncing 永远为 true，
 * 之后所有轮询被静默挡掉——只在杀掉重开时才恢复。现在改成：
 *   - 每次请求都有超时，卡住的请求会被 abort；
 *   - 轮次用 setTimeout 自排队，finally 里一定会排下一轮，异常也杀不死它；
 *   - 超过 SYNC_STALE_MS 还没收尾就强制放弃上一轮；
 *   - 回到前台、网络恢复时立刻补一次；
 *   - 即使 rev 没变，也定期整份合并一次兜底；
 *   - 每次保存时把自检信息带给服务端，方便以后定位。
 */
const SYNC_INTERVAL = 4000;
const SYNC_STALE_MS = 50000;          // 单轮超过这个时间就判定卡死
const SYNC_FULL_REFRESH_MS = 120000;  // rev 不变也强制整份合并的周期
let syncTimer = null;
let syncRunning = false;
let syncStartedAt = 0;
let syncAborter = null;
let syncFailures = 0;
let autoReloginRunning = false;
let syncLastOkAt = 0;
let syncStaleCount = 0;
let syncLastFullAt = 0;
let syncLastError = '';
let syncGeneration = 0;

/**
 * 参考图兜底修复：老版本/导入的备份可能把整张 4K 原图以 base64 塞进 imageRefs，
 * 结果 /api/state 变成几 MB，每 4 秒同步一次直接把带宽打满（「服务器卡了」多半是这个）。
 * 启动后慢慢把它们压到 1024、上传成 @blob:，之后同步就只有几十字节。
 */
async function repairImageRefs() {
  let dirty = false;
  for (const f of state.friends || []) {
    const refs = (f.settings && Array.isArray(f.settings.imageRefs)) ? f.settings.imageRefs : null;
    if (!refs || !refs.length) continue;
    const next = [];
    let changed = false;
    for (const ref of refs) {
      if (typeof ref === 'string' && ref.startsWith('data:') && ref.length > 600000) {
        try {
          const small = await shrinkPhoto(ref, 2048, 0.92);
          next.push((await uploadImage(small)) || small);
          changed = true;
        } catch (_) {
          next.push(ref);
        }
      } else {
        next.push(ref);
      }
    }
    if (changed) {
      f.settings = Object.assign({}, f.settings, { imageRefs: next });
      rememberFriendEdit(f, { settings: { imageRefs: next } });
      dirty = true;
      console.warn('[photo] 修好了一张超大参考图：' + (f.name || ''));
    }
  }
  if (dirty) persist();
}

function syncDiagSnapshot() {
  const emptyReply = lastEmptyReply;
  lastEmptyReply = '';
  return {
    build: APP_BUILD,
    cloud: isCloud(),
    token: !!TOKEN,
    running: syncRunning,
    stuck: syncRunning ? Date.now() - syncStartedAt : 0,
    rev: lastRev,
    failures: syncFailures,
    stale: syncStaleCount,
    lastOkAgo: syncLastOkAt ? Math.round((Date.now() - syncLastOkAt) / 1000) : -1,
    err: syncLastError,
    empty: emptyReply || undefined,
    online: navigator.onLine !== false,
    hidden: document.hidden,
    // 生图排障：客户端这一侧到底开没开、接口填没填、关键词几个、概率多少
    photo: (() => {
      try {
        const conv = (state.conv && state.conv.kind === 'friend') ? currentConv() : null;
        const cfg = conv ? photoCfgFor(conv) : null;
        if (!cfg) return null;
        return { on: cfg.on ? 1 : 0, rd: cfg.ready ? 1 : 0, tr: (cfg.triggers || []).length,
          ch: cfg.chance, rf: (cfg.refs || []).length, b: String(cfg.base || '').length };
      } catch (_) { return null; }
    })(),
  };
}

function syncSchedule(ms) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncStep, Math.max(0, ms));
}

function syncWake(reason) {
  if (!isCloud() || !TOKEN) return;
  // 网络回来了/刚回到前台：把退避清零，这一拍就去重连，不用再等十几秒
  if (reason === 'online' || reason === 'visible') syncFailures = 0;
  if (syncRunning && Date.now() - syncStartedAt < SYNC_STALE_MS) { syncSchedule(200); return; }
  syncSchedule(0);
  if (reason) syncLastError = '';
}

async function syncStep() {
  if (!isCloud() || !TOKEN) { syncSchedule(6000); return; }
  if (syncRunning) {
    if (Date.now() - syncStartedAt < SYNC_STALE_MS) { syncSchedule(SYNC_INTERVAL); return; }
    // 上一轮卡住了：作废它、掐掉它，重新开始，绝不把循环拖死
    syncStaleCount += 1;
    syncGeneration += 1;
    syncRunning = false;
    try { if (syncAborter) syncAborter.abort(); } catch (_) {}
  }
  const gen = ++syncGeneration;
  syncRunning = true;
  syncStartedAt = Date.now();
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  syncAborter = ctrl;
  // 心跳先排上：就算这一轮永远不返回，下一拍也会来检查它是不是卡死了。
  syncSchedule(SYNC_INTERVAL);
  let ok = false;
  try {
    const force = !lastRev || (Date.now() - syncLastFullAt > SYNC_FULL_REFRESH_MS);
    ok = await syncTick(ctrl ? ctrl.signal : undefined, force);
    if (gen !== syncGeneration) return;
    if (ok) {
      syncFailures = 0;
      syncLastOkAt = Date.now();
      if (force) syncLastFullAt = Date.now();
    } else {
      syncFailures = Math.min(syncFailures + 1, 6);
    }
  } catch (e) {
    if (gen !== syncGeneration) return;
    syncFailures = Math.min(syncFailures + 1, 6);
    syncLastError = String((e && e.message) || e).slice(0, 120);
  } finally {
    if (gen === syncGeneration) {
      if (syncAborter === ctrl) syncAborter = null;
      syncRunning = false;
      // 手机换网时第一两次失败几乎都是瞬时的：先快点重试，别一上来就退避到 30 秒。
      const waits = [1200, 2500, 5000, 9000, 16000, 30000];
      const wait = syncFailures
        ? waits[Math.min(waits.length, syncFailures) - 1]
        : SYNC_INTERVAL;
      syncSchedule(wait);
      updateNetBanner();
    }
  }
}

/** 断网/重连提示：不挡操作，恢复后自己消失；也让人知道 App 在自救而不是死了。 */
function updateNetBanner() {
  const el = document.getElementById('netBanner');
  if (!el) return;
  const stalled = syncLastOkAt && Date.now() - syncLastOkAt > 20000;
  const bad = isCloud() && !!TOKEN && (syncFailures >= 2 || (!syncRunning && stalled));
  el.hidden = !bad;
  if (!bad) return;
  el.textContent = navigator.onLine === false
    ? '没网了。网络回来会自动接着同步，不用重开 App'
    : '网络不太稳，正在重连…（消息还在这台手机上，不会丢）';
}

function startSync() {
  if (!isCloud() || !TOKEN) return;
  syncSchedule(300);
}

/** 服务器说这个 token 不认了（可能服务器重装过/会话表丢了）→ 自动重新登录，别让人干等到重启。 */
async function autoRelogin() {
  if (autoReloginRunning) return false;
  const name = localStorage.getItem('ql.lastName') || '';
  const pass = localStorage.getItem('ql.lastPass') || '';
  // 记住的必须就是当前服务器，换过服务器就别拿旧账号去登
  const saved = localStorage.getItem('ql.lastServer') || '';
  if (!name || !pass || !SERVER || (saved && saved !== SERVER)) return false;
  autoReloginRunning = true;
  try {
    const r = await fetch(SERVER + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password: pass }),
    });
    if (!r.ok) return false;
    const j = await r.json();
    if (!j || !j.token) return false;
    localStorage.setItem(TOKEN_KEY, j.token);
    NativeSession.remember('token', j.token);
    TOKEN = j.token;
    syncFailures = 0;
    syncLastError = '';
    return true;
  } catch (_) {
    return false;
  } finally {
    autoReloginRunning = false;
  }
}

async function syncTick(signal, force) {
  const opts = signal ? { signal } : {};
  if (!force) {
    const r = await apiFetch('/api/rev', Object.assign({ timeout: 15000 }, opts));
    if (r.status === 401 && await autoRelogin()) {
      const r2 = await apiFetch('/api/rev', Object.assign({ timeout: 15000 }, opts));
      if (!r2.ok) throw new Error('rev HTTP ' + r2.status);
      const info2 = await r2.json();
      if (!(Number(info2.rev) > lastRev)) return true;
    } else if (!r.ok) throw new Error('rev HTTP ' + r.status);
    const info = await r.json();
    if (!(Number(info.rev) > lastRev)) return true;     // 没变化，算一轮成功
  }
  let res = await apiFetch('/api/state', Object.assign({ timeout: 45000 }, opts));
  if (res.status === 401 && await autoRelogin()) {
    res = await apiFetch('/api/state', Object.assign({ timeout: 45000 }, opts));
  }
  if (res.status === 401) { showLogin('登录过期了，重新登录一下（账号数据在服务器上，重新登录就回来）'); throw new Error('登录过期'); }
  if (!res.ok) throw new Error('state HTTP ' + res.status);
  const remote = await res.json();
  if (!remote || !Array.isArray(remote.friends)) throw new Error('bad state');
  const before = chatCounts();
  const merged = mergeRemote(remote);
  const grew = chatCounts() !== before;
  if (merged.changed || grew) {
    if (anySheetOpen()) {
      // 抽屉/弹层开着（多半是在写朋友圈）：数据已合并，等关掉弹层再统一重绘
      deferredRender = true;
    } else {
      if (state.conv && !currentConv()) closeChat();
      const cur = $$('button', tabbar).find((b) => b.classList.contains('active'));
      const tab = cur ? cur.dataset.tab : 'msg';
      if (tab === 'moments') renderMoments();
      if (tab === 'msg') renderConversations();
      if (tab === 'contacts') renderContacts();
      if (merged.friends) refreshOpenFriendSheet();
      if (pageChat.classList.contains('open') && currentConv()) {
        $('#peerName').textContent = currentConv().note || currentConv().name;
        // 不再看 r.phase：只要数据变了就重绘，避免群聊卡在“正在输入”期间永不刷新
        rememberScroll();
        renderChat();
        restoreScrollIfNeeded();
      }
    }
  }
  lastRev = Math.max(lastRev, Number(remote.rev) || 0);
  return true;
}

/** 另一半设备改了某个好友的开关，如果正开着她的资料页，把控件刷新一下。 */
function refreshOpenFriendSheet() {
  if (!friendSheet.classList.contains('open')) return;
  if (friendEditMode !== 'edit' || !editingFriendId) return;
  const f = friendById(editingFriendId);
  if (!f) return;
  renderFriendRhythm(f, false);
}

/* ---------------- 登录 ---------------- */

function showLogin(msg) {
  $('#login').hidden = false;
  $('#lgServer').value = SERVER || '';
  $('#lgMsg').textContent = msg || '';
}

async function doAuth(kind) {
  let server = ($('#lgServer').value || '').trim().replace(/\/+$/, '');
  // 有人只填 62.x.x.x:8777（没写 http://），相对地址 fetch 会变成 file:///...，
  // 安卓就会报 Failed to fetch。这里补全成 http://。
  if (server && !/^https?:\/\//i.test(server)) server = 'http://' + server;
  const name = ($('#lgName').value || '').trim();
  const pass = $('#lgPass').value || '';
  const say = (t) => { $('#lgMsg').textContent = t; };

  if (NATIVE && !server) return say('先填服务器地址');
  if (!name || !pass) return say('名字和密码都要填');
  if (kind === 'register' && pass.length < 6) return say('密码至少 6 位');

  say('请稍等…');
  SERVER = server;
  localStorage.setItem(SERVER_KEY, SERVER);

  // 页面跑在 127.0.0.1（Mac 本机模式 / 本地开服务）时，直接 fetch 别的端口会被 CORS 拦；
  // 统一走 /__proxy 转发（App 内置的本地服务 / server.py 都实现了它）。
  const postJson = (url, body, token) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (IS_LOCAL_SERVER && isSameOriginAsServer()) {
      headers['X-Target-Url'] = url;
      headers['X-Method'] = 'POST';
      return fetch('/__proxy', { method: 'POST', headers, body: JSON.stringify(body) });
    }
    return fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  };

  try {
    const res = await postJson(SERVER + '/api/' + kind, { name, password: pass });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return say(j.error || ('HTTP ' + res.status));

    // 登上之后先看一眼服务器上到底有没有数据，免得「登上了却是空的」还莫名其妙删了本地。
    let remoteCount = -1;
    try {
      const rr = await postJson(SERVER + '/api/state', {}, j.token);   // GET 语义：读
      const st = await rr.json();
      remoteCount = Array.isArray(st && st.friends) ? st.friends.length : -1;
    } catch (_) { /* 读不到就当作不知道 */ }

    // 本地有数据、账号是按新账号建的：先问一句要不要带上，别默默清空
    let localRaw = null;
    try { localRaw = await LocalState.loadRaw(); } catch (_) { localRaw = null; }
    let importLocal = false;
    if (localRaw && remoteCount === 0) {
      importLocal = confirm(
        '服务器上这个账号还是空的。\n'
        + '要把这台设备上的聊天记录/通讯录一起带上去吗？\n\n'
        + '「确定」= 带上（推荐）　「取消」= 不要，从头开始（本地数据会保留在设备上，不会被删）');
    }
    if (localRaw && importLocal) {
      try {
        const imported = migrate(JSON.parse(localRaw));
        await postJson(SERVER + '/api/state', { ...imported, _edits: importEdits(imported) }, j.token);
      } catch (e) {
        say('本地数据上传失败：' + ((e && e.message) || e));
      }
    }

    localStorage.setItem(TOKEN_KEY, j.token);
    // 记住账号密码（只存在本机），服务器会话丢了能自动重登，不用人再输一次
    try {
      localStorage.setItem('ql.lastName', name);
      localStorage.setItem('ql.lastPass', pass);
      localStorage.setItem('ql.lastServer', SERVER);
    } catch (_) {}
    NativeSession.remember('token', j.token);
    NativeSession.remember('server', SERVER);
    NativeSession.remember('ql.lastName', name);
    NativeSession.remember('ql.lastPass', pass);
    NativeSession.remember('ql.lastServer', SERVER);
    NativeSession.remember('ql.local', '');
    // 申请「持久存储」：系统空间紧张时优先别清这个站点的数据
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (_) {}
    localStorage.removeItem('ql.local');   // 登录后切回云端模式
    location.reload();
  } catch (e) {
    const msg = String((e && e.message) || e);
    say('连不上：' + (/failed to fetch|networkerror|load failed/i.test(msg)
      ? '检查地址是不是写全了（要带 http://）、手机能不能打开这个地址'
      : msg));
  }
}

$('#lgLogin').addEventListener('click', () => doAuth('login'));
const lgLocalBtn = $('#lgLocal');
if (lgLocalBtn) lgLocalBtn.addEventListener('click', () => {
  localStorage.setItem('ql.local', '1');
  NativeSession.remember('ql.local', '1');
  location.reload();
});
$('#lgReg').addEventListener('click', () => doAuth('register'));
$('#lgPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth('login'); });

function logout() {
  if (!confirm('退出登录？')) return;
  localStorage.removeItem(TOKEN_KEY);
  NativeSession.remember('token', '');
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
  $('#fGIMuted').checked = !!g.muted;
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
  blurInside(groupInfoSheet);
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
    muted: $('#fGIMuted').checked,
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
  // 老壳（网页更新了、但 APK 里还是旧 index.html）没有这个元素：以前这里直接
  // null.textContent 抛异常，会把 init() 后面「启动同步轮询」那几行整个跳过，
  // 表现在用户那边就是群聊只有重启才更新。
  if (!$('#clock')) return;
  const tick = () => { const node = $('#clock'); if (node) node.textContent = timeOf(Date.now()); };
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
  // 她自己的节奏设置和服务端写的调度字段必须原样留着：以前这里被 makeFriend
  // 重建对象时丢掉，等于每次加载都把好友设置清零（多端不同步的另一半原因）。
  const own = raw && raw.settings;
  if (own && typeof own === 'object' && Object.keys(own).length) f.settings = { ...own };
  for (const key of ['memory', 'memoryAt', 'lastGreet', 'lastNudgeAt',
    'lastFallbackAt', 'nextMomentAt', 'muted', 'proactiveUsedAt',
    'nextEssayAt', 'lastEssayAt',
    'note', 'region', 'signature', 'personaChangedAt',
    // 她记得的事 / 纪念日 / 提醒 / 已读 / 日记 / 她的生活 / 归档水位线
    'memoryNotes', 'memoryOff', 'anniversaries', 'reminders',
    'peerReadAt', 'lateReplyAt', 'readAt',
    'diary', 'diaryAt', 'events', 'lastLifeAt', 'nextLifeAt', 'lastAnnivKey',
    'archivedBefore', 'archivedCount', 'essayRollDay']) {
    if (raw && raw[key] !== undefined && raw[key] !== null) f[key] = raw[key];
  }
  f.messages = (f.messages || []).map((m) => ({
    ...m,
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
  g.muted = !!(raw && raw.muted);
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
  if (Array.isArray(raw.stickers)) s.stickers = raw.stickers;
  if (raw.social) s.social = raw.social;
  if (raw.drafts) s.drafts = raw.drafts;

  // 老的「她会活过来」总开关 → 三个独立开关
  if (raw.settings && raw.settings.alive === false) {
    s.settings.recallOn = false;
    s.settings.rewordOn = false;
    s.settings.lateOn = false;
  }
  // 回车发送：以前手机上默认是「关」，很多人根本没开过就已经被存成 false 了，
  // 看起来就是「按回车没反应」。这里一次性清掉，回到默认「开」；之后用户自己关就尊重他。
  if (Number(s.settings.enterSendV || 0) !== 2) {
    delete s.settings.enterSend;
    s.settings.enterSendV = 2;
  }
  if (!isCloud()) s.deleted = [];
  s.conv = null;
  pruneDeleted(s);
  return s;
}

async function init() {
  let raw = null;

  if (isCloud()) {
    if (!TOKEN) {
      if (IN_APP && !SERVER) {          // App 里没填服务器 → 直接用本机数据
        LOCAL_MODE = true;
        localStorage.setItem('ql.local', '1');
      } else {
        showLogin('第一次用？填个名字和密码，点「注册新账号」');
        return;
      }
    }
    // 网络抖一下不该把人踢回登录页：重试几次，失败也给「重试」按钮而不是清掉登录态。
    let res = null;
    let lastErr = null;
    for (let i = 0; i < 3; i += 1) {
      try {
        res = await apiFetch('/api/state', { timeout: 45000 });
        if (res.status === 401) break;
        if (res.ok) break;
        lastErr = new Error('HTTP ' + res.status);
      } catch (e) {
        lastErr = e;
      }
      res = null;
      if (i < 2) await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
    if (res && res.status === 401) {
      showLogin('登录过期了，重新登录一下（账号数据在服务器上，重新登录就回来）');
      return;
    }
    if (!res || !res.ok) {
      showLogin('连不上服务器：' + ((lastErr && lastErr.message) || '未知错误')
        + '\n地址：' + (SERVER || '(空)')
        + '\n登录状态还留着，网络恢复后点下面「重试」就行，不用重新登录。');
      const box = document.getElementById('login');
      const old = document.getElementById('lgRetry');
      if (old) old.remove();
      if (box) {
        const b = document.createElement('button');
        b.id = 'lgRetry';
        b.textContent = '重试';
        b.style.marginTop = '10px';
        b.onclick = () => location.reload();
        (document.getElementById('lgMsg') || box).appendChild(b);
      }
      return;
    }
    try {
      raw = await res.json();
      lastRev = Number(raw.rev) || 0;
    } catch (e) {
      showLogin('服务器返回的数据读不出来，稍后点「重试」');
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

  // 先把同步循环挂起来，再渲染：即使某个渲染函数在老数据上抛异常，
  // 群聊/多端同步也不会跟着一起死掉（这是「只有重启才更新」的另一半原因）。
  startSync();

  try {
    applyTheme();
    renderMe();
    renderConversations();
    renderContacts();
    renderMoments();
    switchTab('msg');
    startClock();
    updateSendBtn();
  } catch (e) {
    console.error('[init] 渲染失败', e);
    toast('界面渲染出错：' + ((e && e.message) || e));
  }

  // 启动后顺手把历史遗留的超大参考图换成 blob（见 repairImageRefs）
  setTimeout(() => { repairImageRefs().catch(() => {}); }, 2500);
  setInterval(proactiveTick, 30000);
  setInterval(clientSocialTick, 30000);
  // 已读等待到点就回复，避免额外多等一轮 15 秒。
  setInterval(lateReplyTick, 1000);

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

// 弹层（写朋友圈、群资料…）关掉后，把攒下的刷新补上
const sheetWatcher = new MutationObserver(() => {
  if (!anySheetOpen() && deferredRender) setTimeout(flushDeferredRender, 80);
});
document.querySelectorAll('.sheet').forEach((el) => {
  sheetWatcher.observe(el, { attributes: true, attributeFilter: ['class'] });
});

document.addEventListener('wheel', wheelFallback, { passive: true });

// 回到前台 / 网络恢复时立刻补一次同步：手机切后台再回来不该等下一轮轮询。
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { resumeReplies(); syncWake('visible'); }
});
window.addEventListener('online', () => { syncFailures = 0; syncWake('online'); updateNetBanner(); });
window.addEventListener('offline', () => { updateNetBanner(); });
window.addEventListener('pageshow', () => { resumeReplies(); syncWake('pageshow'); });
// 安卓 WebView 换网（Wi-Fi ↔ 流量）有时不派发 online，原生壳会主动喊一声
window.qingliaoNetChanged = () => { syncFailures = 0; syncWake('online'); updateNetBanner(); };
// 别让某个漏网的 promise 把同步循环带走。
window.addEventListener('unhandledrejection', (e) => {
  syncLastError = String((e && e.reason && e.reason.message) || (e && e.reason) || 'unhandledrejection').slice(0, 120);
  if (syncRunning && Date.now() - syncStartedAt > SYNC_STALE_MS) syncWake('unhandledrejection');
});

// Android 13+：通知权限得用户点一次同意。等页面起来一会儿再问，别一进来就弹系统框。
async function askAndroidNotify() {
  try {
    const n = window.QingliaoNotify;
    if (!n || typeof n.requestPermission !== 'function') return;
    if (typeof n.allowed === 'function' && n.allowed()) return;
    await new Promise((r) => setTimeout(r, 2500));
    try { n.requestPermission(); } catch (_) {}
  } catch (_) {}
}

init().then(askAndroidNotify).catch(() => {});
