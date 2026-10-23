# 轻聊 Windows 客户端 · 打包任务书

> 给 Windows 上的 agent：把现成的网页套成桌面应用。**不要写业务逻辑**。

## 一、这是什么

「轻聊」是自托管的 AI 聊天应用：账号、朋友、群聊、朋友圈全部在服务器上，前端是一套完整的 H5 页面。

服务端已经跑起来了：

```
http://YOUR_SERVER:8777
```

- nginx 监听 8777，反代到 127.0.0.1:8778 上的 Python
- 支持流式输出（SSE），登录用 token（存在 localStorage）
- 三端（Windows / macOS / Android）登录同一个账号 = 同一份数据

你的任务：**给这个网页做个 Windows 窗口，打成 exe。**

## 二、硬性约束

| 不要做 | 为什么 |
|---|---|
| 不要把 `index.html` / `app.js` / `style.css` 打进 exe | 前端随时在更新，打包进去就固化了，用户永远看不到新功能 |
| 不要写任何聊天、存储、请求拦截逻辑 | exe 只是个浏览器，所有逻辑在网页里 |
| 不要试图直连 `api.deepseek.com` | 模型调用由服务器代理，Key 在服务器上；客户端直连必挂（真踩过这个坑） |
| 不要做离线模式、本地缓存 | 数据只有服务器一份，缓存会打架 |
| 不要加代理/抓包/改 UA | 没必要，还会引发各种诡异问题 |

**一句话：exe = 一个带图标、没有地址栏的浏览器窗口，指向那个 URL。**

## 三、交付物

1. `轻聊.exe`（免安装，双击即用）
2. 源码目录（`main.js` / `package.json` / `build/icon.ico`）
3. `README.txt`：怎么改服务器地址、装在哪

## 四、方案 A：Electron（推荐）

### 4.1 目录

```
qingliao-win/
├── main.js
├── package.json
└── build/
    └── icon.ico        # 256×256，用附带的 icon.png 转
```

### 4.2 `package.json`

```json
{
  "name": "qingliao",
  "version": "1.2.0",
  "description": "轻聊",
  "author": "Keson",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "dist": "electron-builder --win portable"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0"
  },
  "build": {
    "appId": "com.qingliao.app",
    "productName": "轻聊",
    "files": ["main.js", "build/icon.ico"],
    "win": {
      "target": ["portable"],
      "icon": "build/icon.ico"
    },
    "portable": {
      "artifactName": "qingliao.exe"
    }
  }
}
```

> 产物名故意用英文，中文文件名在部分环境下会出问题，打完手动改成 `轻聊.exe`。

### 4.3 `main.js`

```js
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULT_SERVER = 'http://YOUR_SERVER:8777';

// 配置：%APPDATA%/轻聊/config.json
const CONFIG = path.join(app.getPath('userData'), 'config.json');

function readServer() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    if (raw && typeof raw.server === 'string' && raw.server.trim()) return raw.server.trim();
  } catch (_) {}
  return DEFAULT_SERVER;
}

function writeServer(server) {
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify({ server }, null, 2), 'utf8');
}

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 430,
    height: 880,
    minWidth: 360,
    minHeight: 620,
    title: '轻聊',
    backgroundColor: '#f2f3f5',
    webPreferences: {
      // 关键：用默认 session，cookie / localStorage 才会落到 userData
      // 千万不要写 partition: 'temp'，否则每次打开都要重新登录
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  const server = readServer();
  win.loadURL(server);

  // 外链一律用系统浏览器，不在应用里弹新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 页面内跳转到别处（比如点了外链）也交给系统浏览器
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(server)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  win.on('closed', () => { win = null; });
}

function buildMenu() {
  const template = [
    {
      label: '轻聊',
      submenu: [
        {
          label: '服务器地址…',
          click: () => {
            // 不弹输入框：直接用记事本打开配置，改完 Ctrl+R
            shell.openPath(CONFIG);
          }
        },
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '拷贝' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: '开发者工具' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    if (!fs.existsSync(CONFIG)) writeServer(DEFAULT_SERVER);
    buildMenu();
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
```

### 4.4 图标

用附带的 `icon.png`（512×512，蓝底气泡）转 256×256 的 `.ico`：

```powershell
# 有 ImageMagick
magick icon.png -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico
```

没有就用 Pillow：

```powershell
pip install pillow
python -c "from PIL import Image; Image.open('icon.png').save('build/icon.ico', sizes=[(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)])"
```

### 4.5 构建

```powershell
npm install
npm run dist
```

产物 `dist/qingliao.exe`，约 80–100 MB（Electron 就这样，正常）。

