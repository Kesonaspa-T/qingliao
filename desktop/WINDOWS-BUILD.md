# 轻聊 · Windows 客户端适配任务书

> 给在 **Windows** 上干活的 agent。
> 一句话：**给现成的网页套一个窗口，打成免安装 exe。不要写任何业务逻辑。**
>
> 任务书更新：2026-11-10 · 对应 Android / macOS `1.5.10`（页面 `app.js?v=118`、`style.css?v=36`、服务端 build `v55`）

---

## 0. 先看这段

「轻聊」是自托管的 AI 聊天应用：账号、好友、群聊、朋友圈全在服务器上，前端是一整套 H5 页面（`server.py` + `web/`）。

三端（Windows / macOS / Android）登录同一个账号 = 同一份数据。

你的任务只有一件：**做一个 Windows 窗口壳，让它加载服务器上的网页，并打包成 exe。**

```
仓库：https://github.com/Kesonaspa-T/qingliao
```

**目标版本：和 Android / macOS 对齐，都做 `1.5.10`。**

先确认仓库是最新的，三个自检点：

1. `web/index.html` 里写着 `app.js?v=118`、`style.css?v=36`
2. `server.py` 里写着 `"build": "v55"`（1.5.6 起服务端要能存文件，老服务端收不了 blob）
3. 皮肤是 **9 套**：`web/index.html` 里 `data-skin=` 出现 9 次，`web/style.css` 里 `data-skin="` 出现 16 次（8 套 × 浅色/深色 + 默认）

如果 GitHub 上还是旧的，先找 Keson Push 一次（他本地攒了 118 个提交）。
**你的 exe 只加载服务器上的页面，所以 exe 本身不用跟着每次前端更新重打包**，
但首次交付先按最新版做，验收也按下面第 7 节的新清单过一遍。

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
- **发消息按 Enter 发送，Shift+Enter 换行**（桌面端）。设置 → 输入里可以关掉「回车直接发送」，
  关掉之后回车只换行、点「发送」才发；中文输入法**拼音没上屏时按回车不会把消息发出去**（1.5.3 / 1.5.5 / 1.5.7 修的就是这个）。
- **9 套皮肤**（1.5.1 起）：默认 / 樱花 / 抹茶 / 海盐 / 米纸 / 紫藤 / 蜜桃 / 青瓷 / 月白，
  纯 CSS 变量，**每套都有浅色 + 深色两份**；选中的存在账号 `settings.skin` 里，换设备跟着走。
  选项在 `web/index.html`、配色在 `web/style.css`，**两边都得是新的**，只换一边会出现「能选但没反应」。
- **她发来的照片会按聊的内容换机位**（1.5.2 起）：说了伤 / 部位 / 特写，拍的就是那个东西的近距离，
  **不再是站着或坐着的全身自拍**；明确要自拍才是自拍；参考图只用来定长相，姿势机位不照抄。
- **大图能保存**（1.5.3 起）：点开她的照片，右下角有「保存图片」，长按消息的菜单里也有；
  电脑上走浏览器 / Electron 下载，**壳不要拦 `will-download`**。
- **输入框右边多了文件按钮**（1.5.6 / 1.5.8）：PDF / docx / xlsx / pptx / csv / txt / 代码都能发，
  网页在本地把文字抽出来再交给模型，服务端只负责存 blob（要 build v55）。
- **她会记得自己发出去的图**（1.5.4）、**答应要写就真的写文件**（1.5.9）、
  **不把「（你发给他一个文件：…）」这种系统标注抄进聊天**（1.5.10）。
- **点聊天里对方的头像 → 弹出个人资料页**（微信那种版式：大头像 / 轻聊号 / 地区 / 个性签名 /
  发消息 / 她的朋友圈）；备注名会覆盖显示名。
- **她偶尔会"画图"**：消息里会带一张 SVG 简笔画，页面自己渲染成图片。
  这是一个 `<img src="data:image/svg+xml,...">`，**不要拦 data: 协议**。
- **好友资料里还有**：她会画图开关、下一条主动消息发什么（一次性的）、会主动找我、每天早晚问候、
  静默多久找你、朋友圈频率。
- **设置里有**：让她看图、她会画简笔画、联网搜索、记忆条数、思考模式等。

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
  "version": "1.5.10",
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

## 6.5 这一版（1.4.45 → 1.5.10）页面新增了什么

你拿到的是最新前端，验收时请**多验这几条**，它们都是这轮才有的：

