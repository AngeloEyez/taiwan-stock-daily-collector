# 台灣股市每日自動抓取 (Taiwan Stock Daily Collector)

自動從 Yahoo Finance 與 Exchange API 抓取台灣股市每日資料，並寫入 Google Sheets。

## 功能

- **自動抓取**台股加權指數、台積電股價、台積電 ADR、USD/TWD 匯率
- **自動計算**每日漲跌與漲跌百分比
- **寫入 Google Sheets**，自動檢查每日重複，自動刷新 Token
- **隨機延遲**模擬真人瀏覽速度，避免 IP 被封鎖
- **日誌記錄**完整追蹤每次執行的狀態

## 目前抓取 10/15 欄

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

## 安裝

### 1. 安裝 Python 依賴

```bash
pip install -r requirements.txt
```

或者手動安裝:

```bash
pip install google-api-python-client google-auth requests
```

### 2. Google OAuth 設定

如果你需要將此程式用於自己的試算表:

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 建立新的 OAuth 2.0 憑證 (Desktop app 類型)
3. 下載 `client_secret.json`
4. 執行 OAuth 授權流程生成 `token.json`

範例授權流程:

```python
# 在 Python 中執行一次:
from google_auth_oauthlib.flow import Flow

flow = Flow.from_client_secrets_file(
    'client_secret.json',
    scopes=['https://www.googleapis.com/auth/spreadsheets']
)
auth_url, _ = flow.authorization_url(prompt='consent')
print(f"請前往以下 URL 授權: {auth_url}")
# 複製授權碼回來
code = input("請輸入授權碼: ")
creds = flow.get_credentials(code)
# 儲存 token
import json
from pathlib import Path
Path('token.json').write_text(json.dumps(creds.to_json()))
print("token.json 已生成!")
```

### 3. 設定 .env 環境變數

```bash
cp .env.example .env
```

編輯 `.env`:

```bash
SPREADSHEET_ID=你的試算表ID
TOKEN_PATH=/path/to/google_token.json
CLIENT_SECRET_PATH=/path/to/google_client_secret.json
```

### 4. 測試執行

```bash
cd src
python main.py
```

## Cron 設定

每天執行 cron job (例如每分鐘執行一次的 cron, 在程式中判斷是否為交易日與正確時間):

### 方式一: 系統 crontab

```bash
crontab -e
```

加入:

```bash
# 每天上午 18:00 執行 (收盤後)
0 18 * * 0-6 /usr/bin/python3 /path/to/taiwan-stock-daily-collector/src/main.py >> /var/log/stock_collector.log 2>&1
```

### 方式二: Hermes Agent cron job

```
create 台灣股市每日抓取
  prompt: 執行 taiwan-stock-daily-collector/src/main.py 抓取今日股市資料并寫入 Google Sheets
  schedule: 每天 18:00
```

## 架構圖

```
┌─────────────────────────────────────────────┐
│  main.py (主程式)                           │
│  │                                            │
│  ├── Yahoo Finance API (^TWII, 2330.TW, TSM)│
│  ├── Exchange API (USD/TWD)                  │
│  ├── 資料計算 (漲跌、漲跌%)                  │
│  └── Google Sheets API (寫入)               │
└─────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│  .env (環境變數設定)                        │
│  (不進入版本控制，避免洩漏機密)             │
└─────────────────────────────────────────────┘
```

## .gitignore

自動忽略 `.env` 與 Python 生成的檔案。

## License

MIT
