# AGENTS.md - 台灣股市每日自動抓取

## 專案目標

自動每日抓取台灣股市資料並寫入 Google Sheets (股市data 1)。
目前自動抓取 10/15 欄位，還有 5 欄需要台灣境內證券交易所 API 才能取得。

## 整體架構

```
┌────────────────────────────────┐
│        .env (環境變數)          │
│   SPREADSHEET_ID, TOKEN_PATH   │
│   CLIENT_SECRET_PATH, 等        │
└─────┬──────────────────────────┘
      │ 載入
┌─────▼──────────────────────────┐
│       src/config_loader.py     │
│   讀取 .env, 提供 config 字典  │
└─────┬──────────────────────────┘
      │ config 字典
┌─────▼──────────────────────────┐
│       src/main.py              │
│  ┌──────────────────────────┐  │
│  │ Section 2: Yahoo Finance │  │
│  │   - ^TWII (台股指數)     │  │
│  │   - 2330.TW (台積電)     │  │
│  │   - TSM (ADR)            │  │
│  └──────────────────────────┘  │
│  ┌──────────────────────────┐  │
│  │ Section 3: Exchange API  │  │
│  │   - USD/TWD 匯率          │  │
│  └──────────────────────────┘  │
│  ┌──────────────────────────┐  │
│  │ Section 4: 資料計算       │  │
│  │   - 漲跌 = price - prev  │  │
│  │   - 漲跌% = (a-b)/b×100 | │
│  │   - 星期計算               │  │
│  └──────────────────────────┘  │
│  ┌──────────────────────────┐  │
│  │ Section 5: Google Sheets │  │
│  │   - OAuth 憑證           │  │
│  │   - 檢查重複日期          │  │
│  │   - append 新增一列       │  │
│  └──────────────────────────┘  │
└────────────────────────────────┘
```

## 已完成部分 ✓

| 項目 | 狀態 | 說明 |
|------|------|------|
| Yahoo Finance API 整合 | ✅ | 抓取 ^TWII, 2330.TW, TSM |
| Exchange API 整合 | ✅ | 抓取 USD/TWD, 含備用 CDN |
| Google Sheets API 整合 | ✅ | OAuth, append, 去重檢查 |
| .env 環境變數 | ✅ | 機密資訊分離 |
| config_loader | ✅ | 集中配置管理 |
| 程式 restructure | ✅ | 從單一檔案拆為 src/main.py + src/config_loader.py |
| 隨機延遲 | ✅ | 6-15 秒模擬真人 |
| 日誌記錄 | ✅ | logging 模組 |
| 程式 bug 修復 | ✅ | adr 變數名稱修正 |

## 未完成部分

| 項目 | 說明 | 阻塞原因 |
|------|------|----------|
| 成交金額 (Col F) | 需 twse.com.tw API | 本機無法存取台灣境內 API |
| 外資買賣超 (Col G) | 需 twse.com.tw API | 同上 |
| 外資多空單 (Col H) | 需 twse.com.tw API | 同上 |
| 增減 (Col I) | 需 twse.com.tw API | 同上 |
| 融資餘額 (Col J) | 需 twse.com.tw API | 同上 |
| 增減 (Col K) | 需 twse.com.tw API | 同上 |

> 這 5 欄需要台灣境內的證券交易所 API (twse.com.tw/rwd/zh/afterTrading 或 mops.twse.org.tw)。
> 目前本機伺服器在境外，無法存取這些 API (全部 404)。
> **解法**: 透過 SSH 到 GB10-ollama (192.168.1.5, 台灣境內) 執行爬取，或用台灣 VPS。

## 待解決問題

1. **證交所 API 404** → 考慮透過 Ollama remote host (GB10-192.168.1.5) SSH 執行
2. **token 過期處理** → 已有 refresh 邏輯，但 refresh_token 過期後需重新手動授權
3. **錯誤重試機制** → 目前無重試，可加入 requests 重試
4. **HTML 解析** → mops.twse.org.tw 需要 BeautifulSoup 才能解析表格
5. **OAuth 自動更新** → setup.py 需隨專案一起發布

## 開發流程

### 新增欄位功能

如果要新增某個欄位 (例如成交金額):

1. 新增 API 抓取函數 (如 `fetch_volume()`)
2. 在主程式中呼叫並取得資料
3. 將結果放入 `combined_row` 對應位置 (目前 Col F = 索引 5)
4. 更新 README.md 與本文件

### 環境變數

所有設定走 `.env`:

```bash
SPREADSHEET_ID=xxx
TOKEN_PATH=/path/to/token.json
CLIENT_SECRET_PATH=/path/to/secret.json
YAHOO_TIMEOUT=15
EXCHANGE_TIMEOUT=10
MIN_WAIT=6
MAX_WAIT=15
LOG_LEVEL=INFO
```

## 程式碼結構

```
taiwan-stock-daily-collector/
├── src/
│   ├── __init__.py
│   ├── config_loader.py    # 環境變數載入
│   └── main.py             # 主程式
├── .env.example            # 環境變數範本
├── requirements.txt        # Python 依賴
├── .gitignore
├── README.md
└── AGENTS.md               # 本檔案
```

## 測試

```bash
cd src
pip install -r ../requirements.txt
python config_loader.py    # 測試配置
python main.py             # 執行
```
