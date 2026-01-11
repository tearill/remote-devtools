const {nanoid} = require('nanoid');
const fs = require('fs');
const {logger} = require('../utils');
const {createBackendJSUrl} = require('../utils');
const {REMOTE_DEVTOOLS_HTML} = require('../constants');

module.exports = tplpath => {
    return (req, res, next) => {
        if (req.origFilePath !== '/' && req.origFilePath !== '/getHomeConfigOnly') {
            logger.debug('home middleware out');
            next();
            return;
        }
        let getConfigOnly = false;
        if (req.origFilePath === '/getHomeConfigOnly') {
            getConfigOnly = true;
        }
        const {address, port} = req;
        const sessionId = nanoid();

        // 检测当前是否为 HTTPS 请求
        const isHttps = req.connection && req.connection.encrypted ||
                       req.headers['x-forwarded-proto'] === 'https' ||
                       req.protocol === 'https';

        const protocol = isHttps ? 'https' : 'http';
        const frontendUrl = `${protocol}://${address}:${port}/${REMOTE_DEVTOOLS_HTML}`;

        const backends = req
            .getWebSocketServer()
            .getChannelManager()
            .getBackends()
            .reverse()
            .map(a => {
                const rs = {...a};
                delete rs.channel;
                // 去掉对象
                Object.keys(rs).forEach(k => {
                    if (typeof rs[k] === 'function') {
                        delete rs[k];
                    }
                });
                return rs;
            });
        const config = JSON.stringify({
            backendjs: createBackendJSUrl(address, port, isHttps),
            wsPort: port,
            wsHost: address,
            frontendUrl,
            backends: backends,
            sessionId,
            status: 'connected'
        });

        if (getConfigOnly) {
            res.write(config, 'utf8');
            res.end();
        } else {
            try {
                const htmlTemplate = fs.readFileSync(tplpath, 'utf8');
                const html = htmlTemplate.replace(
                    '</head>',
                    `<script>window.__config__ = ${config};</script></head>`
                );
                res.write(html, 'utf8');
                res.end();
            } catch (err) {
                logger.error('Home middleware: read template error:');
                logger.error(err);
                next(err);
            }
        }
    };
};