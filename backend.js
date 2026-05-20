/**
 * Remote DevTools Backend Script - 使用 npm chobitsu 包
 */
(function() {
    'use strict';

    // 检查是否已经加载过
    if (window.__remote_devtools_backend_loaded__) {
        return;
    }
    window.__remote_devtools_backend_loaded__ = true;

    console.log('[Remote DevTools] Backend script loaded');

    // 直接 require chobitsu (打包时会被内联)
    const chobitsu = require('chobitsu');

    // 生成或获取 session ID
    function getSessionId(useCache = true) {
        const key = '$remote_devtool';
        const sessionStorage = window.sessionStorage;

        let sessionId;
        if (useCache && sessionStorage) {
            sessionId = sessionStorage.getItem(key);
            if (sessionId) {
                return sessionId;
            }
        }

        // 简化的 nanoid 实现
        sessionId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

        if (useCache && sessionStorage) {
            try {
                sessionStorage.setItem(key, sessionId);
            } catch (e) {
                console.warn('[Remote DevTools] Failed to store session ID');
            }
        }
        return sessionId;
    }

    // 基础工具函数
    function getFavicon() {
        const links = document.getElementsByTagName('link');
        for (let i = 0; i < links.length; i++) {
            const link = links[i];
            if ((link.rel || '').indexOf('icon') !== -1) {
                return link.href;
            }
        }
        return '';
    }

    function parseQuery(queryString) {
        const query = {};
        const pairs = (queryString[0] === '?' ? queryString.substr(1) : queryString).split('&');
        for (let i = 0; i < pairs.length; i++) {
            const pair = pairs[i].split('=');
            query[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
        }
        return query;
    }

    function getUrlParts(url) {
        const a = document.createElement('a');
        a.href = url;
        return {
            protocol: a.protocol,
            hostname: a.hostname,
            port: a.port,
            pathname: a.pathname,
            search: a.search,
            hash: a.hash
        };
    }

    // 获取当前脚本的 src 地址
    function getCurrentScriptSource() {
        // document.currentScript 是获取当前脚本最准确的方式
        if (document.currentScript) {
            return document.currentScript.getAttribute('src');
        }

        // 回退到获取文档中的所有脚本
        const scriptElements = document.scripts || [];
        const currentScript = scriptElements[scriptElements.length - 1];

        if (currentScript) {
            return currentScript.getAttribute('src');
        }

        // 如果都失败了，尝试从已知的脚本名称匹配
        const scripts = document.getElementsByTagName('script');
        for (let script of scripts) {
            if (script.src && (
                script.src.includes('ws-backend.js') ||
                script.src.includes('backend.js') ||
                script.src.includes('remote-devtools')
            )) {
                return script.getAttribute('src');
            }
        }

        return null;
    }

    // 从资源查询字符串或脚本源获取 URL
    function getUrlFromResourceQuery(resourceQuery) {
        if (!resourceQuery || resourceQuery === '') {
            // 如果没有资源查询，从 <script> 标签获取
            resourceQuery = getCurrentScriptSource();
        }

        if (!resourceQuery) {
            return null;
        }

        return resourceQuery
            // 去掉查询字符串开头的 `?` 以获得有效的 URL
            .replace(/^\?/, '')
            // 将第一个 `&` 替换为 `?` 以获得有效的查询字符串
            .replace(/&/, '?');
    }

    // 解析 URL 并返回各个部分
    function parseUrlParts(resourceQuery) {
        const urlString = getUrlFromResourceQuery(resourceQuery);
        if (!urlString) {
            return null;
        }

        try {
            const url = new URL(urlString);
            const query = {};

            // 解析查询参数 - 避免使用解构赋值
            url.searchParams.forEach(function(value, key) {
                query[key] = value;
            });

            return {
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port,
                pathname: url.pathname,
                search: url.search,
                hash: url.hash,
                query: query
            };
        } catch (error) {
            // 如果 URL 解析失败，尝试简单的字符串分割
            return getUrlParts(urlString);
        }
    }

    // 生成 WebSocket URL
    function createWebSocketUrl(urlParts, wsPath, urlQuery = {}) {
        if (!urlParts) {
            return null;
        }

        const query = urlParts.query || {};
        let { hostname, port } = urlParts;
        const protocol = location.protocol;

        const wsHost = query.wsHost || hostname;
        let wsPort = query.wsPort || port;

        // 构建 WebSocket URL
        const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
        let wsUrl = `${wsProtocol}//${wsHost}`;

        if (wsPort) {
            wsUrl += `:${wsPort}`;
        }

        wsUrl += wsPath;

        // 添加查询参数
        if (Object.keys(urlQuery).length > 0) {
            const params = new URLSearchParams(urlQuery);
            wsUrl += `?${params}`;
        }

        return wsUrl;
    }

    function createBackendSocketUrl(sessionId, pageInfo) {
        console.log('[Remote DevTools] Creating WebSocket URL...');

        // 1. 优先使用全局注入的配置变量
        const resourceQuery = window.__remote_devtools_ws_query__ || '';

        console.log('[Remote DevTools] Global config:', resourceQuery ? 'Found' : 'Not found');

        // 2. 解析 URL 部分
        const urlParts = parseUrlParts(resourceQuery);

        if (!urlParts) {
            console.error('[Remote DevTools] Cannot determine server URL from script source');
            return null;
        }

        console.log('[Remote DevTools] Parsed URL parts:', urlParts);

        // 3. 构建查询参数
        const params = {
            title: pageInfo.title,
            url: pageInfo.url,
            favicon: pageInfo.favicon
        };

        // 4. 生成 WebSocket URL
        const wsUrl = createWebSocketUrl(urlParts, `/backend/${sessionId}`, params);

        if (!wsUrl) {
            console.error('[Remote DevTools] Failed to create WebSocket URL');
            return null;
        }

        console.log('[Remote DevTools] Generated WebSocket URL:', wsUrl);
        return wsUrl;
    }

    // WebSocket 连接管理
    function WebSocketConnection(url, sessionId) {
        this.url = url;
        this.sessionId = sessionId;
        this.ws = null;
        this.connected = false;
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.channels = new Map();

        // 诊断信息
        this.diagnostics = {
            connectionAttempts: 0,
            lastError: null,
            networkInfo: this.getNetworkInfo()
        };

        this.connect();
    }

    WebSocketConnection.prototype.getNetworkInfo = function() {
        return {
            userAgent: navigator.userAgent,
            onLine: navigator.onLine,
            cookieEnabled: navigator.cookieEnabled,
            language: navigator.language,
            platform: navigator.platform,
            currentUrl: location.href,
            protocol: location.protocol,
            host: location.host,
            // 代理检测
            proxyDetection: this.detectProxy()
        };
    };

    WebSocketConnection.prototype.detectProxy = function() {
        const detection = {
            possibleProxy: false,
            indicators: []
        };

        // 检测 Charles 等代理工具的常见特征
        if (navigator.userAgent.includes('Charles')) {
            detection.possibleProxy = true;
            detection.indicators.push('Charles proxy detected in User Agent');
        }

        // 检测协议升级（代理可能会修改协议）
        if (location.protocol === 'https:' && location.port === '8888') {
            detection.possibleProxy = true;
            detection.indicators.push('Common proxy port 8888 detected');
        }

        // 检测 localhost 但使用了 HTTPS（Charles 的典型行为）
        if (location.protocol === 'https:' &&
            (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
            detection.possibleProxy = true;
            detection.indicators.push('HTTPS on localhost (common with Charles proxy)');
        }

        // 检测证书相关问题的间接指标
        try {
            if (window.chrome && window.chrome.runtime) {
                detection.indicators.push('Chrome extension environment detected');
            }
        } catch (e) {
            // 忽略错误
        }

        return detection;
    };

    WebSocketConnection.prototype.validateUrl = function(url) {
        console.log('[Remote DevTools] Validating WebSocket URL:', url);

        try {
            const urlObj = new URL(url);

            // 基本验证
            if (!urlObj.protocol.match(/^wss?:$/)) {
                console.error('[Remote DevTools] Invalid WebSocket protocol:', urlObj.protocol);
                return false;
            }

            if (!urlObj.hostname) {
                console.error('[Remote DevTools] Missing hostname in URL');
                return false;
            }

            // 检查协议匹配
            const expectedProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            if (urlObj.protocol !== expectedProtocol) {
                console.warn(`[Remote DevTools] Protocol mismatch: expected ${expectedProtocol}, got ${urlObj.protocol}`);
                console.warn('[Remote DevTools] This might cause connection issues if page is served over HTTPS');
            }

            // 检查协议
            const port = urlObj.port || (urlObj.protocol === 'wss:' ? '443' : '80');
            console.log(`[Remote DevTools] Target server: ${urlObj.hostname}:${port}`);

            // 网络可达性提示
            if (urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1') {
                console.warn('[Remote DevTools] Using localhost - make sure the server is accessible from the current device');
            }

            // 检查 HTTPS/WSS 配置
            if (location.protocol === 'https:' && urlObj.protocol === 'ws:') {
                console.error('[Remote DevTools] ⚠️ Protocol mismatch: HTTPS page cannot connect to WS (non-secure WebSocket)');
                console.error('[Remote DevTools] 💡 Solution: Start server with HTTPS enabled:');
                console.error('[Remote DevTools]    remote-devtools --https');
                return false;
            }

            // 检查服务器是否支持 WSS
            if (urlObj.protocol === 'wss:') {
                console.log('[Remote DevTools] 🔒 WSS connection - make sure server started with --https flag');
            }

            return true;
        } catch (error) {
            console.error('[Remote DevTools] Invalid URL format:', error);
            return false;
        }
    };

    WebSocketConnection.prototype.connect = function() {
        // URL 验证
        if (!this.validateUrl(this.url)) {
            console.error('[Remote DevTools] URL validation failed, aborting connection');
            return;
        }

        this.diagnostics.connectionAttempts++;
        console.log(`[Remote DevTools] Connection attempt #${this.diagnostics.connectionAttempts}`);
        console.log('[Remote DevTools] Network status:', this.diagnostics.networkInfo);

        try {
            console.log('[Remote DevTools] Creating WebSocket connection...');
            this.ws = new WebSocket(this.url);

            this.ws.onopen = () => {
                console.log('[Remote DevTools] ✅ WebSocket connected successfully');
                this.connected = true;
                this.reconnectAttempts = 0;
                this.diagnostics.lastError = null;

                // 发送初始连接消息
                this.sendSystemMessage({
                    event: 'connected',
                    payload: {
                        sessionId: this.sessionId,
                        userAgent: navigator.userAgent,
                        url: location.href,
                        title: document.title,
                        timestamp: Date.now(),
                        diagnostics: this.diagnostics
                    }
                });

                this.setupChromeDevTools();
            };

            this.ws.onclose = (event) => {
                console.log('[Remote DevTools] ❌ WebSocket connection closed');
                console.log('[Remote DevTools] Close event details:', {
                    code: event.code,
                    reason: event.reason,
                    wasClean: event.wasClean
                });

                // 记录关闭原因
                this.diagnostics.lastError = {
                    type: 'close',
                    code: event.code,
                    reason: event.reason || 'No reason provided',
                    wasClean: event.wasClean,
                    timestamp: Date.now()
                };

                this.connected = false;
                this.scheduleReconnect();
            };

            this.ws.onerror = (error) => {
                console.error('[Remote DevTools] ❌ WebSocket error occurred');
                console.error('[Remote DevTools] Error event:', error);

                // 详细的错误诊断
                const errorDiagnostics = {
                    type: 'error',
                    message: error.message || 'Unknown error',
                    timestamp: Date.now(),
                    url: this.url,
                    readyState: this.ws ? this.ws.readyState : 'undefined',
                    networkOnline: navigator.onLine
                };

                this.diagnostics.lastError = errorDiagnostics;

                console.group('[Remote DevTools] Connection Diagnostics');
                console.log('🔗 Target URL:', this.url);
                console.log('🌐 Network Online:', navigator.onLine);
                console.log('📱 User Agent:', navigator.userAgent.substring(0, 100) + '...');
                console.log('🔒 Current Protocol:', location.protocol);
                console.log('🏠 Current Host:', location.host);
                console.log('📊 WebSocket ReadyState:', this.ws ? this.ws.readyState : 'undefined');
                console.log('🔄 Connection Attempts:', this.diagnostics.connectionAttempts);

                if (this.diagnostics.lastError) {
                    console.log('⚠️ Last Error:', this.diagnostics.lastError);
                }

                // 常见问题提示
                console.group('💡 Troubleshooting Tips');

                // Charles 代理相关提示
                const proxyDetection = this.diagnostics.networkInfo.proxyDetection;
                if (proxyDetection && proxyDetection.possibleProxy) {
                    console.log('🔍 Proxy detected! Charles or similar proxy tools can affect WebSocket connections:');
                    proxyDetection.indicators.forEach(indicator => {
                        console.log('  - ' + indicator);
                    });
                    console.log('');
                    console.log('📋 Charles Proxy Solutions:');
                    console.log('  1. Enable WebSocket support in Charles:');
                    console.log('     • Proxy → Proxy Settings → SSL → Enable SSL Proxying');
                    console.log('     • Add your server host:port to SSL Proxying locations');
                    console.log('  2. Or bypass proxy for WebSocket connections:');
                    console.log('     • Proxy → Proxy Settings → Bypass');
                    console.log('     • Add your server host to bypass list');
                    console.log('  3. Temporarily disable Charles to test direct connection');
                    console.log('');
                }

                if (this.url.includes('localhost') || this.url.includes('127.0.0.1')) {
                    console.log('• You are connecting to localhost. Make sure:');
                    console.log('  - The server is running on the target device');
                    console.log('  - Use the actual IP address instead of localhost for remote devices');
                }

                if (location.protocol === 'https:' && this.url.startsWith('ws:')) {
                    console.log('• ⚠️ HTTPS/WSS Configuration Issue:');
                    console.log('  - HTTPS page trying to connect to WS (not WSS)');
                    console.log('  - This will be blocked by browsers for security reasons');
                    console.log('');
                    console.log('• 🔧 Solutions:');
                    console.log('  1. Start server with HTTPS support:');
                    console.log('     remote-devtools --https');
                    console.log('  2. Then update your configuration to use WSS:');
                    console.log('     window.__remote_devtools_ws_query__ = "https://your-ip:port?ws=1&wsHost=your-ip&wsPort=port"');
                    console.log('  3. Or serve your page over HTTP instead of HTTPS');
                    if (proxyDetection && proxyDetection.possibleProxy) {
                        console.log('  4. Charles proxy might be upgrading HTTP to HTTPS automatically');
                        console.log('     - Try bypassing your page domain in Charles settings');
                    }
                    console.log('');
                }

                if (!navigator.onLine) {
                    console.log('• Device appears to be offline');
                    console.log('  - Check your internet connection');
                }

                console.log('• General troubleshooting:');
                console.log('  - Check if the server is accessible from this device');
                console.log('  - Verify firewall/proxy settings');
                console.log('  - Try accessing the server URL directly in browser');
                if (proxyDetection && proxyDetection.possibleProxy) {
                    console.log('  - Test without proxy tools like Charles');
                }
                console.groupEnd();
                console.groupEnd();
            };

            this.ws.onmessage = (event) => {
                this.handleRawMessage(event.data);
            };

        } catch (error) {
            console.error('[Remote DevTools] ❌ Failed to create WebSocket connection:', error);
            this.diagnostics.lastError = {
                type: 'constructor_error',
                message: error.message,
                stack: error.stack,
                timestamp: Date.now()
            };
            this.scheduleReconnect();
        }
    };

    WebSocketConnection.prototype.handleRawMessage = function(rawMessage) {
        try {
            if (rawMessage.startsWith('@')) {
                // 解析通道消息: @channelName\nmessage
                const newlineIndex = rawMessage.indexOf('\n');
                if (newlineIndex !== -1) {
                    const channelName = rawMessage.substring(1, newlineIndex);
                    const message = rawMessage.substring(newlineIndex + 1);
                    this.handleChannelMessage(channelName, message);
                }
            } else {
                // 系统消息
                const data = JSON.parse(rawMessage);
                this.handleSystemMessage(data);
            }
        } catch (error) {
            console.error('[Remote DevTools] Failed to handle message:', error);
        }
    };

    WebSocketConnection.prototype.handleChannelMessage = function(channelName, message) {
        if (channelName === 'chii' && chobitsu) {
            chobitsu.sendRawMessage(message);
        }
    };

    WebSocketConnection.prototype.handleSystemMessage = function(data) {
        console.log('[Remote DevTools] System message:', data.event);
    };

    WebSocketConnection.prototype.sendChannelMessage = function(channelName, message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const channelMessage = `@${channelName}\n${message}`;
            this.ws.send(channelMessage);
        }
    };

    WebSocketConnection.prototype.sendSystemMessage = function(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const message = JSON.stringify(data);
            this.ws.send(message);
        }
    };

    WebSocketConnection.prototype.scheduleReconnect = function() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[Remote DevTools] Max reconnection attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

        console.log(`[Remote DevTools] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, delay);
    };

    // Chrome DevTools 集成 - 直接使用 require 的 chobitsu
    WebSocketConnection.prototype.setupChromeDevTools = function() {
        const self = this;

        if (chobitsu) {
            console.log('[Remote DevTools] Chobitsu loaded via require()');

            // 设置 chobitsu 消息处理
            chobitsu.setOnMessage(function(message) {
                self.sendChannelMessage('chii', message);
            });

            console.log('[Remote DevTools] Chrome DevTools integration ready');
        } else {
            console.warn('[Remote DevTools] Chobitsu not available');
        }
    };

    // 页面监控
    function setupPageMonitoring(wsConnection) {
        let lastTitle = document.title;
        let lastUrl = location.href;

        function sendPageUpdate() {
            wsConnection.sendSystemMessage({
                event: 'pageUpdate',
                payload: {
                    title: lastTitle,
                    url: lastUrl,
                    favicon: getFavicon(),
                    timestamp: Date.now()
                }
            });
        }

        // 监听标题变化
        const titleObserver = new MutationObserver(() => {
            if (document.title !== lastTitle) {
                lastTitle = document.title;
                sendPageUpdate();
            }
        });

        titleObserver.observe(document.querySelector('title') || document.head, {
            childList: true,
            subtree: true
        });

        // 监听 URL 变化 (SPA)
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function() {
            originalPushState.apply(history, arguments);
            setTimeout(() => {
                if (location.href !== lastUrl) {
                    lastUrl = location.href;
                    sendPageUpdate();
                }
            }, 0);
        };

        history.replaceState = function() {
            originalReplaceState.apply(history, arguments);
            setTimeout(() => {
                if (location.href !== lastUrl) {
                    lastUrl = location.href;
                    sendPageUpdate();
                }
            }, 0);
        };

        window.addEventListener('popstate', () => {
            setTimeout(() => {
                if (location.href !== lastUrl) {
                    lastUrl = location.href;
                    sendPageUpdate();
                }
            }, 0);
        });

        // 发送初始页面信息
        sendPageUpdate();
    }

    // 初始化状态管理
    let initializationState = {
        initialized: false,
        attempts: 0,
        maxAttempts: 50, // 最多轮询 50 次 (5 秒)
        interval: 100,   // 每 100ms 检查一次
        timer: null
    };

    // 主初始化函数
    function initRemoteDevTools() {
        // 如果已经初始化过，直接返回
        if (initializationState.initialized) {
            console.log('[Remote DevTools] Already initialized');
            return;
        }

        console.log('[Remote DevTools] Initializing...');

        const sessionId = getSessionId();
        const pageInfo = {
            title: document.title || 'Untitled',
            url: location.href,
            favicon: getFavicon()
        };

        const wsUrl = createBackendSocketUrl(sessionId, pageInfo);
        if (!wsUrl) {
            console.error('[Remote DevTools] Failed to create WebSocket URL');
            return false;
        }

        const wsConnection = new WebSocketConnection(wsUrl, sessionId);
        setupPageMonitoring(wsConnection);

        // 暴露调试接口
        window.__remote_devtools__ = {
            sessionId: sessionId,
            wsConnection: wsConnection,
            version: '1.0.0',
            init: initRemoteDevTools, // 暴露手动初始化方法
            // 诊断工具
            getDiagnostics: function() {
                return wsConnection.diagnostics;
            },
            getConnectionStatus: function() {
                return {
                    connected: wsConnection.connected,
                    url: wsConnection.url,
                    attempts: wsConnection.diagnostics.connectionAttempts,
                    lastError: wsConnection.diagnostics.lastError,
                    networkInfo: wsConnection.diagnostics.networkInfo
                };
            },
            // 手动重连
            reconnect: function() {
                console.log('[Remote DevTools] Manual reconnection triggered');
                wsConnection.connect();
            },
            // 测试网络连接
            testConnection: function() {
                console.log('[Remote DevTools] Testing connection...');
                console.log('Current status:', this.getConnectionStatus());
                return this.getConnectionStatus();
            }
        };

        initializationState.initialized = true;
        console.log('[Remote DevTools] Initialization complete');
        return true;
    }

    // 轮询检查全局变量并尝试初始化
    function tryInitializeWithPolling() {
        initializationState.attempts++;

        console.log(`[Remote DevTools] Polling attempt ${initializationState.attempts}/${initializationState.maxAttempts}`);

        // 尝试初始化
        if (initRemoteDevTools()) {
            // 初始化成功，清除定时器
            if (initializationState.timer) {
                clearInterval(initializationState.timer);
                initializationState.timer = null;
            }
            console.log('[Remote DevTools] Initialization successful after polling');
            return;
        }

        // 如果达到最大尝试次数，停止轮询
        if (initializationState.attempts >= initializationState.maxAttempts) {
            if (initializationState.timer) {
                clearInterval(initializationState.timer);
                initializationState.timer = null;
            }
            console.warn('[Remote DevTools] Initialization failed after maximum polling attempts');
            console.warn('[Remote DevTools] You can try calling window.__remote_devtools__.init() manually after setting the global config');
            return;
        }
    }

    // 启动轮询初始化
    function startPollingInitialization() {
        console.log('[Remote DevTools] Starting polling initialization...');

        // 立即尝试一次
        if (initRemoteDevTools()) {
            return;
        }

        // 开始轮询
        initializationState.timer = setInterval(tryInitializeWithPolling, initializationState.interval);
    }

    // 智能初始化策略
    function startInitialization() {
        // 1. 如果全局变量已经存在，直接初始化
        if (window.__remote_devtools_ws_query__) {
            console.log('[Remote DevTools] Global config found, initializing immediately');
            initRemoteDevTools();
            return;
        }

        // 2. 如果从脚本标签能获取到配置，也直接初始化
        const scriptSource = getCurrentScriptSource();
        if (scriptSource) {
            console.log('[Remote DevTools] Script source available, initializing immediately');
            if (initRemoteDevTools()) {
                return;
            }
        }

        // 3. 否则启动轮询等待全局变量
        console.log('[Remote DevTools] No config found, starting polling for global variable');
        startPollingInitialization();
    }

    // 确保 DOM 加载完成后开始初始化流程
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startInitialization);
    } else {
        startInitialization();
    }
})();
