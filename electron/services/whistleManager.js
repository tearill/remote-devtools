const startWhistle = require('whistle');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { app } = require('electron');
const configStore = require('./configStore');
const {
  UNPKG_HOST_CACHE_RULE,
  VCONSOLE_MAP_RULES
} = require('./vconsoleWhistleRules');

let whistleResult = null;
let proxyPort = null;

/**
 * 启动 whistle 代理
 * @param {number} port - 代理端口
 * @returns {Promise<{ port: number }>}
 */
function start(port) {
  if (whistleResult) return Promise.resolve({ port: proxyPort });

  proxyPort = port;

  return new Promise((resolve, reject) => {
    try {
      startWhistle({
        port,
        host: '0.0.0.0',
        storage: 'remote-devtools-proxy',
        certDir: path.join(app.getPath('userData'), 'whistle-certs')
      }, (result) => {
        whistleResult = result;
        console.log(`[Whistle] Proxy started on port ${port}`);
        resolve({ port });
      });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * 停止 whistle 代理
 */
function stop() {
  if (whistleResult) {
    whistleResult = null;
    proxyPort = null;
    console.log('[Whistle] Proxy stopped');
  }
}

/**
 * 根据 DevTools 服务参数更新代理规则
 * @param {object} options
 * @param {number} options.devtoolsPort - DevTools 服务端口
 * @param {string} options.protocol - http 或 https
 * @param {string} options.localIP - 本机局域网 IP
 */
function updateRules(options) {
  if (!whistleResult) return;

  const { devtoolsPort, protocol, localIP } = options;
  const serverUrl = `${protocol}://${localIP}:${devtoolsPort}`;

  // 注入脚本内容（各 vConsole 版本共用）
  const injectScript = [
    '',
    '// --- Remote DevTools Inject ---',
    'setTimeout(function(){',
    `  window.__remote_devtools_ws_query__='${serverUrl}?ws=1&wsHost=${localIP}&wsPort=${devtoolsPort}';`,
    "  var s=document.createElement('script');",
    `  s.src='${serverUrl}/ws-backend.js';`,
    '  document.head.appendChild(s);',
    '}, 500);'
  ].join('\n');

  const mappingRules = [];
  for (const rule of VCONSOLE_MAP_RULES) {
    const sourcePath = getPublicFilePath(rule.sourceFile);
    const combinedPath = path.join(getTempDir(), rule.combinedFile);
    try {
      const content = fs.readFileSync(sourcePath, 'utf-8');
      fs.writeFileSync(combinedPath, content + injectScript, 'utf-8');
      console.log('[Whistle] Combined vconsole written:', rule.cdnUrl, '->', combinedPath);
    } catch (e) {
      console.error('[Whistle] Failed to write combined vconsole for', rule.cdnUrl, e);
      return;
    }
    mappingRules.push(`${rule.cdnUrl} file://${combinedPath} enable://capture`);
  }

  const rules = [UNPKG_HOST_CACHE_RULE, ...mappingRules].join('\n');

  // 记录并设置 shadow rules
  currentShadowRules = rules;
  whistleResult.setShadowRules(rules);

  // HTTP API 写入可见规则组（在面板 Rules 标签可查看）
  setVisibleRules(proxyPort, 'Remote DevTools', rules);

  console.log('[Whistle] Rules updated for', serverUrl);
  console.log('[Whistle] Rules:\n' + rules);
}

/**
 * 获取 temp 目录（whistle 规则中空格是分隔符，需用无空格路径）
 */
function getTempDir() {
  const os = require('os');
  const dir = path.join(os.tmpdir(), 'remote-devtools');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 获取 public 目录下资源文件的绝对路径（开发 / 打包）
 */
function getPublicFilePath(filename) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app', 'public', filename);
  }
  return path.join(__dirname, '..', '..', 'public', filename);
}

/**
 * 通过 whistle HTTP API 写入可见规则组
 */
function setVisibleRules(port, name, rules) {
  const body = `name=${encodeURIComponent(name)}&value=${encodeURIComponent(rules)}&selected=true`;
  const req = http.request({
    hostname: '127.0.0.1',
    port,
    path: '/cgi-bin/rules/select',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body)
    }
  }, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log('[Whistle] Set visible rules response:', data);
    });
  });
  req.on('error', (e) => {
    console.error('[Whistle] Failed to set visible rules:', e.message);
  });
  req.write(body);
  req.end();
}

/**
 * 获取 whistle 代理信息
 */
function getInfo() {
  return {
    running: !!whistleResult,
    port: proxyPort,
    localIP: configStore.getLocalIP(),
    certDownloadUrl: proxyPort
      ? `http://${configStore.getLocalIP()}:${proxyPort}/cgi-bin/rootca`
      : null
  };
}

let certServer = null;
let certServerPort = null;

/**
 * 启动一个小型 HTTP 服务器来提供 mkcert rootCA 下载
 * @param {string} rootCAPath - rootCA.pem 的绝对路径
 * @returns {Promise<string|null>} 下载 URL
 */
async function setCertDownloadRule(rootCAPath) {
  if (!rootCAPath || !fs.existsSync(rootCAPath)) return null;

  // 如果已经在运行，关闭旧的
  if (certServer) {
    certServer.close();
    certServer = null;
  }

  const certContent = fs.readFileSync(rootCAPath);
  const portfinder = require('portfinder');
  const port = await portfinder.getPortPromise({ port: 18900 });

  return new Promise((resolve) => {
    certServer = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/x-pem-file');
      res.setHeader('Content-Disposition', 'attachment; filename=rootCA.pem');
      res.end(certContent);
    });
    certServer.listen(port, '0.0.0.0', () => {
      certServerPort = port;
      const localIP = configStore.getLocalIP();
      const downloadUrl = `http://${localIP}:${port}/rootCA.pem`;
      console.log('[CertServer] mkcert rootCA available at:', downloadUrl);
      resolve(downloadUrl);
    });
    certServer.on('error', (e) => {
      console.error('[CertServer] Failed to start:', e);
      resolve(null);
    });
  });
}

module.exports = { start, stop, updateRules, getInfo, setCertDownloadRule };
