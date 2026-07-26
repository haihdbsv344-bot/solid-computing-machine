const axios = require('axios');
const express = require('express');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

// ======================
// CẤU HÌNH
// ======================
const BASE = "http://hackbacarat.com/Formula/Room?appId=2";
const HOME_URL = "http://hackbacarat.com/Home/Index";
const LOGIN_URL = `${BASE}/login`;
const LOBBY_URL = `${BASE}/ae/lobby`;
const GETNEWRESULT_URL = `${BASE}/baccarat/getnewresult`;

// Đã cập nhật Tài khoản & Mật khẩu mới
const USERNAME = "Hoang2286";
const PASSWORD = "hoang2010";
const SECURITY_CODE = ""; 

const jar = new CookieJar();

// Khai báo Session với CookieJar (bỏ httpsAgent để tránh đụng độ thư viện)
const session = wrapper(axios.create({
    baseURL: BASE,
    timeout: 30000,
    jar,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
    }
}));

let baccaratData = [];
let lastUpdate = null;

// ======================
// BẮT CSRF TOKEN & MÃ BẢO MẬT
// ======================
function extractSecurityTokens(html) {
    if (typeof html !== 'string') return { token: null, captchaUrl: null };
    
    const tokenMatch = html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/) || 
                       html.match(/name="_token"\s+value="([^"]+)"/);
    
    const captchaMatch = html.match(/src="([^"]*captcha[^"]*)"/i) || 
                         html.match(/src="([^"]*security[^"]*)"/i);

    return {
        token: tokenMatch ? tokenMatch[1] : null,
        captchaUrl: captchaMatch ? captchaMatch[1] : null
    };
}

// ======================
// ĐĂNG NHẬP
// ======================
async function login() {
    try {
        console.log('[1] Truy cập trang chủ Home/Index...');
        await session.get(HOME_URL);
        
        console.log('[2] Truy cập trang Login...');
        const getResp = await session.get(LOGIN_URL, {
            headers: { 'Referer': HOME_URL }
        });

        const { token, captchaUrl } = extractSecurityTokens(getResp.data);

        if (captchaUrl) {
            console.log(`[!] Tìm thấy đường dẫn Mã bảo mật/Captcha: ${captchaUrl}`);
        }

        const formData = new URLSearchParams();
        formData.append('username', USERNAME);
        formData.append('password', PASSWORD);
        
        if (token) {
            formData.append('_token', token);
        }

        if (SECURITY_CODE) {
            formData.append('security_code', SECURITY_CODE);
            formData.append('captcha', SECURITY_CODE);
            formData.append('code', SECURITY_CODE);
        }

        formData.append('action', 'Login');

        const headers = {
            'Referer': LOGIN_URL,
            'Origin': 'http://hackbacarat.com',
            'Content-Type': 'application/x-www-form-urlencoded'
        };

        console.log('[3] Gửi thông tin đăng nhập...');
        const loginResp = await session.post(LOGIN_URL, formData.toString(), { headers });

        if (loginResp.status === 200 && !loginResp.data.includes('Invalid') && !loginResp.data.includes('sai')) {
            console.log('[OK] Đăng nhập thành công!');
            return true;
        } else {
            console.error('[X] Đăng nhập thất bại: Kiểm tra lại tài khoản hoặc mã bảo mật.');
            return false;
        }
    } catch (error) {
        console.error('Lỗi Login:', error.message);
        return false;
    }
}

// ======================
// VÀO LOBBY & LẤY KẾT QUẢ
// ======================
async function goToLobby() {
    try {
        await session.get(LOBBY_URL, { headers: { 'Referer': LOGIN_URL } });
        return true;
    } catch (error) {
        console.error('Lỗi Lobby:', error.message);
        return false;
    }
}

async function fetchBaccaratData() {
    try {
        const cookies = await jar.getCookies(BASE);
        const xsrfCookie = cookies.find(c => c.key === 'XSRF-TOKEN');
        const xsrfToken = xsrfCookie ? decodeURIComponent(xsrfCookie.value) : '';

        const headers = {
            'Referer': LOBBY_URL,
            'Origin': 'http://hackbacarat.com',
            'X-Requested-With': 'XMLHttpRequest',
            'X-XSRF-TOKEN': xsrfToken,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Accept': 'application/json, text/javascript, */*; q=0.01'
        };

        const formData = new URLSearchParams();
        formData.append('gameCode', 'ae');

        const resp = await session.post(GETNEWRESULT_URL, formData.toString(), { headers });

        let rawList = [];
        if (resp.data && Array.isArray(resp.data.data)) {
            rawList = resp.data.data;
        } else if (Array.isArray(resp.data)) {
            rawList = resp.data;
        }

        if (rawList.length > 0) {
            baccaratData = rawList.map(item => ({
                table: item.table_name || item.table || item.tableName || 'N/A',
                result: item.result || item.history || '',
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
// API SERVER
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

    if (found) {
        res.json({ success: true, data: found });
    } else {
        res.status(404).json({ success: false, message: `Không tìm thấy bàn ${req.params.table}` });
    }
});

// ======================
// KHỞI ĐỘNG
// ======================
async function start() {
    console.log('========================================');
    console.log('BACCARAT DATA CRAWLER & API SERVER');
    console.log('========================================');

    const ok = await login();
    if (!ok) {
        console.error('[X] Không thể vào được hệ thống.');
        process.exit(1);
    }

    await goToLobby();
    const data = await fetchBaccaratData();
    console.log(`[OK] Đã lấy thành công toàn bộ ${data.length} bàn.`);

    autoUpdate();

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 API ready at port: ${PORT}`);
    });
}

start();
