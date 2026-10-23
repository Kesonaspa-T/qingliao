# 轻聊 · Qingliao

一个自托管的 AI 聊天应用：像 QQ / 微信一样的界面，对面是一个有人设、会主动说话的 AI 朋友。

不是「问答框」，是「她」。

![聊天](preview-chat.png)

## 它是什么

- **有人设的朋友**：名字、头像、性格、说话方式都由你写，她按这个跟你聊
- **朋友圈**：她会自己发动态、点赞、评论；你也可以发，她会来互动
- **群聊**：多个人设在一个群里，会互相接话，`@` 谁谁先说
- **主动找你**：你半天没回，她会再发一条；每天早晚各一句问候
- **长期记忆**：每聊 30 条自动压缩成一段摘要，三个月后她还记得你讨厌香菜
- **多端同步**：服务器存数据，手机 / Mac / 浏览器登录同一账号，4 秒内同步

全部基于 DeepSeek（`deepseek-flash`，1M 上下文），也兼容任何 OpenAI 格式的接口。

## 截图

| 消息 | 朋友圈 | 群聊 |
|---|---|---|
| ![](preview-chat.png) | ![](preview-moments.png) | ![](preview-group.png) |

## 架构

```
浏览器 / Android / macOS
        │  HTTP (JSON + SSE)
        ▼
   nginx  ──►  server.py (Python 标准库，无依赖)
                   ├── 静态页面      web/
                   ├── 账号与会话    data/users.json
                   ├── 每人一份状态  data/users/<id>.json
                   └── 后台调度线程  朋友圈 / 互动 / 主动消息 / 记忆
```

**零第三方依赖**，只要有 `python3` 就能跑。

## 快速开始

```bash
python3 server.py 8777
# 打开 http://127.0.0.1:8777
# 第一次进：注册账号 → 我的 → 设置 → 填 API Key
```

想改数据目录：

```bash
QINGLIAO_DATA=/var/lib/qingliao python3 server.py 8777 --host 0.0.0.0
```

## 部署到服务器

```bash
tar xzf qingliao-server.tar.gz -C /opt/qingliao --strip-components=1
sudo bash /opt/qingliao/deploy/install.sh
```

装完是 systemd 服务，开机自启。默认监听 `127.0.0.1:8777`，用 nginx 反代出去时**务必关掉缓冲**：

```nginx
location / {
    proxy_pass http://127.0.0.1:8777;
    proxy_http_version 1.1;
    proxy_buffering off;      # 流式回复必须
    proxy_read_timeout 300s;
}
```

## 客户端

| 平台 | 说明 |
|---|---|
| 浏览器 | 直接打开地址，宽度 ≥900px 自动切成桌面布局 |
| Android | `android/build.sh` 打包 WebView 壳，见目录内说明 |
| macOS | `desktop/mac/main.swift`，SWift + WKWebView |

## 安全须知

这是一个**单人自用**的项目，别直接开给公网陌生人：

- 服务本身没有限流、没有验证码，登录密码只做了 PBKDF2 加盐
- API Key 保存在服务端状态文件里，请确保 `data/` 目录权限为 `700`
- 建议只在内网 / Tailscale 里访问，或把安全组限制到自己的 IP
- 公网 + 备案域名请自行加上 HTTPS

## 目录

```
server.py             服务端全部逻辑
social_server.py      只跑朋友圈调度、不开网页
web/                  前端（原生 JS，无框架）
android/              Android WebView 壳与打包脚本
desktop/              macOS / Windows 客户端
deploy/               systemd 单元与安装脚本
```

## License

MIT