| 功能 | 怎么验 |
|---|---|
| **4 套新皮肤（1.5.1）** | 设置 → 皮肤：从 5 套变 **9 套**（多出 紫藤 / 蜜桃 / 青瓷 / 月白）。切完立刻变；把主题切「深色」再逐个切一遍，**没有一套掉回默认蓝**（掉了就是 `style.css` 还是旧的）；换一台设备登录同一个账号，皮肤跟着走 |
| **照片按聊的内容换机位（1.5.2 / 1.5.3）** | 说「我脚扭了，给我看看」→ 拍的是**脚 / 脚踝的近照**，不是站着或坐着的全身自拍；明确说「发张自拍」→ 还是自拍；连发两三张 → 机位不要完全是同一个角度（要配好生图中转 + 参考图） |
| **存图（1.5.3）** | 让她发一张照片 → 点开大图 → 右下角「保存图片」→ 「下载」文件夹里能找到，而且是**大图**不是缩略图；长按消息的菜单里也有「保存图片」 |
| **回车直接发送（1.5.3 / 1.5.7）** | 设置 → 输入 → 「回车直接发送」电脑默认开；打一句话按回车 → 直接发出去；关掉后回车只换行、点「发送」才发；Shift+回车始终换行 |
| **输入法上屏不误发（1.5.3 / 1.5.5 / 1.5.7）** | 切到中文输入法打几个英文字母，按回车 → 字母**原样上屏、不发**；再按一次回车 → **这次要真的发出去** |
| **输入诊断（1.5.7）** | 设置 → 输入 → 「输入诊断」→ 能看到最近几次回车事件 |
| **通知（1.5.4）** | 让她发一条消息，然后切到别的窗口 → 弹系统通知；点通知能回到 App（Windows 上就是回到窗口） |
| **她记得自己发的图（1.5.4 / 1.5.5）** | 让她发张照片，下一轮问「你刚才发的是什么」→ 她能说出图里真实的画面，而不是她原来编的场景 |
| **发文件（1.5.6 / 1.5.8）** | 点输入框右边的文件按钮，发一个 PDF / docx / xlsx / pptx / csv → 出文件卡片；问她「这个文件里写了什么」→ 她说到**具体内容**；点「保存」能存回原文件 |
| **答应要写就真写（1.5.9）** | 让她写一份周报 → 出文件卡片；如果她只回「我慢慢写」→ 几秒后应该**自动补一条带文件卡片的回复** |
| **系统标注不漏进聊天（1.5.10）** | 发完文件接着聊，历史里不该出现「（你发给他一个文件：x.xlsx）」这种括号标注 |
| **个人资料页** | 聊天里点对方头像 → 弹出资料页；改备注名 / 地区 / 个性签名 → 保存 → 列表和聊天标题都跟着变 |
| **她的朋友圈筛选** | 资料页点「她的朋友圈」→ 朋友圈只剩她发的，顶部有「显示全部」 |
| **画图** | 对她说「你画一张试试」→ 她在气泡里发一张简笔画（`<img class="doodle">`） |
| **画图开关** | 设置 →「她会画简笔画」；好友资料 →「她会画图」（单个关掉只影响这个人） |
| **下一条主动消息** | 好友资料最下面那个输入框，填点离谱的（"发一篇抒情长文"）→ 等她主动找你时应该照这个写 |
| **朋友圈配图** | 自己发一条带图的朋友圈 → 她评论时会提到图里的内容（要 API Key） |
| **朋友圈多图** | 发 2~9 张图 → 九宫格里排布，点开能看大图 |
| **表情包** | 设置 →「表情包」导入 gif/图片 → 她会偶尔发；照片能预览、能看描述 |
| **表情包动图** | 导入 gif 后她发出来，**必须是会动的**（不是静止第一帧） |
| **图片按需加载** | 聊天里老图片是 `/api/blob/xxx?t=<token>` 这种地址，**不能拦**；加载慢是正常的（走了网络） |
| **个性签名** | 聊天标题下面、空闲时会显示她的签名（不是「在线」） |

如果这几条哪条不对，先记下 `app.js?v=` 的版本号，再报给我——很可能是仓库没更新到最新。

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
- [ ] **聊天里点对方头像 → 弹出个人资料页**（大头像 / 轻聊号 / 地区 / 个性签名 / 发消息 / 她的朋友圈）
- [ ] 资料页改备注名 → 保存 → 会话列表、聊天标题都显示备注名
- [ ] 资料页点「她的朋友圈」→ 只剩她发的，点「显示全部」恢复
- [ ] 好友资料里能看到「她会画图」开关和「下一条主动消息发什么」输入框
- [ ] 聊天标题下面显示她的个性签名（空闲时），打字时变回「对方正在输入…」
- [ ] 设置 →「表情包」能导入图片，列表里有缩略图和描述（没有 API Key 时只有「表情」两个字）
- [ ] 设置里能看到「发消息带表情包的概率（%）」，0~100 可调
- [ ] 朋友圈发 2~9 张图 → 九宫格显示

