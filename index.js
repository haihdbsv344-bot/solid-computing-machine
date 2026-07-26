const axios = require('axios');
const express = require('express');
const readline = require('readline');
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

// Nếu web dùng Mã Bảo Mật cố định, điền vào đây. Nếu thay đổi liên tục, code sẽ hỏi từ Terminal.
let SECURITY_CODE = ""; 

const jar = new CookieJar();

const session = wrapper(axios.create({
    timeout: 30000,
    jar,
    maxRedirects: 5,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
    }
}));

let baccaratData = [];
let lastUpdate = null;

// Hàm hỗ trợ nhập mã bảo mật từ Terminal/Console nếu cần
function askCaptcha(questionText) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise(resolve => rl.question(questionText, ans => {
        rl.close();
        resolve(ans.trim());
    }));
}

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

    // Tìm URL ảnh Captcha/Mã bảo mật
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
        console.log('[1] Lấy Cookie khởi tạo từ Room...');
        await session.get(BASE);

        console.log('[2] Truy cập trang Login...');
        const getResp = await session.get(LOGIN_URL, {
            headers: { 'Referer': BASE }
        });

        const { inputs, captchaUrl } = parseLoginForm(getResp.data);

        if (captchaUrl) {
            console.log(`\n[!] PHÁT HIỆN MÃ BẢO MẬT! Đường dẫn ảnh: ${captchaUrl}`);
        }

        // Nếu chưa cấu hình SECURITY_CODE sẵn và phát hiện trang cần nhập mã
        if (!SECURITY_CODE) {
            // Trường hợp chạy trên máy cục bộ (Local Terminal)
            if (process.stdin.isTTY) {
                SECURITY_CODE = await askCaptcha('👉 Hãy nhập Mã Bảo Mật hiển thị trên trang: ');
            } else {
                console.warn('[!] Đang chạy trên Render/Server Cloud: Vui lòng gán giá trị Mã Bảo Mật cố định vào biến SECURITY_CODE trong code nếu có!');
            }
        }

        const formData = new URLSearchParams();
        
        // Đổ toàn bộ hidden input từ web
        for (const [key, val] of Object.entries(inputs)) {
            formData.append(key, val);
        }

        // Gán Tài khoản, Mật khẩu & Mã bảo mật vào Form
        formData.set('username', USERNAME);
        formData.set('password', PASSWORD);

        if (SECURITY_CODE) {
            // Gửi mã vào tất cả các trường tên mã bảo mật phổ biến
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

        console.log('[3] Gửi Request Đăng Nhập kèm Mã Bảo Mật...');
        const loginResp = await session.post(LOGIN_URL, formData.toString(), { headers });

        const finalUrl = loginResp.request?.res?.responseUrl || '';
        const isStillLogin = typeof loginResp.data === 'string' && loginResp.data.includes('type="password"');

        if (finalUrl.includes('Room') || finalUrl.includes('lobby') || !isStillLogin) {
            console.log('[OK] ĐĂNG NHẬP THÀNH CÔNG!');
            return true;
        } else {
            console.error('[X] Đăng nhập thất bại: Sai Tài khoản, Mật khẩu hoặc Mã bảo mật!');
            return false;
        }
    } catch (error) {
        console.error('Lỗi Login:', error.message);
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
                raw: item // Giữ toàn bộ thông tin gốc của bàn
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
        console.error('[X] Đăng nhập thất bại. Dừng chương trình.');
        process.exit(1);
    }

    await session.get(LOBBY_URL, { headers: { 'Referer': BASE } });

    console.log('[4] Tiến hành lấy dữ liệu tất cả các bàn...');
    const data = await fetchBaccaratData();
    console.log(`[OK] Đã lấy thành công toàn bộ ${data.length} bàn.`);

    autoUpdate();

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 API ready: http://localhost:${PORT}/api/baccarat`);
    });
}

start();
