# API 文件說明

## Yahoo Finance API

本專案使用 `yahoo-finance2` 套件進行資料抓取，該套件內部封裝了對 Yahoo Finance v8 chart API 的請求。

### 抓取範例 (Node.js)
```javascript
const yahooFinance = require('yahoo-finance2').default;
const result = await yahooFinance.chart('2330.TW', {
  period1: startTime, // Unix timestamp
  period2: endTime,
  interval: '1d'
});
```

### 資料欄位
- **Symbol**: 股票代號 (`^TWII`, `2330.TW`, `TSM`)
- **Price**: 收盤價
- **Previous Close**: 前一日收盤價 (用於計算漲跌)
- **Quotes**: 包含 open, high, low, close, volume 等歷史資料陣列

---

## Exchange API (fawazahmed0)

### 主端點
```
GET https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json
```

### 備用端點
```
GET https://latest.currency-api.pages.dev/v1/currencies/usd.json
```

### 回應範例
```json
{
  "usd": {
    "twd": 32.5847,
    "eur": 0.9234,
    "jpy": 149.2351
  }
}
```

---

## Google Sheets API

### 需要授權的範圍
```
https://www.googleapis.com/auth/spreadsheets
```

### 主要 API 呼叫

#### 讀取試算表最後一列
```javascript
const response = await service.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range: `${SHEET_NAME}!A:A`,
  valueRenderOption: 'UNFORMATTED_VALUE'
});
```

#### 寫入新資料
```javascript
await service.spreadsheets.values.append({
  spreadsheetId: SPREADSHEET_ID,
  range: SHEET_NAME,
  valueInputOption: 'RAW',
  requestBody: {
    values: [[col1, col2, col3, ...]]
  }
});
```

---

## Taiwan Stock Exchange (TWSE) API

### MI_INDEX - 每日收盤行情
```
GET https://api.twse.com.tw/v1/exchangeReport/MI_INDEX?date=20260421&response=json
```

- **用途**: 取得成交金額、成交股數、成交筆數
- **日期格式**: YYYYMMDD (例如 20260421)
- **回應格式**: JSON
- **Key Fields**: 
  - 總計 (row 16): `data[16].tradingVolume` → 成交金額 (元)
  - **單位轉換**: API 回傳「元」/ 100,000,000 = 億

### MI_MARGN - 融資融券餘額
```
GET https://api.twse.com.tw/v1/exchangeReport/MI_MARGN?date=20260421&response=json
```

- **用途**: 取得融資餘額、融券餘額
- **日期格式**: YYYYMMDD
- **Key Fields**:
  - 融資 (row 0): `data[0].balance` → 今日餘額
  - 融券 (row 1): `data[1].balance` → 融券餘額
- **單位轉換**: API 回傳「仟元」/ 10,000 = 億

### BFI82U - 三大法人買賣金額
```
GET https://api.twse.com.tw/v1/exchangeReport/BFI82U?date=20260421&response=json
```

- **用途**: 取得三大法人買賣金額
- **日期格式**: YYYYMMDD
- **Key Fields**:
  - 外資及陸資 (不含外資自營商): `data[row3].balance`
  - 自營商(避險): `data[row1].balance`
- **單位轉換**: API 回傳「元」/ 100,000,000 = 億

### 注意事項
- **需 User-Agent header** → 否則回傳 403
- **非交易日查詢** → API 回傳空資料表
- **證交所 API 資料更新延遲** → 盤後 1~2 小時才更新完
- MI_MARGN 無資料時回傳: `{"stat": "很抱歉，沒有符合條件的資料"}`

---

## TAIFEX API (臺灣期貨交易所)

### futContractsDate (HTML 表格) — **每日推薦做法** ✅

```
GET https://www.taifex.com.tw/cht/3/futContractsDate?queryDate=2026/04/21&commodityId=
```

- **用途**: 取得三大法人期貨交易資料（含外資期貨未平倉餘額）
- **日期格式**: YYYY/MM/DD
- **Date format**: YYYY/MM/DD (例如 2026/04/21)
- **commodityId**: 留空 = 全部商品；TX=臺股期貨，tX=臺股選擇權
- **回傳格式**: HTML (不是 CSV!)
- **編碼**: UTF-8
- **Headers (必選)**:
  ```
  Referer: https://www.taifex.com.tw/cht/3/futContractsDate
  User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
  ```
- **Table 結構**:
  - class="table_f" 識別表格
  - 23種期貨契約 × 3種法人 (自營商/投信/外資) × 3種統計 (交易/契約金額/未平倉)
  - 每種契約內：表頭 → 自營商 → 投信 → 外資
  - 最後有「期貨小計」+「期貨合計」列
