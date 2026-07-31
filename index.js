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

const agent = new https.Agent({ rejectUnauthorized: false });
let cookieJar = '';
let baccaratData = [];
let lastUpdate = null;
let isLoggedIn = false;
let isInLobby = false;

// ======================
// SESSION AXIOS
// ======================
const session = axios.create({
    baseURL: BASE,
    timeout: 30000,
    httpsAgent: agent,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
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
    // Log chi tiết lỗi response
    if (error.response) {
        console.error(`[HTTP ERROR] Status: ${error.response.status}, Data:`, error.response.data);
    }
    return Promise.reject(error);
});

// ======================
// LẤY CSRF TOKEN
// ======================
function getCsrfToken(html) {
    const match = html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/);
    return match ? match[1] : null;
}

// ======================
// KIỂM TRA KẾT NỐI
// ======================
async function checkConnectivity() {
    try {
        console.log('[CHECK] Kiểm tra kết nối đến server...');
        await axios.get('https://aibcr.me', {
            timeout: 10000,
            httpsAgent: agent
        });
        console.log('[OK] Kết nối thành công');
        return true;
    } catch (error) {
        console.error('[ERROR] Không thể kết nối đến server:', error.message);
        return false;
    }
}

// ======================
// ĐĂNG NHẬP
// ======================
async function login() {
    try {
        console.log('[LOGIN] Đang lấy trang đăng nhập...');
        const getResp = await session.get(LOGIN_URL, { timeout: 15000 });
        const token = getCsrfToken(getResp.data);
        
        if (!token) {
            console.error('[ERROR] Không tìm thấy CSRF token');
            return false;
        }
        console.log('[LOGIN] Lấy được CSRF token');
        
        const formData = new URLSearchParams();
        formData.append('username', USERNAME);
        formData.append('password', PASSWORD);
        formData.append('_token', token);
        formData.append('action', 'Login');
        
        const headers = {
            'Referer': LOGIN_URL,
            'Origin': BASE,
            'Content-Type': 'application/x-www-form-urlencoded'
        };
        
        console.log('[LOGIN] Đang gửi thông tin đăng nhập...');
        const loginResp = await session.post(LOGIN_URL, formData.toString(), { 
            headers,
            timeout: 15000 
        });
        
        if (loginResp.status === 200) {
            console.log('[OK] Đăng nhập thành công');
            isLoggedIn = true;
            return true;
        } else {
            console.error(`[ERROR] Đăng nhập thất bại với status: ${loginResp.status}`);
            return false;
        }
    } catch (error) {
        console.error('[ERROR] Login error:', error.message);
        if (error.code === 'ECONNABORTED') {
            console.error('[ERROR] Timeout khi đăng nhập');
        }
        return false;
    }
}

// ======================
// VÀO LOBBY (có retry)
// ======================
async function goToLobby() {
    try {
        console.log('[LOBBY] Đang vào lobby...');
        const response = await session.get(LOBBY_URL, {
            timeout: 60000 // 60 giây cho lobby
        });
        
        if (response.status === 200) {
            console.log('[OK] Vào lobby thành công');
            isInLobby = true;
            return true;
        } else {
            console.error(`[ERROR] Lobby response status: ${response.status}`);
            return false;
        }
    } catch (error) {
        console.error('[LOBBY ERROR]:', error.message);
        if (error.code === 'ECONNABORTED') {
            console.error('[ERROR] Timeout khi vào lobby - server có thể đang chậm');
        } else if (error.response) {
            console.error(`[ERROR] Status: ${error.response.status}`);
        }
        return false;
    }
}

