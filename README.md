# remote-devtools

通用的 **远程调试（Remote DevTools）** 服务：把「目标页面（被调试端）」的 DevTools 协议消息通过 WebSocket 转发到「调试端（浏览器里的 DevTools UI）」，从而实现跨设备/跨网络调试。

---

## 功能

- 在本机或服务器上启动 Remote DevTools Server（支持 HTTP / HTTPS）
- 提供一个首页（`/`）展示当前可调试的目标列表，并生成可复制的注入脚本/配置
- 目标页面注入 `ws-backend.js` 后会主动连接服务端并注册为一个 **Backend Target**
- 通过 `chii` 前端打开 DevTools UI，并将其 WebSocket 连接到指定 Backend Target
- 服务端在两端之间做 **消息转发与通道多路复用**（支持多目标）

---

## 使用场景

- **手机/平板 WebView / H5 页面调试**：设备上无法直接打开 DevTools 时，通过注入脚本让页面连回电脑上的调试服务器。
- **远程环境调试**：例如内网机器、测试机、容器内服务渲染出来的页面，需要在本机浏览器里进行 DevTools 级别的调试。
- **HTTPS 页面调试**：当目标页面为 HTTPS 时，浏览器会阻止 `ws://`，需要用 `wss://`（本项目提供 `--https` 一键方案）。
- **多目标并行**：同一个服务同时接入多个页面实例，首页可选择目标打开 DevTools。

---

## Features

### 1) CLI & 运行体验

- **命令行启动**：`remote-devtools` / `rdt`
- **Node 版本检查**：要求 `node >= 12`
- **端口自动选择**：未指定端口时，从 `8899` 起自动找可用端口
- **自动打开首页**：启动后自动在浏览器打开首页地址
- **多网卡地址展示**：监听 `0.0.0.0` 时会打印所有 IPv4 可访问地址

### 2) 页面注入（被调试端 backend）

- **零侵入注入**：在目标页面引入服务端提供的 `ws-backend.js` 即可：
  - `http(s)://<server-host>:<port>/ws-backend.js`
- **自动生成/缓存 sessionId**：默认用 `sessionStorage` 缓存同一页面会话
- **自动推导服务端地址**：
  - 优先使用全局配置变量：`window.__remote_devtools_ws_query__`
  - 否则从 `<script src="...">` 的 URL 推导
- **HTTPS/WSS 兼容**：如果目标页面是 `https:`，backend 会强制使用 `wss:` 连接（避免 Mixed Content 被浏览器拦截）
- **连接诊断**：backend 内置较详细的日志、网络信息收集与常见问题提示（如 HTTPS/WS 不匹配、localhost 不可达、代理干扰等）
- **自动重连**：断线指数退避重连（最多 10 次）
- **CDP 消息通道**：将 `chobitsu` 产生的 DevTools 协议消息走“通道消息”发送到服务端

### 3) 调试前端（chii）

- **内置 DevTools UI**：通过 `/chii/chii_app.html` 打开类似 Chrome DevTools 的界面
- **连接稳定性增强**：项目对 `chii` 的 `Connections.js` 做了替换（`server/rewrite/sdk/Connections.js`）：
  - 当 WebSocket 断开时，会周期性请求 `/alive/:backendId` 探测目标是否仍在线
  - 目标恢复在线后自动刷新 UI（使 DevTools 更容易“自动恢复”）

### 4) 服务端协议与通道

- **HTTP/HTTPS 静态资源服务**：首页、`ws-backend.js`、chii 前端资源、静态文件等
- **WebSocket 升级路由**（角色化）：
  - `/backend/:sessionId?...`：目标页面（backend）连接入口
  - `/frontend/:frontendId/:backendId`：调试前端连接入口（与某个 backend 绑定）
  - `/home/:homeSessionId`：首页用于实时接收 backend 上下线事件
  - `/chii/:frontendId/:backendId`：chii 作为 frontend 的一种角色（内部走同一逻辑）
- **多路复用与转发**：
  - 使用 `@channelName\npayload` 作为通道消息封装格式
  - `ChannelMultiplex` 维护 backend / frontend 映射，并在 frontend 连接时把其“桥接”到对应 backend

### 5) HTTPS 场景支持（含原理说明）

当目标页面是 HTTPS：
- 浏览器安全策略会 **禁止 HTTPS 页面连接不安全的 WebSocket**（`ws://`），必须使用 `wss://`
- 所以服务端也必须启用 HTTPS，才能同时提供 `wss://`（WebSocket over TLS）

