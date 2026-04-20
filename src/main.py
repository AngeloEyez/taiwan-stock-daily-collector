#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
台灣股市資料每日自動抓取與寫入 Google Sheets

功能說明:
1. 使用 Yahoo Finance API 取得市場價格資料 (指數、台積電股價、ADR)
2. 使用 Exchange API (fawazahmed0) 取得 USD/TWD 匯率
3. 將 10 個欄位寫入 Google Sheets (股市data 1)

資料來源 (4 個 API):
  - Yahoo Finance: ^TWII, 2330.TW, TSM
  - Exchange API: USD/TWD
  
Python 小白閱讀指南:
  本程式分為 6 個主要區塊 (Section):
  
  Section 1 (配置載入): 從 .env 讀取設定
    → 不需要修改程式碼，只需改 .env 檔案
  
  Section 2 (Yahoo Finance 爬取): 用 Yahoo Finance 抓價格資料
    → 台股指數、台積電股價、ADR 由這裡取得
  
  Section 3 (Exchange API): 取得 USD/TWD 匯率
    → 使用 fawazahmed0 的免費貨幣 API
  
  Section 4 (資料處理): 合併資料並計算漲跌/漲跌%
  
  Section 5 (Google Sheets 寫入): 寫資料到試算表
    → 自動檢查重複，避免寫入相同的列
  
  Section 6 (主程式): 串起所有功能
