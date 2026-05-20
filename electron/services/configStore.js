const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const CONFIG_FILE = 'settings.json';

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const DEFAULTS = {
  port: 8899,
  proxyPort: 8900,
  address: '',
  https: false,
  cert: '',
  key: ''
};

function getConfigPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

function load() {
  try {
    const filePath = getConfigPath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const saved = JSON.parse(raw);
      return { ...DEFAULTS, ...saved };
    }
  } catch (e) {
    console.error('[ConfigStore] Failed to load config:', e.message);
  }
  return { ...DEFAULTS };
}

function save(config) {
  try {
    const filePath = getConfigPath();
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('[ConfigStore] Failed to save config:', e.message);
  }
}

module.exports = { load, save, getLocalIP, DEFAULTS };
