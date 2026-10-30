// 无第三方依赖：node tests/reply-regression.mjs（Node 22+，Chrome；可用 CHROME 指定路径）
// 独立临时浏览器 + 本地静态站点；模型用可控 promise，计时器用虚拟时钟，不访问真实账号/API。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../web/', import.meta.url));
const profile = await mkdtemp(join(tmpdir(), 'ql-reply-test-'));
const server = createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    const path = resolve(root, name);
    if (!path.startsWith(root)) throw new Error('bad path');
    const content = await readFile(path);
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(content);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', r); });
const site = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn(process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  // 在已经套了一层沙箱的环境里（DeepSeek Harness 等）Chrome 自己的沙箱起不来，
  // 加 CHROME_NO_SANDBOX=1 就能跑；默认还是开着沙箱。
  ...(process.env.CHROME_NO_SANDBOX ? ['--no-sandbox'] : []),
], { stdio: 'ignore' });
let ws;
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch {}
    if (chrome.exitCode !== null) throw new Error('Chrome exited: ' + chrome.exitCode);
    await sleep(100);
  }
  assert.ok(port, 'Chrome did not start');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id) { pending.get(msg.id)?.(msg); pending.delete(msg.id); }
  });
  const cdp = (method, params = {}) => new Promise((r, reject) => {
    const n = ++id;
    const timer = setTimeout(() => { pending.delete(n); reject(new Error('CDP timeout: ' + method)); }, 15000);
    pending.set(n, msg => { clearTimeout(timer); msg.error ? reject(new Error(JSON.stringify(msg.error))) : r(msg.result); });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const ev = async expression => {
    const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  };
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('ql.local', '1'); localStorage.setItem('ql.idb', '0');` });
  await cdp('Page.navigate', { url: site });
  for (let i = 0; i < 100; i++) {
    if (await ev(`typeof init === 'function' && typeof LocalState !== 'undefined' && LocalState.mode === 'ls'`).catch(() => false)) break;
    await sleep(100);
  }
  await ev(`
    window.testClock = { now: Date.now(), next: -1, timers: new Map() };
    Date.now = () => testClock.now;
    window.setTimeout = (fn, ms = 0) => { const id = testClock.next--; testClock.timers.set(id, { at: Date.now() + ms, fn }); return id; };
    const realClearTimeout = window.clearTimeout;
    window.clearTimeout = id => { testClock.timers.delete(id); realClearTimeout(id); };
    window.flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
    window.advance = async ms => {
      const until = Date.now() + ms;
      for (let n = 0; n < 1000; n++) {
        const first = [...testClock.timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!first) { testClock.now = until; await flush(); return; }
        testClock.now = Math.max(testClock.now, first[1].at); testClock.timers.delete(first[0]); first[1].fn(); await flush();
      }
      throw new Error('timer loop');
    };
    window.jobs = []; window.saved = [];
    Store.save = async s => saved.push(JSON.parse(JSON.stringify(s)));
    streamOnce = opts => {
      const j = { body: opts.body, cancelled: false, text: '' };
      j.promise = new Promise((resolve, reject) => { j.resolve = resolve; j.reject = reject; });
      // 模拟流式：emit 就是模型一段一段地吐字
      j.emit = t => { j.text += t; if (opts.onDelta) opts.onDelta({ content: t }); };
      j.cancel = () => { j.cancelled = true; }; // 模拟原生取消后不回调，旧结果仍可能迟到
      jobs.push(j); return j;
    };
    window.resetCase = async (settings = {}) => {
      for (const f of state.friends) stopReply('friend', f);
      await flush(); testClock.timers.clear(); rt.clear(); jobs.length = 0; saved.length = 0;
      state = defaultState(); pendingEdits = { settings: {}, friends: {}, groups: {} };
      Object.assign(state.settings, { apiKey: 'test-only', model: 'mock', vision: false, webSearch: false,
        recallOn: false, rewordOn: false, stickerChance: 0, delayMin: 10, delayMax: 10, bursts: 1 }, settings);
      state.friends = [makeFriend({ id: 'f-test', name: '测试朋友' })];
      window.f = state.friends[0]; LOCAL_MODE = true; SERVER = ''; closeSheet(); openChat('friend', f.id);
      window.r = rtOf(convKey('friend', f.id)); inputEl.value = '';
    };
    window.complete = async (index = jobs.length - 1, content = '收到这两句话') => {
      jobs[index].resolve({ content, toolCalls: [] }); await flush();
    };
    true;
  `);
  let count = 0;
  async function check(name, expression) {
    assert.equal(await ev(`(async () => { ${expression} })()`), true, name);
    console.log('PASS ' + name); count++;
  }
  for (const gap of [1000, 3000, 8000]) {
    await check(`连发间隔 ${gap / 1000} 秒：等待期就开始生成，补充一句停 1 秒再推 1 秒`, `
      await resetCase(); await send('今天下雨了'); const due = r.deadline;
      if (jobs.length !== 1) return false;                       // 假等待里就把模型请求发出去了
      await advance(${gap}); await send('出门记得带伞');
      // 补充消息：按合并后的内容重新生成，等待时间 +2 秒（停 1 秒 + 再推 1 秒）
      if (jobs.length !== 2 || !jobs[0].cancelled) return false;
      if (!(r.deadline === due + 2000 || r.deadline === r.since + 45000)) return false;
      if (chatEl.querySelector('.dots')) return false;            // 还没到点，不许冒气泡
      await advance(20000);
      if (!JSON.stringify(jobs[1].body).includes('今天下雨了')) return false;
      if (!JSON.stringify(jobs[1].body).includes('出门记得带伞')) return false;
      await complete(); await advance(20000);
      return f.messages.filter(m => m.role === 'peer').length === 1 && r.phase === 'idle' && !chatEl.querySelector('.dots');
    `);
  }
  await check('到点直接整条出现：没有三个点的加载气泡，也不逐字', `
    await resetCase({ delayMin: 10, delayMax: 10 });
    await send('在吗'); await advance(3000);
    jobs[0].emit('我在呢');                                   // 模型在假等待里就生成好了
    await complete(0, '我在呢');                              // 流结束
    // 到点之前：聊天里既没有气泡也没有文字
    if (chatEl.querySelector('.dots')) return false;
    await advance(6999);
    if (chatEl.querySelector('.dots')) return false;
    if (f.messages.some(m => m.role === 'peer')) return false;
    await advance(1);                                         // 到点
    await advance(2000);
    if (chatEl.querySelector('.dots')) return false;           // 永远不出现三个点
    const replies = f.messages.filter(m => m.role === 'peer').map(m => m.text);
    return replies.length === 1 && replies[0] === '我在呢' && r.phase === 'idle';
  `);
  await check('生成中点发送会合并新消息，取消旧结果且不再等完整延迟', `
    await resetCase({ delayMin: 5, delayMax: 5 }); await send('第一句');
    await advance(8000);
    if (r.phase !== 'streaming' || chatEl.querySelector('.dots')) return false;
    inputEl.value = '第二句'; inputEl.dispatchEvent(new Event('input'));
    if (sendBtn.textContent !== '发送') return false;
    sendBtn.click(); await flush(); await advance(0);
    if (jobs.length !== 2 || !jobs[0].cancelled || !JSON.stringify(jobs[1].body).includes('第二句')) return false;
    await complete(0, '不该发出的旧回复'); await complete(1, '两句一起回答'); await advance(20000);
    return f.messages.filter(m => m.role === 'peer').map(m => m.text).join() === '两句一起回答' && jobs.length === 2;
  `);
  await check('生成中不冒气泡；同步重绘/切聊天再回来也不会多一条', `
    await resetCase({ delayOn: false }); await send('同步测试'); await advance(400);
    if (r.phase !== 'streaming') return false;
    if (chatEl.querySelector('.dots')) return false;                 // 不要加载的三个点
    if (statusEl.textContent !== '对方正在输入…') return false;       // 只在状态栏写
    const originalApi = apiFetch;
    const remote = JSON.parse(JSON.stringify(state)); remote.rev = 3; remote.friends[0].name = '远端修改';
    apiFetch = async () => ({ ok: true, json: async () => remote });
    await syncTick(null, true); apiFetch = originalApi;
    if (chatEl.querySelector('.dots')) return false;
    closeChat(); openChat('friend', f.id);
    if (chatEl.querySelector('.dots')) return false;
    await complete(); await advance(20000);
    return f.messages.filter(m => m.role === 'peer').length === 1 && f.messages.length === 2;
  `);
  await check('空结果和接口错误不会静默消失，重绘后错误仍显示', `
    await resetCase({ delayOn: false }); await send('空回复'); await advance(400);
    await complete(0, ''); await advance(2000); renderChat();
    if (!r.error || !chatEl.querySelector('.error') || r.phase !== 'idle') return false;
    await send('重试'); await advance(400); jobs[1].reject(new Error('模拟网络失败')); await advance(2000); renderChat();
    return r.error === '模拟网络失败' && chatEl.textContent.includes('模拟网络失败') && !chatEl.querySelector('.dots');
  `);
  await check('手机断流：还没出字就自动重连，不把人晾着', `
    await resetCase({ delayOn: false }); await send('断流'); await advance(400);
    jobs[0].reject(new TypeError('Failed to fetch')); await flush(); await advance(1500);
    if (jobs.length !== 2) return false;                       // 自动重连了一次
    jobs[1].emit('重连上了'); await complete(1, '重连上了'); await advance(20000);
    return f.messages.filter(m => m.role === 'peer').map(m => m.text).join() === '重连上了';
  `);
  await check('手机断流：已经打出来的半截不丢，别的也不重发', `
    await resetCase({ delayOn: false }); await send('半截'); await advance(400);
    jobs[0].emit('我今天有点累，'); jobs[0].reject(new TypeError('Failed to fetch'));
    await advance(20000);
    const replies = f.messages.filter(m => m.role === 'peer').map(m => m.text);
    return replies.length === 1 && replies[0].includes('我今天有点累') && jobs.length === 1;
  `);
  await check('90 秒总超时取消任务；迟到响应不会落地', `
    await resetCase({ delayOn: false }); await send('超时'); await advance(400); await advance(90000);
    if (!jobs[0].cancelled || r.phase !== 'idle' || !r.error.includes('超时')) return false;
    await complete(0, '迟到消息'); await advance(20000);
    return f.messages.length === 1 && !!chatEl.querySelector('.error');
  `);
  await check('准备链接期间停止，后续不会偷偷发起模型请求', `
    await resetCase({ delayOn: false }); const original = prepareLinkDoc; let finish;
    prepareLinkDoc = () => new Promise(resolve => { finish = resolve; });
    await send('准备资料'); await advance(400); stopReply('friend', f); await flush(); finish(); await flush(); prepareLinkDoc = original;
    return jobs.length === 0 && r.phase === 'idle' && !chatEl.querySelector('.dots');
  `);
  await check('前台恢复立即执行过期等待，不重复生成', `
    await resetCase(); await send('后台测试'); testClock.now += 30000;
    document.dispatchEvent(new Event('visibilitychange')); await flush();
    if (jobs.length !== 1 || r.phase !== 'streaming') return false;
    await advance(0); await complete(); await advance(20000);
    return jobs.length === 1 && f.messages.length === 2;
  `);
  await check('已读等待明确显示；再次发言取消等待且不重新抽签', `
    await resetCase({ lateOn: true, lateChance: 30 });
    f.messages = Array.from({ length: 5 }, (_, i) => ({ id: 'old' + i, role: i % 2 ? 'peer' : 'user', text: '旧消息', ts: Date.now() - 10000 + i }));
    const random = Math.random; Math.random = () => 0;
    await send('第一句'); renderChat();
    if (!f.lateReplyAt || statusEl.textContent !== '已读，等会儿回' || !chatEl.querySelector('.read-tag')) { Math.random = random; return false; }
    await send('第二句'); Math.random = random; await advance(0); await complete();
    await advance(20000);
    return !f.lateReplyAt && jobs.length === 1 && r.phase === 'idle';
  `);
  await check('已读等待到期/关闭时直接生成，不再追加随机等待', `
    await resetCase({ lateOn: true }); await send('稍后回'); stopReply('friend', f); await flush();
    const before = jobs.length;
    f.lateReplyAt = Date.now() + 60000; testClock.now += 60000; lateReplyTick(); await advance(0);
    if (jobs.length !== before + 1) return false;              // 到点直接生成，不再抽等待
    await complete(); await advance(20000);
    if (f.lateReplyAt || !f.messages.some(m => m.role === 'peer')) return false;
    await send('又一句'); stopReply('friend', f); await flush(); f.lateReplyAt = Date.now() + 60000;
    state.settings.lateOn = false; lateReplyTick(); await advance(0);
    return !f.lateReplyAt && jobs.length > before + 1;
  `);
  await check('缺少 Key 的错误、发送按钮、好友覆盖值与零秒上限', `
    await resetCase({ apiKey: '' }); f.settings = { delayMax: 0, delayMin: 20 };
    if (delayFor(f) !== 0) return false;
    f.settings = { delayMin: 12, delayMax: 12 }; if (delayFor(f) !== 12000) return false;
    f.settings = {}; await send('没填 Key');
    if (jobs.length !== 0) return false;                       // 没 Key 不提前发请求
    await advance(10000); renderChat();
    return r.phase === 'idle' && sendBtn.textContent === '发送' && !!chatEl.querySelector('.error');
  `);
  await check('延迟是 3~10 秒里均匀随机（不是老往 3 秒挤）', `
    await resetCase({ delayMin: 3, delayMax: 10, delayOn: true }); f.settings = {};
    // 固定随机数验证映射：均匀 → 3 + u*7；以前那种 pow(u,1.35) 偏置会被这里抓住
    const rnd = Math.random;
    Math.random = () => 0.5; const mid = delayFor(f);
    Math.random = () => 0.25; const q1 = delayFor(f);
    Math.random = () => 0.75; const q3 = delayFor(f);
    Math.random = rnd;
    if (mid !== 6500 || q1 !== 4750 || q3 !== 8250) return false;
    const seen = new Set(); let lo = 1e9, hi = -1, sum = 0; const N = 200;
    for (let i = 0; i < N; i += 1) {
      const v = delayFor(f); seen.add(Math.round(v));
      lo = Math.min(lo, v); hi = Math.max(hi, v); sum += v;
    }
    if (lo < 3000 || hi > 10000 || seen.size < 30) return false;
    const mean = sum / N / 1000;
    if (mean < 6.2 || mean > 6.8) return false;          // 均匀的均值应贴着 6.5
    // 好友自己的节奏优先，界面上要能算出「现在到底几秒」
    state.settings.delayMin = 3; state.settings.delayMax = 10;
    const g = delayRange(f); if (g.min !== 3 || g.max !== 10) return false;
    f.settings = { delayMin: 5, delayMax: 5 };
    const own = delayRange(f);
    return own.min === 5 && own.max === 5;
  `);
  await check('手机看大图：@blob: 要换成服务器地址，不再是裂图', `
    await resetCase();
    const wasLocal = LOCAL_MODE; LOCAL_MODE = false; SERVER = 'http://example.test'; TOKEN = 'tk';
    f.messages.push({ id: 'img1', role: 'peer', authorId: f.id, image: '@blob:abc.jpg',
      thumb: 'data:image/png;base64,AAAA', ts: Date.now() });
    renderChat();
    const im = chatEl.querySelector('.bubble.pic img');
    // 缩略图还是本地 data URL（秒出），点开的大图必须是服务器地址
    if (!im || !im.src.startsWith('data:image/')) { LOCAL_MODE = wasLocal; return false; }
    im.click(); await flush();
    const lb = document.getElementById('lightboxImg');
    const ok = !!lb && lb.src.includes('/api/blob/abc.jpg') && !lb.src.includes('@blob:');
    const box = document.getElementById('lightbox'); if (box) box.classList.remove('open');
    LOCAL_MODE = wasLocal; SERVER = ''; TOKEN = '';
    return ok;
  `);
  await check('自己也能发表情包：点一下就发，她也看得懂', `
    await resetCase({ delayOn: false });
    state.stickers = [{ id: 'st1', url: '@blob:stk.png', tags: ['开心', '笑脸'],
      desc: '一个笑着的小人', ts: Date.now() }];
    openEmoji();
    const sec = document.getElementById('stkSec');
    const strip = document.getElementById('stkStrip');
    if (!sec || sec.hidden || !strip || strip.querySelectorAll('button').length !== 1) return false;
    strip.querySelector('button').click();
    await advance(0);
    const mine = f.messages.filter(m => m.role === 'user');
    if (mine.length !== 1) return false;
    const msg = mine[0];
    if (!msg.sticker || msg.image !== '@blob:stk.png') return false;
    if (!Array.isArray(msg.stickerTags) || msg.stickerTags[0] !== '开心') return false;
    if (!chatEl.querySelector('.bubble.sticker .sticker-img')) return false;
    // 给模型看的必须是「他发了一个表情包」，不能写成「你发的」；也不能占看图额度
    const api = toApiMessage(msg, true, new Map());
    if (typeof api.content !== 'string') return false;
    if (!api.content.includes('他发了一个表情包')) return false;
    if (!api.content.includes('一个笑着的小人')) return false;
    if (api.content.includes('你刚发')) return false;
    return true;
  `);
  await check('记忆按旁观视角注入：不能让她把「我」当成自己', `
    await resetCase();
    f.memory = '小柔是我老婆，R6II 是我的相机';
    f.memoryNotes = [{ id: 'n1', text: '小柔是我老婆' }];
    const sys = memorySysFor(f);
    if (!sys.includes('旁观记录')) return false;
    if (!sys.includes('指的也是他，不是你')) return false;
    if (!sys.includes('里面的「我」指的都是他')) return false;
    // 记忆内容本身不能丢
    return sys.includes('小柔是我老婆，R6II 是我的相机');
  `);
  await check('分段回复第一段及时保存，停止后后续分段不再出现', `
    await resetCase({ delayOn: false, bursts: 2 }); await send('分两句说'); await advance(400);
    await complete(0, '第一段\\n第二段'); await advance(1500);
    if (!saved.some(s => s.friends[0].messages.some(m => m.text === '第一段'))) return false;
    const before = f.messages.filter(m => m.role === 'peer').length;
    stopReply('friend', f); await advance(3000);
    const after = f.messages.filter(m => m.role === 'peer').length;
    return after === before && r.phase === 'idle';
  `);
  await check('分段发送时的新消息只追加一轮，已回答的消息不重排', `
    await resetCase({ delayOn: false, bursts: 2 }); await send('第一个问题'); await advance(400);
    await complete(0, '第一段\\n第二段'); await advance(1500);
    await send('新问题'); await advance(2000);
    if (jobs.length !== 2) return false;
    await complete(1, '新问题的回答'); await advance(20000);
    return jobs.length === 2 && r.phase === 'idle';
  `);
  await check('同步收到服务器兜底后取消本机未发送回复', `
    await resetCase({ delayOn: false }); await send('等待兜底'); await advance(400);
    const remote = JSON.parse(JSON.stringify(state)); remote.friends[0].messages.push({ id: 'fallback', role: 'peer', text: '服务器回复', ts: Date.now(), source: 'fallback', replyTo: f.messages[0].id });
    mergeRemote(remote); await flush(); renderChat(); await complete(0, '不应出现'); await advance(2000);
    return jobs[0].cancelled && f.messages.filter(m => m.role === 'peer').length === 1 && r.phase === 'idle';
  `);
  await check('真实流式入口不会使用普通接口 25 秒超时', `
    await resetCase(); LOCAL_MODE = false; const original = apiFetch; let timeout;
    apiFetch = async (_path, opts) => { timeout = opts.timeout; return new Response('data: {"choices":[{"delta":{"content":"好"}}]}\\n\\n'); };
    let content = '';
    await new Promise((resolve, reject) => startStream({ url: '/mock', key: 'test-only', body: {}, onDelta: d => { content += d.content; }, onDone: resolve, onError: reject }));
    apiFetch = original; LOCAL_MODE = true;
    return timeout === 0 && content === '好';
  `);
  // ---------- 她会发照片（AI 生图） ----------
  const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await check('她发照片：关键词命中必发，文字先到、图随后贴上来', `
    await resetCase({ delayOn: false, imageOn: true, imageBaseUrl: ${JSON.stringify(site + '/v1')},
      imageApiKey: 'sk-img', imageModel: 'gpt-image-1', imageTriggers: '自拍', imageChance: 0 });
    const realGen = genImage; const realShrink = shrinkPhoto;
    window.__imgCalls = [];
    genImage = async (prompt) => { __imgCalls.push(prompt); return 'data:image/png;base64,${PNG1}'; };
    shrinkPhoto = async (d) => d;
    try {
      await send('给我看看你的自拍'); await advance(400);
      if (!JSON.stringify(jobs[0].body).includes('【照片】')) return false;    // 关键词命中：提示词里要有照片规则
      await complete(0, '好呀，等我一下\\n（你刚发了一张照片：以前那张）\\n[[照片:书店柜台后面，米白色开衫，捧着热可可]]');
      await advance(2000);
      const peers = f.messages.filter(m => m.role === 'peer');
      const texts = peers.map(m => m.text);
      // 标记不能漏给用户看，文字必须还在
      if (texts.some(t => String(t).includes('[[照片'))) return false;
      if (texts.some(t => String(t).includes('你刚发了一张照片'))) return false;   // 系统标注不能漏出去
      if (!texts.includes('好呀，等我一下')) return false;
      const pic = peers.find(m => m.image);
      if (!pic || !pic.photo || !pic.photo.includes('书店柜台后面')) return false;
      if (__imgCalls.length !== 1) return false;                              // 只花一张的钱
      if (!__imgCalls[0].includes('书店柜台后面') || !__imgCalls[0].includes('测试朋友')) return false;
      if (f.__photoThisTurn !== undefined) return false;                       // 这一轮的闸门用完要清掉
      // 下一轮她要看得到「你刚发了一张照片：…」，不然她会忘了自己发过
      return toApiMessage(pic).content.includes('你刚发了一张照片');
    } finally { genImage = realGen; shrinkPhoto = realShrink; }
  `);
  await check('她发照片：概率 0 且没关键词就不发，模型硬写标记也会被剥掉', `
    await resetCase({ delayOn: false, imageOn: true, imageBaseUrl: ${JSON.stringify(site + '/v1')},
      imageApiKey: 'sk-img', imageChance: 0, imageTriggers: '' });
    const realGen = genImage; const realShrink = shrinkPhoto;
    window.__imgCalls = [];
    genImage = async (p) => { __imgCalls.push(p); return 'data:image/png;base64,${PNG1}'; };
    shrinkPhoto = async (d) => d;
    try {
      await send('在干嘛'); await advance(400);
      if (JSON.stringify(jobs[0].body).includes('【照片】')) return false;     // 没抽中就不该提照片
      await complete(0, '在看书呢\\n[[照片:不该发的一张]]'); await advance(2000);
      return __imgCalls.length === 0
        && !f.messages.some(m => m.image)
        && !f.messages.some(m => String(m.text || '').includes('[[照片'));
    } finally { genImage = realGen; shrinkPhoto = realShrink; }
  `);
  await check('她发照片：概率进了但模型没写标记，代码兜底生成一张', `
    await resetCase({ delayOn: false, imageOn: true, imageBaseUrl: ${JSON.stringify(site + '/v1')},
      imageApiKey: 'sk-img', imageChance: 100, imageTriggers: '' });
    const realGen = genImage; const realShrink = shrinkPhoto; const realQuick = quickChat;
    window.__imgCalls = [];
    genImage = async (p) => { __imgCalls.push(p); return 'data:image/png;base64,${PNG1}'; };
    shrinkPhoto = async (d) => d;
    quickChat = async () => '窗边自拍，米色针织衫';
    try {
      await send('随便聊聊'); await advance(400);
      if (!JSON.stringify(jobs[0].body).includes('【照片】')) return false;
      await complete(0, '嗯嗯'); await advance(2000);
      const pic = f.messages.find(m => m.image);
      if (!pic || pic.photo !== '窗边自拍，米色针织衫') return false;
      return __imgCalls.length === 1 && __imgCalls[0].includes('窗边自拍，米色针织衫');
    } finally { genImage = realGen; shrinkPhoto = realShrink; quickChat = realQuick; }
  `);
  await check('她发照片：群里永远不发（和表情包一致）', `
    await resetCase({ imageOn: true, imageBaseUrl: ${JSON.stringify(site + '/v1')},
      imageApiKey: 'sk-img', imageChance: 100, imageTriggers: '自拍' });
    window.__imgCalls = [];
    const realGen = genImage; genImage = async (p) => { __imgCalls.push(p); return ''; };
    try {
      const g = makeGroup({ id: 'g-test', name: '测试群', members: [f.id] });
      state.groups = [g];
      if (JSON.stringify(buildMessages(f, g)).includes('【照片】')) return false;
      startPhotoJob('group', g, f.id, '群里的照片', '', () => true);
      await flush();
      return __imgCalls.length === 0;
    } finally { genImage = realGen; }
  `);
  await check('她发照片：接口地址/请求体拼装正确，Key 只走 Authorization', `
    await resetCase({ imageBaseUrl: ${JSON.stringify(site + '/v1')} + '/', imageApiKey: 'sk-x',
      imageModel: 'gpt-image-2', imageSize: '1024x1536', imageQuality: 'high', imageStyle: '日系胶片' });
    if (imagesEndpoint('https://x.test') !== 'https://x.test/v1/images/generations') return false;
    if (imagesEndpoint('https://x.test/v1') !== 'https://x.test/v1/images/generations') return false;
    if (imagesEndpoint('https://x.test/v1/images/generations') !== 'https://x.test/v1/images/generations') return false;
    const seen = {}; const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      seen.url = String(url); seen.body = JSON.parse(opts.body); seen.headers = opts.headers;
      return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: '${PNG1}' }] }) };
    };
    try {
      const out = await genImage(buildPhotoPrompt('窗边自拍', f));
      if (seen.url !== ${JSON.stringify(site + '/v1/images/generations')}) return false;
      if (seen.body.model !== 'gpt-image-2' || seen.body.size !== '1024x1536' || seen.body.n !== 1) return false;
      if (seen.body.quality !== 'high') return false;            // 清晰度要真的发过去
      if (!seen.body.prompt.includes('窗边自拍') || !seen.body.prompt.includes('日系胶片')) return false;
      if (!seen.body.prompt.includes('测试朋友')) return false;
      if (seen.headers.Authorization !== 'Bearer sk-x') return false;
      if (!out.startsWith('data:image/png;base64,${PNG1}')) return false;
      // size=auto / quality=auto 时不要把不合法的值塞进去
      const cfgAuto = photoConfig({ imageSize: 'auto', imageQuality: '' });
      if (cfgAuto.size !== 'auto' || cfgAuto.quality !== '') return false;
      const seen2 = {}; window.fetch = async (url, opts) => {
        seen2.body = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: '${PNG1}' }] }) };
      };
      await genImage(buildPhotoPrompt('窗边自拍', f), photoConfig({ imageSize: 'auto', imageQuality: '' }));
      if ('quality' in seen2.body || 'size' in seen2.body) return false;   // 自动就整条不发
      return true;
    } finally { window.fetch = realFetch; }
  `);
  await check('她发照片：设置能存、能同步、能迁移', `
    await resetCase();
    openSheet();
    $('#fImgOn').checked = true;
    $('#fImgBase').value = 'https://relay.example/v1/';
    $('#fImgKey').value = 'sk-relay';
    $('#fImgModel').value = 'gpt-image-2.5';
    $('#fImgSize').value = '1024x1536';
    $('#fImgQuality').value = 'medium';
    $('#fImgStyle').value = '写实摄影，黑长直';
    $('#fImgChance').value = '25';
    $('#fImgTriggers').value = '自拍， 照片';
    saveForm();
    if (!state.settings.imageOn || state.settings.imageBaseUrl !== 'https://relay.example/v1') return false;
    if (state.settings.imageApiKey !== 'sk-relay' || state.settings.imageModel !== 'gpt-image-2.5') return false;
    if (state.settings.imageQuality !== 'medium') return false;
    if (state.settings.imageChance !== 25 || state.settings.imageTriggers !== '自拍, 照片') return false;
    if (pendingEdits.settings.imageOn !== true) return false;      // 要让服务器也收到这次改动
    const back = migrate(JSON.parse(JSON.stringify(state)));
    return back.settings.imageOn === true
      && back.settings.imageBaseUrl === 'https://relay.example/v1'
      && back.settings.imageQuality === 'medium'
      && back.settings.imageTriggers === '自拍, 照片';
  `);
  console.log(`\n${count} browser regressions passed`);
} finally {
  ws?.close();
  chrome.kill();
  await new Promise(r => { if (chrome.exitCode !== null) r(); else chrome.once('exit', r); });
  server.closeAllConnections();
  await new Promise(r => server.close(r));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
