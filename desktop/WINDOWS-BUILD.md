# 轻聊 · Windows 客户端适配任务书

> 给在 **Windows** 上干活的 agent。
> 一句话：**给现成的网页套一个窗口，打成免安装 exe。不要写任何业务逻辑。**

---

## 0. 先看这段

「轻聊」是自托管的 AI 聊天应用：账号、好友、群聊、朋友圈全在服务器上，前端是一整套 H5 页面（`server.py` + `web/`）。

三端（Windows / macOS / Android）登录同一个账号 = 同一份数据。

你的任务只有一件：**做一个 Windows 窗口壳，让它加载服务器上的网页，并打包成 exe。**

```
仓库：https://github.com/Kesonaspa-T/qingliao
```

**先确认仓库是最新的**：里面应该有 `desktop/mac/main.swift`（macOS 壳的写法，可参考）和 `web/app.js` 顶部写着 `app.js?v=29`。
如果 GitHub 上还是旧版本，先找 Keson 让他 Push 一次（本地有 5 个未推送的提交）。

**服务器地址我不写在文档里**，找 Keson 要，形如 `http://你的地址:8777`。
文档里出现的 `http://YOUR_SERVER:8777` 都是占位符。

---

## 1. 交付物

| 东西 | 说明 |
|---|---|
| `轻聊.exe` | 免安装，双击即用（portable，不是安装包） |
| 源码 | 放在仓库的 `desktop/windows/` 目录下 |
| 一句话验收 | 在哪个 Windows 版本测的、清单里有没有没过的 |

**exe 不要提交进 git**，发版时作为 GitHub Release 的附件上传（见第 10 节）。

---

## 2. 硬性约束（这几条都是真踩过坑总结的）

| 不要做 | 为什么 |
|---|---|
| **不要把 `index.html` / `app.js` / `style.css` 打进 exe** | 前端随时在更新，打包进去就固化了，用户永远看不到新功能。exe 只加载服务器上的页面 |
| **不要注入脚本、不要改 DOM、不要替换资源** | 网页里有一套同步逻辑，改动会引发诡异问题。历史上有人把页面里的某个元素删了，直接导致群聊消息不再刷新 |
| **不要写聊天 / 存储 / 请求拦截逻辑** | 所有业务逻辑都在网页里，exe 只是个浏览器 |
| **不要加代理、抓包、改 UA、加缓存层** | 服务端已经配好 `proxy_buffering off`，中间再套一层会把流式输出打断 |
| **不要试图直连 `api.deepseek.com`** | 模型调用由服务器代理，Key 在服务器上 |
| **不要把真实服务器地址写进 `DEFAULT_SERVER`** | 这个 exe 会公开挂在 Release 上，写死就等于公开你的服务器 IP。让你填地址走配置文件（见 5.3） |
| **不要用 `http://127.0.0.1:8777` 当服务器地址做测试** | 见第 7 节，这个地址在网页里有特殊判断，会走一个不存在的代理接口，结果就是「发消息一直显示正在输入但没回复」 |
| **不要做离线模式 / 本地缓存** | 数据只有服务器一份 |

---

## 3. 网页里已经有的东西（你只需要别碰）

- **布局随窗口宽度自适配**：≥900px 自动变成桌面布局（左侧会话列表 + 右侧聊天）；<900px 是手机布局。**建议默认窗口 1180×760**，和 macOS 端保持一致。
- **首次打开是登录页**；页面上还有一个「服务器地址」输入框，**留空就行**（留空 = 用当前站点，
  因为窗口本来就是从这个地址加载的）。登录后 token 存在 `localStorage`。
- **每 4 秒会自己 `GET /api/rev` 轮询**，这是群聊能实时看到回复的关键。
- **群聊里打 `@` 会弹成员面板**，用 `↑` `↓` 选、`Enter`/`Tab` 确认、`Esc` 取消。
- **群资料里有「消息免打扰」开关**。
- **发消息按 Enter 发送，Shift+Enter 换行**（桌面端）。

---

## 4. 方案 A：Electron（推荐，最省事）

80–100 MB，自带 Chromium，不依赖系统组件。

### 4.1 目录

```
desktop/windows/
├── package.json
├── main.js
└── build/
    └── icon.ico        # 256×256，用仓库里的 web/icon.png 转
```

### 4.2 `package.json`

```json
{
  "name": "qingliao-win",
  "version": "1.4.36",
  "description": "轻聊 Windows 客户端",
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
    "win": { "target": ["portable"], "icon": "build/icon.ico" },
    "portable": { "artifactName": "qingliao-win.exe" }
  }
}
```

> 产物名先用英文，中文文件名在部分环境会出问题。要发给用户时手动改名成 `轻聊.exe`，
> **但上传 GitHub Release 的附件必须叫 `qingliao-win.exe`**（为了直链稳定，见第 10 节）。