**1.5.x 新增，不需要 Key 也能验：**

- [ ] 设置 → 皮肤：**9 套都能切**，切完立刻变；关掉 exe 再开还是那套
- [ ] 主题切「深色」后，9 套各切一遍，**没有一套掉回默认蓝**
- [ ] 设置 → 输入 → 「回车直接发送」开着时按回车**直接发出去**；关掉后回车只换行；Shift+回车始终换行
- [ ] 中文输入法打英文，按回车是**上屏不发送**；再按一次回车才发
- [ ] 设置 → 输入 → 「输入诊断」能看到最近几次回车事件
- [ ] 大图右下角「保存图片」能存进「下载」；长按消息的菜单里也有；存下来的是大图
- [ ] 输入框右边的**文件按钮**能打开文件选择框（选个 PDF / txt）→ 出文件卡片
- [ ] 群头像：建一个 2~4 人的群 → 会话列表 / 通讯录里是**成员头像拼图**，不是「群」字
- [ ] 引用：自己气泡里的引用是**白字**，对方白气泡里是深灰字
- [ ] 聊天背景：从相册选一张几 MB 的大图 → 聊天里立刻能看到；关掉聊天再打开还在；「清除背景」能清掉
- [ ] 红包：输入框右边信封按钮 → 选金额 + 附言 → 发出去是**红色红包气泡**

### B. 需要 API Key 才能测（找 Keson 要）

- [ ] 「我的 → 设置」填 Base URL `https://api.deepseek.com` + Key + 模型 `deepseek-flash`，点「测试连接」→ 显示「连通了 ✓」
- [ ] 发一条文字 → 几秒后逐字出现回复（有「对方正在输入…」）
- [ ] 发一张图片 → 有回复
- [ ] 群里 @ 某人 → **被 @ 的人第一个回话**
- [ ] 对她说「你画一张试试」→ 气泡里出现一张简笔画图（不是一堆 `<svg ...>` 源码）
- [ ] 好友资料里填「下一条主动消息发什么」→ 保存 → 等她主动找你（或把「静默多久主动找你」调小）→ 内容按你填的来
- [ ] 自己发一条带图的朋友圈 → 她评论时能说到图里的东西
- [ ] 设置里导入一个 **gif** 表情包 → 过一会儿对她说「发个表情看看」→ 她发出来的图**是会动的**
- [ ] 她发完表情包，历史里不会出现「（你刚发了一个表情包：…）」这种括号文字（那是内部标注，被抄出来就是 bug）
- [ ] 聊天里老图片能显示出来（地址形如 `/api/blob/xxxx?t=...`）

**1.5.x 新增，要 Key（还要配好生图中转 / 参考图）：**

- [ ] 让她发张照片 → 下一轮问「你刚才发的是什么」→ 说得出图里真实画面（1.5.4）
- [ ] 说「我脚扭了，给我看看」→ 脚 / 脚踝的**近照**，不是全身自拍（1.5.2）
- [ ] 明确说「发张自拍」→ 仍然是自拍；连发两三张 → 机位不要完全一样（参考图只定长相）
- [ ] 发一个 PDF / docx，问她「这个文件里写了什么」→ 说到**具体内容**（1.5.8）
- [ ] 让她写一份周报：她只回「我慢慢写」时，几秒后**自动补一条带文件卡片的回复**（1.5.9）
- [ ] 发完文件接着聊，历史里不出现「（你发给他一个文件：…）」这种标注（1.5.10）

### C. 回归项（今天刚修的 bug，别弄回去）

- [ ] 按 `F12` 打开开发者工具 → Network 过滤 `api/rev` → **每 4 秒左右一条**
      （这是群聊能实时刷新的关键；如果一条都没有，说明页面被套了什么东西拦住了）
- [ ] 群里别人说话，**不重启 exe 也能在 30 秒内看到**
- [ ] 两台设备（Windows + 手机）改同一个好友的开关，能互相同步
- [ ] **画出来的图在重启 exe 之后还在**（它是消息文本的一部分，不该丢）
- [ ] 图显示不出来时，F12 看 Console 有没有 `Refused to load the image` 之类
      —— 说明壳子拦了 `data:` 协议，这必须放开

