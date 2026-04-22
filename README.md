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

## 🚀 使用方式

本程式支援多種執行模式，可透過命令行參數進行操作：

### 1. 單日抓取 (預設)

抓取指定日期或今日（台北時間）的資料。

```bash
# 抓取今日資料 (預設)
node index.js

# 抓取特定日期 (格式: YYYY/MM/DD)
node index.js --mode single --date 2026/04/14
```

### 2. 批次抓取

抓取指定日期區間內的所有交易日資料。

```bash
node index.js --mode batch --start 2026/04/01 --end 2026/04/22
```

### 3. 自動補齊模式

檢查試算表中現有的日期紀錄，自動補齊遺漏的交易日資料。

```bash
node index.js --mode fill
```

---

## 📦 安裝與設定

### 1. 安裝環境與依賴

確保已安裝 **Node.js >= 18.0.0**。

```bash
# 安裝套件
npm install
```

### 2. Google Service Account 設定

本專案採用 **Service Account (服務帳戶)** 驗證，適合伺服器自動化執行：

1. 前往 **[Google Cloud Console](https://console.cloud.google.com/)**。
2. 建立新的 **Service Account** 並下載其 **JSON 金鑰檔案**。
3. 將該 JSON 檔案命名為 `service_account.json` 並放入專案根目錄。
4. 將您的 Google Sheet **共用 (Share)** 給該 Service Account 的電子郵件地址，並授予「編輯者」權限。

### 3. 設定環境變數

```bash
cp .env.example .env
```

編輯 `.env` 檔案，確保包含以下內容：

```env
SPREADSHEET_ID=你的試算表ID
GOOGLE_SERVICE_ACCOUNT_FILE=service_account.json
LOG_LEVEL=info
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
| HTTP 請求 | requests | fetch (原生) / yahoo-finance2 |
| 日誌記錄 | logging | winston |
| 認證模式 | OAuth 2.0 | Service Account |
| 配置管理 | 自訂 config_loader | dotenv |
| 程式風格 | 多個 functions | async/await |

## 📄 License

MIT