### 4.3 `main.js`（完整可用）

```js
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
    server = await askServer('');
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
            const next = await askServer(current);
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
        { role: 'toggleDevTools', label: '开发者工具' },
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
```

### 4.4 图标

用仓库里的 `web/icon.png`（512×512）转 256×256 的 `.ico`：

```powershell
pip install pillow
python -c "from PIL import Image; Image.open('web/icon.png').save('build/icon.ico', sizes=[(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)])"
```

`.ico` 里**必须**含 256×256，否则 Windows 上图标会糊。

### 4.5 构建

```powershell
cd desktop/windows
npm install
npm run dist
```

产物在 `dist/qingliao-win.exe`，约 80–100 MB，正常。

国内下载 Electron 慢就设镜像：

```powershell
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install
```

---

## 5. 方案 B：WebView2 + WinForms（体积 2–5 MB）

不想装 Node 就用这个。依赖系统的 **WebView2 运行时**（Win11 自带；Win10 需要装一次，微软官网有离线包）。

### 5.1 `Qingliao.csproj`

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net8.0-windows</TargetFramework>
    <UseWindowsForms>true</UseWindowsForms>
    <ApplicationIcon>icon.ico</ApplicationIcon>
    <AssemblyName>qingliao</AssemblyName>
    <Nullable>disable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Web.WebView2" Version="1.0.2903.40" />
  </ItemGroup>
</Project>
```

### 5.2 `Program.cs`

```csharp
using System;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

static class Program
{
    static readonly string Dir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Qingliao");
    static readonly string Cfg = Path.Combine(Dir, "config.json");

    static string ReadServer()
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(Cfg));
            if (doc.RootElement.TryGetProperty("server", out var v))
                return (v.GetString() ?? "").Trim().TrimEnd('/');
        }
        catch { }
        return "";
    }

    static void WriteServer(string s)
    {
        Directory.CreateDirectory(Dir);
        File.WriteAllText(Cfg, JsonSerializer.Serialize(new { server = s }));
    }

    [STAThread]
    static void Main()
    {
        using var mutex = new Mutex(true, "qingliao-win-single", out bool first);
        if (!first) return;

        ApplicationConfiguration.Initialize();

        var server = ReadServer();
        if (string.IsNullOrEmpty(server))
        {
            using var dlg = new ServerDialog("");
            if (dlg.ShowDialog() != DialogResult.OK) return;
            server = dlg.ServerUrl;
            WriteServer(server);
        }

        var form = new Form
        {
            Text = "轻聊",
            Width = 1180, Height = 760,
            MinimumSize = new System.Drawing.Size(360, 620),
            BackColor = System.Drawing.Color.FromArgb(0xF2, 0xF3, 0xF5),
        };
        var web = new WebView2 { Dock = DockStyle.Fill };
        form.Controls.Add(web);
        form.Shown += async (_, __) =>
        {
            // userDataFolder 放在 %LOCALAPPDATA%，localStorage 才会持久化（登录状态）
            var udf = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Qingliao", "WebView2");
            Directory.CreateDirectory(udf);
            var env = await CoreWebView2Environment.CreateAsync(null, udf);
            await web.EnsureCoreWebView2Async(env);
            web.CoreWebView2.Settings.AreDevToolsEnabled = true;
            web.CoreWebView2.Settings.IsStatusBarEnabled = false;
            web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            web.CoreWebView2.Navigate(server);
            // 外链交给系统浏览器
            web.CoreWebView2.NewWindowRequested += (_, e) =>
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(e.Uri) { UseShellExecute = true });
                e.Handled = true;
            };
        };
        Application.Run(form);
    }
}
```

`ServerDialog` 就是个小窗体：一个 `TextBox` + 确定/取消，`ServerUrl` 属性返回去掉尾斜杠的地址。几十行，自己写。

### 5.3 发布

```powershell
dotnet publish -c Release -r win-x64 --self-contained false /p:PublishSingleFile=true
```

产物 `bin\Release\net8.0-windows\win-x64\publish\qingliao.exe`，约 1–2 MB（不含 WebView2 运行时）。

> 缺点：目标机器要有 .NET 8 桌面运行时 + WebView2 运行时。要免依赖就加 `--self-contained true`，体积约 60 MB。

---

## 6. 本地测试服务器

你没有现成的服务器也行，自己起一个：

```powershell
git clone https://github.com/Kesonaspa-T/qingliao
cd qingliao
python server.py 8777 --host 127.0.0.1
```

浏览器打开 **`http://localhost:8777`**，注册一个账号即可。