---

## 8. 排错

| 现象 | 先看哪里 |
|---|---|
| 白屏 | 地址对不对；`curl.exe http://你的地址:8777/api/authinfo` 通不通 |
| 一直「正在输入」但没回复 | **十有八九是服务器地址写成了 `127.0.0.1`**，见第 6 节（1.5.x 只在「页面和服务器同一个源」时才走 `/__proxy`，但真实服务器还是别填 127.0.0.1） |
| 每次打开都要重新登录 | 用了临时 session（Electron 的 `partition`，或 WebView2 的 userDataFolder 每次换目录） |
| 回复一次性蹦出来、没有逐字 | 中间加了缓冲代理。Electron / WebView2 本身不会缓冲 |
| 页面显示旧版本 | DevTools → Network 看 `app.js?v=` 是多少，应该是 `v=118`、`style.css?v=36` |
| 皮肤能选、选了没反应 | `style.css` 还是旧的（皮肤配色在 CSS 里）。`index.html` 和 `style.css` **必须一起换** |
| 按回车没反应 / 输入法把字吃了 | 1.5.4 / 1.5.6 的旧页面会这样；确认 `app.js?v=118`。设置 → 输入 → 输入诊断能看到回车事件 |
| 「保存图片」/ 文件卡片「保存」点了没反应 | 壳拦了下载。`main.js` 里不要有 `will-download` 拦截、不要禁 `session` 下载；本壳目前**没有**任何下载拦截（已核） |
| 通知不弹 | Windows 10/11 的 toast 需要 AppUserModelID；portable 版没有开始菜单快捷方式时可能不弹。见第 11 节 |
| `npm run dist` 卡在下载 | 设 `ELECTRON_MIRROR` |
| exe 被 SmartScreen 拦 | 没有代码签名，正常。让用户点「更多信息 → 仍要运行」，或在 README 里写清楚 |
| 图标不显示 | `.ico` 里必须含 256×256 |

---

## 9. 发版（发给我之后我来做也行）

1. 源码提交到 `desktop/windows/`（**不要提交 `node_modules/`、`dist/`、exe**）。
   `.gitignore` 里挡的是 `/desktop/windows/dist/` 和 `/desktop/windows/release/`；
   **`/desktop/windows/build/` 不要再挡**——`build/icon.ico` 是要提交的（`package.json` 的 `win.icon` 指着它）。
2. 把 `dist/qingliao-win.exe` 改名成 **`qingliao-win.exe`**（固定名字，别带版本号）。
3. 在仓库的 Release 页面上传这个附件（和 Android 的 `qingliao.apk` 放同一个 Release）。

这样下面这个链接就永远是"最新版 Windows 客户端"：

```
https://github.com/Kesonaspa-T/qingliao/releases/latest/download/qingliao-win.exe
```

---

## 10. 验收时直接照抄的一段话

> 在 Windows 11（版本 xxxx）测试，exe 版本 1.5.10（对应页面 `app.js?v=118`、`style.css?v=36`、服务端 build `v55`）：
> 窗口正常、首次启动问服务器地址、登录页正常、关掉再开保持登录；
> Network 里每 4 秒一次 `api/rev`；群聊 @ 面板、消息免打扰可用；
> 设置里 9 套皮肤都能切，深色主题下也不会掉回默认蓝；
> 回车直接发送、中文输入法上屏不误发、输入诊断都正常；大图能存进「下载」；
> 点聊天头像能开个人资料页，备注名会同步到列表；
> 说「画一张试试」能在气泡里看到简笔画（不是 `<svg>` 源码）；
> 发文件能出文件卡片，她读到的是文件里的真实内容；
> 未通过：xxx（没有就说"全部通过"）。

---

## 11. 本轮（1.5 → 1.5.10）同步记录

> 2026-11-24 · Windows 侧同步 + 回归。**壳的代码一行没改**，所以 `qingliao-win.exe` 不需要重新发
> （页面重开就是新版）；这次动的只有 `package.json` 的版本号、这份文档、`desktop/windows/验收报告.md`。

### 11.1 测在哪台机器上

| 项目 | 值 |
|---|---|
| 系统 | Windows 11 25H2 · build 26200.9711（中文） |
| 壳 | `desktop/windows` 源码（main.js / icon / pack），`package.json` **1.5.10** |
| 内核 | Electron 44.0.0 / Chromium 152（和 1.4.45 那份 exe 同一个运行时） |
| 服务端 | 仓库里的 `server.py` **build v55**，本机 `127.0.0.1:8798`，`QINGLIAO_DATA` 指到临时目录（没碰真实数据） |
| 模型 | `tests/mock-model.py`（假模型：固定回复 + 一个文件块，够验页面链路） |

