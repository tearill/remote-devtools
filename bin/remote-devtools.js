#!/usr/bin/env node

const path = require('path');
const os = require('os');
/* eslint-disable no-console */
const updateNotifier = require('update-notifier');
const semver = require('semver');
const chalk = require('chalk');

const {
    scriptName,
    engines: {node: requiredNodeVersion},
    name: pkgName,
    version: pkgVersion
} = require('../package.json');

const DEFAULT_PORT = 8899;

// set process
process.title = scriptName;

// 1. 检测 node 版本
checkNodeVersion(requiredNodeVersion, pkgName);
// 2. 检测最新版本
upNotifier(pkgVersion, pkgName);
// 3. 加载bin
require('yargs')
    .scriptName(scriptName)
    .detectLocale(false)
    .usage('Usage: $0 <command> [options]')
    .command(
        '$0',
        'Remote DevTools Server - Generic remote debugging server',
        {
            https: {
                default: false,
                type: 'boolean',
                describe: 'Use HTTPS protocol.'
            },
            cert: {
                type: 'string',
                describe: 'Path to SSL certificate file (PEM format).'
            },
            key: {
                type: 'string',
                describe: 'Path to SSL private key file (PEM format).'
            },
            port: {
                alias: 'p',
                type: 'number',
                describe: `Port to use [${DEFAULT_PORT}]`
            },
            address: {
                alias: 'a',
                type: 'string',
                describe: 'Address to use [0.0.0.0]'
            }
        },
        argv => {
            const portfinder = require('portfinder');
            const Server = require('../server/Server');
            const {BACKEND_JS_PATH} = require('../server/constants');
            let port = argv.port || parseInt(process.env.PORT, 10);
            const hostname = argv.address || '0.0.0.0';
            const https = argv.https;

            if (!port) {
                portfinder.basePort = DEFAULT_PORT;
                portfinder.getPort((err, p) => {
                    if (err) {
                        throw err;
                    }
                    port = p;
                    startServer();
                });
            } else {
                startServer();
            }
            function startServer() {
                const ifaces = os.networkInterfaces();
                const httpsOptions = https ? {} : null;

                // 如果指定了证书文件，添加到 HTTPS 配置中
                if (https && (argv.cert || argv.key)) {
                    if (argv.cert) httpsOptions.cert = argv.cert;
                    if (argv.key) httpsOptions.key = argv.key;
                }

                const options = {
                    https: httpsOptions,
                    port,
                    hostname,
                    root: path.join(__dirname, '../dist')
                };
                const server = new Server(options);

                server.listen(port, hostname, err => {
                    if (err) {
                        throw err;
                    }
                    const canonicalHost = hostname === '0.0.0.0' ? '127.0.0.1' : hostname;
                    const protocol = https ? 'https://' : 'http://';

                    console.log(
                        [
                            chalk.yellow('Starting up Remote DevTools Server, serving '),
                            chalk.cyan(server.root),
                            chalk.yellow('\nAvailable on:')
                        ].join('')
                    );
                    const urls = [];
                    if (argv.address && hostname !== '0.0.0.0') {
                        const url = '  ' + protocol + canonicalHost + ':' + chalk.green(port.toString());
                        urls.push(url);
                        console.log(url);
                    } else {
                        Object.keys(ifaces).forEach(dev => {
                            /* eslint-disable max-nested-callbacks */
                            ifaces[dev].forEach(details => {
                                if (details.family === 'IPv4') {
                                    const url = '  ' + protocol + details.address + ':' + chalk.green(port.toString());
                                    urls.push(url);
                                    console.log(url);
                                }
                            });
                        });
                    }
                    console.log('');

                    console.log(`👉 ${chalk.yellow('Usage:')} Add backend.js to your debugging target page.`);
                    console.log('');
                    console.log(chalk.yellow('Backend url:'));
                    urls.forEach(u => {
                        console.log(u + chalk.green(BACKEND_JS_PATH));
                    });
                    console.log('Hit CTRL-C to stop the server');
                    console.log('');

                    const home = server.getUrl();
                    // 发送消息：告诉工具链的兄弟们端口等信息
                    // eslint-disable-next-line operator-linebreak
                    process.send &&
                        process.send({
                            home,
                            backend: home.replace(/\/$/, '') + BACKEND_JS_PATH
                        });
                    require('opener')(home);
                });
            }
        }
    )
    .help('h')
    .alias('h', 'help')
    .alias('v', 'version').argv;

function checkNodeVersion(wanted, id) {
    if (!semver.satisfies(process.version, wanted)) {
        console.log(
            // prettier-ignore
            // eslint-disable-next-line
            'You are using Node ' + process.version + ', but this version of ' + id +
            ' requires ' + chalk.yellow('Node ' + wanted) + '.\nPlease upgrade your Node version.'
        );
        process.exit(1);
    }
}

function upNotifier(version, name) {
    let notifier;
    if (version && name) {
        // 检测版本更新
        notifier = updateNotifier({
            pkg: {
                name,
                version
            },
            updateCheckInterval: 1000 * 60 * 60 * 24 * 7, // 1 week
            isGlobal: true,
            // updateCheckInterval: 0,
            // npm script 也显示
            shouldNotifyInNpmScript: true
        });
    }
    ['SIGINT', 'SIGTERM'].forEach(signal => {
        process.on(signal, () => {
            notifier && notifier.notify();
            process.exit(0);
        });
    });
}

if (process.platform === 'win32') {
    require('readline')
        .createInterface({
            input: process.stdin,
            output: process.stdout
        })
        .on('SIGINT', () => {
            process.emit('SIGINT');
        });
}

process.on('SIGINT', () => {
    console.log(chalk.red('Remote DevTools server stopped.'));
    process.exit();
});

process.on('SIGTERM', () => {
    console.log(chalk.red('Remote DevTools server stopped.'));
    process.exit();
});
process.on('uncaughtException', error => {
    console.error(error);
    process.exit(1);
});

process.on('unhandledRejection', error => {
    console.error(error);
    process.exit(1);
});
