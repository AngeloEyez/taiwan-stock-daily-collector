# 台灣股市每日自動抓取 (Taiwan Stock Daily Collector)

<p align="center">
  📊 自動從 Yahoo Finance 與 Exchange API 抓取台灣股市每日資料，並寫入 Google Sheets
  
  Node.js 版本 | v2.0.0
</p>

## ✨ 功能

- **自動抓取**台股加權指數、台積電股價、台積電 ADR、USD/TWD 匯率
- **自動計算**每日漲跌與漲跌百分比
- **寫入 Google Sheets**，自動檢查每日重複，自動刷新 Token
- **隨機延遲**模擬真人瀏覽速度，避免 IP 被封鎖
- **日誌記錄**完整追蹤每次執行的狀態

## 📋 目前抓取 10/15 欄

| Col | 欄位 | 狀態 | 來源 |
|-----|------|------|------|
| A | 日期 | ✅ | 程式計算 |
| B | 星期 | ✅ | 程式計算 |
| C | 台股指數 | ✅ | Yahoo Finance (^TWII) |
| D | 漲跌 | ✅ | 程式計算 (price - prev_close) |
| E | 漲跌% | ✅ | 程式計算 |
| F | 成交金額 | ❌ | 需證交所 API (twse.com.tw) |
| G | 外資買賣超 | ❌ | 需證交所 API (twse.com.tw) |
| H | 外資多空單 | ❌ | 需證交所 API (twse.com.tw) |
| I | 增減 | ❌ | 需證交所 API (twse.com.tw) |
| J | 融資餘額 | ❌ | 需證交所 API (twse.com.tw) |
| K | 增減 | ❌ | 需證交所 API (twse.com.tw) |
| L | 台積電股價 | ✅ | Yahoo Finance (2330.TW) |
| M | 台積電漲跌% | ✅ | 程式計算 |
| N | ADR (USD) | ✅ | Yahoo Finance (TSM) |
| O | 匯率 | ✅ | Exchange API (fawazahmed0) |

## 📦 安裝

### 1. 安裝 Node.js

確保已安裝 Node.js >= 18.0.0

```bash
node --version  # 確認版本
```

### 2. 安裝專案依賴

```bash
npm install
```

### 3. Google OAuth 設定

如果你想將此程式用於自己的試算表:

1. 前往 **[Google Cloud Console](https://console.cloud.google.com/)**
2. 建立新的 OAuth 2.0 憑證 (Desktop app 類型)
3. 下載 `client_secret.json`
4. 執行 OAuth 授權流程生成 `token.json`

範例授權流程:

```javascript
// 在 Node.js 中執行一次:
const { google } = require('googleapis');
const { OAuth2 } = google.auth;
const fs = require('fs');

const client = new OAuth2(
  YOUR_CLIENT_ID,
  YOUR_CLIENT_SECRET,
  'urn:ietf:wg:auth:2.0:oob'
);

const authUrl = client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/spreadsheets']
});

console.log('請前往以下 URL 授權:', authUrl);
// 複製授權碼回來
const code = readline.question('請輸入授權碼: ');

const token = await client.getToken(code);
fs.writeFileSync('token.json', JSON.stringify(token.tokens));
console.log('token.json 已生成!');
```

### 4. 設定 .env 環境變數

```bash
cp .env.example .env
```

編輯 `.env`:

```bash
SPREADSHEET_ID=你的試算表ID
TOKEN_PATH=/path/to/google_token.json
CLIENT_SECRET_PATH=/path/to/google_client_secret.json
```

### 5. 測試執行

```bash
node index.js
# 或
npm start
```

## 🔄 Cron 設定

每天執行 cron job (例如每天 18:00 收盤後):

### 方式一: 系統 crontab

```bash
crontab -e
```

加入:

```bash
# 每天下午 18:00 執行 (收盤後)
0 18 * * 0-6 /usr/bin/node /path/to/taiwan-stock-daily-collector/index.js >> /var/log/stock_collector.log 2>&1
```

### 方式二: Hermes Agent cron job

```
create 台灣股市每日抓取
  prompt: 執行 taiwan-stock-daily-collector/index.js 抓取今日股市資料并寫入 Google Sheets
  schedule: 每天 18:00
```

## 🏗️ 架構圖

```
┌──────────────────────────────────────────┐
│  index.js (主程式)                         │
│                                            │
│  ├── Yahoo Finance API (^TWII, 2330.TW, TSM)  │
│  ├── Exchange API (USD/TWD)             │
│  ├── 資料計算 (漲跌、漲跌%)             │
│  └── Google Sheets API (寫入)          │
└──────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────┐
│  .env (環境變數設定)                     │
│  (不進入版本控制，避免洩漏機密)         │
└──────────────────────────────────────────┘
```

## 📁 專案結構

```
taiwan-stock-daily-collector/
├── index.js          # 主程式 (entry point)
├── config.js         # 環境變數配置載入器
├── package.json      # npm 套件描述檔
├── README.md         # 本檔案
├── .env.example      # 環境變數範本
├── .env              # 實際環境變數 (不進入版本控制)
├── .gitignore        # Git 忽略檔
└── node_modules/     # 安裝的依賴套件 (不進入版本控制)
```

## ✨ Node.js 版本特色 (vs Python)

| 項目 | Python 版 | Node.js 版 |
|------|-----------|------------|
| 執行時 | Python 3.10+ | Node.js 18+ |
| HTTP 請求 | requests | axios |
| 日誌記錄 | logging | winston |
| OAuth | google-auth-oauthlib | googleapis (原生) |
| 配置管理 | 自訂 config_loader | dotenv |
| 程式風格 | 多個 functions | async/await |

## 📄 License

MIT