async function goToLobbyWithRetry(maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        console.log(`[LOBBY] Thử lần ${i + 1}/${maxRetries}...`);
        const success = await goToLobby();
        if (success) {
            return true;
        }
        if (i < maxRetries - 1) {
            const waitTime = 5000 * (i + 1);
            console.log(`[LOBBY] Chờ ${waitTime/1000} giây trước khi thử lại...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
    console.error('[ERROR] Không thể vào lobby sau', maxRetries, 'lần thử');
    return false;
}

// ======================
// LẤY KẾT QUẢ BACCARAT
// ======================
async function fetchBaccaratData() {
    try {
        // Kiểm tra đã đăng nhập và vào lobby chưa
        if (!isLoggedIn || !isInLobby) {
            console.warn('[WARN] Chưa đăng nhập hoặc chưa vào lobby, thử đăng nhập lại...');
            const loginOk = await login();
            if (!loginOk) return [];
            
            const lobbyOk = await goToLobbyWithRetry(2);
            if (!lobbyOk) return [];
        }
        
        // Lấy XSRF token từ cookie
        let xsrfToken = '';
        const xsrfMatch = cookieJar.match(/XSRF-TOKEN=([^;]+)/);
        if (xsrfMatch) {
            xsrfToken = decodeURIComponent(xsrfMatch[1]);
        } else {
            console.warn('[WARN] Không tìm thấy XSRF-TOKEN trong cookie');
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
        
        console.log('[FETCH] Đang lấy dữ liệu baccarat...');
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
            
            // Chỉ cập nhật nếu có dữ liệu mới
            if (newData.length > 0) {
                baccaratData = newData;
                lastUpdate = new Date().toISOString();
                console.log(`[FETCH] Đã cập nhật ${baccaratData.length} bàn`);
            } else {
                console.warn('[WARN] Không có dữ liệu bàn nào');
            }
        } else {
            console.warn('[WARN] Response không có dữ liệu:', resp.data);
        }
        
        return baccaratData;
    } catch (error) {
        console.error('[FETCH ERROR]:', error.message);
        if (error.code === 'ECONNABORTED') {
            console.error('[ERROR] Timeout khi lấy dữ liệu');
        } else if (error.response) {
            console.error(`[ERROR] Status: ${error.response.status}`);
            if (error.response.status === 401 || error.response.status === 403) {
                console.warn('[WARN] Có thể session đã hết hạn, sẽ thử đăng nhập lại...');
                isLoggedIn = false;
                isInLobby = false;
            }
        }
        return baccaratData; // Trả về dữ liệu cũ nếu có lỗi
    }
}

// ======================
// VÒNG LẶP TỰ ĐỘNG CẬP NHẬT (có xử lý lỗi)
// ======================
async function autoUpdate() {
    let retryCount = 0;
    const MAX_RETRY = 5;
    
    while (true) {
        try {
            await fetchBaccaratData();
            retryCount = 0; // Reset retry count khi thành công
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            console.error('[AUTO UPDATE ERROR]:', error.message);
            retryCount++;
            
            if (retryCount >= MAX_RETRY) {
                console.error('[ERROR] Quá nhiều lỗi, thử đăng nhập lại...');
                isLoggedIn = false;
                isInLobby = false;
                const loginOk = await login();
                if (loginOk) {
                    await goToLobbyWithRetry(2);
                }
                retryCount = 0;
            }
            
            // Chờ lâu hơn khi có lỗi
            await new Promise(resolve => setTimeout(resolve, 5000 * retryCount));
        }
    }
}

// ======================
// KHỞI TẠO API SERVER
// ======================
const app = express();

// CORS cho phép gọi từ frontend
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        isLoggedIn: isLoggedIn,
        isInLobby: isInLobby,
        dataCount: baccaratData.length,
        lastUpdate: lastUpdate
    });
});

// API lấy tất cả bàn
app.get('/api/baccarat', (req, res) => {
    res.json({
        success: true,
        data: baccaratData,
        lastUpdate: lastUpdate,
        total: baccaratData.length,
        isLoggedIn: isLoggedIn,
        isInLobby: isInLobby
    });
});

// API lấy theo bàn cụ thể
app.get('/api/baccarat/:table', (req, res) => {
    const tableName = req.params.table;
    const found = baccaratData.find(item => item.table === tableName);
    
    if (found) {
        res.json({ success: true, data: found });
    } else {
        res.json({ 
            success: false, 
            message: 'Không tìm thấy bàn ' + tableName,
            availableTables: baccaratData.map(item => item.table)
        });
    }
});

// API lấy kết quả mới nhất
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
        lastUpdate: lastUpdate,
        total: baccaratData.length
    });
});

// API refresh dữ liệu thủ công
app.post('/api/refresh', async (req, res) => {
    try {
        console.log('[MANUAL REFRESH] Đang refresh dữ liệu...');
        const data = await fetchBaccaratData();
        res.json({
            success: true,
            message: 'Refresh thành công',
            total: data.length,
            lastUpdate: lastUpdate
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Refresh thất bại',
            error: error.message
        });
    }
});

// ======================
// KHỞI ĐỘNG
// ======================
async function start() {
    console.log('========================================');
    console.log('🃏 BACCARAT API SERVER v2.0');
    console.log('========================================');
    
    // Kiểm tra kết nối
    const connected = await checkConnectivity();
    if (!connected) {
        console.error('[FATAL] Không thể kết nối đến server, thoát...');
        process.exit(1);
    }
    
    console.log('[1] Đang đăng nhập...');
    const loginOk = await login();
    if (!loginOk) {
        console.error('[FATAL] Đăng nhập thất bại!');
        process.exit(1);
    }
    
    console.log('[2] Vào lobby...');
    const lobbyOk = await goToLobbyWithRetry(3);
    if (!lobbyOk) {
        console.warn('[WARN] Không thể vào lobby, nhưng vẫn tiếp tục...');
        // Thử lấy dữ liệu trực tiếp mà không cần lobby
    }
    
    console.log('[3] Lấy dữ liệu lần đầu...');
    await fetchBaccaratData();
    console.log(`[OK] Đã lấy ${baccaratData.length} bàn`);
    
    // Hiển thị danh sách bàn
    if (baccaratData.length > 0) {
        console.log('\n📊 DANH SÁCH BÀN:');
        baccaratData.slice(0, 10).forEach(item => {
            const resultShort = item.result.substring(0, 40) + (item.result.length > 40 ? '...' : '');
            console.log(`   ${item.table.padEnd(6)}: ${resultShort}`);
        });
        if (baccaratData.length > 10) {
            console.log(`   ... và ${baccaratData.length - 10} bàn khác`);
        }
    } else {
        console.warn('[WARN] Không có dữ liệu bàn nào!');
    }
    
    // Chạy auto update background
    autoUpdate();
    
    // Khởi động server
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 API SERVER ĐANG CHẠY:`);
        console.log(`   📍 http://localhost:${PORT}/api/baccarat`);
        console.log(`   📍 http://localhost:${PORT}/api/baccarat/1`);
        console.log(`   📍 http://localhost:${PORT}/api/baccarat/C01`);
        console.log(`   📍 http://localhost:${PORT}/api/latest`);
        console.log(`   📍 http://localhost:${PORT}/api/health`);
        console.log(`   📍 http://localhost:${PORT}/api/refresh (POST)`);
        console.log(`\n⏰ Auto update mỗi 2 giây`);
        console.log(`🔒 Status: ${isLoggedIn ? '✅ Đã đăng nhập' : '❌ Chưa đăng nhập'}`);
        console.log(`🏠 Lobby: ${isInLobby ? '✅ Đã vào' : '❌ Chưa vào'}`);
        console.log(`📊 Dữ liệu: ${baccaratData.length} bàn`);
    });
}

// Bắt lỗi unhandled rejection
process.on('unhandledRejection', (reason, promise) => {
    console.error('[UNHANDLED REJECTION]', reason);
});

// Bắt lỗi uncaught exception
process.on('uncaughtException', (error) => {
    console.error('[UNCAUGHT EXCEPTION]', error);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[SHUTDOWN] Đang tắt server...');
    process.exit(0);
});

start();
