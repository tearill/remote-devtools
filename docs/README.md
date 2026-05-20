# Remote DevTools 使用说明
> 版本：1.0.5 ｜ 最后更新：2026-04-30

---
## 一、项目简介
### 解决什么问题？
在移动端 H5、WebView、远程服务器或内网环境中，开发者**无法直接打开 Chrome DevTools** 进行调试。

传统调试方案的痛点：
1. **真机调试方式不统一**：Android 用 `chrome://inspect`，iOS 用 Safari，流程割裂
2. **依赖客户端开启调试开关**：线上包、Release 包无法调试
3. **HTTPS 页面限制**：浏览器禁止 HTTPS 页面建立 `ws://` 连接
4. **需要 USB 连线或额外工具**：无法远程/跨网络调试

### Remote DevTools 的解决方式
| 痛点 | 解决方式 |
|------|---------|
| 手机无法打开 DevTools | 目标页面注入一行脚本，通过 WebSocket 将调试协议转发到电脑端 |
| HTTPS 页面禁止 ws:// | 内置 HTTPS/WSS 支持，一键启用，自动处理证书 |
| 需要安装额外调试工具 | 桌面端应用开箱即用，内置 Whistle 代理自动注入调试脚本 |
| 多设备/多页面并行调试 | 服务端支持多 Target 同时接入，首页实时展示可调试列表 |

### 核心架构
```
┌─────────────────┐     WebSocket      ┌──────────────────┐     WebSocket      ┌─────────────────┐
│   目标页面        │  ───────────────▶  │  Remote DevTools  │  ◀───────────────  │   DevTools UI   │
│  (手机/WebView)   │   /backend/:id    │     Server        │   /frontend/:id   │  (电脑浏览器)    │
│  注入 backend.js  │                   │  消息转发 & 多路复用 │                   │  chii DevTools  │
└─────────────────┘                    └──────────────────┘                    └─────────────────┘
```

---
## 二、功能特性
### 核心功能
- **远程调试**：在电脑上打开完整的 Chrome DevTools 界面（基于 chii），调试任意设备上的页面
- **多目标支持**：多个页面可同时接入，首页实时展示所有可调试目标
- **HTTPS/WSS**：支持 HTTPS 页面调试，避免 Mixed Content 拦截
- **自动重连**：目标页面断线后自动重连（指数退避，最多 10 次）
- **连接诊断**：内置网络诊断、代理检测、常见问题提示

### 桌面端增强
- **可视化设置界面**：端口、HTTPS、证书配置一目了然
- **mkcert 集成**：自动检测并引导安装本地受信任 HTTPS 证书
- **Whistle 代理内置**：应用启动即启动代理，自动配置 No Cache + Map Local 规则，通过代理自动注入调试脚本
- **系统托盘**：后台运行，快速访问常用操作
- **证书扫码安装**：手机扫描二维码即可下载安装根证书
- **Whistle 面板**：内置 Whistle 管理界面，可查看 Network 抓包、编辑代理规则

---
## 三、桌面端使用（推荐）
桌面端是开箱即用的方案，打包后双击即可运行，无需 Node.js 环境。

### 3.1 安装
从 `release/` 目录获取对应平台的安装包：
| 平台 | 安装包 |
|------|--------|
| **macOS** | `Remote DevTools-x.x.x-arm64.dmg` |
| **Windows** | `Remote DevTools Setup x.x.x.exe` |
| **Linux** | `Remote DevTools-x.x.x.AppImage` |

macOS 双击 `.dmg` 将应用拖入 Applications 文件夹即可。

### 3.2 使用流程
#### 方式一：Whistle 代理自动注入（推荐）
> 目标页面**无需修改任何代码**，通过代理自动注入调试脚本。
> 前提：目标页面引用了 `https://unpkg.com/vconsole@3.15.1/dist/vconsole.min.js`。

**Step 1：启动应用**
双击打开 Remote DevTools，应用启动时会自动启动 Whistle 代理（默认端口 8900）。设置界面中可以看到代理状态。

**Step 2：手机配置 HTTP 代理**
确保手机和电脑在同一 Wi-Fi 网络下，然后在手机 Wi-Fi 设置中配置 HTTP 代理：
**iOS：**
1. 前往 **设置 → Wi-Fi**，点击当前连接的 Wi-Fi 名称
2. 滚动到底部，点击 **配置代理 → 手动**
3. 填写服务器地址和端口（设置界面有显示）
4. 点击「存储」保存设置

