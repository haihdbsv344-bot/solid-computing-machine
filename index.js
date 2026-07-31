const axios = require('axios');
const express = require('express');
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');

// ======================
// CẤU HÌNH
// ======================
const BASE = "https://aibcr.me";
const LOGIN_URL = `${BASE}/login`;
const LOBBY_URL = `${BASE}/ae/lobby`;
const GETNEWRESULT_URL = `${BASE}/baccarat/getnewresult`;

const USERNAME = "Hoang2285";
const PASSWORD = "hoang2010";

// ======================
// PROXY CONFIG (tự động lấy proxy)
// ======================
let currentProxy = null;
let proxyList = [];

// Hàm lấy proxy miễn phí
async function fetchFreeProxies() {
    try {
        console.log('[PROXY] Đang lấy danh sách proxy...');
        const response = await axios.get('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all', {
            timeout: 10000
        });
        
        const proxies = response.data.split('\n')
            .filter(line => line.trim())
            .map(line => {
                const [ip, port] = line.split(':');
                return { ip, port: parseInt(port) };
            })
            .filter(p => p.ip && p.port);
        
        console.log(`[PROXY] Lấy được ${proxies.length} proxy`);
        proxyList = proxies;
        return proxies;
    } catch (error) {
        console.error('[PROXY] Lỗi lấy proxy:', error.message);
        return [];
    }
}

// Hàm kiểm tra proxy
async function testProxy(proxy) {
    try {
        const agent = new HttpsProxyAgent(`http://${proxy.ip}:${proxy.port}`);
        await axios.get('https://aibcr.me', {
            timeout: 10000,
            httpsAgent: agent
        });
        return true;
    } catch (error) {
        return false;
    }
}

// Hàm lấy proxy hoạt động
async function getWorkingProxy() {
    if (currentProxy) {
        // Kiểm tra proxy hiện tại
        const working = await testProxy(currentProxy);
        if (working) return currentProxy;
    }
    
    // Lấy proxy mới
    if (proxyList.length === 0) {
        await fetchFreeProxies();
    }
    
    for (const proxy of proxyList) {
        console.log(`[PROXY] Đang test ${proxy.ip}:${proxy.port}...`);
        const working = await testProxy(proxy);
        if (working) {
            console.log(`[PROXY] ✅ Proxy hoạt động: ${proxy.ip}:${proxy.port}`);
            currentProxy = proxy;
            return proxy;
        }
    }
    
    console.log('[PROXY] ⚠️ Không tìm thấy proxy hoạt động, dùng direct');
    return null;
}

// ======================
// TẠO SESSION
// ======================
let cookieJar = '';
let baccaratData = [];
let lastUpdate = null;
let isLoggedIn = false;
let isInLobby = false;
let session = null;

function createSession(proxy = null) {
    const config = {
        baseURL: BASE,
        timeout: 30000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        }
    };

    if (proxy) {
        config.httpsAgent = new HttpsProxyAgent(`http://${proxy.ip}:${proxy.port}`);
        console.log(`[SESSION] Dùng proxy: ${proxy.ip}:${proxy.port}`);
    } else {
        config.httpsAgent = new https.Agent({ 
            rejectUnauthorized: false,
            keepAlive: true
        });
        console.log('[SESSION] Dùng direct connection');
    }

    const newSession = axios.create(config);
    
    // Interceptor lưu cookie
    newSession.interceptors.request.use(config => {
        if (cookieJar) config.headers.Cookie = cookieJar;
        return config;
    });

    newSession.interceptors.response.use(res => {
        const setCookie = res.headers['set-cookie'];
        if (setCookie) {
            for (const cookie of setCookie) {
                const [name, value] = cookie.split(';')[0].split('=');
                const cookieStr = `${name}=${value}`;
                if (cookieJar.includes(`${name}=`)) {
                    cookieJar = cookieJar.replace(new RegExp(`${name}=[^;]+;?`), '');
                }
                cookieJar += `${cookieStr}; `;
            }
        }
        return res;
    }, error => {
        if (error.response) {
            console.error(`[HTTP ERROR] Status: ${error.response.status}`);
        }
        return Promise.reject(error);
    });

    return newSession;
}

