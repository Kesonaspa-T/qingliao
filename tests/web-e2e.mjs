// 网站端到端测试（本地起一个 server.py + mock 模型，用 headless Chrome 跑）
//
// 准备：
//   1) mock 模型：python3 mockllm.py  (127.0.0.1:8797，返回固定文本/文件块，见 README)
//   2) 站点：QINGLIAO_DATA=/tmp/ql-e2e python3 server.py 8798 --host 127.0.0.1
//   3) headless Chrome：--remote-debugging-port=9338
//   4) node tests/web-e2e.mjs
//
// 覆盖：登录态 / 新建朋友 / 设置保存 / 发消息收回复 / 文件卡片 / 链接正文进提示词 /
//       提示词关闭即保存 / 小作文开关 / 清空聊天 / 服务器落盘 / 刷新后仍在
// 依赖 /tmp/mockllm.log（mock 把请求体追加进去，用来断言提示词里有链接正文）。
import { readFileSync, existsSync } from 'node:fs';
const SITE='http://127.0.0.1:8798', CDP=9338;
async function api(path, data, token) {
  const r = await fetch(SITE+path, { method: data?'POST':'GET', headers: Object.assign({'Content-Type':'application/json'}, token?{Authorization:'Bearer '+token}:{}), body: data?JSON.stringify(data):undefined });
  return { status: r.status, body: await r.json().catch(()=>({})) };
}
const reg = await api('/api/register', { name: '网站测试'+Date.now()%1000, password: '123456' });
const TOKEN = reg.body.token;
console.log('register:', reg.status, !!TOKEN);

const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const page = list.find(t=>t.type==='page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id=0; const waiters=new Map();
ws.addEventListener('message', ev=>{const m=JSON.parse(ev.data); if(m.id&&waiters.has(m.id)){waiters.get(m.id)(m);waiters.delete(m.id);}});
await new Promise(r=>ws.addEventListener('open',r));
const send=(m,p={})=>new Promise(res=>{const i=++id;waiters.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true}); if(r.result?.exceptionDetails) return {__exc:JSON.stringify(r.result.exceptionDetails).slice(0,300)}; return r.result?.result?.value;};
const waitFor=async (expr,ms=10000)=>{const t0=Date.now(); while(Date.now()-t0<ms){const v=await ev(expr); if(v) return v; await sleep(300);} return null;};
const results=[]; const ok=(n,c,x)=>results.push((c?'PASS ':'FAIL ')+n+(c?'':' :: '+String(x).slice(0,220)));

await send('Network.enable'); await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Page.navigate',{url:SITE+'/'}); await sleep(1500);
await ev(`localStorage.setItem('ql.token', ${JSON.stringify(TOKEN)}); location.reload();`); await sleep(2600);
ok('打开首页 + 登录态', (await ev(`!!state.me && document.getElementById('login').hidden`))===true);

const created = await ev(`(() => {
  openFriendSheet(null,'new');
  document.getElementById('fFName').value='小满';
  document.getElementById('fFPersona').value='一个普通女生，话不多。';
  document.getElementById('btnFSave').click();
  const f = state.friends[state.friends.length-1];
  window.__fid = f.id;
  openChat('friend', f.id);
  return JSON.stringify({n: state.friends.length, id: f.id, name: f.name});
})()`);
console.log('created:', created);
ok('新建朋友并进聊天', (await ev(`state.friends.length===2 && (state.conv||{}).id===window.__fid`))===true);

await ev(`(() => {
  openSheet();
  document.getElementById('fBase').value='http://127.0.0.1:8797/v1';
  document.getElementById('fKey').value='sk-test';
  document.getElementById('fModel').value='mock';
  document.getElementById('fDelayOn').checked=false;
  document.getElementById('btnSheetSave').click();
  state.settings.typingFx=false;
  return 'saved';
})()`);
ok('设置保存', (await ev(`state.settings.baseUrl==='http://127.0.0.1:8797/v1' && state.settings.delayOn===false`))===true);

await ev(`(() => { openChat('friend', window.__fid); inputEl.value='你好'; inputEl.dispatchEvent(new Event('input',{bubbles:true})); sendBtn.click(); return 'sent'; })()`);
const reply = await waitFor(`(() => { const f=friendById(window.__fid); return f.messages.some(m=>m.text && m.text.includes('收到啦')); })()`, 12000);
ok('发消息收到回复', !!reply, await ev(`JSON.stringify(friendById(window.__fid).messages.map(m=>m.role+':'+(m.text||'').slice(0,20)))`));

await ev(`(() => { inputEl.value='帮我写个 python 脚本'; inputEl.dispatchEvent(new Event('input',{bubbles:true})); sendBtn.click(); return 'sent'; })()`);
const fileMsg = await waitFor(`(() => { const f=friendById(window.__fid); return f.messages.some(m=>m.file && m.file.name==='hello.py'); })()`, 12000);
const cards = await waitFor(`document.querySelectorAll('.file-card').length`, 8000);
ok('生成文件卡片', !!fileMsg && cards>=1, JSON.stringify({fileMsg, cards}));

await ev(`(() => { inputEl.value='看看 https://example.com/ 讲了啥'; inputEl.dispatchEvent(new Event('input',{bubbles:true})); sendBtn.click(); return 'sent'; })()`);
await waitFor(`(() => { const f=friendById(window.__fid); return f.messages.filter(m=>m.text && m.text.includes('收到啦')).length>=2; })()`, 15000);
await sleep(1200);
const logText = existsSync('/tmp/mockllm.log') ? readFileSync('/tmp/mockllm.log','utf-8') : '';
ok('链接正文进了提示词', logText.includes('Example Domain') && logText.includes('他发来的链接'), logText.slice(-200));

await ev(`(() => { openPromptSheet(); document.getElementById('prChat').value='一条只说一句'; document.getElementById('btnPrClose').click(); return 'x'; })()`);
ok('提示词关闭即保存', (await ev(`state.settings.prompts.chat==='一条只说一句'`))===true);

await ev(`(() => { openFriendSheet(friendById(window.__fid),'edit'); const b=document.getElementById('rEssay'); if(!b) return 'no'; b.checked=true; document.getElementById('btnFSave').click(); return 'ok'; })()`);
ok('小作文开关保存', (await ev(`!!(friendById(window.__fid).settings||{}).essay`))===true);

await ev(`(() => { window.confirm=()=>true; openFriendSheet(friendById(window.__fid),'edit'); document.getElementById('btnFClearChat').click(); return 'cleared'; })()`);
ok('清空聊天记录', (await ev(`friendById(window.__fid).messages.length===0`))===true);

await sleep(1800);
const st = await api('/api/state', null, TOKEN);
const fid = await ev(`window.__fid`);
const rf = (st.body.friends||[]).find(f=>f.id===fid) || {};
ok('服务器落盘（朋友/小作文/提示词/清空）',
  rf.name==='小满' && (rf.settings||{}).essay===true
  && ((st.body.settings||{}).prompts||{}).chat==='一条只说一句'
  && (rf.messages||[]).length===0,
  JSON.stringify({name:rf.name, essay:(rf.settings||{}).essay, prompts:(st.body.settings||{}).prompts, msgs:(rf.messages||[]).length}));

await ev(`location.reload()`); await sleep(2600);
ok('刷新后数据还在', (await ev(`(() => { const f=state.friends.find(x=>x.name==='小满'); return !!f && !!(f.settings||{}).essay && f.messages.length===0; })()`))===true);

console.log(results.join('\n'));
console.log('FAILS:', results.filter(r=>r.startsWith('FAIL')).length);
ws.close(); process.exit(0);