**Android：**
1. 前往 **设置 → WLAN**，长按当前连接的 Wi-Fi
2. 选择 **修改网络 → 高级选项**
3. 将代理设置为 **手动**，填写主机名和端口
4. 保存设置

**Step 3：安装 Whistle 代理证书**
在设置页扫描二维码，或在手机浏览器中访问证书下载地址，下载并安装 Whistle 根证书：
**iOS：**
1. 用手机扫描二维码，在 Safari 中打开并下载证书
2. 前往 **设置 → 通用 → VPN 与设备管理**，安装该描述文件
3. 前往 **设置 → 通用 → 关于本机 → 证书信任设置**
4. 开启对该根证书的「完全信任」

**Android：**
1. 用手机扫描二维码，在浏览器中打开并下载证书
2. 前往 **设置 → 安全 → 加密与凭据**
3. 点击 **安装证书 → CA 证书**
4. 选择下载的证书文件并确认安装

**Step 4：点击 Start Server**
在设置界面中确认代理配置和证书安装已完成（对应项打勾），然后点击 **Start Server**。
服务启动后 Whistle 会自动配置规则：
- 将 `vconsole.min.js` 替换为内置版本，并在末尾注入 Remote DevTools 连接脚本
- 禁用 `unpkg.com` 的缓存，确保每次都加载最新内容

**Step 5：开始调试**
在手机上打开包含 vconsole 的页面，该页面会自动出现在首页的 **Available Targets** 列表中。点击 **Chrome DevTools** 按钮即可开始调试。
> **提示**：首页和设置页都有「Whistle」按钮，可以打开 Whistle 管理面板，在 Network 中查看抓包数据。

#### 方式二：手动注入脚本
适用于所有场景，不依赖代理，但需要修改目标页面代码。

**Step 1：启动服务**
打开 Remote DevTools，在设置界面配置端口等参数后点击 **Start Server**。

**Step 2：在目标页面注入脚本**
打开首页（`http(s)://<your-ip>:<port>/`），复制以下两段代码添加到目标页面的 `<head>` 中：
```html
<!-- 1. 全局配置（推荐，避免脚本 URL 解析失败） -->
<script>
  window.__remote_devtools_ws_query__ = 'http://<your-ip>:<port>?ws=1&wsHost=<your-ip>&wsPort=8899';
</script>

<!-- 2. 注入调试脚本 -->
<script src="http://<your-ip>:<port>/ws-backend.js"></script>
```
> 将 IP 和端口替换为你的实际服务地址。HTTPS 场景请使用 `https://` 和对应端口。

**Step 3：打开 DevTools**
刷新目标页面后，它会出现在首页的 **Available Targets** 列表中。点击 **Chrome DevTools** 按钮即可开始调试。

### 3.3 HTTPS 配置
当目标页面是 HTTPS 时，浏览器安全策略会禁止连接 `ws://`，必须使用 `wss://`。
在设置界面中展开 **HTTPS 配置** 区域，勾选 **Enable HTTPS**。

**证书优先级：**
1. **自定义证书**：在设置界面手动选择 PEM 文件
2. **mkcert 证书**：本机安装了 mkcert 时自动生成，浏览器自动信任（**推荐**）
3. **自签名证书**：兜底方案，浏览器会显示安全警告

**mkcert 安装：**
设置界面会自动检测 mkcert 是否已安装。如未安装，按界面提示操作：
```bash
# macOS
brew install mkcert
# Windows
choco install mkcert
# 或 scoop install mkcert
```
安装后回到设置界面：
1. 点击 **安装根证书到系统**，信任 mkcert CA
2. 手机端扫码下载并安装 mkcert 根证书
3. 勾选 **Enable HTTPS** 后点击 Start Server

---
## 四、CLI 使用
适用于服务器部署、CI/CD 集成等场景，需要 Node.js >= 12 环境。

### 4.1 安装与启动
```bash
npm install       # 安装依赖
npm run build     # 构建
npm start         # 启动服务
```

