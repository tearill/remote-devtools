const { BrowserWindow, ipcMain, app } = require('electron');
const path = require('path');

const devtoolsWindows = new Map();

// 开发版本在标题前加 [DEV] 前缀，方便同时打开时区分
const APP_TITLE = app.isPackaged ? 'Remote DevTools' : '[DEV] Remote DevTools';

/**
 * 向指定窗口注入开发模式横幅（仅开发版本执行）
 * 横幅固定在页面顶部，并为 body 添加 padding 避免内容被遮挡
 */
function injectDevBanner(win) {
  if (app.isPackaged) return;

  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript(`
      (function() {
        if (document.getElementById('__dev_banner__')) return;
        var b = document.createElement('div');
        b.id = '__dev_banner__';
        b.textContent = '⚡ DEV MODE';
        Object.assign(b.style, {
          position: 'fixed',
          top: '0', left: '0', right: '0',
          height: '24px',
          lineHeight: '24px',
          background: 'linear-gradient(90deg, #d97706, #f59e0b, #d97706)',
          color: '#000',
          fontSize: '11px',
          fontWeight: '700',
          letterSpacing: '3px',
          textAlign: 'center',
          zIndex: '2147483647',
          pointerEvents: 'none',
          fontFamily: '-apple-system, "SF Mono", monospace',
          boxShadow: '0 2px 6px rgba(217,119,6,0.5)'
        });
        document.body.insertBefore(b, document.body.firstChild);
        // 推开正文内容，避免被横幅遮挡
        var cur = parseInt(getComputedStyle(document.body).paddingTop) || 0;
        document.body.style.setProperty('padding-top', Math.max(cur, 24) + 'px', 'important');
      })();
    `).catch(() => {});
  });
}

function createMainWindow(port, protocol) {
  const scheme = protocol || 'http';
  const win = new BrowserWindow({
    width: 1200,
    height: 1000,
    minWidth: 800,
    minHeight: 500,
    title: APP_TITLE,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'main.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.loadURL(`${scheme}://127.0.0.1:${port}/`);

  // 阻止页面 <title> 标签覆盖已设定的窗口标题
  win.on('page-title-updated', (event) => event.preventDefault());
  injectDevBanner(win);

  return win;
}

function createDevtoolsWindow(url, title) {
  const existingWin = devtoolsWindows.get(url);
  if (existingWin && !existingWin.isDestroyed()) {
    existingWin.focus();
    return existingWin;
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: title || 'DevTools',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.loadURL(url);

  devtoolsWindows.set(url, win);
  win.on('closed', () => {
    devtoolsWindows.delete(url);
  });

  return win;
}

function setupIPC() {
  ipcMain.on('open-devtools', (event, { url, title }) => {
    createDevtoolsWindow(url, title);
  });

  ipcMain.on('copy-to-clipboard', (event, text) => {
    const { clipboard } = require('electron');
    clipboard.writeText(text);
  });
}

function closeAllDevtoolsWindows() {
  for (const [, win] of devtoolsWindows) {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
  devtoolsWindows.clear();
}

module.exports = {
  createMainWindow,
  createDevtoolsWindow,
  setupIPC,
  closeAllDevtoolsWindows,
  injectDevBanner
};
