const fs = require('fs');
const chalk = require('chalk');
const log = require('webpack-log');

const onFinished = require('on-finished');
const destroy = require('destroy');

const {BACKEND_JS_PATH} = require('./constants');

// 简化的日志实现，替代 webpack-log
// const logger = {
//     debug: process.env.DEBUG ? (...args) => console.log(chalk.gray('[DEBUG]'), ...args) : () => {},
//     info: (...args) => console.log(chalk.blue('[INFO]'), ...args),
//     warn: (...args) => console.warn(chalk.yellow('[WARN]'), ...args),
//     error: (...args) => console.error(chalk.red('[ERROR]'), ...args)
// };
// exports.logger = logger;

const logger = log({
    name: 'RemoteDevtools',
    level: process.env.DEBUG ? 'debug' : 'info'
});
exports.logger = logger;

exports.truncate = function truncate(txt, width = 10) {
    if (!txt) {
        return '';
    }
    const ellipsis = '...';
    const len = txt.length;
    if (width > len) {
        return txt;
    }
    let end = width - ellipsis.length;
    if (end < 1) {
        return ellipsis;
    }
    return txt.slice(0, end) + ellipsis;
};
function getColorfulName(role) {
    role = role.toUpperCase();
    switch (role) {
        case 'FRONTEND':
            return chalk.blue(role);
        case 'BACKEND':
            // 为了对齐
            return chalk.cyan('BACK_END');
        case 'HOME':
            return chalk.magenta(role);
        case 'GET':
            return chalk.green(role);
    }
    return chalk.cyan(role);
}
exports.getColorfulName = getColorfulName;

exports.createBackendJSUrl = (address, port, isHttps = false) => {
    const protocol = isHttps ? 'https' : 'http';
    return `${protocol}://${address}:${port}${BACKEND_JS_PATH}`;
};

exports.sendFileStreamToResponse = function sendFileStreamToResponse(absoluteFilePath, response, next) {
    let finished = false;
    const stream = fs.createReadStream(absoluteFilePath, {start: 0});
    stream.pipe(response);
    // response finished, done with the fd
    onFinished(response, function onfinished() {
        logger.debug(`${getColorfulName('GET')} ${chalk.green('200')} ${absoluteFilePath}`);
        finished = true;
        destroy(stream);
    });
    // error
    stream.on('error', function onerror(err) {
        if (finished) {
            return;
        }
        finished = true;
        destroy(stream);
        logger.error(`${getColorfulName('GET')} ${chalk.red('500')} ${absoluteFilePath}`);
        next(err);
        return;
    });
};