### 4.2 命令行参数
```bash
npm start                                              # 默认启动（HTTP，端口从 8899 起自动选择）
npm start -- --port 8899                               # 指定端口
npm start -- --address 0.0.0.0                         # 指定监听地址
npm start -- --https                                   # 启用 HTTPS
npm start -- --https --cert ./server.pem --key ./server-key.pem  # 使用自定义证书
```
| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-p, --port` | 服务端口 | 8899（自动查找可用端口） |
| `-a, --address` | 监听地址 | `0.0.0.0` |
| `--https` | 启用 HTTPS/WSS | `false` |
| `--cert` | 自定义证书路径（PEM） | - |
| `--key` | 自定义私钥路径（PEM） | - |

### 4.3 全局安装
发布为 npm 包后可全局安装使用：
```bash
npm install -g remote-devtools
remote-devtools --port 8899   # 或简写 rdt --port 8899
```

### 4.4 注入与调试
启动后终端会输出服务地址和可注入的脚本 URL。使用方式与桌面端「手动注入脚本」相同，参考第三章方式二。

---
## 五、常见问题（FAQ）
**Q：电脑浏览器显示「不安全」警告？**
检查：1) 是否已安装 mkcert 并点击了「安装根证书到系统」；2) 是否使用了正确的证书文件；3) 安装证书后需要**重启浏览器**。

**Q：手机浏览器提示证书不受信任？**
检查：1) 手机和电脑是否在同一网络下；2) rootCA.pem 是否已在手机上安装**并信任**；3) 证书是否覆盖了当前电脑的 IP 地址；4) iOS 需要额外在 **设置 → 通用 → 关于本机 → 证书信任设置** 中开启完全信任。

**Q：证书过期了怎么办？**
mkcert 生成的证书有效期约 2 年，在设置界面中点击「重新生成」即可创建新证书。

**Q：目标页面在首页列表中不显示？**
检查：1) 目标页面是否正确注入了 `ws-backend.js`；2) 注入脚本 URL 中的 IP 和端口是否正确；3) 手机和电脑是否在同一网络下；4) 如果使用 HTTPS，目标页面也需要通过 HTTPS 加载脚本；5) 打开浏览器控制台查看是否有 WebSocket 连接错误。

**Q：Whistle 代理注入不生效？**
检查：1) 手机是否已正确配置 HTTP 代理指向 Whistle 端口；2) 手机是否已安装 Whistle 根证书（HTTPS 页面必须安装）；3) 是否已点击 **Start Server**（规则在服务启动后才生效）；4) 打开 Whistle 面板 → Network，查看 `vconsole.min.js` 请求的响应是否包含注入脚本。

**Q：如何确认 Map Local 是否生效？**
打开 Whistle 面板 → Network 标签 → 在手机上访问目标页面 → 找到 `vconsole.min.js` 请求，查看响应末尾是否有 `// --- Remote DevTools Inject ---` 标记。

**Q：打包后的安装包在哪里？**
打包产物在 `release/` 目录下：macOS 为 `.dmg` + `.app`，Windows 为 `.exe`，Linux 为 `.AppImage`。

