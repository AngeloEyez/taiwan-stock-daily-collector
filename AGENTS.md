# AGENTS.md - 台灣股市每日自動抓取 (Node.js 版本)

## 專案目標

自動每日抓取台灣股市資料並寫入 Google Sheets (股市data 1)。
目前自動抓取 10/15 欄位，還有 5 欄需要台灣境內證券交易所 API 才能取得。

## 技術棧

| 項目 | 使用套件版本 |
|------|------|
| 執行環境 | Node.js >= 18.0.0 |
| HTTP 請求 | axios |
| Google Sheets | googleapis (原生 OAuth2) |
| 日誌 | winston |
| 環境變數 | dotenv |

## 整體架構

```
┌───────────────────────┐
│  .env (環境變數)      │
│  SPREADSHEET_ID       │
│  TOKEN_PATH           │
│  CLIENT_SECRET_PATH   │
└─────┬─────────────────┘
      │ 載入
┌─────▼──────────────────┐
│  config.js             │
│  讀取 .env, 提供       │
│  config 配置           │
└─────┬──────────────────┘
      │ config 配置
┌─────▼──────────────────┐
│  collect.js (CLI入口)  │
│  ┌──────────────────┐  │
│  │ src/main.js       │  │
│  │   - 流程控制      │  │
│  └────────┬─────────┘  │
│  ┌────────▼─────────┐  │
│  │ src/fetchYahoo.js │  │
│  │ src/fetchExchange.│  │
│  │ src/googleSheets. │  │
│  │ src/utils.js      │  │
│  │ src/logger.js     │  │
│  └──────────────────┘  │
└─────────────────────────┘
```

## 已完成部分 ✓

| 項目 | 狀態 | 說明 |
|------|------|------|
| Yahoo Finance API 整合 | ✅ | 抓取 ^TWII, 2330.TW, TSM |
| Exchange API 整合 | ✅ | 抓取 USD/TWD, 含備用 CDN |
| TWSE API 整合 | ✅ | 大盤成交金額、外資買賣超、融資餘額 |
| Google Sheets API 整合 | ✅ | OAuth2, append, 去重檢查 |
| .env 環境變數 | ✅ | 機密資訊分離 |
| config.js 配置管理 | ✅ | 使用 dotenv |
| 隨機延遲 | ✅ | 6-15 秒模擬真人 |
| 日誌記錄 | ✅ | winston 模組 |
| async/await 風格 | ✅ | 現代化异步程式設計 |
| TAIFEX API 整合 | ✅ | 抓取外資期貨多空單及計算增減 |

## 未完成部分

目前所有 15 個欄位皆已實作完畢。

> TWSE API 已經整合，但請注意如果在境外伺服器執行可能會遇到 404 (需透過台灣 IP 或 VPN)。

## 檔案結構

```
taiwan-stock-daily-collector/
├── collect.js        # 主程式 (CLI 入口)
├── src/              # 功能模組
│   ├── main.js
│   ├── fetchYahoo.js
│   ├── fetchTwse.js
│   ├── fetchTaifex.js
│   ├── googleSheets.js
│   ├── utils.js
│   └── logger.js
├── config.js         # 環境變數配置載入器
├── package.json      # npm 套件描述檔
├── README.md         # 專案說明文件
├── docs/
│   ├── API.md        # API 端點說明文件
│   └── STRUCTURE.md  # 架構說明
├── .env.example      # 環境變數範本
├── .env              # 實際環境變數 (不進入版本控制)
└── .gitignore        # Git 忽略檔
```

## 環境變數

所有設定走 `.env`:

```bash
SPREADSHEET_ID=xxx
TOKEN_PATH=/path/...json
CLIENT_SECRET_PATH=/path/...json
YAHOO_TIMEOUT=15
EXCHANGE_TIMEOUT=10
MIN_WAIT=6
MAX_WAIT=15
LOG_LEVEL=info
```

## 開發流程

### 新增欄位功能

如果要新增某個欄位 (例如成交金額):

1. 新增 API 抓取函數 (如 `fetchVolume()`)
2. 在 `src/main.js` 中呼叫並取得資料
3. 將結果放入 `combinedRow` 對應位置 (目前 Col F = 索引 5)
4. 更新 README.md 與本文件

### 測試方式

```bash
npm install          # 安裝依賴
node config.js       # 測試配置
node collect.js      # 執行主程式
```
