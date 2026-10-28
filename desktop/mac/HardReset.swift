import Cocoa
import WebKit

/// 菜单「清空本地数据并重新登录」：把 WKWebView 的网站数据（localStorage / IndexedDB / cookie / 缓存）
/// 清干净，并回到登录页。修「换了服务器还显示旧数据 / 一直退登 / 登录了却没有记录」这类
/// 本地脏数据问题。
enum HardReset {
    static func run(webView: WKWebView?, after: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = "清空本地数据并重新登录？"
        alert.informativeText = "会清掉这台 Mac 上缓存的网页数据（聊天记录的本地副本、登录状态、缓存），"
            + "服务器上的数据不受影响。清完后需要重新输服务器地址和账号。"
        alert.addButton(withTitle: "清空并重新登录")
        alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        let store = WKWebsiteDataStore.default()
        let types = WKWebsiteDataStore.allWebsiteDataTypes()
        let group = DispatchGroup()
        group.enter()
        store.removeData(ofTypes: types, modifiedSince: Date(timeIntervalSince1970: 0)) {
            group.leave()
        }
        // 顺便把 App 自己记的地址/模式也清掉，避免下次又连回旧地址
        UserDefaults.standard.removeObject(forKey: "server")
        UserDefaults.standard.removeObject(forKey: "mode")
        UserDefaults.standard.removeObject(forKey: "lastServer")

        group.notify(queue: .main) {
            webView?.configuration.websiteDataStore.httpCookieStore.getAllCookies { _ in }
            after()
        }
    }
}
