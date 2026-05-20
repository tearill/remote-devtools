const { Tray, Menu, clipboard, nativeImage } = require('electron');
const path = require('path');

let tray = null;

function createTray(mainWindow, serverInfo, onOpenSettings) {
  const iconPath = path.join(__dirname, 'icon-tray.png');

  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      trayIcon = createDefaultIcon();
    }
  } catch (e) {
    trayIcon = createDefaultIcon();
  }

  if (process.platform === 'darwin') {
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Remote DevTools');

  updateTrayMenu(mainWindow, serverInfo, onOpenSettings);

  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });

  return tray;
}

function createDefaultIcon() {
  const img = nativeImage.createFromBuffer(
    createIconBuffer(32),
    { width: 32, height: 32 }
  );
  return img;
}

function createIconBuffer(size) {
  const channels = 4;
  const buffer = Buffer.alloc(size * size * channels);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * channels;
      const cx = size / 2;
      const cy = size / 2;
      const r = size / 2 - 2;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

      if (dist <= r) {
        buffer[idx] = 102;     // R
        buffer[idx + 1] = 126; // G
        buffer[idx + 2] = 234; // B
        buffer[idx + 3] = 255; // A
      } else {
        buffer[idx + 3] = 0;
      }
    }
  }
  return buffer;
}

function updateTrayMenu(mainWindow, serverInfo, onOpenSettings) {
  if (!tray) return;

  const { port, protocol, backendUrl } = serverInfo;

  // 获取 whistle 代理信息
  let proxyItems = [];
  try {
    const whistleManager = require('../services/whistleManager');
    const proxyInfo = whistleManager.getInfo();
    if (proxyInfo.running) {
      const proxyAddr = `${proxyInfo.localIP}:${proxyInfo.port}`;
      proxyItems = [
        { type: 'separator' },
        {
          label: `Proxy Running (${proxyAddr})`,
          enabled: false
        },
        {
          label: 'Copy Proxy Address',
          click: () => {
            clipboard.writeText(proxyAddr);
          }
        }
      ];
    }
  } catch (e) {
    // whistle 未加载时忽略
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Remote DevTools',
      enabled: false
    },
    { type: 'separator' },
    {
      label: `Server Running (${(protocol || 'http').toUpperCase()} : ${port})`,
      enabled: false
    },
    {
      label: 'Copy Backend Script URL',
      click: () => {
        clipboard.writeText(backendUrl);
      }
    },
    ...proxyItems,
    { type: 'separator' },
    {
      label: 'Show Main Window',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Settings...',
      click: () => {
        if (typeof onOpenSettings === 'function') {
          onOpenSettings();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.removeAllListeners('close');
          mainWindow.destroy();
        }
        const { app } = require('electron');
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = {
  createTray,
  updateTrayMenu,
  destroyTray
};
