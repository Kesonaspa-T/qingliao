const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// ⚠️ 必须是占位符。真实地址在首次启动时由用户填，存到 config.json。
const DEFAULT_SERVER = 'http://127.0.0.1:8777';

const CONFIG = path.join(app.getPath('userData'), 'config.json');
let win = null;

function readServer() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    if (raw && typeof raw.server === 'string' && raw.server.trim()) return raw.server.trim().replace(/\/+$/, '');
  } catch (_) {}
  return '';
}

function writeServer(server) {
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify({ server }, null, 2), 'utf8');
}

/** 用户可能只打了 1.2.3.4:8777，补一个 http://；别的一律原样。 */
function normalizeServer(value) {
  const s = String(value || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  return 'http://' + s;
}

/** 首次启动 / 改了地址后，弹一个小窗口让用户填服务器地址。 */
function askServer(initial) {
  return new Promise((resolve) => {
    const input = JSON.stringify(initial || '').replace(/"/g, '&quot;');
    const html = `<!doctype html><meta charset="utf-8">
      <body style="font:14px 'Microsoft YaHei',sans-serif;padding:18px;margin:0">
        <div style="margin-bottom:10px;color:#333">填你服务器的地址（例如 http://1.2.3.4:8777）</div>
        <input id="v" autofocus value="${input.replace(/&quot;/g, '')}"
          style="width:100%;padding:9px;border:1px solid #ccc;border-radius:8px;font-size:14px;box-sizing:border-box">
        <div style="margin-top:16px;text-align:right">
          <button id="ok" style="padding:7px 20px;border:0;border-radius:8px;background:#12b7f5;color:#fff;font-size:14px;cursor:pointer">确定</button>
        </div>
        <script>
          const { ipcRenderer } = require('electron');
          const v = document.getElementById('v');
          const ok = () => ipcRenderer.send('qingliao-server', v.value.trim());
          document.getElementById('ok').onclick = ok;
          v.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
          v.select();
        </script>
      </body>`;
    const p = new BrowserWindow({
      width: 470, height: 230, resizable: false, minimizable: false, maximizable: false,
      title: '轻聊 · 服务器地址', parent: win || undefined, modal: !!win,
      webPreferences: { nodeIntegration: true, contextIsolation: false },
    });
    p.setMenuBarVisibility(false);
    p.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    let done = false;
    ipcMain.once('qingliao-server', (_e, value) => { done = true; p.destroy(); resolve(value || ''); });
    p.on('closed', () => { if (!done) resolve(''); });
  });
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 760, minWidth: 360, minHeight: 620,
    title: '轻聊',
    backgroundColor: '#f2f3f5',
    autoHideMenuBar: false,
    webPreferences: {
      // 关键：用默认 session，localStorage 才会落到 userData，
      // 关掉再打开才是登录状态。千万不要写 partition。
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // 聊天应用：窗口最小化时也别把定时器降频，否则同步会拖慢
      backgroundThrottling: false,
    },
  });

  let server = readServer();
  if (!server) {
    server = normalizeServer(await askServer(''));
    if (!server) { app.quit(); return; }
    writeServer(server);
  }

  // 前端会带 ?v=NN，理论上不会吃旧缓存；这里再兜一层，保证改完服务器能立刻生效
  try { await win.webContents.session.clearCache(); } catch (_) {}
  win.loadURL(server);

  // 外链一律交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(server)) { e.preventDefault(); shell.openExternal(url); }
  });

  win.on('closed', () => { win = null; });
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '轻聊',
      submenu: [
        {
          label: '服务器地址…',
          click: async () => {
            const current = readServer();
            const next = normalizeServer(await askServer(current));
            if (next && next !== current) {
              writeServer(next);
              win && win.loadURL(next);
            }
          },
        },
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', click: () => win && win.reload() },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' }, { role: 'copy', label: '拷贝' },
        { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        // 验收清单 C 要求「按 F12 打开开发者工具」，role 的默认快捷键在 Windows 上是 Ctrl+Shift+I
        { role: 'toggleDevTools', label: '开发者工具', accelerator: 'F12' },
      ],
    },
  ]));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => { buildMenu(); createWindow(); });
  app.on('window-all-closed', () => app.quit());
}
