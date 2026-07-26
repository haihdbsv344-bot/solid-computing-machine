const axios = require('axios');
const express = require('express');
const https = require('https');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

// ======================
// CẤU HÌNH
// ======================
const BASE = "http://hackbacarat.com/Formula/Room?appId=2";
const LOGIN_URL = `${BASE}/login`;
const LOBBY_URL = `${BASE}/ae/lobby`;
const GETNEWRESULT_URL = `${BASE}/baccarat/getnewresult`;

const USERNAME = "Hoang2285";
const PASSWORD = "hoang2010";

// Tự động quản lý Cookie với CookieJar
const jar = new CookieJar();
const agent = new https.Agent({ rejectUnauthorized: false });

const session = wrapper(axios.create({
    baseURL: BASE,
    timeout: 30000,
    jar, // Tự động lưu và gửi cookie cho mọi request
    httpsAgent: agent,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
    }
}));

let baccaratData = [];
let lastUpdate = null;

// ======================
// LẤY CSRF TOKEN
// ======================
function getCsrfToken(html) {
    if (typeof html !== 'string') return null;
    const match = html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/) || 
                  html.match(/name="_token"\s+value="([^"]+)"/);
    return match ? match[1] : null;
}

// ======================
// ĐĂNG NHẬP
// ======================
async function login() {
    try {
        console.log('[...] Đang tải trang đăng nhập...');
        const getResp = await session.get(LOGIN_URL);
        const token = getCsrfToken(getResp.data);

        if (!token) {
            console.warn('[!] Không tìm thấy CSRF Token, thử gửi request trực tiếp...');
        }

        const formData = new URLSearchParams();
        formData.append('username', USERNAME);
        formData.append('password', PASSWORD);
        if (token) formData.append('_token', token);
        formData.append('action', 'Login');

        const headers = {
            'Referer': LOGIN_URL,
            'Origin': 'http://hackbacarat.com',
            'Content-Type': 'application/x-www-form-urlencoded'
        };

        const loginResp = await session.post(LOGIN_URL, formData.toString(), { headers });
        
        // Kiểm tra xem đăng nhập thành công hay không
        if (loginResp.status === 200) {
            console.log('[OK] Đăng nhập hoàn tất.');
            return true;
        }
        return false;
    } catch (error) {
        console.error('Lỗi Login:', error.message);
        return false;
    }
}

// ======================
// VÀO LOBBY
// ======================
async function goToLobby() {
    try {
        await session.get(LOBBY_URL, {
            headers: { 'Referer': LOGIN_URL }
        });
        return true;
    } catch (error) {
        console.error('Lỗi Lobby:', error.message);
        return false;
    }
}

// ======================
// LẤY KẾT QUẢ BACCARAT ALL BÀN
// ======================
async function fetchBaccaratData() {
    try {
        // Lấy XSRF token từ cookie lưu trong jar nếu có
        const cookies = await jar.getCookies(BASE);
        const xsrfCookie = cookies.find(c => c.key === 'XSRF-TOKEN');
        const xsrfToken = xsrfCookie ? decodeURIComponent(xsrfCookie.value) : '';

        const headers = {
            'Referer': LOBBY_URL,
            'Origin': 'http://hackbacarat.com',
            'X-Requested-With': 'XMLHttpRequest',
            'X-XSRF-TOKEN': xsrfToken,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        };

        const formData = new URLSearchParams();
        formData.append('gameCode', 'ae');

        const resp = await session.post(GETNEWRESULT_URL, formData.toString(), { headers });

        // Parse dữ liệu trả về
        let rawList = [];
        if (resp.data && Array.isArray(resp.data.data)) {
            rawList = resp.data.data;
        } else if (Array.isArray(resp.data)) {
            rawList = resp.data;
        } else if (typeof resp.data === 'string') {
            try {
                const parsed = JSON.parse(resp.data);
                rawList = parsed.data || parsed;
            } catch (e) {
                console.error('[!] Server trả về HTML thay vì JSON (có thể bị logout)');
                return [];
            }
        }

        if (Array.isArray(rawList) && rawList.length > 0) {
            baccaratData = rawList.map(item => ({
                table: item.table_name || item.table || item.tableName || 'N/A',
                result: item.result || item.history || '',
                shoeId: item.shoeId || item.shoe_id || '',
                round: item.round || item.roundNo || '',
                raw: item // Lưu toàn bộ thông tin gốc của bàn
            }));
            lastUpdate = new Date().toISOString();
        }

        return baccaratData;
    } catch (error) {
        console.error('Lỗi Fetch Data:', error.message);
        return [];
    }
}

// ======================
// AUTO UPDATE LOOP
// ======================
async function autoUpdate() {
    while (true) {
        await fetchBaccaratData();
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
}

// ======================
// SERVER EXPRESS API
// ======================
const app = express();

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

// Lấy tất cả bàn
app.get('/api/baccarat', (req, res) => {
    res.json({
        success: true,
        total: baccaratData.length,
        lastUpdate: lastUpdate,
        data: baccaratData
    });
});

// Lấy 1 bàn cụ thể
app.get('/api/baccarat/:table', (req, res) => {
    const tableName = String(req.params.table).toLowerCase();
    const found = baccaratData.find(item => String(item.table).toLowerCase() === tableName);

    if (found) {
        res.json({ success: true, data: found });
    } else {
        res.status(404).json({ success: false, message: `Không tìm thấy bàn ${req.params.table}` });
    }
});

// ======================
// CHẠY CHƯƠNG TRÌNH
// ======================
async function start() {
    console.log('========================================');
    console.log('KHỞI ĐỘNG BACCARAT DATA CRAWLER');
    console.log('========================================');

    const ok = await login();
    if (!ok) {
        console.error('[X] Không thể đăng nhập. Kiểm tra lại Username/Password.');
        process.exit(1);
    }

    await goToLobby();
    const data = await fetchBaccaratData();
    console.log(`[OK] Đã lấy thành công dữ liệu của ${data.length} bàn.`);

    autoUpdate();

    const PORT = 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 API ready at: http://localhost:${PORT}/api/baccarat`);
    });
}

start();