---
## 六、Whistle 代理说明
桌面端内置了 [Whistle](https://github.com/nicknisi/whistle) HTTP/HTTPS 代理。

**生命周期：**
- **启动**：应用启动时自动启动（默认端口 8900）
- **停止**：应用完全退出时自动停止
- 与 Start Server 无关，代理始终在后台运行

**内置规则（Start Server 后自动配置）：**
| 规则 | 说明 |
|------|------|
| `https://unpkg.com disable://cache enable://capture` | 禁用 unpkg 缓存，开启 HTTPS 抓包 |
| `https://unpkg.com/vconsole@3.15.1/dist/vconsole.min.js file://...` | 将 vconsole 替换为包含 DevTools 连接脚本的合并版本 |

**Whistle 面板：**
设置页和首页均提供「**打开面板**」按钮，以独立窗口打开 Whistle 管理界面，可查看 Network 抓包记录、编辑代理规则。

---
## 附录 A：项目结构
```
remote-devtools/
├── bin/
│   └── remote-devtools.js            # CLI 入口
├── server/
│   ├── Server.js                     # HTTP/HTTPS Server + Middleware + WebSocket
│   ├── constants.js                  # 常量定义
│   ├── getCertificate.js             # HTTPS 证书策略
│   ├── utils.js                      # 工具函数
│   ├── middle/                       # HTTP 中间件
│   │   ├── home.js                   # 首页路由与配置注入
│   │   ├── magicBackend.js           # /ws-backend.js → dist/backend.js
│   │   ├── chii.js                   # chii DevTools 静态资源
│   │   ├── alive.js                  # /alive/:backendId 存活探测
│   │   └── static.js                 # 通用静态文件
│   ├── lib/                          # WebSocket 核心
│   │   ├── WebSocketServer.js        # WS 路由分发
│   │   ├── ChannelMultiplex.js       # Backend/Frontend 映射与转发
│   │   ├── Channel.js                # 单通道桥接
│   │   └── Manager.js                # 首页 WS 推送
│   └── rewrite/
│       └── sdk/Connections.js        # chii 连接增强
├── electron/                          # Electron 桌面端
│   ├── main.js                       # 应用入口 & 生命周期协调
│   ├── preload/                      # IPC 桥接层（主进程 ↔ 渲染进程安全边界）
│   │   ├── main.js                   # 主窗口：暴露 electronAPI
│   │   └── settings.js               # 设置窗口：暴露 settingsAPI
│   ├── windows/                      # 窗口管理层
│   │   ├── windowManager.js          # 窗口创建与管理
│   │   ├── tray.js                   # 系统托盘
│   │   └── settings.html             # 设置界面 HTML
│   └── services/                     # 后台服务层
│       ├── whistleManager.js         # Whistle 代理管理
│       └── configStore.js            # 配置持久化
├── public/
│   ├── home.html                     # 首页 UI
│   └── vconsole.min.js               # 内置 vConsole
├── backend.js                         # 注入脚本源码
├── package.json
└── docs/
    └── README.md                      # 本文档
```

---
## 附录 B：关键源码说明
### B.1 注入脚本（backend.js）
目标页面注入的核心脚本，负责生成/缓存 sessionId、自动推导 WebSocket 地址、建立连接、通过 chobitsu 转发 CDP 消息、断线自动重连、网络诊断。
```javascript
if (window.__remote_devtools_backend_loaded__) return;
window.__remote_devtools_backend_loaded__ = true;
const queryStr = window.__remote_devtools_ws_query__ || parseScriptSrc();
const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${wsProtocol}//${host}:${port}/backend/${sessionId}`);
chobitsu.setOnMessage((message) => {
  ws.send(`@${channelName}\n${message}`);
});
```

### B.2 服务端（server/Server.js）
基于 Node.js 的 HTTP/HTTPS 服务器，使用中间件模式：
```javascript
this.use(magicBackend(this.root));     // /ws-backend.js
this.use(homeMiddleware(homePath));     // 首页
this.use(chiiMiddleware());            // chii DevTools
this.use(aliveMiddleware());           // 存活探测
this.use(staticMiddleware(this.root)); // 静态文件
// WebSocket 路由：/backend/:sessionId, /frontend/:fid/:bid, /home/:homeSessionId, /chii/:fid/:bid
```

### B.3 Whistle 代理管理（electron/services/whistleManager.js）
```javascript
startWhistle({ port: 8900, host: '0.0.0.0', storage: 'remote-devtools-proxy',
  certDir: path.join(app.getPath('userData'), 'whistle-certs') });
const rules = [
  'https://unpkg.com disable://cache enable://capture',
  `https://unpkg.com/vconsole@3.15.1/dist/vconsole.min.js file://${combinedPath} enable://capture`
].join('\n');
whistleResult.setShadowRules(rules);
```

### B.4 桌面端主进程（electron/main.js）
```javascript
app.whenReady() → 启动 Whistle 代理 → 打开设置窗口
ipcMain.on('settings-save-and-start', config => {
  startServer(config);  whistleManager.updateRules();  createMainWindow();  createTray();
});
app.on('will-quit', () => { whistleManager.stop(); stopServer(); });
```

### B.5 配置持久化（electron/services/configStore.js）
```javascript
const DEFAULTS = { port: 8899, proxyPort: 8900, address: '', https: false, cert: '', key: '' };
// 存储位置：~/Library/Application Support/remote-devtools/settings.json
```

---
## 附录 C：技术栈
| 组件 | 技术 |
|------|------|
| 服务端 | Node.js + WebSocket (ws) |
| DevTools UI | chii (Chrome DevTools Protocol) |
| 页面端 CDP | chobitsu |
| 桌面端 | Electron + electron-builder |
| 代理 | Whistle |
| 证书 | mkcert / node-forge / selfsigned |
| 注入脚本打包 | Webpack + Babel |
| 二维码 | qrcode (npm) |

---
## 附录 D：版本历史
| 版本 | 更新内容 |
|------|---------|
| 1.0.5 | 集成 Whistle 代理，支持自动注入调试脚本；证书扫码安装；Whistle 面板集成 |
| 1.0.0 | 初始版本：CLI + Electron 桌面端，支持 HTTP/HTTPS 远程调试 |
