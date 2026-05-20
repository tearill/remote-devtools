const { app, ipcMain, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const portfinder = require('portfinder');

const { createMainWindow, setupIPC, closeAllDevtoolsWindows, injectDevBanner } = require('./windows/windowManager');
const { createTray, updateTrayMenu, destroyTray } = require('./windows/tray');
const configStore = require('./services/configStore');
const whistleManager = require('./services/whistleManager');

const DEFAULT_PORT = 8899;

let settingsWindow = null;
let mainWindow = null;
let server = null;
let serverPort = null;
let serverConfig = { https: false, protocol: 'http' };

// ── 服务器生命周期 ──────────────────────────────────────

function startServer(config) {
  return new Promise((resolve, reject) => {
    const Server = require('../server/Server');
    const root = path.join(__dirname, '../dist');
    const hostname = config.address || '0.0.0.0';
    const useHttps = config.https;

    let httpsOptions = null;
    if (useHttps) {
      httpsOptions = {};
      if (config.cert) httpsOptions.cert = config.cert;
      if (config.key) httpsOptions.key = config.key;
    }

    serverConfig.https = useHttps;
    serverConfig.protocol = useHttps ? 'https' : 'http';

    // certDir 传给服务器用于存储 mkcert 生成的证书（打包版 process.cwd() 不可写）
    const certDir = path.join(app.getPath('userData'), 'server-certs');
    const options = { https: httpsOptions, port: config.port, hostname, root, certDir };

    server = new Server(options);
    server.listen(config.port, hostname, (err) => {
      if (err) {
        reject(err);
        return;
      }
      serverPort = config.port;
      console.log(`[Electron] Server started on port ${serverPort} (${serverConfig.protocol})`);
      resolve(serverPort);
    });
  });
}

function stopServer() {
  if (server) {
    try {
      server.close();
    } catch (e) {
      // 忽略关闭时的错误
    }
    server = null;
    serverPort = null;
  }
}

function getServerInfo() {
  const address = server ? server.getAddress() : '127.0.0.1';
  const { BACKEND_JS_PATH } = require('../server/constants');
  const protocol = serverConfig.protocol;
  return {
    port: serverPort,
    address,
    protocol,
    backendUrl: `${protocol}://${address}:${serverPort}${BACKEND_JS_PATH}`
  };
}

// ── 设置窗口 ──────────────────────────────────────────

function showSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 540,
    height: 900,
    resizable: false,
    maximizable: false,
    title: app.isPackaged ? 'Remote DevTools - Settings' : '[DEV] Remote DevTools - Settings',
    webPreferences: {
      preload: path.join(__dirname, 'preload', 'settings.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'windows', 'settings.html'));
  injectDevBanner(settingsWindow);

  settingsWindow.on('closed', () => {
    settingsWindow = null;
    // 如果还没有启动过服务器，用户直接关闭设置窗口则退出应用
    if (!server && !mainWindow) {
      app.quit();
    }
  });
}

// ── 启动服务 & 打开主窗口 ──────────────────────────────

async function launchWithConfig(config) {
  // 关闭旧服务器和旧主窗口
  closeAllDevtoolsWindows();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeAllListeners('close');
    mainWindow.destroy();
    mainWindow = null;
  }
  stopServer();

  // 解析端口：若用户填了 0 或空值，自动查找可用端口
  let port = config.port;
  if (!port || port <= 0) {
    portfinder.basePort = DEFAULT_PORT;
    port = await portfinder.getPortPromise();
    config.port = port;
  }

  // 保存配置
  configStore.save(config);

  // 启动服务器
  await startServer(config);

  const protocol = serverConfig.protocol;
  mainWindow = createMainWindow(port, protocol);

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      closeAllDevtoolsWindows();
      stopServer();
      destroyTray();
      mainWindow.removeAllListeners('close');
      mainWindow.destroy();
      mainWindow = null;
      showSettingsWindow();
    }
  });

  // 更新 whistle 代理规则
  const localIP = configStore.getLocalIP();
  whistleManager.updateRules({
    devtoolsPort: port,
    protocol,
    localIP
  });

  const serverInfo = getServerInfo();
  createTray(mainWindow, serverInfo, () => showSettingsWindow());
  // 显式刷新一次托盘菜单，确保菜单信息与最新服务状态一致
  updateTrayMenu(mainWindow, serverInfo, () => showSettingsWindow());

  console.log(`[Electron] Remote DevTools running at ${protocol}://127.0.0.1:${port}/`);

  // 关闭设置窗口
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.destroy();
    settingsWindow = null;
  }
}

// ── IPC 事件 ────────────────────────────────────────────