> ### ⚠️ 必须用 `localhost`，不要用 `127.0.0.1`
>
> `web/app.js` 里有一句 `const IS_LOCAL_SERVER = location.hostname === '127.0.0.1';`，
> 是给 Android 本地单机版用的：它会把所有模型请求发到 `/__proxy`。
> 而 Python 服务端没有这个接口 → 表现就是**发消息一直「正在输入」但永远没有回复**。
>
> 所以：`localhost:8777`、`192.168.x.x:8777`、真实域名都可以，**只有 `127.0.0.1` 不行**。

**没有 API Key 时能测什么**：页面加载、登录、注册、切标签、改资料、建群、@ 面板、消息免打扰、关掉再开是否还是登录状态。
**不能测**：AI 回复（服务端要调模型，没 Key 就不生成）。

---

## 7. 验收清单

### A. 不需要 API Key 就能测

- [ ] 双击 exe → 窗口打开，标题「轻聊」，任务栏有图标
- [ ] 首次启动弹「服务器地址」输入框，填完能进（填错地址要有报错，不能白屏卡死）
- [ ] 页面加载出来显示**登录页**（不是聊天界面）
- [ ] 注册一个账号 → 进入应用
- [ ] 底部标签齐全：消息 / 通讯录 / 朋友圈 / 我的
- [ ] **关掉 exe 再打开 → 还是登录状态**（最容易翻车的一条）
- [ ] 窗口拉宽到 >900px 变成桌面布局（左边列表右边聊天），拉窄回来变手机布局
- [ ] 群聊里输入 `@` → 弹出成员面板；`↓` 选、`Enter` 确认 → 输入框里出现「@名字 」且**没有把消息发出去**
- [ ] 群资料里能开「消息免打扰」，会话列表出现小铃铛、没有红点
- [ ] 中文输入法（微软拼音）能正常打字，**拼音候选没上屏时按 Enter 不会把消息发出去**
- [ ] 菜单「轻聊 → 服务器地址…」能改地址并立刻生效

### B. 需要 API Key 才能测（找 Keson 要）

- [ ] 「我的 → 设置」填 Base URL `https://api.deepseek.com` + Key + 模型 `deepseek-flash`，点「测试连接」→ 显示「连通了 ✓」
- [ ] 发一条文字 → 几秒后逐字出现回复（有「对方正在输入…」）
- [ ] 发一张图片 → 有回复
- [ ] 群里 @ 某人 → **被 @ 的人第一个回话**

### C. 回归项（今天刚修的 bug，别弄回去）

- [ ] 按 `F12` 打开开发者工具 → Network 过滤 `api/rev` → **每 4 秒左右一条**
      （这是群聊能实时刷新的关键；如果一条都没有，说明页面被套了什么东西拦住了）
- [ ] 群里别人说话，**不重启 exe 也能在 30 秒内看到**
- [ ] 两台设备（Windows + 手机）改同一个好友的开关，能互相同步

---

## 8. 排错

| 现象 | 先看哪里 |
|---|---|
| 白屏 | 地址对不对；`curl.exe http://你的地址:8777/api/authinfo` 通不通 |
| 一直「正在输入」但没回复 | **十有八九是服务器地址写成了 `127.0.0.1`**，见第 6 节 |
| 每次打开都要重新登录 | 用了临时 session（Electron 的 `partition`，或 WebView2 的 userDataFolder 每次换目录） |
| 回复一次性蹦出来、没有逐字 | 中间加了缓冲代理。Electron / WebView2 本身不会缓冲 |
| 页面显示旧版本 | DevTools → Network 看 `app.js?v=` 是多少，应该是 `v=29` |
| `npm run dist` 卡在下载 | 设 `ELECTRON_MIRROR` |
| exe 被 SmartScreen 拦 | 没有代码签名，正常。让用户点「更多信息 → 仍要运行」，或在 README 里写清楚 |
| 图标不显示 | `.ico` 里必须含 256×256 |

---

## 9. 发版（发给我之后我来做也行）

1. 源码提交到 `desktop/windows/`（**不要提交 `node_modules/`、`dist/`、exe**）。
   记得在 `.gitignore` 里补一条：`/desktop/windows/dist/`
2. 把 `dist/qingliao-win.exe` 改名成 **`qingliao-win.exe`**（固定名字，别带版本号）。
3. 在仓库的 Release 页面上传这个附件（和 Android 的 `qingliao.apk` 放同一个 Release）。

这样下面这个链接就永远是"最新版 Windows 客户端"：

```
https://github.com/Kesonaspa-T/qingliao/releases/latest/download/qingliao-win.exe
```

---

## 10. 验收时直接照抄的一段话

> 在 Windows 11（版本 xxxx）测试：
> 窗口正常、登录页正常、关掉再开保持登录、Network 里能看到每 4 秒一次的 `api/rev`、
> 群聊 @ 面板可用、消息免打扰开关可用。
> 未通过：xxx（没有就说"全部通过"）。
