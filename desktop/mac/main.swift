import Cocoa
import WebKit

let DEFAULT_SERVER = "http://127.0.0.1:8777"

final class Navigator: NSObject, WKNavigationDelegate {
    weak var web: WKWebView?
    let logPath = "/tmp/qingliao-mac.log"

    func log(_ text: String) {
        let line = "[\(Date())] \(text)\n"
        if let data = line.data(using: .utf8) {
            if let fh = FileHandle(forWritingAtPath: logPath) {
                fh.seekToEndOfFile(); fh.write(data); fh.closeFile()
            } else {
                try? data.write(to: URL(fileURLWithPath: logPath))
            }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        log("loaded \(webView.url?.absoluteString ?? "")")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        log("fail \(error.localizedDescription)")
        showError(error.localizedDescription)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        log("provisional fail \(error.localizedDescription)")
        showError(error.localizedDescription)
    }

    func showError(_ text: String) {
        let html = "<meta name='viewport' content='width=device-width'><body style='font:15px -apple-system;padding:40px;color:#333'>"
            + "<h3 style='font-weight:600'>加载失败</h3><p style='color:#666'>\(text)</p>"
            + "<p style='color:#999;font-size:13px'>检查服务器地址（菜单「轻聊 → 服务器地址…」），或网络是否可达。想离线用就选菜单「轻聊 → 本机模式」。</p></body>"
        web?.loadHTMLString(html, baseURL: nil)
    }
}

/// 网页里点「保存」→ 写到「下载」文件夹（WKWebView 自己不做下载，必须接这个）
final class SaveFileHandler: NSObject, WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let name = body["name"] as? String,
              let base64 = body["base64"] as? String,
              let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else { return }
        var safe = name.replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if safe.isEmpty { safe = "文件.txt" }
        let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Downloads")
        var url = dir.appendingPathComponent(safe)
        let base = url.deletingPathExtension().lastPathComponent
        let ext = url.pathExtension
        var n = 1
        while FileManager.default.fileExists(atPath: url.path) {
            let nm = ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)"
            url = dir.appendingPathComponent(nm)
            n += 1
        }
        do {
            try data.write(to: url)
            NSWorkspace.shared.activateFileViewerSelecting([url])
        } catch {
            NSSound.beep()
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    let navigator = Navigator()
    let saveFileHandler = SaveFileHandler()
    var localServer: LocalWebServer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let rect = NSRect(x: 0, y: 0, width: 1180, height: 760)
        window = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "轻聊"
        window.minSize = NSSize(width: 900, height: 600)
        window.center()

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.add(saveFileHandler, name: "saveFile")
        webView = WKWebView(frame: rect, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = navigator
        webView.uiDelegate = self
        navigator.web = webView
        window.contentView = webView

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        // 第一次打开先问服务器地址；没配就直接显示一个说明页，
        // 免得对着 127.0.0.1 白屏。
        // 第一次打开：让他选「本机使用（不需要服务器）」还是「连接自己的服务器」。
        // 已经选过/填过地址的，直接按上次的方式来。
        let mode = UserDefaults.standard.string(forKey: "mode") ?? ""
        let saved = UserDefaults.standard.string(forKey: "server") ?? ""
        if mode == "local" {
            startLocal()
        } else if !saved.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            load(saved)
        } else if !DEFAULT_SERVER.contains("127.0.0.1") {
            // 预配置版本：地址写死在包里，直接连
            UserDefaults.standard.set("server", forKey: "mode")
            load(DEFAULT_SERVER)
        } else {
            DispatchQueue.main.async { self.chooseMode() }
        }
    }

    func showWelcome() {
        let html = "<meta name='viewport' content='width=device-width'>"
            + "<body style='font:15px -apple-system;padding:48px;color:#333;line-height:1.7'>"
            + "<h3 style='font-weight:600;margin:0 0 10px'>欢迎用轻聊</h3>"
            + "<p style='color:#666;margin:0 0 18px'>先填一下轻聊服务端的地址（比如 http://你的服务器:8777）。"
            + "单机使用的话，填 https://api.deepseek.com 也能直接开始聊。</p>"
            + "<p style='color:#999;font-size:13px'>以后随时可以在菜单「轻聊 → 服务器地址…」里改。</p></body>"
        webView.loadHTMLString(html, baseURL: nil)
    }

    func serverURL() -> String {
        let saved = UserDefaults.standard.string(forKey: "server") ?? ""
        return saved.isEmpty ? DEFAULT_SERVER : saved
    }

    func load(_ address: String) {
        guard let url = URL(string: address) else { return }
        // 每次启动都绕过本地缓存，避免改完服务器后客户端还跑旧 JS
        var req = URLRequest(url: url)
        req.cachePolicy = .reloadIgnoringLocalCacheData
        webView.load(req)
    }

    @objc func hardReload() {
        guard let url = URL(string: serverURL()) else { return }
        var req = URLRequest(url: url)
        req.cachePolicy = .reloadIgnoringLocalCacheData
        webView.load(req)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    /// 第一次打开的选择：本机使用 or 连服务器
    func chooseMode() {
        let alert = NSAlert()
        alert.messageText = "轻聊"
        alert.informativeText = "怎么用？\n\n"
            + "· 本机使用：不需要服务器，数据只存在这台电脑（第一次在设置里填自己的 API Key）\n"
            + "· 连接服务器：填你自己的服务器地址，手机/电脑多端同步"
        alert.addButton(withTitle: "本机使用")
        alert.addButton(withTitle: "连接服务器…")
        alert.addButton(withTitle: "稍后")

        switch alert.runModal() {
        case .alertFirstButtonReturn:
            UserDefaults.standard.set("local", forKey: "mode")
            startLocal()
        case .alertSecondButtonReturn:
            changeServer()
            if (UserDefaults.standard.string(forKey: "server") ?? "").isEmpty {
                showWelcome()
            }
        default:
            showWelcome()
        }
    }

    /// 本机模式：起一个只监听 127.0.0.1 的小服务，把打包在 App 里的网页发出来
    func startLocal() {
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("www"),
              FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else {
            showWelcome()
            return
        }
        if localServer == nil {
            let server = LocalWebServer(root: root)
            guard server.start() != nil else {
                let alert = NSAlert()
                alert.messageText = "本机模式启动不了"
                alert.informativeText = "本地端口 17877 被占用了（可能已经开着一个轻聊窗口）。先关掉另一个再试。"
                alert.addButton(withTitle: "好")
                alert.runModal()
                showWelcome()
                return
            }
            localServer = server
        }
        guard let port = localServer?.port else { showWelcome(); return }
        var req = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/")!)
        req.cachePolicy = .reloadIgnoringLocalCacheData
        webView.load(req)
    }

    @objc func useLocalMode() {
        UserDefaults.standard.set("local", forKey: "mode")
        startLocal()
    }

    @objc func changeServer() {
        let alert = NSAlert()
        alert.messageText = "服务器地址"
        alert.informativeText = "填轻聊服务端的地址，例如 http://127.0.0.1:8777"
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")

        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        field.stringValue = serverURL()
        alert.accessoryView = field
        alert.window.initialFirstResponder = field

        if alert.runModal() == .alertFirstButtonReturn {
            let value = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty {
                UserDefaults.standard.set(value, forKey: "server")
                UserDefaults.standard.set("server", forKey: "mode")
                load(value)
            }
        }
    }

    @objc func reload() { webView.reload() }

    func buildMenu() {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于 轻聊", action: nil, keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "本机模式（不需要服务器）", action: #selector(useLocalMode), keyEquivalent: "")
        appMenu.addItem(withTitle: "服务器地址…", action: #selector(changeServer), keyEquivalent: ",")
        appMenu.addItem(withTitle: "重新加载首页", action: #selector(hardReload), keyEquivalent: "R")
        appMenu.addItem(withTitle: "刷新", action: #selector(reload), keyEquivalent: "r")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "隐藏 轻聊", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "退出 轻聊", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu

        NSApp.mainMenu = mainMenu
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
delegate.buildMenu()
app.run()