function registerSettingsIPC() {
  ipcMain.handle('settings-load-config', () => {
    const config = configStore.load();
    config._localIP = configStore.getLocalIP();
    return config;
  });

  // 立即保存部分配置项（不启动服务器），用于实时持久化用户选项
  ipcMain.handle('settings-save-partial-config', (event, partial) => {
    const existing = configStore.load();
    configStore.save({ ...existing, ...partial });
  });

  ipcMain.on('settings-save-and-start', async (event, config) => {
    try {
      await launchWithConfig(config);
    } catch (err) {
      console.error('[Electron] Failed to start server:', err);
      dialog.showErrorBox(
        'Server Start Failed',
        `Could not start server on port ${config.port}.\n\n${err.message}`
      );
    }
  });

  ipcMain.handle('settings-check-port', async (event, port) => {
    // 当前服务器正占用的端口，切换时会先关闭，不需要拦截
    if (server && serverPort === port) {
      return true;
    }
    const net = require('net');
    return new Promise((resolve) => {
      const tester = net.createServer()
        .once('error', () => resolve(false))
        .once('listening', () => {
          tester.close(() => resolve(true));
        })
        .listen(port, '0.0.0.0');
    });
  });

  ipcMain.handle('settings-browse-file', async (event, title) => {
    const focusedWin = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(focusedWin, {
      title: title || 'Select File',
      properties: ['openFile'],
      filters: [
        { name: 'PEM Files', extensions: ['pem', 'crt', 'key'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  // ── mkcert 相关 ──

  // Electron 进程 PATH 不含 Homebrew 路径，需手动补全以找到 mkcert
  const getMkcertEnv = () => ({
    ...process.env,
    PATH: [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      process.env.PATH || ''
    ].join(':')
  });

  ipcMain.handle('mkcert-check', async () => {
    const { execSync } = require('child_process');
    try {
      const version = execSync('mkcert -version', {
        encoding: 'utf8',
        stdio: 'pipe',
        env: getMkcertEnv()
      }).trim();
      return { installed: true, version };
    } catch (e) {
      return { installed: false };
    }
  });

  ipcMain.handle('mkcert-get-caroot', async () => {
    const { execSync } = require('child_process');
    const fs = require('fs');
    try {
      const caroot = execSync('mkcert -CAROOT', {
        encoding: 'utf8',
        stdio: 'pipe',
        env: getMkcertEnv()
      }).trim();
      const rootCAPath = path.join(caroot, 'rootCA.pem');
      const exists = fs.existsSync(rootCAPath);
      return { caroot, rootCAPath, exists };
    } catch (e) {
      return { caroot: null, rootCAPath: null, exists: false };
    }
  });

  ipcMain.handle('mkcert-generate-cert', async (event, domains) => {
    const { execSync } = require('child_process');
    const fs = require('fs');
    try {
      const certDir = path.join(app.getPath('userData'), 'certs');
      fs.mkdirSync(certDir, { recursive: true });

      const certFile = path.join(certDir, 'devtools-cert.pem');
      const keyFile = path.join(certDir, 'devtools-key.pem');

      const domainArgs = domains.join(' ');
      execSync(
        `mkcert -cert-file "${certFile}" -key-file "${keyFile}" ${domainArgs}`,
        { encoding: 'utf8', stdio: 'pipe', env: getMkcertEnv() }
      );

      return { success: true, certFile, keyFile };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('mkcert-install-ca', async () => {
    const { execSync } = require('child_process');
    try {
      execSync('mkcert -install', { encoding: 'utf8', stdio: 'pipe', env: getMkcertEnv() });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('mkcert-reveal-file', async (event, filePath) => {
    shell.showItemInFolder(filePath);
  });

  // ── whistle 代理相关 ──

  ipcMain.handle('whistle-get-info', () => {
    return whistleManager.getInfo();
  });

  ipcMain.handle('mkcert-set-cert-rule', async (_event, rootCAPath) => {
    return whistleManager.setCertDownloadRule(rootCAPath);
  });

  ipcMain.handle('generate-qrcode', async (_event, text) => {
    const QRCode = require('qrcode');
    return QRCode.toDataURL(text, { width: 160, margin: 2 });
  });

  ipcMain.handle('open-external', async (_event, url) => {
    const { BrowserWindow } = require('electron');
    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      title: 'Whistle',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    win.loadURL(url);
  });

  // 仅用于飞书等外部文档：系统默认浏览器打开，不影响 Whistle 等应用内窗口
  ipcMain.handle('open-in-system-browser', async (_event, url) => {
    await shell.openExternal(url);
  });

  // 获取桌面端版本号（独立维护于 electron/services/appVersion.js）
  ipcMain.handle('get-app-version', () => require('./services/appVersion').version);
}

// ── 应用启动 ────────────────────────────────────────────

app.whenReady().then(() => {
  // 开发版本：在 macOS Dock 图标上显示 DEV 角标，提供系统级感知
  if (!app.isPackaged && app.dock) {
    app.dock.setBadge('DEV');
  }

  // 允许连接本地 / 内网 HTTPS 服务器（自签名/mkcert 证书）
  // 内网 IP 范围：10.x、172.16-31.x、192.168.x 以及 loopback
  const PRIVATE_IP_RE = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;
  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (host === '127.0.0.1' || host === 'localhost' || PRIVATE_IP_RE.test(host)) {
      event.preventDefault();
      callback(true);
    } else {
      callback(false);
    }
  });

  setupIPC();
  registerSettingsIPC();
  ipcMain.handle('get-server-info', () => getServerInfo());
  ipcMain.on('open-settings', () => showSettingsWindow());

  // 启动 whistle 代理（用 portfinder 找可用端口，避免与其他实例冲突）
  const config = configStore.load();
  const preferredProxyPort = config.proxyPort || 8900;
  portfinder.basePort = preferredProxyPort;
  portfinder.getPortPromise().then((availableProxyPort) => {
    return whistleManager.start(availableProxyPort);
  }).then(({ port }) => {
    console.log(`[Electron] Whistle proxy ready on port ${port}`);
  }).catch((err) => {
    console.error('[Electron] Failed to start whistle proxy:', err);
  });

  showSettingsWindow();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('will-quit', () => {
  closeAllDevtoolsWindows();
  destroyTray();
  stopServer();
  whistleManager.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  } else if (!server) {
    showSettingsWindow();
  }
});
