# AGENTS.md - 台灣股市每日自動抓取 (Node.js 版本)

## 專案目標

自動每日抓取台灣股市資料並寫入 Google Sheets (股市data 1)。
目前自動抓取 15/15 欄位，已全部實作完成。

## 技術棧

| 項目 | 使用套件版本 |
|------|------|
| 執行環境 | Node.js >= 18.0.0 |
| HTTP 請求 | fetch (原生) |
| Google Sheets | googleapis (原生 OAuth2) |
| 日誌 | winston |
| 環境變數 | dotenv |

## 整體架構

### 抓取流程 (v2.1 批次架構)

```
按「資料來源」批次抓取，而非「按日期」逐日抓取

runBatch(startDate, endDate)
  │
  ├─ 1. 按來源批次抓取 (fetchAllDataBatch)
  │     ├─ Yahoo Finance: 3 ticker 各 1 次請求，取整個區間 (緩衝 15 天)
  │     ├─ TAIFEX: 1 次 POST 請求，取整個區間 (緩衝 15 天)
  │     ├─ Exchange: 逐日呼叫 (無區間 API)
  │     └─ TWSE: 逐日呼叫 3 個端點 (無區間 API)
  │
  ├─ 2. 記憶體組合 (buildRows)
  │     └─ Map<date, data> 暫存區 → 逐日 combineRow → rows[]
  │
  ├─ 3. 刪除 Sheets 舊資料 (deleteRowsByDateRange)
  │
  └─ 4. 批次寫入 (batchAppendToSheets)
```

### 模組架構

```
┌───────────────────────┐
│  .env (環境變數)      │
│  SPREADSHEET_ID       │
│  GOOGLE_SERVICE_...   │
└─────┬─────────────────┘
      │ 載入
┌─────▼────────────────┐
│  src/config.js         │
│  讀取 .env, 提供       │
│  config 配置           │
└─────┬──────────────┘
      │ config 配置
┌─────▼────────────────┐
│  collect.js (CLI入口)  │
│  ┌──────────────────┐  │
│  │ src/main.js       │  │
│  │   - 批次資料抓取    │  │
│  │   - 記憶體組合    │  │
│  │   - 流程控制      │  │
│  └───────┬──────────┘  │
│  ┌───────▼──────────┐  │
│  │ src/fetchYahoo.js │  │
│  │ src/fetchExchange. │  │
│  │ src/fetchTwse.js  │  │
│  │ src/fetchTaifex.  │  │
│  │ src/googleSheets. │  │
│  │ src/utils.js      │  │
│  │ src/logger.js     │  │
│  │ src/config.js     │  │
│  └──────────────────┘  │
└───────────────────────┘
```

## 已完成部分 ✓

| 項目 | 狀態 | 說明 |
|------|------|------|
| Yahoo Finance API 整合 | ✅ | 批次區間抓取 ^TWII, 2330.TW, TSM (緩衝 15 天) |
| Exchange API 整合 | ✅ | 抓取 USD/TWD, 含備用 CDN |
| TWSE API 整合 | ✅ | 大盤成交金額、外資買賣超、融資餘額 |
| Google Sheets API 整合 | ✅ | Service Account, 批次寫入, 去重檢查 |
| .env 環境變數 | ✅ | 機密資訊分離 |
| config.js 配置管理 | ✅ | 使用 dotenv (已移至 src/) |
| 隨機延遲 | ✅ | 模擬真人等待 |
| 日誌記錄 | ✅ | winston 模組 |
| async/await 風格 | ✅ | 現代化异步程式設計 |
| TAIFEX API 整合 | ✅ | 批次區間抓取外資期貨多空單及計算增減 |
| **真實批次處理架構** | ✅ | 按來源批次抓取，記憶體 Map 暫存，然後寫入 |
| **googleapis 延遲引入** | ✅ | 將載入時間藏在資料下載期間 |

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
│   ├── logger.js
│   └── config.js     # 環境變數配置載入器
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

如果要新增某個欄位：

1. 新增 API 抓取函數 (如 `fetchVolumeBatch(tradingDays)`)，回傳 `Map<date, value>`
2. 在 `fetchAllDataBatch()` 中加入該批次函數的呼叫
3. 在 `combineRow()` 中將對應 Map 的資料放入組合列的對應位置
4. 更新 README.md 與本文件

### API 區間支援表

| 資料來源 | 區間支援 | 抱取策略 |
|---------|------------|----------|
| Yahoo Finance | ✅ 原生支援 | `yahooGetHistoricalBatch(ticker, start, end)` |
| TAIFEX | ✅ 原生支援 | `getForeignFuturesBatch(start, end)` |
| Exchange API | ❌ 不支援 | `getFxRateBatch(tradingDays)` 逐日 |
| TWSE | ❌ 不支援 | `fetchTwseBatch(tradingDays)` 逐日 |

### 測試方式

```bash
npm install          # 安裝依賴
node config.js       # 測試配置
node collect.js      # 執行主程式
```