- **使用方式**: axios 請求 + cheerio/jsdom 解析 HTML table
- **⚠️ 可用於所有日期**（包含歷史資料）← **推薦方案**

### futContractsDateDown (CSV) — **僅限當天有效** ⚠️

```
GET https://www.taifex.com.tw/cht/3/futContractsDateDown?queryDate=2026/04/21&commodityId=
```

- **限制**: **僅能查詢當天或 1-2 天內的日期**
- **過期日期查詢**: 回傳 610-byte HTML redirect (`alert("查無資料")`)
- **編碼**: Big5 (需 iconv 解碼)
- **Headers (必選)**:
  ```
  Referer: https://www.taifex.com.tw/cht/3/futContractsDate
  User-Agent: Mozilla/5.0
  ```
- **CSV 欄位**:
  - col0=機構名稱, col1=買進口數, col2=賣出口數, col3=淨額口數
  - col4=買進金額, col5=賣出金額, col6=淨額金額, col7=未平倉餘額
  - col3 = col1 - col2 (正=淨多, 負=淨空)
- **外資期貨未平倉餘額** = 外資列的 col3 (淨額口數)
- **❌ Node.js axios 也可行，但同樣只限當天**
- **歷史資料**：只能用 futContractsDate (HTML) 或 Playwright

### futContractsDateAh (夜盤)
```
GET https://www.taifex.com.tw/cht/3/futContractsDateAh?queryDate=2026/04/21
```

### futContractsDateAhView (夜盤資料檢視)
```
GET https://www.taifex.com.tw/cht/3/futContractsDateAhView?queryDate=2026/04/21
```

### futContractsWeek (依週別查詢)
```
GET https://www.taifex.com.tw/cht/3/futContractsWeek?queryDate=2026/04/21
```

### 其他 TAIFEX 頁面
- `/cht/3/futContractsDateAh` - 夜盤查詢
- `/cht/3/futContractsDateAhView` - 夜盤資料檢視
- `/cht/3/totalTableDateIf?queryDate=YYYY/MM/DD` - 三大法人總表iframe (需 cookie)

### Node.js 實現範例 (futContractsDate)

```javascript
const axios = require('axios');
const cheerio = require('cheerio');

async function fetchTaifexFutures(queryDate) {
  const url = `https://www.taifex.com.tw/cht/3/futContractsDate`;
  
  const headers = {
    'Referer': 'https://www.taifex.com.tw/cht/3/futContractsDate',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };
  
  const resp = await axios.get(url, {
    params: { queryDate, commodityId: '' },
    headers,
  });
  
  const $ = cheerio.load(resp.data);
  const tables = $('.table_f');
  
  // 解析 HTML 表格
  // ...
}
```

---

## Google Sheets API (Service Account 模式)

本專案採用 **Service Account (服務帳戶)** 進行驗證，適合自動化無人值守執行。

### 認證流程

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)。
2. 建立一個服務帳戶，並下載其 **JSON 金鑰檔案**。
3. 將該 JSON 檔案命名為 `service_account.json` 並放入專案目錄。
4. 將您的試算表 **分享** 給該服務帳戶的 Email (權限設為「編輯者」)。
5. 在 `.env` 中設定 `GOOGLE_SERVICE_ACCOUNT_FILE=service_account.json`。

### 安全提示
- `service_account.json` 包含敏感私鑰，已預設加入 `.gitignore`，請勿上傳至公開版本庫。

---

## 原始碼

- **原始碼**: https://github.com/AngeloEyez/taiwan-stock-daily-collector
- **Yahoo Finance**: https://finance.yahoo.com/
- **Exchange API**: https://github.com/fawazahmed0/currency-api
- **TWSE API**: https://github.com/murlot/twse
- **TAIFEX API**: https://www.taifex.com.tw/

---

## 單位轉換速查表

| 來源 | 原始單位 | 目標單位 | 轉換方式 |
|------|------|------|------|
| MI_INDEX 成交金額 | 元 | 億 | / 100,000,000 |
| MI_MARGN 融資餘額 | 仟元 | 億 | / 10,000 |
| BFI82U 外資買賣超 | 元 | 億 | / 100,000,000 |
| TAIFEX 契約金額 | 千元 | 億 | / 100,000 |
| 台股指數 | 點 | - | 直接使用 |
| 台積電股價 | TWD | - | 直接使用 |
| ADR | USD | - | 直接使用 |
| 匯率 | TWD/USD | - | 直接使用 |

---

## 日期格式速查表

| API | 格式 | 範例 |
|-----|-----|-----|
| Google Sheets | YYYY/MM/DD | 2026/04/21 |
| TAIFEX | YYYY/MM/DD | 2026/04/21 |
| TWSE API | YYYYMMDD | 20260421 |
