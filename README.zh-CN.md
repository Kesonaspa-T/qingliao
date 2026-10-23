# 轻聊 · Qingliao

[English](README.md) | **中文**

一个自托管的 AI 聊天应用：像 QQ / 微信一样的界面，对面是一个有人设、会主动说话的 AI 朋友。

不是「问答框」，是「她」。

## 自述
大约几天前，我开始尝试研究 QQ Bot 的接入。和大肥鱼聊天是一件很快乐的事情！

作为学生，我没有太多时间折腾，所以只选用了最简单的 AstrBot + NapCat。但腾讯的风控极其强力，基本上每次都是秒封。对我一个学生来说，这太恐怖了。我只是想把自己的 OC 放上去，模拟和真人聊天啊。

何不曲线救国呢？对我这么一个不拉群、也不想和群友聊天的社恐来说，我只是想用一个比较真实的界面和 AI 聊天，而 Chatbox、SillyTavern 这些现有软件，长得并不像我们的微信、QQ、WhatsApp——

于是，在花了 73 轮、746 步、250M tokens 之后，我隆重推出——

**轻聊 Qingliao**

一个半自动的、模拟真实社交软件的类 QQ 之物。

它不是 QQ 客户端，也不接入腾讯的服务；我做这玩意只是用来放 OC、跑角色对话，单纯满足一下自己内心的小世界其实是“活生生的”的需求。全自动的意思是：如果有一个24小时的服务器，或类服务器，那你创建的智能体就能全天候自动给你早晚安、发朋友圈、互相聊天。这很酷。

具体功能与使用方式见下文。

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