"""

import json
import sys
import time
import random
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, Optional, List

# 加入專案目錄到 Python path
sys.path.insert(0, str(Path(__file__).parent))
from config_loader import config

# ============ 設定日誌記錄 ============
logging.basicConfig(
    level=getattr(logging, config['LOG_LEVEL']),
    format='%(message)s'
)
logger = logging.getLogger(__name__)

# 匯率 API 網址
EXCHANGE_API_URL = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json"
EXCHANGE_API_FALLBACK = "https://latest.currency-api.pages.dev/v1/currencies/usd.json"

# HTTP 標頭 - 讓 Yahoo Finance 認為我們是正常的瀏覽器
TWSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

# =========== 從 config_loader 載入設定 ===========
SPREADSHEET_ID = config['SPREADSHEET_ID']
SHEET_NAME = config['SHEET_NAME']
TOKEN_PATH = Path(config['TOKEN_PATH'])
CLIENT_SECRET_PATH = Path(config['CLIENT_SECRET_PATH'])
YAHOO_TIMEOUT = config['YAHOO_TIMEOUT']
EXCHANGE_TIMEOUT = config['EXCHANGE_TIMEOUT']
MIN_WAIT = config['MIN_WAIT']
MAX_WAIT = config['MAX_WAIT']


def yahoo_get(ticker: str) -> Dict:
    """
    向 Yahoo Finance 取得單一 ticker 的資料
    
    參數:
      ticker: Yahoo Finance ticker (例如 ^TWII, 2330.TW, TSM)
    
    回傳:
      dict: 包含價格、開盤、高低、成交量等
            key 說明:
              - symbol: ticker 名稱
              - price: 目前價格
              - prev_close: 前一日的收盤價
              - open: 今日開盤價
              - high: 今日最高價
              - low: 今日最低價
              - close: 今日收盤價
              - currency: 幣別 (TWD/USD 等)
              - volume: 成交量
              - timestamp: 資料的時間戳記
              - error: 錯誤訊息 (如果抓取失敗)
    """
    import requests
    
    try:
        url = f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d"
        
        resp = requests.get(url, headers=TWSE_HEADERS, timeout=YAHOO_TIMEOUT)
        data = resp.json()
        
        result = data.get("chart", {}).get("result", [{}])
        if not result:
            return {"error": "Yahoo Finance 回傳空的結果"}
        
        meta = result[0].get("meta", {})
        quotes = result[0].get("indicators", {}).get("quote", [{}])
        quote_obj = quotes[0]
        timestamps = result[0].get("timestamp", [])
        
        return {
            "symbol": meta.get("symbol", ticker),
            "price": meta.get("regularMarketPrice"),
            "prev_close": meta.get("chartPreviousClose"),
            "open": quote_obj.get("open", [None])[-1] if quote_obj.get("open") else None,
            "close": quote_obj.get("close", [None])[-1] if quote_obj.get("close") else None,
            "high": quote_obj.get("high", [None])[-1] if quote_obj.get("high") else None,
            "low": quote_obj.get("low", [None])[-1] if quote_obj.get("low") else None,
            "volume": meta.get("regularMarketVolume"),
            "currency": meta.get("currency"),
            "timestamp": timestamps[-1] if timestamps else None,
        }
        
    except Exception as e:
        return {"error": f"Yahoo Finance 請求失敗: {e}"}


def get_fx_rate_exchange_api() -> Optional[float]:
    """
    抓取 USD/TWD 匯率
    
    使用 Exchange API (fawazahmed0)
    → 免費、無訪問次數限制、每天更新
    """
    import requests
    
    try:
        resp = requests.get(EXCHANGE_API_URL, timeout=EXCHANGE_TIMEOUT)
        
        if resp.status_code != 200:
            resp = requests.get(EXCHANGE_API_FALLBACK, timeout=EXCHANGE_TIMEOUT)
        
        if resp.status_code != 200:
            return None
        
        data = resp.json()
        return data.get("usd", {}).get("twd", None)
        
    except Exception:
        return None


def calculate_change(current: float, prev: float) -> Optional[float]:
    """計算漲跌點數 (current - prev)"""
    if current is None or prev is None:
        return None
    return round(current - prev, 2)


def calculate_pct(current: float, prev: float) -> Optional[float]:
    """計算漲跌百分比 ((current - prev) / prev * 100)"""
    if current is None or prev is None or prev == 0:
        return None
    return round((current - prev) / prev * 100, 2)


def get_weekday(date_str: str) -> str:
    """將字串日期轉為星期幾"""
    dt = datetime.strptime(date_str.strip(), "%Y/%m/%d")
    day_map = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]
    return day_map[dt.weekday()]


def wait_random():
    """隨機等待，模擬正常使用者速度"""
    delay = random.uniform(MIN_WAIT, MAX_WAIT)
    time.sleep(delay)


def get_google_credentials():
    """讀取 OAuth 憑證並重建 Google API Credentials"""
    from googleapiclient.discovery import build
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    
    token_data = json.loads(TOKEN_PATH.read_text())
    client_data = json.loads(CLIENT_SECRET_PATH.read_text())
    creds_data = client_data.get("web") or client_data.get("installed", {})
    
    creds = Credentials(
        token=token_data["token"],
        refresh_token=token_data.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=creds_data["client_id"],
        client_secret=creds_data["client_secret"],
        scopes=token_data.get("scopes", [])
    )
    
    if not creds.valid:
        creds.refresh(Request())
    
    return creds


def check_already_exists_in_sheets(service, date_str: str) -> bool:
    """檢查試算表最後一列是否已經是今天"""
    values = service.spreadsheets().values().get(
        spreadsheetId=SPREADSHEET_ID,
        range=SHEET_NAME + "!A:A",
        valueRenderOption='UNFORMATTED_VALUE'
    ).execute().get('values', [])
    
    if not values:
        return False
    
    last_row = values[-1]
    if last_row and len(last_row) > 0:
        last_date = last_row[0]
        return last_date.strip() == date_str.strip()
    
    return False


def append_to_sheets(row_data: list) -> bool:
    """將一列資料寫入 Google Sheets"""
    creds = get_google_credentials()
    from googleapiclient.discovery import build
    service = build('sheets', 'v4', credentials=creds)
    
    if check_already_exists_in_sheets(service, row_data[0]):
        logger.info("今天已有資料，跳過寫入")
        return False
    
    response = service.spreadsheets().values().append(
        spreadsheetId=SPREADSHEET_ID,
        range=SHEET_NAME,
        valueInputOption='RAW',
        body={"values": [row_data]}
    ).execute()
    
    logger.info(f"寫入成功! 共有 {response['updates']['updatedRows']} 列更新")
    return True


def main():
    """主程式入口點"""
    logger.info("=" * 50)
    logger.info("台灣股市每日資料自動抓取程式啟動")
    logger.info("=" * 50)
    
    today = datetime.today()
    date_str = today.strftime("%Y/%m/%d")
    logger.info(f"目標日期: {date_str}\n")
    
    # Step 1: 抓取 Yahoo Finance 資料
    logger.info("--- 抓取 Yahoo Finance 資料 ---")
    
    # 1-A: 台股加權指數
    market = yahoo_get("^TWII")
    logger.info(f"1. 台股指數 (^TWII): {market.get('price', 'N/A')}")
    wait_random()
    
    # 1-B: 台積電股價
    tsmc = yahoo_get("2330.TW")
    logger.info(f"2. 台積電股價 (2330.TW): {tsmc.get('price', 'N/A')}")
    wait_random()
    
    # 1-C: 台積電 ADR
    adr = yahoo_get("TSM")
    logger.info(f"3. 台積電 ADR (TSM): {adr.get('price', 'N/A')}")
    wait_random()
    
    # 1-D: USD/TWD 匯率
    fx = get_fx_rate_exchange_api()
    logger.info(f"4. USD/TWD 匯率: {fx if isinstance(fx, float) else 'N/A'}")
    wait_random()
    
    # 檢查是否有抓取到有效資料
    if not market or 'error' in market:
        logger.error(f"台股指數抓取失敗: {market.get('error', '未知錯誤')}")
        return
    if not tsmc or 'error' in tsmc:
        logger.error(f"台積電股價抓取失敗: {tsmc.get('error', '未知錯誤')}")
        return
    if not adr or 'error' in adr:
        logger.error(f"ADR 抓取失敗: {adr.get('error', '未知錯誤')}")
        return
    if fx is None:
        logger.error("匯率抓取失敗")
        return
    
    logger.info("\n抓取完成!\n")
    
    # Step 2: 計算漲跌
    taiex_change = calculate_change(market.get('price'), market.get('prev_close'))
    taiex_pct = calculate_pct(market.get('price'), market.get('prev_close'))
    
    tsmc_change = calculate_change(tsmc.get('price'), tsmc.get('prev_close'))
    tsmc_pct = calculate_pct(tsmc.get('price'), tsmc.get('prev_close'))
    
    # Step 3: 組合 15 列資料
    combined_row = [
        date_str,                     # 1. 日期
        get_weekday(date_str),        # 2. 星期
        market.get('price'),          # 3. 台股指數
        taiex_change,                 # 4. 漲跌
        taiex_pct,                    # 5. 漲跌%
        "N/A",                        # 6. 成交金額   (未來補充)
        "N/A",                        # 7. 外資買賣超 (未來補充)
        "N/A",                        # 8. 外資多空單 (未來補充)
        "N/A",                        # 9. 增減       (未來補充)
        "N/A",                       # 10. 融資餘額  (未來補充)
        "N/A",                        # 11. 增減      (未來補充)
        tsmc.get('price'),            # 12. 台積電股價
        tsmc_pct,                     # 13. 台積電漲跌%
        adr.get('price'),             # 14. ADR(USD)
        fx,                           # 15. 匯率
    ]
    
    # Step 4: 寫入 Google Sheets
    write_result = append_to_sheets(combined_row)
    
    # Step 5: 回報結果
    if write_result:
        logger.info("\n全部工作完成！\n")
        headers = [
            "日期", "星期", "台股指數", "漲跌", "漲跌%",
            "成交金額", "外資買賣超", "外資多空單", "增減",
            "融資餘額", "增減", "台積電股價", "台積電漲跌%",
            "ADR(USD)", "匯率"
        ]
        for i, h in enumerate(headers):
            val = combined_row[i]
            status = "✓" if val is not None and val != "N/A" else "✗"
            logger.info(f"  {status} {h}: {val if val is not None else 'N/A'}")
    else:
        logger.info("\n寫入跳過 (可能已存在今天的資料)。")


if __name__ == "__main__":
    main()
