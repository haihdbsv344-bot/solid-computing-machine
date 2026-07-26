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

// Mã bảo mật mặc định (có thể đổi qua API)
let SECURITY_CODE = ""; 

const jar = new CookieJar();

const session = wrapper(axios.create({
    timeout: 30000,
    jar,
    maxRedirects: 5,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
    }
}));

let baccaratData = [];
let lastUpdate = null;
let isLogined = false;

// Bóc tách Form & URL ảnh Mã Bảo Mật
function parseLoginForm(html) {
    if (typeof html !== 'string') return { inputs: {}, captchaUrl: null };
    
    const inputs = {};
    const inputRegex = /<input[^>]+>/gi;
    let match;
    
    while ((match = inputRegex.exec(html)) !== null) {
        const inputTag = match[0];
        const nameMatch = inputTag.match(/name=["']([^"']+)["']/i);
        const valueMatch = inputTag.match(/value=["']([^"']*)["']/i);
        
        if (nameMatch) {
            inputs[nameMatch[1]] = valueMatch ? valueMatch[1] : '';
        }
    }

    const captchaMatch = html.match(/src=["']([^"']*captcha[^"']*)["']/i) || 
                         html.match(/src=["']([^"']*code[^"']*)["']/i) ||
                         html.match(/src=["']([^"']*security[^"']*)["']/i);

    let captchaUrl = captchaMatch ? captchaMatch[1] : null;
    if (captchaUrl && !captchaUrl.startsWith('http')) {
        captchaUrl = BASE_HOST + (captchaUrl.startsWith('/') ? '' : '/') + captchaUrl;
    }

    return { inputs, captchaUrl };
}

// ======================
// QUY TRÌNH ĐĂNG NHẬP
// ======================
async function login() {
    try {
        console.log('[1] Khởi tạo Session từ Room...');
        await session.get(BASE);

        console.log('[2] Lấy thông tin trang Login...');
        const getResp = await session.get(LOGIN_URL, { headers: { 'Referer': BASE } });

        const { inputs, captchaUrl } = parseLoginForm(getResp.data);

        if (captchaUrl) {
            console.log(`[!] Ảnh Mã bảo mật: ${captchaUrl}`);
        }

        const formData = new URLSearchParams();
        
        for (const [key, val] of Object.entries(inputs)) {
            formData.append(key, val);
        }

        formData.set('username', USERNAME);
        formData.set('password', PASSWORD);

        if (SECURITY_CODE) {
            formData.set('captcha', SECURITY_CODE);
            formData.set('security_code', SECURITY_CODE);
            formData.set('code', SECURITY_CODE);
            formData.set('vcode', SECURITY_CODE);
        }

        const headers = {
            'Referer': LOGIN_URL,
            'Origin': BASE_HOST,
            'Content-Type': 'application/x-www-form-urlencoded'
        };

        console.log('[3] Gửi Request Đăng Nhập...');
        const loginResp = await session.post(LOGIN_URL, formData.toString(), { headers });

        const finalUrl = loginResp.request?.res?.responseUrl || '';
        const isStillLogin = typeof loginResp.data === 'string' && loginResp.data.includes('type="password"');

        if (finalUrl.includes('Room') || finalUrl.includes('lobby') || !isStillLogin) {
            console.log('[OK] ĐĂNG NHẬP THÀNH CÔNG!');
            isLogined = true;
            return true;
        } else {
            console.error('[X] Đăng nhập thất bại (Có thể do sai Mã bảo mật).');
            isLogined = false;
            return false;
        }
    } catch (error) {
        console.error('Lỗi Login:', error.message);
        isLogined = false;
        return false;
    }
}

// ======================
// CÀO DỮ LIỆU
// ======================
async function fetchBaccaratData() {
    if (!isLogined) {
        const ok = await login();
        if (!ok) return [];
        await session.get(LOBBY_URL, { headers: { 'Referer': BASE } });
    }

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

        // Nếu hết session bị đẩy về HTML -> Login lại ngầm
        if (typeof resData === 'string' && resData.trim().startsWith('<')) {
            console.log('[!] Hết phiên làm việc, tiến hành Đăng nhập lại...');
            isLogined = false;
            return [];
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
            else {
                const firstArrKey = Object.keys(resData).find(k => Array.isArray(resData[k]));
                if (firstArrKey) rawList = resData[firstArrKey];
            }
        }

        if (rawList.length > 0) {
            baccaratData = rawList.map((item, index) => ({
                table: item.table_name || item.tableName || item.table || item.name || `Bàn ${index + 1}`,
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

// Link lấy danh sách bàn
app.get('/api/baccarat', (req, res) => {
    res.json({
        success: true,
        total: baccaratData.length,
        lastUpdate: lastUpdate,
        isLogined: isLogined,
        data: baccaratData
    });
});

// Link cập nhật mã bảo mật ngay trên trình duyệt di động: /set-code/1234
app.get('/set-code/:code', async (req, res) => {
    SECURITY_CODE = req.params.code;
    console.log(`[!] Đã cập nhật Mã Bảo Mật mới: ${SECURITY_CODE}`);
    isLogined = false; // Bắt buộc login lại với mã mới
    const ok = await login();
    if (ok) {
        res.json({ success: true, message: `Đã cập nhật Mã Bảo Mật thành: ${SECURITY_CODE} và Đăng nhập thành công!` });
    } else {
        res.json({ success: false, message: `Đã nhập Mã Bảo Mật: ${SECURITY_CODE} nhưng Đăng nhập thất bại. Kiểm tra lại mã!` });
    }
});

// ======================
// KHỞI ĐỘNG
// ======================
function start() {
    const PORT = process.env.PORT || 5000;
    
    // Mở cổng Express ngay lập tức để Render KHÔNG bị Exit
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`========================================`);
        console.log(`🚀 SERVER ĐÃ MỞ TẠI PORT: ${PORT}`);
        console.log(`👉 API Data: http://localhost:${PORT}/api/baccarat`);
        console.log(`👉 Set Code: http://localhost:${PORT}/set-code/MA_BAO_MAT`);
        console.log(`========================================`);
        
        // Chạy ngầm tiến trình đăng nhập & cào dữ liệu
        autoUpdate();
    });
}

start();
