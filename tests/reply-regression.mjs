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
  await check('10 分钟总超时取消任务；迟到响应不会落地', `
    await resetCase({ delayOn: false }); await send('超时'); await advance(400); await advance(600000);
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
    const seen = new Set(); let lo = 1e9, hi = -1, sum = 0; const N = 600;   // 200 时偶发均值抖动，600 稳定
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
  await check('记忆注入上限放宽到 1200 字（以前 600 就截了）', `
    await resetCase();
    f.memory = '记'.repeat(900) + '尾巴在这里';
    const sys = memorySysFor(f);
    return sys.includes('尾巴在这里');
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
      // 下一轮她要看得到「你发了一张照片：…」，不然她会忘了自己发过
      return toApiMessage(pic).content.includes('你发了一张照片');
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
  await check('她发照片：每个角色的预设覆盖全局（模型/尺寸/清晰度/画风/提示词/概率）', `
    await resetCase({ delayOn: false, imageOn: true, imageBaseUrl: ${JSON.stringify(site + '/v1')},
      imageApiKey: 'sk-g', imageModel: 'gpt-image-global', imageSize: '1024x1024', imageQuality: 'low',
      imageStyle: '全局画风', imagePrompt: '全局提示词', imageChance: 0, imageTriggers: '' });
    f.settings = { imageChance: 100, imageTriggers: '自拍', imageStyle: '她的画风',
      imagePrompt: '她的提示词：他说想看才发', imageModel: 'gpt-image-her',
      imageSize: '1024x1536', imageQuality: 'high' };
    const realGen = genImage; const realShrink = shrinkPhoto;
    window.__imgCalls = [];
    genImage = async (p, c) => { __imgCalls.push({ p, c }); return 'data:image/png;base64,${PNG1}'; };
    shrinkPhoto = async (d) => d;
    try {
      await send('给我看看自拍'); await advance(400);
      const body = JSON.stringify(jobs[0].body);
      if (!body.includes('【照片】')) return false;
      if (!body.includes('她的提示词')) return false;        // 用她的提示词
      if (body.includes('全局提示词')) return false;
      await complete(0, '好呀\\n[[照片:窗边]]'); await advance(2000);
      if (__imgCalls.length !== 1) return false;
      const c = __imgCalls[0].c;
      if (c.model !== 'gpt-image-her' || c.size !== '1024x1536' || c.quality !== 'high') return false;
      return __imgCalls[0].p.includes('她的画风') && !__imgCalls[0].p.includes('全局画风');
    } finally { genImage = realGen; shrinkPhoto = realShrink; }
  `);
  await check('她发照片：说要「画」时只画图，绝不生图', `
    await resetCase({ delayOn: false, imageOn: true, imageBaseUrl: ${JSON.stringify(site + '/v1')},
      imageApiKey: 'sk', imageChance: 100, imageTriggers: '自拍' });
    const realGen = genImage; window.__imgCalls = [];
    genImage = async () => { __imgCalls.push(1); return ''; };
    try {
      await send('给我画个猫'); await advance(400);
      const body = JSON.stringify(jobs[0].body);
      if (body.includes('【照片】')) return false;             // 不许塞生图规则
      if (!body.includes('【画图】')) return false;            // 要走画图
      await complete(0, '好呀\\n<svg viewBox="0 0 240 240"><circle cx="120" cy="120" r="60"/></svg>');
      await advance(2000);
      return __imgCalls.length === 0
        && f.messages.some(m => m.role === 'peer' && String(m.text).includes('<svg'));
    } finally { genImage = realGen; }
  `);
  await check('她发照片：有参考图就走 /images/edits（multipart，最多 6 张）', `
    await resetCase({ delayOn: false, imageOn: true, imageBaseUrl: ${JSON.stringify(site + '/v1')},
      imageApiKey: 'sk-r', imageModel: 'gpt-image-2', imageChance: 0, imageTriggers: '自拍' });
    f.settings = { imageChance: 100,
      imageRefs: ['data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,BBBB'] };
    const realGen = genImage; const realShrink = shrinkPhoto; const realFetch = window.fetch;
    shrinkPhoto = async (d) => d;
    let seen = null; let dataFetch = 0;
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u.startsWith('data:')) { dataFetch += 1; return { blob: async () => new Blob(['x'], { type: 'image/jpeg' }) }; }
      seen = { url: u, body: opts.body, headers: opts.headers };
      return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: '${PNG1}' }] }) };
    };
    try {
      const cfg = photoCfgFor(f);
      const out = await genImage(buildPhotoPrompt('窗边', f, cfg), cfg);
      if (!seen || !seen.url.endsWith('/v1/images/edits')) return false;
      if (!(seen.body instanceof FormData)) return false;
      if (seen.body.getAll('image[]').length !== 2 || dataFetch !== 2) return false;
      if (seen.body.get('model') !== 'gpt-image-2') return false;
      if (!String(seen.body.get('prompt')).includes('窗边')) return false;
      if (!seen.body.get('prompt').includes('参考图')) return false;
      if (seen.headers.Authorization !== 'Bearer sk-r') return false;
      if (!out.startsWith('data:image/png;base64,')) return false;
      // 中转不认参考图：退回纯文字生图，别把人卡死
      let posts = [];
      window.fetch = async (url) => {
        const u = String(url);
        if (u.startsWith('data:')) return { blob: async () => new Blob(['x']) };
        posts.push(u);
        if (u.endsWith('/images/edits')) {
          return { ok: false, status: 400, json: async () => ({ error: { message: 'image[] not supported' } }) };
        }
        return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: '${PNG1}' }] }) };
      };
      const out2 = await genImage(buildPhotoPrompt('窗边', f, cfg), cfg);
      if (!(out2.startsWith('data:image/png;base64,')
        && posts.some(u => u.endsWith('/images/edits'))
        && posts.some(u => u.endsWith('/images/generations')))) return false;

      // 连服务器时交给 /api/image-edit（参考图的 base64 走 JSON，服务器拼 multipart）
      const wasLocal = LOCAL_MODE; const wasServer = SERVER; const wasToken = TOKEN;
      LOCAL_MODE = false; SERVER = 'http://example.test'; TOKEN = 'tk';
      const realApi = apiFetch; let box = null;
      apiFetch = async (path, opts) => {
        box = { path, payload: JSON.parse(opts.body) };
        return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: '${PNG1}' }] }) };
      };
      try {
        const out3 = await genImage(buildPhotoPrompt('窗边', f, cfg), cfg);
        if (!box || box.path !== '/api/image-edit') return false;
        if (!Array.isArray(box.payload.images) || box.payload.images.length !== 2) return false;
        if (!box.payload.images[0].startsWith('data:image/')) return false;
        if (!String(box.payload.url).endsWith('/images/edits')) return false;
        if (!String(box.payload.body.prompt).includes('窗边')) return false;
        return out3.startsWith('data:image/png;base64,');
      } finally {
        apiFetch = realApi; LOCAL_MODE = wasLocal; SERVER = wasServer; TOKEN = wasToken;
      }
    } finally { genImage = realGen; shrinkPhoto = realShrink; window.fetch = realFetch; }
  `);
  await check('她发照片：朋友资料能存她自己的生图预设和参考图', `
    await resetCase({ imageOn: true, imageBaseUrl: ${JSON.stringify(site + '/v1')},
      imageApiKey: 'sk', imageModel: 'gpt-image-2' });
    openFriendSheet(f, 'edit');
    $('#rImgChance').value = '35';
    $('#rImgTriggers').value = '自拍， 照片';
    $('#rImgModel').value = 'gpt-image-her';
    $('#rImgSize').value = '1024x1536';
    $('#rImgOn').checked = false;                       // 这个角色不发照片
    friendRefDraft = ['data:image/jpeg;base64,AAAA'];
    renderImgRefs();
    $('#btnFSave').click();
    await flush();
    const st = f.settings || {};
    if (st.imageChance !== 35 || st.imageTriggers !== '自拍, 照片') return false;
    if (st.imageModel !== 'gpt-image-her' || st.imageSize !== '1024x1536') return false;
    if (st.imageOn !== false) return false;
    if (!Array.isArray(st.imageRefs) || st.imageRefs.length !== 1) return false;
    if (photoCfgFor(f).on !== false) return false;       // 这个角色关掉生图
    // 清空 = 跟随全局
    openFriendSheet(f, 'edit');
    $('#rImgChance').value = '';
    $('#rImgTriggers').value = '';
    $('#rImgOn').checked = true;
    friendRefDraft = [];
    renderImgRefs();
    $('#btnFSave').click();
    await flush();
    return f.settings.imageChance === undefined && f.settings.imageRefs === undefined
      && f.settings.imageOn === true && photoCfgFor(f).on === true;
  `);
  await check('她发照片：最近 5 条聊天进提示词；审核拦了用干净版重试', `
    await resetCase({ delayOn: false, imageOn: true, imageBaseUrl: ${JSON.stringify(site + '/v1')},
      imageApiKey: 'sk', imageChance: 0, imageTriggers: '自拍' });
    f.messages = [
      { id: 'h1', role: 'user', text: '第一句很久以前', ts: 1 },
      { id: 'h2', role: 'peer', authorId: f.id, text: '第二句很久以前', ts: 2 },
      { id: 'h3', role: 'user', text: '第三句', ts: 3 },
      { id: 'h4', role: 'peer', authorId: f.id, text: '第四句', ts: 4 },
      { id: 'h5', role: 'user', text: '第五句', ts: 5 },
      { id: 'h6', role: 'peer', authorId: f.id, text: '第六句', ts: 6 },
      { id: 'h7', role: 'user', text: '发张自拍', ts: 7 },
    ];
    const cfg = photoCfgFor(f);
    const p = buildPhotoPrompt('窗边', f, cfg);
    if (!p.includes('最近的对话')) return false;
    if (!p.includes('第六句') || !p.includes('第五句')) return false;
    if (p.includes('第一句很久以前')) return false;           // 只放最近 5 条
    const p2 = buildPhotoPrompt('窗边', f, cfg, { safe: true });
    if (p2.includes('最近的对话') || p2.includes('你叫林小满')) return false;  // 干净版去掉人设和聊天
    if (!p2.includes('衣着完整')) return false;
    // 第一次被审核拦，第二次（干净版）成功
    const realFetch = window.fetch;
    const bodies = [];
    window.fetch = async (url, opts) => {
      bodies.push(JSON.parse(opts.body));
      if (bodies.length === 1) {
        return { ok: false, status: 400, json: async () => ({ error: { message: 'Your prompt may violate our guardrails around nudity, sexuality or erotic content' } }) };
      }
      return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: '${PNG1}' }] }) };
    };
    try {
      const out = await genPhoto('窗边', f, cfg);
      if (bodies.length !== 2) return false;
      if (!bodies[0].prompt.includes('最近的对话')) return false;
      if (bodies[1].prompt.includes('最近的对话') || bodies[1].prompt.includes('你叫林小满')) return false;
      if (!bodies[1].prompt.includes('衣着完整')) return false;
      return out.startsWith('data:image/png;base64,');
    } finally { window.fetch = realFetch; }
  `);
  await check('她发照片：失败在聊天里留一行灰字，不是闪一下就没', `
    await resetCase({ delayOn: false, imageOn: true, imageBaseUrl: ${JSON.stringify(site + '/v1')},
      imageApiKey: 'sk', imageChance: 0, imageTriggers: '自拍' });
    const realFetch = window.fetch;
    window.fetch = async () => ({ ok: false, status: 400,
      json: async () => ({ error: { message: 'Your prompt may violate our guardrails around nudity' } }) });
    try {
      await send('发张自拍'); await advance(400);
      await complete(0, '好呀\\n[[照片:窗边]]'); await advance(3000);
      const line = f.messages.find((m) => m.role === 'system' && String(m.text).includes('照片没发出来'));
      if (!line) return false;
      if (!line.text.includes('安全审核')) return false;
      if (!chatEl.textContent.includes('照片没发出来')) return false;
      const before = f.messages.filter((m) => m.role === 'system').length;
      await send('再发一张'); await advance(400);
      await complete(1, '好呀\\n[[照片:窗边]]'); await advance(3000);
      return f.messages.filter((m) => m.role === 'system').length === before;   // 一分钟内不刷屏
    } finally { window.fetch = realFetch; }
  `);
  await check('她发照片：标记后面那句话说在照片之后', `
    await resetCase({ delayOn: false, imageOn: true, imageBaseUrl: ${JSON.stringify(site + '/v1')},
      imageApiKey: 'sk', imageChance: 0, imageTriggers: '自拍' });
    const realGen = genImage; const realShrink = shrinkPhoto;
    genImage = async () => 'data:image/png;base64,${PNG1}';
    shrinkPhoto = async (d) => d;
    try {
      await send('发张自拍'); await advance(400);
      await complete(0, '好呀\\n[[照片:窗边]]\\n拍好啦，头发有点乱'); await advance(5000);
      const peers = f.messages.filter((m) => m.role === 'peer');
      const iPic = peers.findIndex((m) => m.image);
      if (iPic < 0) return false;
      const after = peers[iPic + 1];
      if (!after || after.text !== '拍好啦，头发有点乱') return false;
      if (Number(after.ts) <= Number(peers[iPic].ts)) return false;
      return peers.slice(0, iPic).every((m) => !String(m.text || '').includes('[[照片'));
    } finally { genImage = realGen; shrinkPhoto = realShrink; }
  `);
  await check('她发照片：模型没补话就不硬加预设台词（图就图）', `
    await resetCase({ delayOn: false, imageOn: true, imageBaseUrl: ${JSON.stringify(site + '/v1')},
      imageApiKey: 'sk', imageChance: 0, imageTriggers: '自拍' });
    const realGen = genImage; const realShrink = shrinkPhoto;
    genImage = async () => 'data:image/png;base64,${PNG1}';
    shrinkPhoto = async (d) => d;
    try {
      await send('发张自拍'); await advance(400);
      await complete(0, '好呀\\n[[照片:窗边]]'); await advance(5000);
      const peers = f.messages.filter((m) => m.role === 'peer');
      const iPic = peers.findIndex((m) => m.image);
      if (iPic < 0) return false;
      const after = peers[iPic + 1];
      // 以后只发模型自己写的那句；没写就不补「拍好啦」这种预设
      return !after || !/拍好啦|喏，刚拍的|拍得不太好/.test(after.text || '');
    } finally { genImage = realGen; shrinkPhoto = realShrink; }
  `);
  await check('她发照片：生图的时候也能照常聊天，状态是「正在拍照…」', `
    await resetCase({ delayOn: false, imageOn: true, imageBaseUrl: ${JSON.stringify(site + '/v1')},
      imageApiKey: 'sk', imageChance: 0, imageTriggers: '自拍' });
    const realGen = genImage; const realShrink = shrinkPhoto;
    let release = null;
    genImage = () => new Promise((r) => { release = r; });
    shrinkPhoto = async (d) => d;
    try {
      await send('发张自拍'); await advance(400);
      await complete(0, '好呀\\n[[照片:窗边]]'); await advance(2000);
      if (!photoJobs.has('friend:f-test')) return false;         // 这张还在生成
      if (statusEl.textContent !== '正在拍照…') return false;
      // 生成期间照常发消息、照常回
      await send('你在干嘛'); await advance(400);
      if (jobs.length !== 2) return false;
      await complete(1, '在想你'); await advance(2000);
      if (!f.messages.some((m) => m.text === '在想你')) return false;
      if (r.phase !== 'idle') return false;
      // 收尾：放掉这张图，别把后面的用例堵住
      release('data:image/png;base64,${PNG1}');
      await flush();
      await advance(5000);
      return !photoJobs.has('friend:f-test') && f.messages.some((m) => m.image);
    } finally { genImage = realGen; shrinkPhoto = realShrink; }
  `);
  await check('她发照片：关键词留空也有内置的（自拍/照片/看看你）', `
    await resetCase({ delayOn: false, imageOn: true, imageBaseUrl: ${JSON.stringify(site + '/v1')},
      imageApiKey: 'sk', imageChance: 0, imageTriggers: '' });
    const realGen = genImage; const realShrink = shrinkPhoto;
    window.__imgCalls = [];
    genImage = async (p) => { __imgCalls.push(p); return 'data:image/png;base64,${PNG1}'; };
    shrinkPhoto = async (d) => d;
    try {
      await send('发个自拍呗'); await advance(400);
      if (!JSON.stringify(jobs[0].body).includes('【照片】')) return false;
      await complete(0, '好呀\\n[[照片:窗边]]'); await advance(5000);
      return __imgCalls.length === 1 && f.messages.some((m) => m.image);
    } finally { genImage = realGen; shrinkPhoto = realShrink; }
  `);
  await check('生图：提示词里写的画风要求会真的进生图模型', `
    await resetCase({ imageOn: true, imageBaseUrl: ${JSON.stringify(site + '/v1')},
      imageApiKey: 'sk', imageModel: 'gpt-image-2' });
    f.settings = { imagePrompt: '他想看的时候才发；必须是二次元画风，粗描线，平涂，背景可以写实' };
    const cfg = photoCfgFor(f);
    const p = buildPhotoPrompt('窗边', f, cfg);
    if (!p.includes('二次元画风') || !p.includes('粗描线') || !p.includes('平涂')) return false;
    if (!p.includes('额外要求')) return false;
    const ps = buildPhotoPrompt('窗边', f, cfg, { safe: true });
    return ps.includes('二次元画风') && ps.includes('粗描线');
  `);
  // 输入法：macOS 中文输入法下打英文，回车是「上屏」不是「发送」。
  // Safari/WKWebView 这时 isComposing 常常已经是 false，只看它就会误发。
  await check('回车：输入法上屏不发送，拼完字之后的回车才发送', `
    await resetCase();
    if (!isImeEnter({ key: 'Enter', isComposing: true })) return false;      // 正在拼字
    if (!isImeEnter({ key: 'Enter', isComposing: false, keyCode: 229 })) return false;
    inputEl.dispatchEvent(new CompositionEvent('compositionstart'));
    if (!isImeEnter({ key: 'Enter', isComposing: false, keyCode: 13 })) return false;
    inputEl.dispatchEvent(new CompositionEvent('compositionend'));
    if (!isImeEnter({ key: 'Enter', isComposing: false, keyCode: 13 })) return false;  // 刚上屏那一下
    await advance(200);                                                       // 保护窗过去
    return !isImeEnter({ key: 'Enter', isComposing: false, keyCode: 13 });
  `);
  await check('回车发送开关：关掉后回车只换行，打开才发出去', `
    await resetCase({ delayOn: false });
    if (!enterSendOn()) return false;                                        // 桌面没设过默认开
    state.settings.enterSend = false;
    inputEl.value = '关掉时按回车';
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await advance(600);
    if (jobs.length) return false;                                           // 没发出去
    if (inputEl.value !== '关掉时按回车') return false;                        // 字还在
    state.settings.enterSend = true;
    inputEl.value = '打开后按回车';
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await advance(600);
    return jobs.length === 1;                                                // 发出去了
  `);
  // 以前点开大图只能看，手机和 Mac 都没有「保存」入口
  await check('保存图片：看大图有按钮，手机上走原生写文件', `
    await resetCase();
    openLightbox('data:image/jpeg;base64,AAA', '', { id: 'x', role: 'peer', authorId: 'f-test', ts: 1700000000000 });
    const btn = document.getElementById('lightboxSave');
    if (!btn) return false;
    document.getElementById('lightbox').classList.remove('open');
    if (!msgMenu.querySelector('[data-act="saveimg"]')) return false;        // 长按菜单也有
    let called = null;
    window.QingliaoSave = { save: (name, b64) => { called = { name, b64 }; return 'Download/' + name; } };
    const realFetch = window.fetch; const realToast = toast; const said = [];
    window.fetch = async () => ({ ok: true, blob: async () => new Blob(['x'], { type: 'image/jpeg' }) });
    toast = (m) => said.push(m);
    try {
      const ok = await saveImageRef('data:image/jpeg;base64,AAA', '轻聊-测试');
      if (!ok || !called) return false;
      if (called.name !== '轻聊-测试.jpg') return false;                     // 名字带扩展名
      if (!called.b64) return false;
      if (!said.some((m) => String(m).indexOf('已保存') >= 0)) return false;
    } finally {
      delete window.QingliaoSave; window.fetch = realFetch; toast = realToast;
    }
    return true;
  `);
  // 她发完图，下一轮要「记得」自己发的是什么：以前只有她自己写的画面，这次起优先用她看到的那句。
  await check('她能记得自己发的图：照片描述进上下文', `
    await resetCase();
    f.messages = [
      { id: 'm1', role: 'user', text: '给我看看', ts: 1 },
      { id: 'm2', role: 'peer', text: '喏', image: 'data:image/jpeg;base64,AAA', photo: '低头拍脚踝侧面，红了一小块', ts: 2 },
      { id: 'm3', role: 'user', text: '怎么弄的', ts: 3 },
    ];
    const msgs = buildMessages(f, f, null, new Map());
    const asst = msgs.filter((m) => m.role === 'assistant').map((m) => String(m.content)).join('\\n');
    if (!asst.includes('你发了一张照片：低头拍脚踝侧面')) return false;
    // 「让她看图」关着的时候不去打扰模型
    state.settings.vision = false;
    return (await describeOwnPhoto('data:image/jpeg;base64,AAA', f)) === '';
  `);
  // 安卓通知：App 在前台不弹（跟微信一样），切后台才交给原生
  await check('通知：安卓前台不弹，后台才交给原生弹', `
    await resetCase();
    const said = [];
    window.QingliaoNotify = { foreground: () => true, show: (t, b, k, c) => { said.push([t, b, k, c]); return true; } };
    try {
      notifyLast.clear();
      notifyPeer('林小满', '在呢', 'f-test', 'friend');
      if (said.length) return false;                       // 前台不弹
      window.QingliaoNotify.foreground = () => false;
      notifyLast.clear();
      notifyPeer('林小满', '在呢', 'f-test', 'friend');
      if (said.length !== 1) return false;                 // 后台弹
      if (said[0][0] !== '林小满' || said[0][2] !== 'friend' || said[0][3] !== 'f-test') return false;
      // 15 秒内同一个会话不重复弹
      notifyPeer('林小满', '又一条', 'f-test', 'friend');
      return said.length === 1;
    } finally { delete window.QingliaoNotify; }
  `);
  // 以前提示词里写死「单人出镜，像自拍」，于是她说什么都发同一个角度的自拍：
  // 说了脚受伤，发来的还是全身自拍。这里锁住「机位按描述走」这条。
  await check('拍照：说了脚上的伤，拍的是特写不是自拍', `
    await resetCase({ imageOn: true, imageBaseUrl: ${JSON.stringify(site + '/v1')},
      imageApiKey: 'sk', imageModel: 'gpt-image-2' });
    f.settings = { imageOn: true, refs: [], imageRefs: ['@blob:ref.jpg'] };
    const cfg = photoCfgFor(f); cfg.refs = ['@blob:ref.jpg'];
    const hurt = buildPhotoPrompt('坐在床边低头拍脚踝侧面，红了一小块，暖光', f, cfg);
    if (!hurt.includes('不是自拍')) return false;                 // 明确不许拍成自拍
    if (!hurt.includes('特写')) return false;
    if (hurt.includes('像用手机随手拍／自拍的')) return false;      // 那句写死自拍的话必须没了
    const en = buildPhotoPrompt('close-up of my heel, red bruise', f, cfg);
    if (!en.includes('不是自拍')) return false;                   // 英文描述也要认
    // 明说要自拍时，还是要自拍
    const selfie = buildPhotoPrompt('举着手机在健身房自拍，运动背心', f, cfg);
    if (!selfie.includes('这一张是自拍')) return false;
    if (selfie.includes('不是自拍')) return false;
    // 没说清就别默认自拍，也别每次都一个角度
    const vague = buildPhotoPrompt('在厨房煮面', f, cfg);
    return vague.includes('不要默认拍成自拍') && vague.includes('同一个角度');
  `);
  await check('拍照：有参考图时不照抄参考图的姿势和机位', `
    await resetCase({ imageOn: true, imageBaseUrl: ${JSON.stringify(site + '/v1')},
      imageApiKey: 'sk', imageModel: 'gpt-image-2' });
    f.settings = { imageOn: true, imageRefs: ['@blob:ref1.jpg', '@blob:ref2.jpg'] };
    const cfg = photoCfgFor(f);
    const p = buildPhotoPrompt('在窗边站着', f, cfg);
    if (!p.includes('姿势')) return false;                        // 不许照抄姿势
    if (!p.includes('机位')) return false;                        // 机位要按描述重新来
    if (!p.includes('构图')) return false;
    if (!/长什么样/.test(p)) return false;                        // 参考图只用来定长相
    // 没有参考图时不该出现这段（别把「参考图」三个字塞给纯文字生图）
    f.settings = {};
    const plain = buildPhotoPrompt('在窗边站着', f, photoCfgFor(f));
    return !plain.includes('参考图里就是她本人');
  `);
  await check('参考图太大：启动后压小并传成 blob，别把状态拖成几 MB', `
    await resetCase();
    f.settings = { imageRefs: ['data:image/png;base64,' + 'A'.repeat(700000), '@blob:ok.jpg'] };
    const realShrink = shrinkPhoto; const realUpload = uploadImage; const realPersist = persist;
    let uploaded = 0; let saved = 0;
    shrinkPhoto = async () => 'data:image/jpeg;base64,SMALL';
    uploadImage = async () => { uploaded += 1; return '@blob:new.jpg'; };
    persist = () => { saved += 1; };
    try {
      await repairImageRefs();
      await flush();
      if (uploaded !== 1 || saved !== 1) return false;
      if (f.settings.imageRefs[0] !== '@blob:new.jpg') return false;
      if (f.settings.imageRefs[1] !== '@blob:ok.jpg') return false;
      const pend = (pendingEdits.friends[f.id] || {}).settings || {};
      return pend.imageRefs && pend.imageRefs[0] === '@blob:new.jpg';
    } finally { shrinkPhoto = realShrink; uploadImage = realUpload; persist = realPersist; }
  `);
  await check('表情包：服务器有、这台设备没有的会补进来（旧设备保存不会清空）', `
    await resetCase();
    state.stickers = [];
    const remote = JSON.parse(JSON.stringify(state));
    remote.rev = 9;
    remote.stickers = [
      { id: 'st1', url: '@blob:a.png', tags: ['开心'], desc: '笑', ts: 1 },
      { id: 'st2', url: '@blob:b.png', tags: ['难过'], ts: 2 },
    ];
    mergeRemote(remote);
    if ((state.stickers || []).length !== 2) return false;
    // 删掉的（墓碑）不要再补回来
    state.stickers = [];
    state.deleted = ['st2'];
    mergeRemote(remote);
    return state.stickers.length === 1 && state.stickers[0].id === 'st1';
  `);
  await check('引用不再是灰色：自己的气泡上改成白色', `
    await resetCase();
    f.messages.push({ id: 'q1', role: 'user', text: '你看这个', quote: { author: f.name, text: '旧消息' }, ts: Date.now() });
    f.messages.push({ id: 'q2', role: 'peer', authorId: f.id, text: '看到了', quote: { author: '我', text: '你看这个' }, ts: Date.now() + 1 });
    renderChat();
    const mine = chatEl.querySelector('.row.me .quote-block');
    const hers = chatEl.querySelector('.row.peer .quote-block');
    if (!mine || !hers) return false;
    const c1 = getComputedStyle(mine).color;
    // 自己的蓝气泡上必须是白色（深色主题也一样）
    return c1 === 'rgb(255, 255, 255)' || c1 === 'rgba(255, 255, 255, 1)';
  `);
  await check('群聊头像：像微信群一样拼成员头像', `
    await resetCase();
    state.friends.push(makeFriend({ id: 'g-a', name: '阿二' }), makeFriend({ id: 'g-b', name: '阿三' }));
    const g = makeGroup({ id: 'g1', name: '测试群', members: [state.friends[0].id, 'g-a', 'g-b'] });
    const av = avatarEl(g);
    if (!av.classList.contains('group-avatar')) return false;
    if (av.querySelectorAll('i').length !== 3) return false;
    if (!av.classList.contains('n3')) return false;
    // 单聊不受影响
    const one = avatarEl(state.friends[0]);
    return !one.classList.contains('group-avatar') && one.textContent.length > 0;
  `);
  await check('红包：能发、能渲染、她也看得到、提示词里有', `
    await resetCase({ delayOn: false });
    sendMoney(520, '给你买奶茶');
    await advance(400);
    const m = f.messages.find((x) => x.money);
    if (!m || m.money.amount !== 520 || m.money.note !== '给你买奶茶') return false;
    const bubble = chatEl.querySelector('.bubble.money');
    if (!bubble || !bubble.textContent.includes('¥520')) return false;
    if (!bubble.textContent.includes('给你买奶茶')) return false;
    if (!convPreview(f, 'friend').includes('[红包] ¥520')) return false;
    const api = toApiMessage(m);
    if (typeof api.content !== 'string' || !api.content.includes('¥520') || !api.content.includes('红包')) return false;
    if (jobs.length !== 1) return false;
    const body = JSON.stringify(jobs[0].body);
    return body.includes('【红包】') && body.includes('¥520') && body.includes('给你买奶茶');
  `);
  await check('聊天背景：只存本机，不进 state、不上传', `
    await resetCase();
    await ChatBg.set('friend', 'f-test', 'data:image/jpeg;base64,AAAA');
    await applyChatBg();
    if (!String(chatEl.style.backgroundImage).includes('AAAA')) return false;
    if (JSON.stringify(state).includes('bg:friend') || JSON.stringify(state).includes('AAAA')) return false;
    // 本地确实存下来了
    if ((localStorage.getItem('ql.bg:friend:f-test') || '').indexOf('AAAA') < 0) return false;
    await ChatBg.set('friend', 'f-test', '');
    await applyChatBg();
    return !chatEl.style.backgroundImage;
  `);
  await check('皮肤：切换就生效，并且会同步给服务器', `
    await resetCase();
    openSheet();
    const chip = document.querySelector('#skinChips .chip[data-skin="forest"]');
    if (!chip) return false;
    chip.click();
    if (state.settings.skin !== 'forest') return false;
    if (document.documentElement.getAttribute('data-skin') !== 'forest') return false;
    if (pendingEdits.settings.skin !== 'forest') return false;
    state.settings.skin = 'sakura';
    applyTheme();
    return document.documentElement.getAttribute('data-skin') === 'sakura';
  `);
  // 加皮肤最容易漏的地方：选项加了、SKIN_IDS 忘了加（点了弹回默认），
  // 或者 CSS 那一段没写/写错 id（选了没变化）。这里把三处对一遍。
  await check('九套皮肤：选项、SKIN_IDS、CSS 三处对得上，且颜色各不相同', `
    await resetCase();
    const chips = [...document.querySelectorAll('#skinChips .chip[data-skin]')];
    const ids = chips.map(c => c.dataset.skin);
    const diag = [];
    if (ids.length !== 9) diag.push('count=' + ids.length);
    if (ids.join() !== SKIN_IDS.join()) diag.push('chips=' + ids.join() + ' || ids=' + SKIN_IDS.join());
    // 浅色、深色各过一遍：主色撞了，或者深色那份忘了写（掉回默认蓝），都算错
    for (const dark of [false, true]) {
      const used = {};
      for (const id of ids) {
        state.settings.skin = id;
        applyTheme();
        if (dark) document.documentElement.setAttribute('data-theme', 'dark');
        const css = getComputedStyle(document.documentElement).getPropertyValue('--me').trim();
        const tag = (dark ? 'dark-' : 'light-') + id;
        if (!css) diag.push('NO-CSS ' + tag);
        else if (used[css]) diag.push('DUP ' + tag + ' vs ' + used[css]);
        used[css] = id;
      }
    }
    if (diag.length) throw new Error(diag.join(' | '));
    return true;
  `);
  await check('聊天背景：几 MB 的大图也能显示（不能拼进 gradient 被丢掉）', `
    await resetCase();
    const big = 'data:image/jpeg;base64,' + 'A'.repeat(300000);
    await ChatBg.set('friend', 'f-test', big);
    await applyChatBg();
    const style = String(chatEl.style.backgroundImage);
    if (!style.includes('AAAA')) return false;
    if (style.length < 300000) return false;      // 以前这里会被浏览器整条丢掉 → 长度 0
    if (!chatEl.classList.contains('has-bg')) return false;
    await ChatBg.set('friend', 'f-test', '');
    await applyChatBg();
    return !chatEl.style.backgroundImage && !chatEl.classList.contains('has-bg');
  `);
  await check('人设要求 English：系统提示词末尾强制语言（不能跟着中文跑）', `
    await resetCase();
    f.persona = 'You must Talk to me using English. 你叫 Ariadne，22 岁。';
    const msgs = buildMessages(f, f, null, new Map());
    const sys = msgs[0].content;
    if (!sys.includes('【语言·最高优先级】')) return false;
    if (!sys.includes('English')) return false;
    if (!sys.trim().endsWith('除非主人当场明确改口说要用中文。')) return false;
    const last = msgs[msgs.length - 1];
    return last.role === 'system' && last.content.includes('English') && last.content.includes('不要用中文');
  `);
  await check('只是提到「英文名」不会误加语言规则', `
    await resetCase();
    f.persona = '你叫小满。他的英文名是 Charlton，在英文学术会议上认识的。';
    const sys = buildMessages(f, f, null, new Map())[0].content;
    return !sys.includes('【语言·最高优先级】');
  `);
  await check('签名/朋友圈/日记这些也带上语言要求', `
    await resetCase();
    f.persona = 'You must Talk to me using English.';
    const p = personaLang(f);
    if (!p.includes('【语言】') || !p.includes('English')) return false;
    f.persona = '你叫小满，普通中文人设。';
    return personaLang(f) === f.persona;
  `);
  // 聊到一半改人设：不用清空聊天记录，下一句就得按新设定来。
  // 走的是真 UI（编辑资料 → 保存），断言的是真正发出去的请求体。
  await check('聊到一半改人设：下一句请求里立刻是新人设，并带「设定刚更新过」', `
    await resetCase({ delayOn: false, contextLimit: 200 });
    f.persona = '你叫林小满，22 岁，说话甜甜的，爱撒娇。';
    await send('在吗'); await advance(400); await complete(0, '在呢'); await advance(20000);
    await send('干嘛呢'); await advance(400); await complete(1, '发呆'); await advance(20000);
    if (jobs.length !== 2) return false;
    const oldSys = String(jobs[1].body.messages[0].content);
    if (!oldSys.includes('爱撒娇')) return false;
    if (oldSys.includes('设定刚更新过')) return false;        // 没改过就不该冒出这句
    await advance(60000);                                     // 让旧消息的时间戳真的早于改动时间
    openFriendSheet(f, 'edit');
    $('#fFPersona').value = '你叫林小满，22 岁，说话很冲，爱顶嘴，烦撒娇那一套。';
    $('#btnFSave').click(); await flush();
    if (!String(f.persona).includes('爱顶嘴')) return false;   // 内存里已经是新人设
    if (!(Number(f.personaChangedAt) > 0)) return false;      // 记下了改动时间
    await send('你今天脾气好差');
    await advance(400);
    const body = jobs[jobs.length - 1].body;
    const sys = String(body.messages[0].content);
    if (!sys.includes('爱顶嘴')) return false;                 // 新人设进了系统提示词
    if (sys.includes('爱撒娇')) return false;                  // 旧人设不能还留着
    const last = body.messages[body.messages.length - 1];
    return last.role === 'system' && last.content.includes('设定刚更新过');
  `);
  // 提醒不能一直挂在那里（否则每次请求都多几百字），但人设始终是新的。
  await check('改完聊够之后不再重复提醒，人设仍然是新的', `
    await resetCase({ delayOn: false, contextLimit: 6 });
    f.persona = '你叫林小满，说话甜甜的。';
    await send('在吗'); await advance(400); await complete(0, '在呢'); await advance(20000);
    await advance(60000);
    openFriendSheet(f, 'edit');
    $('#fFPersona').value = '你叫林小满，说话很冲，爱顶嘴。';
    $('#btnFSave').click(); await flush();
    const sysOfLast = () => String(jobs[jobs.length - 1].body.messages[0].content);
    const hasNote = () => jobs[jobs.length - 1].body.messages
      .some(m => String(m.content).includes('设定刚更新过'));
    await send('第一句'); await advance(400);
    if (!hasNote()) return false;                              // 上下文里还有旧消息 → 要提醒
    await complete(jobs.length - 1, '回你第一句'); await advance(20000);
    for (let i = 0; i < 4; i++) {
      await send('第' + i + '句'); await advance(400);
      await complete(jobs.length - 1, '回你第' + i + '句'); await advance(20000);
    }
    if (!sysOfLast().includes('爱顶嘴')) return false;
    return !hasNote();                                         // 窗口里全是新消息 → 不再重复
  `);
  await check('英文关键词也触发照片（中文列表 + selfie）', `
    await resetCase({ imageOn: true, imageBaseUrl: 'https://x.test/v1', imageApiKey: 'sk',
      imageChance: 0, imageTriggers: '自拍' });
    f.messages.push({ id: 'm-en', role: 'user', text: 'Send me a SELFIE please', ts: Date.now() });
    buildMessages(f, f, null, new Map());
    if (f.__photoThisTurn !== true) return false;
    // 普通英文句子不该触发
    await resetCase({ imageOn: true, imageBaseUrl: 'https://x.test/v1', imageApiKey: 'sk',
      imageChance: 0, imageTriggers: '自拍' });
    f.messages.push({ id: 'm-en2', role: 'user', text: 'how are you today', ts: Date.now() });
    buildMessages(f, f, null, new Map());
    return f.__photoThisTurn !== true;
  `);
  await check('自定义英文关键词时不再塞内置词', `
    await resetCase({ imageOn: true, imageBaseUrl: 'https://x.test/v1', imageApiKey: 'sk',
      imageChance: 0, imageTriggers: 'shoot me, 拍我' });
    const cfg = photoCfgFor(f);
    return cfg.triggers.includes('shoot me') && !cfg.triggers.includes('selfie');
  `);
  await check('英文人设的照片提示词不给中文示例（不然她台词也是中文）', `
    await resetCase({ imageOn: true, imageBaseUrl: 'https://x.test/v1', imageApiKey: 'sk',
      imageChance: 100, imageTriggers: '' });
    f.persona = 'You MUST speak ONLY in English.';
    f.messages.push({ id: 'm-ph', role: 'user', text: 'selfie', ts: Date.now() });
    const sys = buildMessages(f, f, null, new Map())[0].content;
    if (!sys.includes('【照片】')) return false;
    return !sys.includes('拍好啦') && sys.includes('English');
  `);
  await check('她只写 [[照片:…]] 不写字：不加开场白，照片照发', `
    await resetCase({ delayOn: false, imageOn: true, imageBaseUrl: ${JSON.stringify(site + '/v1')},
      imageApiKey: 'sk-img', imageChance: 100, imageTriggers: '自拍' });
    const realGen = genImage; const realShrink = shrinkPhoto;
    window.__imgCalls = 0;
    genImage = async () => { __imgCalls += 1; return 'data:image/png;base64,${PNG1}'; };
    shrinkPhoto = async (d) => d;
    try {
      openChat('friend', f.id);
      f.__photoThisTurn = true;
      f.__photoTrigger = '自拍';
      await deliver('friend', f, '[[照片:窗边，白衬衫，傍晚]]', f.id, 3);
      await advance(6000);
      const lead = f.messages.some((m) => /等我一下|稍等|等一下下/.test(m.text || ''));
      const photo = f.messages.some((m) => m.photo);
      const err = f.messages.some((m) => String(m.text || '').includes('没收到可显示的内容'));
      return !lead && photo && !err && __imgCalls === 1;
    } finally { genImage = realGen; shrinkPhoto = realShrink; }
  `);
  await check('她只发 [[表情:…]] 不配字：照发这张表情，不报错', `
    await resetCase();
    openChat('friend', f.id);
    state.stickers = [{ id: 'st-x', url: 'data:image/png;base64,${PNG1}', tags: ['开心'], desc: '', ts: 1 }];
    const p = deliver('friend', f, '[[表情:开心]]', f.id, 3).catch(() => {});
    await advance(3000);
    await p;
    const texts = f.messages.map((m) => String(m.text || ''));
    if (texts.some((t) => t.includes('没收到可显示的内容'))) return false;
    return f.messages.some((m) => m.sticker && m.image);
  `);
  await check('生图接口返回网页时，报错带状态和标题', `
    const res = new Response('<html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    try {
      await readPhotoJson(res);
      return false;
    } catch (e) {
      const m = String((e && e.message) || '');
      return m.includes('不是 JSON') && m.includes('text/html') && m.includes('502 Bad Gateway');
    }
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
