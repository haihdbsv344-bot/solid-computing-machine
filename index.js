const axios = require('axios');
const express = require('express');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

// ======================
// CẤU HÌNH HỆ THỐNG
// ======================
const BASE_HOST = "http://hackbacarat.com";
const BASE = `${BASE_HOST}/Formula/Room?appId=2`;
const HOME_URL = `${BASE_HOST}/Home/Index`;
const LOGIN_URL = `${BASE}/login`;
const LOBBY_URL = `${BASE}/ae/lobby`;
const GETNEWRESULT_URL = `${BASE}/baccarat/getnewresult`;

// Tài khoản & Mật khẩu mới
const USERNAME = "Hoang2286";
const PASSWORD = "hoang2010";
const SECURITY_CODE = ""; 

// Khởi tạo Cookie Jar
const jar = new CookieJar();

// Khởi tạo Session Axios (Không truyền agent để tránh đụng độ thư viện)
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
// LẤY CSRF TOKEN & CAPTCHA
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
// QUY TRÌNH ĐĂNG NHẬP
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
            console.log(`[!] Phát hiện URL Mã bảo mật/Captcha: ${captchaUrl}`);
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
            'Origin': BASE_HOST,
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
// CHUYỂN HƯỚNG VÀO LOBBY
// ======================
async function goToLobby() {
    try {
        console.log('[4] Kích hoạt phiên làm việc (Room & Lobby)...');
        await session.get(BASE, { headers: { 'Referer': LOGIN_URL } });
        await session.get(LOBBY_URL, { headers: { 'Referer': BASE } });
        return true;
    } catch (error) {
        console.error('Lỗi Lobby:', error.message);
        return false;
    }
}

// ======================
// CÀO DỮ LIỆU TẤT CẢ CÁC BÀN
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

        // Xử lý nếu server trả về dạng String thay vì Object
        if (typeof resData === 'string') {
            try {
                resData = JSON.parse(resData);
            } catch (e) {
                console.error('[!] Phản hồi từ server không phải định dạng JSON.');
            }
        }

        // Tự động bóc tách mảng dữ liệu bàn
        let rawList = [];
        if (Array.isArray(resData)) {
            rawList = resData;
        } else if (resData && typeof resData === 'object') {
            if (Array.isArray(resData.data)) rawList = resData.data;
            else if (Array.isArray(resData.list)) rawList = resData.list;
            else if (Array.isArray(resData.rooms)) rawList = resData.rooms;
            else if (Array.isArray(resData.result)) rawList = resData.result;
            else {
                // Thử tìm thuộc tính kiểu mảng đầu tiên
                const firstArrayKey = Object.keys(resData).find(key => Array.isArray(resData[key]));
                if (firstArrayKey) rawList = resData[firstArrayKey];
            }
        }

        if (rawList.length > 0) {
            baccaratData = rawList.map((item, index) => ({
                table: item.table_name || item.tableName || item.table || item.name || `Bàn ${index + 1}`,
                result: item.result || item.history || item.data || '',
                shoeId: item.shoeId || item.shoe_id || '',
                round: item.round || item.roundNo || '',
                raw: item // Lưu trữ toàn bộ dữ liệu gốc của bàn
            }));
            lastUpdate = new Date().toISOString();
        } else {
            console.log('[!] Server phản hồi thành công nhưng không có bàn nào:', JSON.stringify(resData).substring(0, 150));
        }

        return baccaratData;
    } catch (error) {
        console.error('Lỗi Fetch Data:', error.message);
        return [];
    }
}

// Vòng lặp cập nhật dữ liệu liên tục
async function autoUpdate() {
    while (true) {
        await fetchBaccaratData();
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
}

// ======================
// EXPRESS API SERVER
// ======================
const app = express();

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

// API Lấy toàn bộ bàn
app.get('/api/baccarat', (req, res) => {
    res.json({
        success: true,
        total: baccaratData.length,
        lastUpdate: lastUpdate,
        data: baccaratData
    });
});

// API Lấy theo tên/mã bàn cụ thể
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
// KHỞI ĐỘNG CHƯƠNG TRÌNH
// ======================
async function start() {
    console.log('========================================');
    console.log('BACCARAT DATA CRAWLER & API SERVER');
    console.log('========================================');

    const ok = await login();
    if (!ok) {
        console.error('[X] Không thể đăng nhập vào hệ thống.');
        process.exit(1);
    }

    await goToLobby();
    
    console.log('[5] Tiến hành cào dữ liệu lần đầu...');
    const data = await fetchBaccaratData();
    console.log(`[OK] Đã lấy thành công dữ liệu của ${data.length} bàn.`);

    // Chạy tự động cập nhật ngầm
    autoUpdate();

    // Khởi chạy Express Server
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 API đã sẵn sàng tại port: ${PORT}`);
        console.log(`👉 Link API All: http://localhost:${PORT}/api/baccarat`);
    });
}

start();