本项目的实现策略：
- CLI 传 `--https` 后，服务端会以 HTTPS 模式启动（Node.js `https.createServer`），并接受 WSS 升级
- 证书来源按优先级自动处理（见 `server/getCertificate.js`）：
  1. **自定义证书**：通过 `--cert <pem>` 与 `--key <pem>` 指定；服务端会校验证书有效期、域名覆盖、私钥匹配（尽力校验，必要时降级为警告继续）
  2. **mkcert 证书**：本机安装了 `mkcert` 时自动生成受信任证书（更适合本机/局域网开发调试）
  > 注意：如果未安装 mkcert 需要自行安装
  3. **自签名证书**：兜底生成自签名证书（浏览器会有安全警告）
- backend 脚本会根据目标页面的 `location.protocol` 自动选择 `ws:` 或 `wss:`，从而避免 Mixed Content。
---

## 项目架构与目录

### 总体流程（从目标页面到 DevTools）

1. 启动服务：提供首页与 WebSocket 服务
2. 目标页面注入 `ws-backend.js`：
   - 连接到：`/backend/:sessionId`
   - 注册页面信息（title/url/favicon）
   - 将 `chobitsu` 的 CDP 消息转发到服务端
3. 在首页选择目标并打开 DevTools（chii）：
   - chii 连接到：`/frontend/chii/:backendId`（或同等前端路径）
4. 服务端将 frontend 与 backend 通过 `Channel` 桥接，完成双向消息转发

### 目录结构

```
.
├── bin/
│   └── remote-devtools.js          # CLI 入口（参数解析、启动 Server）
├── server/
│   ├── Server.js                   # HTTP/HTTPS Server + middleware + WebSocket upgrade
│   ├── constants.js                # 常量（backend 路径、chii 前端路径等）
│   ├── getCertificate.js           # HTTPS 证书生成/选择逻辑（custom → mkcert → selfsigned）
│   ├── utils.js                    # logger、文件流发送、backend URL 生成等
│   ├── middle/                     # HTTP 中间件
│   │   ├── home.js                 # 首页与配置注入（/ 与 /getHomeConfigOnly）
│   │   ├── magicBackend.js         # /ws-backend.js → dist/backend.js 映射
│   │   ├── chii.js                 # /chii/* 静态资源服务 + rewrite 覆盖
│   │   ├── alive.js                # /alive/:backendId 探针接口
│   │   └── static.js               # 通用静态文件服务
│   ├── lib/                        # WebSocket 相关核心
│   │   ├── WebSocketServer.js      # WS upgrade 分发（backend/frontend/home/chii）
│   │   ├── ChannelMultiplex.js     # backend/frontend 映射与事件分发
│   │   ├── Channel.js              # 单通道封装与桥接转发
│   │   └── Manager.js              # home websocket：把 backend 上下线推给首页
│   └── rewrite/
│       └── sdk/Connections.js      # 覆盖 chii 的连接实现（alive 探针 + 自动刷新）
├── public/
│   └── home.html                   # 首页 UI（复制注入脚本、展示 targets、打开 chii）
├── backend.js                      # 被注入脚本源码（webpack 打包进 dist/backend.js）
├── scripts/build.js                # 构建 dist/（webpack backend + copy public）
├── webpack.config.js               # backend.js 的 webpack 配置
├── package.json
└── package-lock.json
```

---

## 使用方法（Usage）

### 启动服务

```bash
# 默认：监听 0.0.0.0，端口从 8899 起自动找可用端口
npm start

# 指定端口与地址
npm start -- --port 8899 --address 0.0.0.0

# 启用 HTTPS（推荐用于 HTTPS 页面调试）
npm start -- --https

# 指定自定义证书（PEM）
npm start -- --https --cert ./server.pem --key ./server-key.pem
```

启动后终端会输出：
- 可访问的首页地址（HTTP/HTTPS）
- 可注入的 backend 地址：`/ws-backend.js`

### 在目标页面注入（被调试端）

打开首页（`/`）会看到两段可复制内容：

- 推荐：先加全局配置（避免 backend 解析脚本 URL 失败）

```html
<script>
  window.__remote_devtools_ws_query__ = 'http(s)://<wsHost>:<wsPort>?ws=1&wsHost=<wsHost>&wsPort=<wsPort>';
</script>
```

- 然后引入 backend：

```html
<script src="http(s)://<server-host>:<port>/ws-backend.js"></script>
```

刷新目标页面后，它会出现在首页的 targets 列表中。

### 打开 DevTools

点击【Chrome Devtools】按钮即可开始调试

---

## 开发与调试（Dev & Debug）

### 本地开发

```bash
npm i
npm run build
npm start
```
