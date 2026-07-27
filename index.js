const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Cấu hình thông tin đăng nhập từ yêu cầu của bạn
const TARGET_URL = 'http://hackbacarat.com/Formula/Room?appId=2';
const LOGIN_URL = 'http://hackbacarat.com/'; // Trang chứa form đăng nhập

const CREDENTIALS = {
  username: 'Hoang2286',
  password: 'Hoang2010',
  captcha: '6151' // Lưu ý: captcha thường thay đổi mỗi phiên làm việc
};

// Hàm tự động thực hiện đăng nhập và lấy dữ liệu
async function loginAndFetchData(credentials) {
  const browser = await puppeteer.launch({
    headless: true, // Đổi thành false nếu muốn xem trình duyệt chạy trực tiếp
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  try {
    // 1. Truy cập trang đăng nhập
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });

    // 2. Điền thông tin đăng nhập vào các ô input (cần khớp tên/selector của web)
    // Tùy theo cấu trúc HTML thực tế, các selector dưới đây có thể cần điều chỉnh
    await page.type('input[placeholder*="Tài khoản"]', credentials.username);
    await page.type('input[placeholder*="Mật khẩu"]', credentials.password);
    
    // Điền mã bảo mật
    const captchaInput = await page.$('input[placeholder*="Mã bảo mật"]');
    if (captchaInput) {
      await captchaInput.type(credentials.captcha);
    }

    // 3. Nhấn nút Đăng nhập
    await Promise.all([
      page.click('button:contains("Đăng nhập"), input[value="Đăng nhập"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {})
    ]);

    // 4. Chuyển hướng tới URL phòng chơi/API
    await page.goto(TARGET_URL, { waitUntil: 'networkidle2' });

    // 5. Lấy nội dung phản hồi hoặc dữ liệu trang
    const pageContent = await page.content();

    await browser.close();
    return { success: true, data: pageContent };
  } catch (error) {
    await browser.close();
    return { success: false, error: error.message };
  }
}

// Route API gọi đăng nhập
app.post('/api/login-fetch', async (req, res) => {
  const customCaptcha = req.body.captcha || CREDENTIALS.captcha;
  
  const result = await loginAndFetchData({
    ...CREDENTIALS,
    captcha: customCaptcha
  });

  if (result.success) {
    res.json({ status: 'success', data: result.data });
  } else {
    res.status(500).json({ status: 'error', message: result.error });
  }
});

app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
});
