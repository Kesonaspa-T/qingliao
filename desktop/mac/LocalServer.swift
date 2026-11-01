import Foundation

/// 纯本地模式用的极简 HTTP 服务：
/// - 把打包在 App 里的 www/ 发给 WKWebView（http://127.0.0.1:PORT，localStorage 正常）
/// - /__proxy 转发模型请求（URLSession），绕开 file:// 的跨域限制
final class LocalWebServer {
    let root: URL
    private(set) var port: UInt16 = 0
    private var listenFD: Int32 = -1
    private let acceptQueue = DispatchQueue(label: "qingliao.localweb.accept")

    init(root: URL) { self.root = root }

    @discardableResult
    func start(preferred: UInt16 = 17877) -> UInt16? {
        var p = preferred
        for _ in 0..<1 {
            let fd = socket(AF_INET, SOCK_STREAM, 0)
            if fd < 0 { continue }
            var yes: Int32 = 1
            setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
            var addr = sockaddr_in()
            addr.sin_family = sa_family_t(AF_INET)
            addr.sin_port = p.bigEndian
            addr.sin_addr.s_addr = inet_addr("127.0.0.1")
            let bound = withUnsafePointer(to: &addr) { ptr in
                ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
                }
            }
            if bound && listen(fd, 64) == 0 {
                listenFD = fd
                port = p
                acceptQueue.async { [weak self] in self?.acceptLoop() }
                return p
            }
            close(fd)
            p += 1
        }
        return nil
    }

    private func acceptLoop() {
        while listenFD >= 0 {
            var ca = sockaddr()
            var len = socklen_t(MemoryLayout<sockaddr>.size)
            let c = accept(listenFD, &ca, &len)
            if c < 0 { usleep(20000); continue }
            Thread.detachNewThread { [weak self] in self?.serve(c) }
        }
    }

    private func serve(_ c: Int32) {
        defer { close(c) }
        var data = Data()
        var buf = [UInt8](repeating: 0, count: 16384)
        while data.count < 262144 {
            let n = read(c, &buf, buf.count)
            if n <= 0 { return }
            data.append(contentsOf: buf[0..<n])
            guard let headRange = data.range(of: Data("\r\n\r\n".utf8)) else { continue }
            let head = String(data: data.subdata(in: 0..<headRange.lowerBound), encoding: .utf8) ?? ""
            let contentLen = headerValue(head, "content-length").flatMap { Int($0) } ?? 0
            var body = data.subdata(in: headRange.upperBound..<data.count)
            while body.count < contentLen {
                let m = read(c, &buf, buf.count)
                if m <= 0 { break }
                body.append(contentsOf: buf[0..<m])
            }
            handle(c, head: head, body: body)
            return
        }
    }

    private func headerValue(_ head: String, _ key: String) -> String? {
        for line in head.split(separator: "\r\n") {
            if let i = line.firstIndex(of: ":") {
                let k = line[..<i].trimmingCharacters(in: .whitespaces).lowercased()
                if k == key { return String(line[line.index(after: i)...]).trimmingCharacters(in: .whitespaces) }
            }
        }
        return nil
    }

    private func handle(_ c: Int32, head: String, body: Data) {
        let lines = head.split(separator: "\r\n").map(String.init)
        guard let first = lines.first else { return }
        let parts = first.split(separator: " ")
        guard parts.count >= 2 else { return }
        let path = String(parts[1]).split(separator: "?").first.map(String.init) ?? "/"
        if path == "/__proxy" { proxy(c, head: head, body: body); return }
        if path == "/" || path == "/boot.html" {
            // 本机模式第一次打开：没有服务器账号就直接进单机模式，不用填地址
            let html = "<!doctype html><meta charset='utf-8'><script>"
                + "try{if(!localStorage.getItem('ql.token'))localStorage.setItem('ql.local','1');}catch(e){}"
                + "location.replace('/index.html');</script>"
            respond(c, 200, "text/html; charset=utf-8", Data(html.utf8))
            return
        }
        let rel = path == "/" ? "index.html" : String(path.dropFirst())
        let file = root.appendingPathComponent(rel).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path),
              let fh = try? FileHandle(forReadingFrom: file),
              let data = try? fh.readToEnd() else {
            respond(c, 404, "text/plain; charset=utf-8", Data("not found".utf8))
            return
        }
        respond(c, 200, mime(file.pathExtension), data)
    }

    private func proxy(_ c: Int32, head: String, body: Data) {
        guard let target = headerValue(head, "x-target-url"), let url = URL(string: target) else {
            respond(c, 400, "application/json", Data("{\"error\":\"missing X-Target-Url\"}".utf8))
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = (headerValue(head, "x-method") ?? "POST").uppercased()
        // 生图一张要几分钟：同步那套 120 秒会把慢中转的图直接掐掉（现在给到 10 分钟）
        req.timeoutInterval = 600
        if let key = headerValue(head, "x-target-key"), !key.isEmpty {
            req.setValue("Bearer " + key, forHTTPHeaderField: "Authorization")
        } else if let auth = headerValue(head, "authorization") {
            req.setValue(auth, forHTTPHeaderField: "Authorization")
        }
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !body.isEmpty { req.httpBody = body }

        let sem = DispatchSemaphore(value: 0)
        var status = 502
        var out = Data("{\"error\":\"upstream failed\"}".utf8)
        var ctype = "application/json"
        URLSession.shared.dataTask(with: req) { d, r, _ in
            if let http = r as? HTTPURLResponse {
                status = http.statusCode
                if let ct = http.value(forHTTPHeaderField: "Content-Type") { ctype = ct }
            }
            if let d = d { out = d }
            sem.signal()
        }.resume()
        if sem.wait(timeout: .now() + 600) == .timedOut { status = 504 }
        respond(c, status, ctype, out)
    }

    private func respond(_ c: Int32, _ status: Int, _ type: String, _ body: Data) {
        let head = "HTTP/1.1 \(status) \(statusText(status))\r\n"
            + "Content-Type: \(type)\r\n"
            + "Content-Length: \(body.count)\r\n"
            + "Cache-Control: no-store\r\n"
            + "Connection: close\r\n\r\n"
        var packet = Data(head.utf8)
        packet.append(body)
        packet.withUnsafeBytes { ptr in
            var sent = 0
            while sent < ptr.count {
                let n = write(c, ptr.baseAddress!.advanced(by: sent), ptr.count - sent)
                if n <= 0 { break }
                sent += n
            }
        }
    }

    private func statusText(_ s: Int) -> String {
        switch s {
        case 200: return "OK"
        case 400: return "Bad Request"
        case 403: return "Forbidden"
        case 404: return "Not Found"
        case 504: return "Gateway Timeout"
        default: return "OK"
        }
    }

    private func mime(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "svg": return "image/svg+xml"
        case "webmanifest": return "application/manifest+json"
        case "ico": return "image/x-icon"
        default: return "application/octet-stream"
        }
    }
}
