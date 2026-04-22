# 專案檔案結構說明

## 目錄結構

```
taiwan-stock-daily-collector/
│
├── collect.js            # ★ CLI 入口點，執行 src/main.js
├── config.js             # 環境變數載入器 (dotenv)
├── index.js              # 相容性保留檔 (已廢棄，勿直接執行)
│
├── src/                  # 功能模組目錄
│   ├── logger.js         # Winston logger 設定與匯出
│   ├── utils.js          # 共用工具函式
│   ├── fetchYahoo.js     # Yahoo Finance API 抓取
│   ├── fetchExchange.js  # 匯率 API 抓取 (fawazahmed0)
│   ├── googleSheets.js   # Google Sheets API 讀寫
│   └── main.js           # 主程式：CLI 解析與三種執行模式
│
├── docs/
│   ├── STRUCTURE.md      # 本文件：專案架構說明
│   └── API.md            # 外部 API 端點說明
│
├── package.json          # npm 套件描述
├── .env                  # 實際環境變數 (不進入版本控制)
├── .env.example          # 環境變數範本
├── .gitignore
└── README.md
```

---

## 模組職責說明

### `collect.js` - CLI 入口點

- 作為程式的唯一執行入口。
- 呼叫 `src/main.js` 匯出的 `main()` 函式。
- 捕捉頂層錯誤並以非零代碼退出。

**執行方式：**
```bash
node collect.js
npm run collect
```

---

### `config.js` - 環境變數載入

- 使用 `dotenv` 讀取 `.env` 檔案。
- 匯出所有設定值供其他模組使用。
- 依賴：`dotenv`

**主要設定項：**

| 環境變數 | 說明 | 預設值 |
|---|---|---|
| `SPREADSHEET_ID` | Google Sheets 試算表 ID | 必填 |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | Service Account JSON 路徑 | `service_account.json` |
| `SHEET_NAME` | 工作表名稱 | 必填 |
| `YAHOO_TIMEOUT` | Yahoo Finance 逾時 (秒) | `15` |
| `EXCHANGE_TIMEOUT` | 匯率 API 逾時 (秒) | `10` |
| `MIN_WAIT` | 最短等待秒數 | `6` |
| `MAX_WAIT` | 最長等待秒數 | `15` |
| `LOG_LEVEL` | 日誌層級 | `info` |

---

### `src/logger.js` - 日誌模組

- 建立並匯出一個全域 `logger` 實例 (Winston)。
- 日誌層級從 `config.LOG_LEVEL` 讀取。
- 依賴：`winston`, `../config`

---

### `src/utils.js` - 共用工具函式

提供整個專案共用的工具函式，不依賴外部 API：

| 函式 | 說明 |
|---|---|
| `getTodayStr()` | 取得今日台北時間字串 (YYYY/MM/DD) |
| `dateStrToDate(str)` | 日期字串轉 Date 物件 |
| `dateToStr(date)` | Date 物件轉日期字串 |
| `isWeekend(date)` | 判斷是否為週末 |
| `isTradingDay(str)` | 判斷是否為交易日 |
| `getTradingDaysBetween(start, end)` | 取得區間內所有交易日 |
| `findMissingDates(existing, required)` | 找出遺漏日期 |
| `getWeekday(str)` | 取得星期幾中文名稱 |
| `waitRandom()` | 隨機延遲 (MIN_WAIT ~ MAX_WAIT 秒) |
| `calculateChange(cur, prev)` | 計算漲跌點數 |
| `calculatePct(cur, prev)` | 計算漲跌百分比 |
| `fetchJson(url, timeout, headers)` | 使用 Node 內建 fetch 取得 JSON |

---

### `src/fetchYahoo.js` - Yahoo Finance 抓取

- 封裝向 Yahoo Finance 查詢歷史資料的邏輯。
- 依賴：`yahoo-finance2`, `./utils`, `./logger`

| 函式 | 說明 |
|---|---|
| `yahooGetHistorical(ticker, dateStr)` | 取得指定 ticker 在指定日期的收盤等資料 |

**支援的 ticker：**
- `^TWII` - 台股加權指數
- `2330.TW` - 台積電 (台股)
- `TSM` - 台積電 ADR (NYSE)

---

### `src/fetchExchange.js` - 匯率 API 抓取

- 從 fawazahmed0 開放匯率 API 取得 USD/TWD。
- 設有主備兩個 CDN URL，失敗自動切換。
- 依賴：`./utils`, `./logger`, `../config`

| 函式 | 說明 |
|---|---|
| `getFxRate()` | 回傳 USD/TWD 匯率 (失敗回傳 null) |

---

### `src/googleSheets.js` - Google Sheets 讀寫

- 封裝所有 Google Sheets API v4 操作。
- 使用 Service Account 驗證。
- 依賴：`googleapis`, `../config`, `./logger`

| 函式 | 說明 |
|---|---|
| `getGoogleCredentials()` | 取得 Google Auth client |
| `getAllDatesInSheets()` | 讀取工作表 A 欄所有日期 |
| `checkAlreadyExistsInSheets(date)` | 檢查指定日期是否已存在 |
| `appendToSheets(rowData)` | 新增一列資料 (含去重判斷) |
| `sortSheetsByDate()` | 依日期升冪排列工作表 |

---

### `src/main.js` - 主程式邏輯

- 整合所有模組，實作三種 CLI 執行模式。
- 依賴：所有 `src/` 模組

| 函式 | 說明 |
|---|---|
| `parseArgs()` | 解析 CLI 參數 (`--date`, `--start`, `--end`, `--fill`) |
| `isValidDate(str)` | 驗證日期字串格式 |
| `fetchDay(dateStr)` | 抓取並組合單一日期的 15 欄資料 |
| `runSingleDay(dateStr)` | 執行單日模式 |
| `runBatch(start, end)` | 執行批次模式 |
| `runFill()` | 執行補齊模式 |
| `main()` | 程式入口，解析模式並分派執行 |

---

## 模組相依圖

```
collect.js
  └── src/main.js
        ├── src/logger.js
        │     └── config.js
        ├── src/utils.js
        │     ├── config.js
        │     └── src/logger.js
        ├── src/fetchYahoo.js
        │     ├── src/utils.js
        │     └── src/logger.js
        ├── src/fetchExchange.js
        │     ├── src/utils.js
        │     └── config.js
        └── src/googleSheets.js
              ├── config.js
              └── src/logger.js
```

---

## 資料欄位對照 (15 欄)

| 欄 | 欄位名稱 | 狀態 | 來源 |
|---|---|---|---|
| A | 日期 | ✅ | 程式計算 |
| B | 星期 | ✅ | `utils.getWeekday` |
| C | 台股指數 | ✅ | Yahoo Finance `^TWII` |
| D | 漲跌 | ✅ | `utils.calculateChange` |
| E | 漲跌% | ✅ | `utils.calculatePct` |
| F | 成交金額 | ❌ | 需 twse.com.tw API |
| G | 外資買賣超 | ❌ | 需 twse.com.tw API |
| H | 外資多空單 | ❌ | 需 twse.com.tw API |
| I | 增減 | ❌ | 需 twse.com.tw API |
| J | 融資餘額 | ❌ | 需 twse.com.tw API |
| K | 增減 | ❌ | 需 twse.com.tw API |
| L | 台積電股價 | ✅ | Yahoo Finance `2330.TW` |
| M | 台積電漲跌% | ✅ | `utils.calculatePct` |
| N | ADR (USD) | ✅ | Yahoo Finance `TSM` |
| O | 匯率 | ✅ | fawazahmed0 API |
