const axios = require('axios');
const express = require('express');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

// ======================
// CẤU HÌNH HỆ THỐNG
// ======================
const BASE_HOST = "http://hackbacarat.com";
const BASE = `${BASE_HOST}/Formula/Room?appId=2`;
const LOGIN_URL = `${BASE}/login`;
const LOBBY_URL = `${BASE}/ae/lobby`;
const GETNEWRESULT_URL = `${BASE}/baccarat/getnewresult`;

const USERNAME = "Hoang2286";
const PASSWORD = "hoang2010";

const jar = new CookieJar();

const session = wrapper(axios.create({
    timeout: 30000,
    jar,
    maxRedirects: 5, // Tự động đi theo Redirect 302 của Server
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        'Connection': 'keep-alive'
    }
}));

let baccaratData = [];
let lastUpdate = null;

// ======================
// LẤY CSRF TOKEN VÀ FIELD NAME ĐĂNG NHẬP
// ======================
function extractFormInputs(html) {
    if (typeof html !== 'string') return {};
    
    // Tìm CSRF Token trong Meta hoặc Input hidden
    const tokenMatch = html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/i) || 
                       html.match(/name="_token"\s+value="([^"]+)"/i);
    
    return {
        token: tokenMatch ? tokenMatch[1] : ''
    };
}

// ======================
// QUY TRÌNH ĐĂNG NHẬP CHUẨN
// ======================
async function login() {
    try {
        console.log('[1] Truy cập trang Login để khởi tạo Session...');
        const getResp = await session.get(LOGIN_URL);

        const { token } = extractFormInputs(getResp.data);
        console.log(`[2] CSRF Token thu được: ${token ? 'Có' : 'Không tìm thấy'}`);

        const formData = new URLSearchParams();
        formData.append('username', USERNAME);
        formData.append('password', PASSWORD);
        if (token) formData.append('_token', token);

        const headers = {
            'Referer': LOGIN_URL,
            'Origin': BASE_HOST,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        };

        console.log('[3] Gửi thông tin đăng nhập...');
        const loginResp = await session.post(LOGIN_URL, formData.toString(), { headers });

        // Kiểm tra xem sau khi login có bị đẩy lại trang login hoặc chứa từ khóa báo lỗi không
        const isLoginPage = typeof loginResp.data === 'string' && (
            loginResp.data.includes('name="password"') || 
            loginResp.data.includes('login') ||
            loginResp.data.includes('Invalid') ||
            loginResp.data.includes('không chính xác')
        );

        if (!isLoginPage || loginResp.request.res.responseUrl.includes('/lobby') || loginResp.request.res.responseUrl.includes('/Room')) {
            console.log('[OK] Đăng nhập thành công!');
            return true;
        } else {
            console.error('[X] Đăng nhập thất bại! Server trả về lại trang Login (Kiểm tra lại Tài khoản/Mật khẩu).');
            return false;
        }
    } catch (error) {
        console.error('Lỗi Login:', error.message);
        return false;
    }
}

// ======================
// LẤY DỮ LIỆU CÁC BÀN
// ======================
async function fetchBaccaratData() {
    try {
        const cookies = await jar.getCookies(BASE_HOST);
        const xsrfCookie = cookies.find(c => c.key === 'XSRF-TOKEN');
        const xsrfToken = xsrfCookie ? decodeURIComponent(xsrfCookie.value) : '';

        const headers = {
            'Referer': LOBBY_URL,
            'Origin': BASE_HOST,
            'X-Requested-With': 'XMLHttpRequest',
            'X-XSRF-TOKEN': xsrfToken,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Accept': 'application/json, text/javascript, */*; q=0.01'
        };

        const formData = new URLSearchParams();
        formData.append('gameCode', 'ae');

        const resp = await session.post(GETNEWRESULT_URL, formData.toString(), { headers });

        let resData = resp.data;

        // Nếu trả về HTML -> Session chưa được nhận diện hoặc bị logout
        if (typeof resData === 'string' && resData.trim().startsWith('<')) {
            console.error('[!] API trả về HTML thay vì JSON (Phiên đăng nhập hết hạn hoặc chưa vào đúng Lobby). Đang thử login lại...');
            await login();
            return baccaratData;
        }

        if (typeof resData === 'string') {
            try { resData = JSON.parse(resData); } catch (e) {}
        }

        let rawList = [];
        if (Array.isArray(resData)) {
            rawList = resData;
        } else if (resData && typeof resData === 'object') {
            if (Array.isArray(resData.data)) rawList = resData.data;
            else if (Array.isArray(resData.list)) rawList = resData.list;
            else if (Array.isArray(resData.rooms)) rawList = resData.rooms;
            else {
                const firstArrKey = Object.keys(resData).find(k => Array.isArray(resData[k]));
                if (firstArrKey) rawList = resData[firstArrKey];
            }
        }

        if (rawList.length > 0) {
            baccaratData = rawList.map((item, index) => ({
                table: item.table_name || item.tableName || item.table || `Bàn ${index + 1}`,
                result: item.result || item.history || item.data || '',
                shoeId: item.shoeId || item.shoe_id || '',
                round: item.round || item.roundNo || '',
                raw: item
            }));
            lastUpdate = new Date().toISOString();
        }

        return baccaratData;
    } catch (error) {
        console.error('Lỗi Fetch Data:', error.message);
        return [];
    }
}

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

app.get('/api/baccarat', (req, res) => {
    res.json({
        success: true,
        total: baccaratData.length,
        lastUpdate: lastUpdate,
        data: baccaratData
    });
});

app.get('/api/baccarat/:table', (req, res) => {
    const tableName = String(req.params.table).toLowerCase();
    const found = baccaratData.find(item => String(item.table).toLowerCase() === tableName);
    if (found) res.json({ success: true, data: found });
    else res.status(404).json({ success: false, message: `Không tìm thấy bàn ${req.params.table}` });
});

// ======================
// KHỞI ĐỘNG
// ======================
async function start() {
    console.log('========================================');
    console.log('BACCARAT CRAWLER SERVER');
    console.log('========================================');

    const ok = await login();
    if (!ok) {
        console.error('[X] Không thể đăng nhập. Dừng chương trình.');
        process.exit(1);
    }

    // Truy cập Lobby để xác nhận Cookie
    await session.get(LOBBY_URL, { headers: { 'Referer': BASE } });

    console.log('[4] Tiến hành lấy dữ liệu bàn...');
    const data = await fetchBaccaratData();
    console.log(`[OK] Lấy thành công ${data.length} bàn.`);

    autoUpdate();

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server đang chạy tại port: ${PORT}`);
    });
}

start();
