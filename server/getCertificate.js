/**
 * from https://github.com/webpack/webpack-dev-server/blob/e80976320d/lib/utils/getCertificate.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');
const findCacheDir = require('find-cache-dir');
const selfsigned = require('selfsigned');

// 获取包含 Homebrew 路径的环境变量（Electron 打包后 PATH 不含 /opt/homebrew/bin）
function getMkcertEnv() {
    return {
        ...process.env,
        PATH: ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || ''].join(':')
    };
}

// 检查 mkcert 是否可用
function checkMkcertAvailable() {
    try {
        execSync('mkcert -version', { stdio: 'ignore', env: getMkcertEnv() });
        return true;
    } catch (error) {
        return false;
    }
}

// 验证证书是否对指定域名有效且在有效期内
function validateCertificate(certPath, keyPath, domains, logger) {
    try {
        if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
            return { valid: false, reason: 'Certificate or key file not found' };
        }

        const certContent = fs.readFileSync(certPath, 'utf8');
        const keyContent = fs.readFileSync(keyPath, 'utf8');

        // 解析证书
        let cert;
        try {
            cert = crypto.X509Certificate ? new crypto.X509Certificate(certContent) : null;
        } catch (error) {
            return { valid: false, reason: 'Failed to parse certificate: ' + error.message };
        }

        if (!cert) {
            // Node.js < 15.6.0 不支持 X509Certificate，使用 openssl 命令验证
            return validateCertificateWithOpenSSL(certPath, domains, logger);
        }

        // 检查证书有效期
        const now = new Date();
        const validFrom = new Date(cert.validFrom);
        const validTo = new Date(cert.validTo);

        if (now < validFrom) {
            return { valid: false, reason: 'Certificate is not yet valid' };
        }

        if (now > validTo) {
            return { valid: false, reason: 'Certificate has expired' };
        }

        // 检查域名匹配
        const certDomains = [];

        // 获取 Subject CN
        const subject = cert.subject;
        const cnMatch = subject.match(/CN=([^,\s]+)/);
        if (cnMatch) {
            certDomains.push(cnMatch[1]);
        }

        // 获取 SAN (Subject Alternative Names)
        try {
            const sanExtension = cert.subjectAltName;
            if (sanExtension) {
                const sanDomains = sanExtension.split(', ').map(san => {
                    if (san.startsWith('DNS:')) {
                        return san.substring(4);
                    } else if (san.startsWith('IP Address:')) {
                        return san.substring(11);
                    }
                    return null;
                }).filter(Boolean);
                certDomains.push(...sanDomains);
            }
        } catch (error) {
            logger.debug('Failed to parse SAN extension:', error.message);
        }

        // 检查是否所有请求的域名都在证书中
        const missingDomains = domains.filter(domain => {
            return !certDomains.some(certDomain => {
                // 支持通配符匹配
                if (certDomain.startsWith('*.')) {
                    const baseDomain = certDomain.substring(2);
                    return domain.endsWith('.' + baseDomain) || domain === baseDomain;
                }
                return domain === certDomain;
            });
        });

        if (missingDomains.length > 0) {
            return {
                valid: false,
                reason: `Certificate does not cover domains: ${missingDomains.join(', ')}`,
                certDomains,
                missingDomains
            };
        }

        // 验证私钥匹配
        try {
            const publicKey = cert.publicKey;
            const privateKey = crypto.createPrivateKey(keyContent);
            const testData = 'test-data-for-key-verification';

            // 使用私钥签名
            const sign = crypto.createSign('SHA256');
            sign.update(testData);
            const signature = sign.sign(privateKey);

            // 使用公钥验证
            const verify = crypto.createVerify('SHA256');
            verify.update(testData);
            const isValid = verify.verify(publicKey, signature);

            if (!isValid) {
                return { valid: false, reason: 'Private key does not match certificate' };
            }
        } catch (error) {
            return { valid: false, reason: 'Failed to verify key pair: ' + error.message };
        }

        return {
            valid: true,
            validFrom,
            validTo,
            certDomains,
            daysUntilExpiry: Math.floor((validTo - now) / (1000 * 60 * 60 * 24))
        };

    } catch (error) {
        return { valid: false, reason: 'Certificate validation error: ' + error.message };
    }
}

// 使用 openssl 命令验证证书（兼容旧版本 Node.js）
function validateCertificateWithOpenSSL(certPath, domains, logger) {
    try {
        // 检查证书有效期
        const validityOutput = execSync(`openssl x509 -in "${certPath}" -noout -dates`, { encoding: 'utf8' });
        const notBeforeMatch = validityOutput.match(/notBefore=(.+)/);
        const notAfterMatch = validityOutput.match(/notAfter=(.+)/);

        if (!notBeforeMatch || !notAfterMatch) {
            return { valid: false, reason: 'Failed to parse certificate validity dates' };
        }

        const validFrom = new Date(notBeforeMatch[1]);
        const validTo = new Date(notAfterMatch[1]);
        const now = new Date();

        if (now < validFrom || now > validTo) {
            return { valid: false, reason: 'Certificate is expired or not yet valid' };
        }

        // 检查域名
        const subjectOutput = execSync(`openssl x509 -in "${certPath}" -noout -subject`, { encoding: 'utf8' });
        const sanOutput = execSync(`openssl x509 -in "${certPath}" -noout -text | grep -A1 "Subject Alternative Name" || echo ""`, { encoding: 'utf8' });

        const certDomains = [];

        // 解析 Subject CN
        const cnMatch = subjectOutput.match(/CN\s*=\s*([^,\s]+)/);
        if (cnMatch) {
            certDomains.push(cnMatch[1]);
        }

        // 解析 SAN
        if (sanOutput.includes('DNS:') || sanOutput.includes('IP Address:')) {
            const sanMatches = sanOutput.match(/(DNS|IP Address):([^,\s]+)/g);
            if (sanMatches) {
                sanMatches.forEach(match => {
                    const domain = match.split(':')[1];
                    if (domain) {
                        certDomains.push(domain);
                    }
                });
            }
        }

        // 检查域名覆盖
        const missingDomains = domains.filter(domain => {
            return !certDomains.some(certDomain => {
                if (certDomain.startsWith('*.')) {
                    const baseDomain = certDomain.substring(2);
                    return domain.endsWith('.' + baseDomain) || domain === baseDomain;
                }
                return domain === certDomain;
            });
        });

        if (missingDomains.length > 0) {
            return {
                valid: false,
                reason: `Certificate does not cover domains: ${missingDomains.join(', ')}`,
                certDomains,
                missingDomains
            };
        }

        return {
            valid: true,
            validFrom,
            validTo,
            certDomains,
            daysUntilExpiry: Math.floor((validTo - now) / (1000 * 60 * 60 * 24))
        };

    } catch (error) {
        return { valid: false, reason: 'OpenSSL validation failed: ' + error.message };
    }
}

// 获取 mkcert 根目录
function getMkcertCAROOT() {
    try {
        return execSync('mkcert -CAROOT', { encoding: 'utf8', env: getMkcertEnv() }).trim();
    } catch (error) {
        // 如果 mkcert 不可用，使用默认路径
        return path.join(process.env.HOME || process.env.USERPROFILE, '.local', 'share', 'mkcert');
    }
}

// 根据服务器配置生成域名列表
function generateDomainList(serverConfig) {
    const domains = ['localhost', '127.0.0.1'];

    // 添加服务器实际地址
    if (serverConfig.serverAddress &&
        serverConfig.serverAddress !== '0.0.0.0' &&
        !domains.includes(serverConfig.serverAddress)) {
        domains.push(serverConfig.serverAddress);
    }

    // 添加 hostname（如果不是通配符地址）
    if (serverConfig.hostname &&
        serverConfig.hostname !== '0.0.0.0' &&
        serverConfig.hostname !== '127.0.0.1' &&
        serverConfig.hostname !== 'localhost' &&
        !domains.includes(serverConfig.hostname)) {
        domains.push(serverConfig.hostname);
    }

    return domains;
}

// 为指定域名生成或获取 mkcert 证书
function setupMkcertCertificate(domains, logger, certDir) {
    const domainString = domains.join(' ');
    const certName = domains.join('+');

    // 使用传入目录；回退到根目录（避免 process.cwd() 在打包后不可写）
    certDir = certDir || path.join(os.homedir(), '.remote-devtools', 'certs');
    try {
        fs.mkdirSync(certDir, { recursive: true });
    } catch (e) {
        // 目录创建失败时使用临时目录
        certDir = path.join(os.tmpdir(), 'remote-devtools-certs');
        fs.mkdirSync(certDir, { recursive: true });
    }
    let certFile = path.join(certDir, `${certName}.pem`);
    let keyFile = path.join(certDir, `${certName}-key.pem`);

    // 检查是否已有有效的证书文件
    let needsGeneration = true;
    let existingCertFile = null;
    let existingKeyFile = null;

    try {
        if (fs.existsSync(certDir)) {
            // 查找所有可能的证书文件
            const allFiles = fs.readdirSync(certDir);
            const certFiles = allFiles.filter(f => f.endsWith('.pem') && !f.endsWith('-key.pem'));

            logger.debug(`Found ${certFiles.length} potential certificate files in ${certDir}`);

            // 遍历所有证书文件，找到第一个有效的
            for (const certFileName of certFiles) {
                const potentialCertFile = path.join(certDir, certFileName);
                const potentialKeyFile = path.join(certDir, certFileName.replace('.pem', '-key.pem'));

                logger.debug(`Checking certificate: ${potentialCertFile}`);

                // 使用严格验证检查证书
                const validation = validateCertificate(potentialCertFile, potentialKeyFile, domains, logger);

                if (validation.valid) {
                    logger.info(`✅ Found valid existing certificate: ${certFileName}`);
                    logger.info(`   - Covers domains: ${validation.certDomains.join(', ')}`);
                    logger.info(`   - Valid until: ${validation.validTo.toISOString()}`);
                    logger.info(`   - Days until expiry: ${validation.daysUntilExpiry}`);

                    needsGeneration = false;
                    existingCertFile = potentialCertFile;
                    existingKeyFile = potentialKeyFile;
                    certFile = existingCertFile;
                    keyFile = existingKeyFile;
                    break;
                } else {
                    logger.debug(`❌ Certificate ${certFileName} is invalid: ${validation.reason}`);
                    if (validation.certDomains) {
                        logger.debug(`   - Certificate covers: ${validation.certDomains.join(', ')}`);
                    }
                    if (validation.missingDomains) {
                        logger.debug(`   - Missing domains: ${validation.missingDomains.join(', ')}`);
                    }
                }
            }

            if (needsGeneration && certFiles.length > 0) {
                logger.info(`🔄 No valid certificate found for domains: ${domains.join(', ')}`);
                logger.info(`   Will generate new certificate...`);
            }
        }
    } catch (error) {
        logger.warn('Failed to check existing certificates:', error.message);
    }

    if (needsGeneration) {
        try {
            logger.info(`🔨 Generating mkcert certificate...`);

            // 使用 -cert-file / -key-file 直接指定输出路径，避免 process.chdir 影响整个进程
            execSync(
                `mkcert -cert-file "${certFile}" -key-file "${keyFile}" ${domainString}`,
                { encoding: 'utf8', stdio: 'pipe', env: getMkcertEnv() }
            );

            logger.info('✅ Mkcert certificate generated successfully');
        } catch (error) {
            logger.error('❌ Failed to generate mkcert certificate:', error.message);
            return null;
        }
    }

    // 验证文件是否存在并读取
    if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
        try {
            const key = fs.readFileSync(keyFile, 'utf8');
            const cert = fs.readFileSync(certFile, 'utf8');

            return {
                key,
                cert
            };
        } catch (error) {
            logger.error('❌ Failed to read mkcert certificate files:', error.message);
            return null;
        }
    }

    return null;
}

// 1. 尝试使用命令行指定的自定义证书
function tryCustomCertificate(httpsOptions, logger, serverConfig) {
    if (!httpsOptions.cert || !httpsOptions.key) {
        return null;
    }

    logger.info('🔒 Using custom certificate files');

    try {
        // 验证文件是否存在
        if (!fs.existsSync(httpsOptions.cert)) {
            throw new Error(`Certificate file not found: ${httpsOptions.cert}`);
        }
        if (!fs.existsSync(httpsOptions.key)) {
            throw new Error(`Private key file not found: ${httpsOptions.key}`);
        }

        // 生成当前服务器需要的域名列表
        const domains = generateDomainList(serverConfig);
        logger.info(`🔍 Validating custom certificate for domains: ${domains.join(', ')}`);

        // 验证证书有效性和域名匹配
        const validation = validateCertificate(httpsOptions.cert, httpsOptions.key, domains, logger);

        if (!validation.valid) {
            logger.warn(`⚠️ Custom certificate validation failed: ${validation.reason}`);
            if (validation.certDomains) {
                logger.warn(`   - Certificate covers: ${validation.certDomains.join(', ')}`);
            }
            if (validation.missingDomains) {
                logger.warn(`   - Missing domains: ${validation.missingDomains.join(', ')}`);
            }
            logger.warn('   - Continuing with potentially incompatible certificate...');
        } else {
            logger.info(`✅ Custom certificate is valid`);
            logger.info(`   - Covers domains: ${validation.certDomains.join(', ')}`);
            logger.info(`   - Valid until: ${validation.validTo.toISOString()}`);
            logger.info(`   - Days until expiry: ${validation.daysUntilExpiry}`);
        }

        // 读取证书和私钥
        const cert = fs.readFileSync(httpsOptions.cert, 'utf8');
        const key = fs.readFileSync(httpsOptions.key, 'utf8');

        // 自定义证书加载成功
        return { key, cert };
    } catch (error) {
        logger.error('❌ Failed to load custom certificate files:', error.message);
        return null;
    }
}

// 2. 尝试使用 mkcert 生成受信任证书
function tryMkcertCertificate(httpsOptions, logger) {
    if (!checkMkcertAvailable()) {
        logger.warn('❌ mkcert not available. Install with: brew install mkcert && mkcert -install');
        return null;
    }

    // 根据服务器配置生成域名列表
    const domains = generateDomainList(httpsOptions);

    const mkcertCert = setupMkcertCertificate(domains, logger, httpsOptions.certDir);
    if (mkcertCert) {
        logger.info('🔒 Using mkcert certificate (trusted)');
        return mkcertCert;
    } else {
        logger.warn('⚠️ mkcert certificate generation failed');
        return null;
    }
}

// 3. 生成自签名证书作为回退方案
function trySelfsignedCertificate(logger, serverConfig) {
    logger.warn('⚠️ Using self-signed certificate (will show browser warnings)');

    const serverIP = serverConfig && serverConfig.serverAddress;
    const certificateDir = findCacheDir({name: 'remote-devtools'}) || os.tmpdir();

    // 以服务器 IP 区分缓存文件名，确保 IP 变化时重新生成
    const ipSuffix = serverIP ? `-${serverIP.replace(/\./g, '_')}` : '';
    const certificatePath = path.join(certificateDir, `server${ipSuffix}.pem`);
    const certificateKeyPath = path.join(certificateDir, `server${ipSuffix}-key.pem`);

    let certificateExists = fs.existsSync(certificatePath) && fs.existsSync(certificateKeyPath);

    if (certificateExists) {
        const certificateTtl = 1000 * 60 * 60 * 24;
        const certificateStat = fs.statSync(certificatePath);
        const now = new Date();

        // cert is more than 30 days old, regenerate
        if ((now - certificateStat.ctime) / certificateTtl > 30) {
            try {
                fs.unlinkSync(certificatePath);
                fs.unlinkSync(certificateKeyPath);
            } catch (e) {
                // ignore error
            }
            certificateExists = false;
        }
    }

    if (!certificateExists) {
        // 静默生成自签名证书，包含服务器实际 IP 地址
        const attributes = [{name: 'commonName', value: serverIP || 'localhost'}];
        const pems = createCertificate(attributes, serverIP);

        fs.mkdirSync(certificateDir, {recursive: true});
        fs.writeFileSync(certificatePath, pems.cert, { encoding: 'utf8' });
        fs.writeFileSync(certificateKeyPath, pems.private, { encoding: 'utf8' });
    }

    // 读取并返回证书
    try {
        const cert = fs.readFileSync(certificatePath, 'utf8');
        const key = fs.readFileSync(certificateKeyPath, 'utf8');
        return { key, cert };
    } catch (error) {
        logger.error('❌ Failed to load self-signed certificate:', error.message);
        throw error;
    }
}

// 生成自签名证书，参考 webpack-dev-server 的实现
function createCertificate(attributes, serverIP) {
    const altNames = [
        { type: 2, value: 'localhost' },
        { type: 2, value: 'localhost.localdomain' },
        { type: 7, ip: '127.0.0.1' },
        { type: 7, ip: '::1' },
        { type: 7, ip: 'fe80::1' }
    ];

    // 动态添加服务器实际局域网 IP（避免 WSS 连接因 IP 不在 SAN 中被拒绝）
    if (serverIP && serverIP !== '127.0.0.1' && serverIP !== 'localhost') {
        altNames.push({ type: 7, ip: serverIP });
    }

    return selfsigned.generate(attributes, {
        algorithm: 'sha256',
        days: 30,
        keySize: 2048,
        extensions: [
            {
                name: 'keyUsage',
                keyCertSign: true,
                digitalSignature: true,
                nonRepudiation: true,
                keyEncipherment: true,
                dataEncipherment: true
            },
            {
                name: 'extKeyUsage',
                serverAuth: true,
                clientAuth: true,
                codeSigning: true,
                timeStamping: true
            },
            {
                name: 'subjectAltName',
                altNames
            }
        ]
    });
}

// 主函数：按优先级尝试不同的证书获取方式
function getCertificate(logger, serverConfig = {}) {

    // 1. 优先使用命令行指定的自定义证书
    const customCert = tryCustomCertificate(serverConfig, logger, serverConfig);
    if (customCert) {
        return {
            key: customCert.key,
            cert: customCert.cert
        };
    }

    // 2. 尝试使用 mkcert 生成受信任证书
    const mkcertCert = tryMkcertCertificate(serverConfig, logger);
    if (mkcertCert) {
        return {
            key: mkcertCert.key,
            cert: mkcertCert.cert
        };
    }

    // 3. 回退到自签名证书（传入 serverConfig 以便动态包含服务器 IP）
    const selfsignedCert = trySelfsignedCertificate(logger, serverConfig);
    return {
        key: selfsignedCert.key,
        cert: selfsignedCert.cert
    };
}

module.exports = getCertificate;