国内下载慢就设镜像：

```powershell
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install
```

## 五、方案 B：pywebview（体积 15 MB）

不想装 Node 的话：

```python
# app.py
import json, os, pathlib
import webview

DEFAULT = 'http://YOUR_SERVER:8777'
CONFIG = pathlib.Path(os.getenv('APPDATA')) / 'Qingliao' / 'config.json'

def server():
    try:
        return json.loads(CONFIG.read_text('utf-8')).get('server') or DEFAULT
    except Exception:
        return DEFAULT

if __name__ == '__main__':
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    if not CONFIG.exists():
        CONFIG.write_text(json.dumps({'server': DEFAULT}), 'utf-8')
    webview.create_window('轻聊', server(), width=430, height=880, min_size=(360, 620))
    webview.start()
```

```powershell
pip install pywebview pyinstaller
pyinstaller --onefile --noconsole --name 轻聊 app.py
```

依赖系统 **WebView2 运行时**（Win11 自带；Win10 需要装一次，微软官网有离线包）。

> pywebview 的 session 目录由它自己管理，一般没问题，但验收时同样要测「关掉再开还是登录状态」。

## 六、验收清单

在 Windows 10 或 11 上逐条过，**每条都要真点一遍**：

- [ ] 双击 exe → 430×880 窗口，标题「轻聊」，有图标
- [ ] 页面加载出来，**显示登录页**（不是聊天界面）
- [ ] 点「注册新账号」，填名字 + 密码（≥6 位）→ 进入应用
- [ ] 能看到底部四个标签：消息 / 通讯录 / 朋友圈 / 我的
- [ ] 「我的 → 设置」填 Base URL `https://api.deepseek.com` + API Key + 模型 `deepseek-flash`，点「测试连接」显示「连通了 ✓」
- [ ] 发一条文字消息，**几秒后收到回复**（会先显示「对方正在输入…」）
- [ ] 发一张图片（点输入框右边的图片按钮），**能收到回复**
- [ ] **关掉 exe 再打开 → 还是登录状态，消息都在**（最容易翻车的一条）
- [ ] 菜单「轻聊 → 服务器地址…」能打开配置文件，改完 `Ctrl+R` 生效
- [ ] 窗口拉大拉小，布局正常
- [ ] 中文输入法能正常打字
- [ ] 朋友圈页面能看到内容（如果服务器上有）

## 七、排错

| 现象 | 先看哪里 |
|---|---|
| 白屏 | 地址对不对；`curl.exe http://YOUR_SERVER:8777/api/authinfo` 能不能通 |
| 一直显示「对方正在输入」但没回复 | **打开开发者工具（Ctrl+Shift+I）看 Network 里有没有 `POST /api/chat`**；没有就是客户端没发出去，有就看响应 |
| 每次打开都要重新登录 | `webPreferences` 里加了 `partition: 'temp'`，或者清了 userData |
| 回复一次性蹦出来，没有逐字效果 | 中间加了缓冲代理；Electron 本身不会缓冲，别自己加 |
| 图片发不出去 | 请求体约 150 KB，检查有没有加 body 大小限制 |
| `npm run dist` 卡在下载 | 设 `ELECTRON_MIRROR` |
| 图标不显示 | `.ico` 里必须含 256×256，路径必须是 `build/icon.ico` |

## 八、几个真踩过的坑（别重复）

**1. 不要把模型请求写到客户端。**  
Android 版一开始让 App 自己直连 `api.deepseek.com`，结果发图片时请求卡死、服务器完全不知情、也查不到日志。Windows 版千万别这么干——页面自己会 `POST /api/chat`，你只要保证窗口能加载页面。

**2. 流式输出不能有缓冲层。**  
服务端已经配好了 nginx `proxy_buffering off`。客户端这边不要再套任何代理。

**3. 登录状态靠 session 持久化。**  
Electron 默认把 localStorage/cookie 存在 `%APPDATA%/轻聊/`。只要不用临时 session，重启就是登录状态。

**4. 不要用 `file://` 加载页面。**  
必须 `loadURL('http://...')`，因为要登录、要跨请求带 token。

## 九、交付

打包完给我：

1. `轻聊.exe`
2. 源码 zip
3. 一句话：在哪个 Windows 版本测的，验收清单里有没有没过的

---

**附：先确认网络**

```powershell
curl.exe http://YOUR_SERVER:8777/api/authinfo
```

期望：

```json
{"needLogin": true, "users": 1}
```

`needLogin: true` 表示服务器已经有人注册过，打开就是登录页；`users: 0` 则是全新服务器，第一次要先注册。连这个都返回不了，先别打包，是网络/安全组问题。