### 11.2 自检（第 0 节 + `WINDOWS-TASK-1.5.10.md` 第 1 节的全部 grep）

**28 / 28 通过**：`app.js?v=118`、`style.css?v=36`、`server.py` build `v55`、
`data-skin=` 9 次、`style.css` 的 `data-skin="` 16 次，以及 `teal` / `photoShotKind` /
`cancelPendingEnter` / `enterSendOn` / `qingliaoInputDiag` / `QingliaoSave` / `lightboxSave` /
`QingliaoNotify` / `describeOwnPhoto` / `attachHerPhoto` / `这一张不是自拍` / `photoCfgFor` /
`image/edit` / `moneyText` / `languageRuleFor` / `group-avatar` / `extractDocText` / `pdfToText` /
`docxToText` / `xlsxToText` / `pptxToText` / `maybeWritePromisedFile` / `你发给他一个文件` /
`save_blob` / 文件按钮，全部达标。

### 11.3 自动化回归

| 套件 | 结果 |
|---|---|
| `tests/reply-regression.mjs`（headless Chrome 跑网页逻辑） | **72 / 72**：9 套皮肤、照片机位、回车/输入法、存图、通知桥、文件抽文字、答应就写、系统标注清理、群头像、红包、聊天背景、语言规则都在里面 |
| `tests/test-new-features.py` | 43 / 43 |
| `tests/test-moment-schedule.py` | 8 / 8 |
| `tests/test-reply-fallback.py` | 7 / 7 |
| `tests/test-image-gen.py` | 25 / 25 |
| `tests/web-e2e.mjs` | 11 / 12 —— 「链接正文进提示词」没过：本机 DNS 把公网域名解析到保留地址，服务端按 SSRF 规则拒绝抓取（**设计如此**），这台机器上验不了 |
| `tests/web-e2e-new.mjs` | **33 / 33** —— 第一遍「手写的记忆进了提示词」没过，是 `tests/mock-model.py` 在 Windows 上按 GBK 写日志、测试按 UTF-8 读的误报；把 mock 改成显式 UTF-8 后重跑全过 |

### 11.4 壳自检（把真在跑的 portable exe 挂上 CDP 逐条点）

- [x] 加载的是**服务器地址**（`http://127.0.0.1:8798/`），不是本地文件；窗口标题「轻聊」
- [x] `app.js?v=118`、`style.css?v=36` 确实是服务器上那份
- [x] 未登录显示登录页，登录页有「服务器地址」输入框（留空 = 当前站点）
- [x] 写入 token 后进入应用；刷新、关掉再开**都还是登录态**（默认 session，没写 partition）
- [x] 1180 宽是桌面布局；<900px 自动切手机布局
- [x] 每 4 秒一次 `GET /api/rev`（10 秒 3 次，间隔 4.0s 左右）
- [x] 设置里 **9 套皮肤**都在；切「青瓷」`--me` 立刻变 `#2b8f8c`；深色主题下不掉回默认蓝
- [x] `Notification.permission === 'granted'`，`new Notification()` 不抛异常
- [ ] **「存到下载文件夹」没验成**：`downloadWillBegin` 正常触发、`suggestedFilename` 也对
      （说明壳**没有**拦 `will-download`），但 Chromium 停在 `state=canceled / receivedBytes=0`。
      这台机器的会话沙箱不让 Chromium 往工作区外写盘（同一环境里它连 `%APPDATA%` 的 singleton 锁都建不了：
      `Lock file can not be created: 拒绝访问`），**不是 exe 的代码问题**。真实桌面双击 exe 点一次「保存图片」即可确认。

### 11.5 结论 / 还需要在真机上点的

- 能自动验的都过了（网页 100+ 条断言、服务端 83 条、壳 20/21；唯一的例外是本机网络导致的「链接抓取」那一项）。
- **没验成的三件**：①「下载落盘」那一环（环境写盘限制，见上）；② 需要 API Key 的对话 / 生图 / 文件问答；
  ③ Windows 通知**实际弹没弹**（API 可用，但 toast 需要 AppUserModelID，portable 版没有开始菜单快捷方式时可能不弹）。
- 清单 A 组里纯 GUI 的（首次启动弹地址框、填错地址的报错、任务栏图标）也得人点。