// ======================
// LẤY CSRF TOKEN
// ======================
function getCsrfToken(html) {
    const match = html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/);
    return match ? match[1] : null;
}

// ======================
// ĐĂNG NHẬP
// ======================
async function login() {
    try {
        console.log('[LOGIN] Đang đăng nhập...');
        
        // Lấy proxy hoạt động nếu cần
        const proxy = await getWorkingProxy();
        session = createSession(proxy);
        
        const getResp = await session.get(LOGIN_URL, { timeout: 15000 });
        const token = getCsrfToken(getResp.data);
        
        if (!token) {
            console.error('[ERROR] Không tìm thấy CSRF token');
            return false;
        }
        
        const formData = new URLSearchParams();
        formData.append('username', USERNAME);
        formData.append('password', PASSWORD);
        formData.append('_token', token);
        formData.append('action', 'Login');
        
        const loginResp = await session.post(LOGIN_URL, formData.toString(), {
            headers: {
                'Referer': LOGIN_URL,
                'Origin': BASE,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 15000
        });
        
        if (loginResp.status === 200) {
            console.log('[OK] Đăng nhập thành công');
            isLoggedIn = true;
            return true;
        }
        return false;
    } catch (error) {
        console.error('[ERROR] Login:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
        }
        return false;
    }
}

// ======================
// VÀO LOBBY
// ======================
async function goToLobby() {
    try {
        console.log('[LOBBY] Đang vào lobby...');
        const response = await session.get(LOBBY_URL, {
            timeout: 60000
        });
        
        if (response.status === 200) {
            console.log('[OK] Vào lobby thành công');
            isInLobby = true;
            return true;
        }
        return false;
    } catch (error) {
        console.error('[LOBBY ERROR]:', error.message);
        return false;
    }
}

async function goToLobbyWithRetry(maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        console.log(`[LOBBY] Thử lần ${i + 1}/${maxRetries}...`);
        const success = await goToLobby();
        if (success) return true;
        
        if (i < maxRetries - 1) {
            const waitTime = 5000 * (i + 1);
            console.log(`[LOBBY] Chờ ${waitTime/1000} giây...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
    console.error('[ERROR] Không thể vào lobby');
    return false;
}

// ======================
// LẤY KẾT QUẢ BACCARAT
// ======================
async function fetchBaccaratData() {
    try {
        if (!isLoggedIn || !isInLobby) {
            console.warn('[WARN] Chưa đăng nhập, thử lại...');
            const loginOk = await login();
            if (!loginOk) return baccaratData;
            
            const lobbyOk = await goToLobbyWithRetry(2);
            if (!lobbyOk) return baccaratData;
        }
        
        let xsrfToken = '';
        const xsrfMatch = cookieJar.match(/XSRF-TOKEN=([^;]+)/);
        if (xsrfMatch) {
            xsrfToken = decodeURIComponent(xsrfMatch[1]);
        }
        
        const headers = {
            'Referer': LOBBY_URL,
            'Origin': BASE,
            'X-Requested-With': 'XMLHttpRequest',
            'X-XSRF-TOKEN': xsrfToken,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        };
        
        const formData = new URLSearchParams();
        formData.append('gameCode', 'ae');
        
        const resp = await session.post(GETNEWRESULT_URL, formData.toString(), {
            headers,
            timeout: 15000
        });
        
        if (resp.data && resp.data.data) {
            const newData = resp.data.data.map(item => ({
                table: item.table_name,
                result: item.result,
                shoeId: item.shoeId || '',
                round: item.round || ''
            }));
            
            if (newData.length > 0) {
                baccaratData = newData;
                lastUpdate = new Date().toISOString();
                console.log(`[FETCH] Đã cập nhật ${baccaratData.length} bàn`);
            }
        }
        return baccaratData;
    } catch (error) {
        console.error('[FETCH ERROR]:', error.message);
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
            isLoggedIn = false;
            isInLobby = false;
        }
        return baccaratData;
    }
}

// ======================
// VÒNG LẶP TỰ ĐỘNG
// ======================
async function autoUpdate() {
    let retryCount = 0;
    const MAX_RETRY = 5;
    
    while (true) {
        try {
            await fetchBaccaratData();
            retryCount = 0;
            await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (error) {
            console.error('[AUTO UPDATE ERROR]:', error.message);
            retryCount++;
            
            if (retryCount >= MAX_RETRY) {
                console.error('[ERROR] Quá nhiều lỗi, thử kết nối lại...');
                isLoggedIn = false;
                isInLobby = false;
                currentProxy = null; // Reset proxy để lấy proxy mới
                await login();
                await goToLobbyWithRetry(2);
                retryCount = 0;
            }
            
            await new Promise(resolve => setTimeout(resolve, 5000 * Math.min(retryCount, 3)));
        }
    }
}

// ======================
// API SERVER
// ======================
const app = express();

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        isLoggedIn,
        isInLobby,
        dataCount: baccaratData.length,
        lastUpdate,
        proxy: currentProxy ? `${currentProxy.ip}:${currentProxy.port}` : 'direct'
    });
});

app.get('/api/baccarat', (req, res) => {
    res.json({
        success: true,
        data: baccaratData,
        lastUpdate,
        total: baccaratData.length
    });
});

app.get('/api/baccarat/:table', (req, res) => {
    const found = baccaratData.find(item => item.table === req.params.table);
    if (found) {
        res.json({ success: true, data: found });
    } else {
        res.json({
            success: false,
            message: 'Không tìm thấy bàn ' + req.params.table
        });
    }
});

app.get('/api/latest', (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const latest = [...baccaratData].sort((a, b) => {
        const numA = parseInt(a.table) || 0;
        const numB = parseInt(b.table) || 0;
        return numB - numA;
    });
    res.json({
        success: true,
        data: latest.slice(0, limit),
        lastUpdate
    });
});

app.post('/api/refresh', async (req, res) => {
    try {
        const data = await fetchBaccaratData();
        res.json({
            success: true,
            message: 'Refresh thành công',
            total: data.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ======================
// KHỞI ĐỘNG
// ======================
async function start() {
    console.log('========================================');
    console.log('🃏 BACCARAT API SERVER v3.0');
    console.log('========================================');
    
    console.log('[INIT] Đang khởi tạo...');
    
    // Lấy proxy trước
    await fetchFreeProxies();
    
    console.log('[1] Đang đăng nhập...');
    const loginOk = await login();
    if (!loginOk) {
        console.error('[FATAL] Đăng nhập thất bại!');
        console.log('[RETRY] Thử lại sau 10 giây...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        // Thử lại lần nữa
        const retryLogin = await login();
        if (!retryLogin) {
            console.error('[FATAL] Vẫn thất bại, thoát...');
            process.exit(1);
        }
    }
    
    console.log('[2] Vào lobby...');
    await goToLobbyWithRetry(3);
    
    console.log('[3] Lấy dữ liệu lần đầu...');
    await fetchBaccaratData();
    console.log(`[OK] Đã lấy ${baccaratData.length} bàn`);
    
    if (baccaratData.length > 0) {
        console.log('\n📊 DANH SÁCH BÀN:');
        baccaratData.slice(0, 10).forEach(item => {
            const resultShort = item.result.substring(0, 40) + (item.result.length > 40 ? '...' : '');
            console.log(`   ${item.table.padEnd(6)}: ${resultShort}`);
        });
    } else {
        console.warn('[WARN] Không có dữ liệu bàn nào!');
    }
    
    // Chạy auto update
    autoUpdate();
    
    // Khởi động server
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 API SERVER ĐANG CHẠY:`);
        console.log(`   📍 Port: ${PORT}`);
        console.log(`   📍 Health: http://localhost:${PORT}/api/health`);
        console.log(`   📍 Data: http://localhost:${PORT}/api/baccarat`);
        console.log(`\n⏰ Auto update mỗi 3 giây`);
        console.log(`🔒 Status: ${isLoggedIn ? '✅ Đã đăng nhập' : '❌ Chưa đăng nhập'}`);
        console.log(`🌐 Proxy: ${currentProxy ? `${currentProxy.ip}:${currentProxy.port}` : 'Direct'}`);
    });
}

// Error handling
process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION]', reason);
});

process.on('uncaughtException', (error) => {
    console.error('[UNCAUGHT EXCEPTION]', error);
    // Không exit để server tiếp tục chạy
});

start();
