const axios = require('axios');
const express = require('express');
const https = require('https');

// ======================
// CẤU HÌNH
// ======================
const BASE = "https://aibcr.me";
const LOGIN_URL = `${BASE}/login`;
const LOBBY_URL = `${BASE}/ae/lobby`;
const GETNEWRESULT_URL = `${BASE}/baccarat/getnewresult`;

const USERNAME = "Hoang2285";
const PASSWORD = "hoang2010";

let cookieJar = '';
let baccaratData = [];
let lastUpdate = null;
let isLoggedIn = false;
let isRunning = true;

// ======================
// TẠO SESSION
// ======================
function createSession() {
    const agent = new https.Agent({
        rejectUnauthorized: false,
        keepAlive: true
    });

    const session = axios.create({
        baseURL: BASE,
        timeout: 60000,
        httpsAgent: agent,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        }
    });

    // Interceptor lưu cookie
    session.interceptors.request.use(config => {
        if (cookieJar) config.headers.Cookie = cookieJar;
        return config;
    });

    session.interceptors.response.use(res => {
        const setCookie = res.headers['set-cookie'];
        if (setCookie) {
            for (const cookie of setCookie) {
                const [name, value] = cookie.split(';')[0].split('=');
                if (cookieJar.includes(`${name}=`)) {
                    cookieJar = cookieJar.replace(new RegExp(`${name}=[^;]+;?`), '');
                }
                cookieJar += `${name}=${value}; `;
            }
        }
        return res;
    }, error => {
        if (error.response) {
            console.error(`[HTTP ERROR] Status: ${error.response.status}`);
        }
        return Promise.reject(error);
    });

    return session;
}

let session = createSession();

// ======================
// LẤY CSRF TOKEN
// ======================
function getCsrfToken(html) {
    const match = html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/);
    return match ? match[1] : null;
}

// ======================
// ĐĂNG NHẬP VỚI RETRY
// ======================
async function login(retryCount = 0) {
    try {
        console.log('[LOGIN] Đang đăng nhập...');
        
        const getResp = await session.get(LOGIN_URL, { timeout: 30000 });
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
            timeout: 30000
        });
        
        if (loginResp.status === 200) {
            console.log('[OK] ✅ Đăng nhập thành công');
            isLoggedIn = true;
            return true;
        }
        return false;
    } catch (error) {
        console.error('[LOGIN ERROR]:', error.message);
        
        if (retryCount < 3) {
            console.log(`[RETRY] Thử lại lần ${retryCount + 1}/3 sau 5 giây...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            return login(retryCount + 1);
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
        const response = await session.get(LOBBY_URL, { timeout: 60000 });
        
        if (response.status === 200) {
            console.log('[OK] ✅ Vào lobby thành công');
            return true;
        }
        return false;
    } catch (error) {
        console.error('[LOBBY ERROR]:', error.message);
        return false;
    }
}

// ======================
// LẤY KẾT QUẢ BACCARAT
// ======================
async function fetchBaccaratData() {
    try {
        if (!isLoggedIn) {
            console.warn('[WARN] Chưa đăng nhập, thử đăng nhập...');
            const loginOk = await login();
            if (!loginOk) return baccaratData;
            
            await goToLobby();
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
            timeout: 30000
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
                console.log(`[FETCH] ✅ Đã cập nhật ${baccaratData.length} bàn`);
            }
        }
        return baccaratData;
    } catch (error) {
        console.error('[FETCH ERROR]:', error.message);
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
            isLoggedIn = false;
        }
        return baccaratData;
    }
}

// ======================
// AUTO UPDATE
// ======================
async function autoUpdate() {
    while (isRunning) {
        try {
            await fetchBaccaratData();
            await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (error) {
            console.error('[AUTO ERROR]:', error.message);
            await new Promise(resolve => setTimeout(resolve, 10000));
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

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        isLoggedIn,
        dataCount: baccaratData.length,
        lastUpdate
    });
});

// Get all tables
app.get('/api/baccarat', (req, res) => {
    res.json({
        success: true,
        data: baccaratData,
        lastUpdate,
        total: baccaratData.length
    });
});

// Get table by name
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

// Get latest results
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

// Refresh data
app.post('/api/refresh', async (req, res) => {
    try {
        await fetchBaccaratData();
        res.json({
            success: true,
            message: 'Refresh thành công',
            total: baccaratData.length
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
    console.log('🃏 BACCARAT API SERVER v1.0');
    console.log('========================================');
    
    console.log('[1] Đang đăng nhập...');
    const loginOk = await login();
    if (!loginOk) {
        console.error('[ERROR] ❌ Đăng nhập thất bại!');
        console.log('[INFO] Server vẫn chạy nhưng sẽ thử lại tự động...');
    }
    
    console.log('[2] Vào lobby...');
    await goToLobby();
    
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
        console.warn('[WARN] ⚠️ Không có dữ liệu bàn nào!');
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
    });
}

// Error handling - KHÔNG EXIT KHI CÓ LỖI
process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION]', reason);
});

process.on('uncaughtException', (error) => {
    console.error('[UNCAUGHT EXCEPTION]', error);
    // Không exit để server tiếp tục chạy
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[SHUTDOWN] Đang tắt server...');
    isRunning = false;
    process.exit(0);
});

start();
