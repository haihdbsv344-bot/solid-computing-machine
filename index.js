const express = require('express');
const axios = require('axios');
const https = require('https');
const app = express();
const PORT = process.env.PORT || 5000;

// ============================================================
// CẤU HÌNH AIBCR
// ============================================================
const BASE = "https://aibcr.me";
const LOGIN_URL = `${BASE}/login`;
const LOBBY_URL = `${BASE}/ae/lobby`;
const GETNEWRESULT_URL = `${BASE}/baccarat/getnewresult`;

// Khuyên dùng biến môi trường Environment Variables trên Render để bảo mật
const USERNAME = process.env.AIBCR_USER || "Hoang2285";
const PASSWORD = process.env.AIBCR_PASS || "hoang2010";

const agent = new https.Agent({ rejectUnauthorized: false });
let cookieJar = '';
let baccaratData = [];
let lastUpdate = null;

// Session axios cho aibcr
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
});

// ============================================================
// HÀM TIỆN ÍCH
// ============================================================
function toArr(str) {
    return str ? str.split('').filter(c => ['B','P','T'].includes(c)) : [];
}

function demTanSuat(arr) {
    const cnt = {B:0, P:0, T:0};
    for (const c of arr) if (cnt[c] !== undefined) cnt[c]++;
    const total = arr.length || 1;
    return {
        B: cnt.B / total * 100,
        P: cnt.P / total * 100,
        T: cnt.T / total * 100
    };
}

function timChuoi(arr) {
    if (arr.length === 0) return [];
    const runs = [];
    let cur = {c: arr[0], n: 1};
    for (let i = 1; i < arr.length; i++) {
        if (arr[i] === cur.c) cur.n++;
        else { runs.push({...cur}); cur = {c: arr[i], n: 1}; }
    }
    runs.push({...cur});
    return runs;
}

// ============================================================
// 20 CÔNG THỨC NHẬN DIỆN CẦU
// ============================================================
function CT1_Zigzag(arr) {
    if (arr.length < 4) return null;
    const last4 = arr.slice(-4);
    if (last4[0] === last4[2] && last4[1] === last4[3] && last4[0] !== last4[1]) {
        return { predict: last4[0] === 'B' ? 'P' : 'B', name: 'Cau 1-1 Zigzag', conf: 92 };
    }
    return null;
}

function CT2_222(arr) {
    if (arr.length < 6) return null;
    const runs = timChuoi(arr);
    if (runs.length >= 3) {
        const last3 = runs.slice(-3);
        if (last3[0].n === 2 && last3[1].n === 2 && last3[2].n === 2) {
            return { predict: last3[0].c, name: 'Cau 2-2-2', conf: 90 };
        }
    }
    return null;
}

function CT3_22Dao(arr) {
    if (arr.length < 6) return null;
    const runs = timChuoi(arr);
    if (runs.length >= 3) {
        const last3 = runs.slice(-3);
        if (last3[1].n === 2 && last3[2].n === 2 && last3[1].c !== last3[2].c) {
            return { predict: last3[1].c, name: 'Cau 2-2 Dao', conf: 88 };
        }
    }
    return null;
}

function CT4_33(arr) {
    if (arr.length < 8) return null;
    const runs = timChuoi(arr);
    if (runs.length >= 2) {
        const last2 = runs.slice(-2);
        if (last2[0].n === 3 && last2[1].n === 3) {
            return { predict: last2[0].c === 'B' ? 'P' : 'B', name: 'Cau 3-3', conf: 89 };
        }
    }
    return null;
}

function CT5_121(arr) {
    if (arr.length < 6) return null;
    const runs = timChuoi(arr);
    if (runs.length >= 3) {
        const last3 = runs.slice(-3);
        if (last3[0].n === 1 && last3[1].n === 2 && last3[2].n === 1) {
            return { predict: last3[1].c, name: 'Cau 1-2-1', conf: 91 };
        }
    }
    return null;
}

function CT6_212(arr) {
    if (arr.length < 6) return null;
    const runs = timChuoi(arr);
    if (runs.length >= 3) {
        const last3 = runs.slice(-3);
        if (last3[0].n === 2 && last3[1].n === 1 && last3[2].n === 2) {
            return { predict: last3[0].c === 'B' ? 'P' : 'B', name: 'Cau 2-1-2', conf: 87 };
        }
    }
    return null;
}

function CT7_Chop(arr) {
    if (arr.length < 8) return null;
    const runs = timChuoi(arr);
    if (runs.length >= 3) {
        const last3 = runs.slice(-3);
        if (last3[0].n === 3 && last3[1].n === 2 && last3[2].n === 1) {
            return { predict: last3[2].c === 'B' ? 'P' : 'B', name: 'Cau Chop 3-2-1', conf: 85 };
        }
    }
    return null;
}

// ============================================================
// KHỞI TẠO SERVER & ROUTE KHỞI ĐỘNG
// ============================================================
app.get('/', (req, res) => {
    res.json({ status: 'Server running', lastUpdate });
});

app.listen(PORT, () => {
    console.log(`Server đang lắng nghe tại cổng ${PORT}`);
});
