#!/usr/bin/env node
/**
 * 台灣股市資料每日自動抓取與寫入 Google Sheets
 * 
 * 功能說明:
 * 1. 使用 Yahoo Finance API 取得市場價格資料 (指數、台積電股價、ADR)
 * 2. 使用 Exchange API (fawazahmed0) 取得 USD/TWD 匯率
 * 3. 將 10 個欄位寫入 Google Sheets (股市data 1)
 * 
 * 資料來源 (4 個 API):
 *   - Yahoo Finance: ^TWII, 2330.TW, TSM
 *   - Exchange API: USD/TWD
 * 
 * Node.js 小白閱讀指南:
 *   本程式分為 6 個主要區塊 (Section):
 * 
 *   Section 1 (配置載入): 從 .env 讀取設定
 *   Section 2 (Yahoo Finance 爬取): 用 Yahoo Finance 抓價格資料
 *   Section 3 (Exchange API): 取得 USD/TWD 匯率
 *   Section 4 (資料處理): 合併資料並計算漲跌/漲跌%
 *   Section 5 (Google Sheets 寫入): 寫資料到試算表
 *   Section 6 (主程式): 串起所有功能
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { google } = require('googleapis');
const winston = require('winston');

// 載入配置
const config = require('./config');

// ==============================================
// Section 1: 設定日誌記錄
// ==============================================
const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: winston.format.simple(),
  transports: [new winston.transports.Console()],
});

// ==============================================
// Section 2: Yahoo Finance API
// ==============================================

/**
 * HTTP 標頭 - 讓 Yahoo Finance 認為我們是正常的瀏覽器
 */
const TWSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

/**
 * 向 Yahoo Finance 取得單一 ticker 的資料
 * 
 * 參數:
 *   ticker: Yahoo Finance ticker (例如 ^TWII, 2330.TW, TSM)
 * 
 * 回傳:
 *   Promise<Object>: 包含價格、開盤、高低、成交量等
 *     物件 key 說明:
 *       - symbol: ticker 名稱
 *       - price: 目前價格
 *       - prev_close: 前一日的收盤價
 *       - open: 今日開盤價
 *       - close: 今日收盤價
 *       - high: 今日最高價
 *       - low: 今日最低價
 *       - volume: 成交量
 *       - currency: 幣別 (TWD/USD 等)
 *       - timestamp: 資料的時間戳記
 *       - error: 錯誤訊息 (如果抓取失敗)
 */
async function yahooGet(ticker) {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d`;
    
    const resp = await axios.get(url, {
      headers: TWSE_HEADERS,
      timeout: config.YAHOO_TIMEOUT * 1000,
    });
    
    const data = resp.data;
    const result = data.chart?.result;
    
    if (!result || result.length === 0) {
      return { error: 'Yahoo Finance 回傳空的結果' };
    }
    
    const meta = result[0].meta || {};
    const quotes = result[0].indicators?.quote?.[0] || {};
    const timestamps = result[0].timestamp || [];
    
    return {
      symbol: meta.symbol || ticker,
      price: meta.regularMarketPrice,
      prev_close: meta.chartPreviousClose,
      open: quotes.open?.[quotes.open.length - 1] || null,
      close: quotes.close?.[quotes.close.length - 1] || null,
      high: quotes.high?.[quotes.high.length - 1] || null,
      low: quotes.low?.[quotes.low.length - 1] || null,
      volume: meta.regularMarketVolume,
      currency: meta.currency,
      timestamp: timestamps[timestamps.length - 1] || null,
    };
    
  } catch (error) {
    return { error: `Yahoo Finance 請求失敗: ${error.message}` };
  }
}

// ==============================================
// Section 3: Exchange API (匯率)
// ==============================================

/**
 * 抓取 USD/TWD 匯率
 * 
 * 使用 Exchange API (fawazahmed0)
 * → 免費、無訪問次數限制、每天更新
 * 
 * 回傳:
 *   Promise<number|null>: USD/TWD 匯率，失敗則回傳 null
 */
async function getFxRate() {
  const urls = [
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    'https://latest.currency-api.pages.dev/v1/currencies/usd.json',
  ];
  
  for (const url of urls) {
    try {
      const resp = await axios.get(url, { timeout: config.EXCHANGE_TIMEOUT * 1000 });
      
      if (resp.status !== 200) continue;
      
      const data = resp.data;
      const twdRate = data?.usd?.twd;
      
      if (twdRate !== undefined && twdRate !== null) {
        return twdRate;
      }
    } catch (error) {
      // 嘗試下一個 URL
      continue;
    }
  }
  
  return null; // 全部失敗
}

// ==============================================
// Section 4: 資料處理函數
// ==============================================

/**
 * 計算漲跌點數 (current - prev)
 * 
 * @param {number} current - 目前價格
 * @param {number} prev - 前一日價格
 * @returns {number|null} - 漲跌點數，任一為 null 則回傳 null
 */
function calculateChange(current, prev) {
  if (current === null || current === undefined || prev === null || prev === undefined) {
    return null;
  }
  return Math.round((current - prev) * 100) / 100; // 保留 2 個小數
}

/**
 * 計算漲跌百分比 ((current - prev) / prev * 100)
 * 
 * @param {number} current - 目前價格
 * @param {number} prev - 前一日價格
 * @returns {number|null} - 漲跌百分比，任一為 null 則回傳 null
 */
function calculatePct(current, prev) {
  if (current === null || current === undefined || prev === null || prev === undefined || prev === 0) {
    return null;
  }
  return Math.round(((current - prev) / prev * 100) * 100) / 100; // 保留 2 個小數
}

/**
 * 將字串日期轉為星期幾
 * 
 * @param {string} dateStr - 日期字串 (YYYY/MM/DD)
 * @returns {string} - 星期幾
 */
function getWeekday(dateStr) {
  const dt = new Date(dateStr.replace(/\//g, '-'));
  const dayMap = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return dayMap[dt.getDay()];
}

/**
 * 隨機等待，模擬正常使用者速度
 */
function waitRandom() {
  const delay = Math.random() * (config.MAX_WAIT - config.MIN_WAIT) + config.MIN_WAIT;
  logger.info(`等待 ${delay.toFixed(1)} 秒 (模擬真人速度)...`);
  return new Promise(resolve => setTimeout(resolve, delay * 1000));
}

// ==============================================
// Section 5: Google Sheets API
// ==============================================

/**
 * 讀取 OAuth 憑證並重建 Google API Credentials
 * 
 * 回傳:
 *   Credentials: Google OAuth 憑證物件
 */
async function getGoogleCredentials() {
  // 讀取 token.json
  const tokenPath = config.TOKEN_PATH;
  const tokenPathObj = path.resolve(tokenPath);
  const tokenData = JSON.parse(fs.readFileSync(tokenPathObj, 'utf8'));
  
  // 讀取 client_secret.json
  const clientSecretPath = config.CLIENT_SECRET_PATH;
  const clientSecretPathObj = path.resolve(clientSecretPath);
  const clientData = JSON.parse(fs.readFileSync(clientSecretPathObj, 'utf8'));
  
  // 取得 credentials (支援 installed 或 web 格式)
  const credsData = clientData.web || clientData.installed || {};
  
  if (!credsData.client_id || !credsData.client_secret) {
    throw new Error('找不到 client_id 或 client_secret');
  }
  
  const redirectUri = credsData.redirect_uris?.[0] || credsData.redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob';
  
  const creds = new google.auth.OAuth2(
    credsData.client_id,
    credsData.client_secret,
    redirectUri
  );

  // 正確設定 credentials (使用 setCredentials)
  const expiryDate = tokenData.expiry || tokenData.expiry_date
    ? new Date(tokenData.expiry || tokenData.expiry_date).getTime()
    : undefined;
    
  creds.setCredentials({
    access_token: tokenData.token || tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expiry_date: expiryDate,
  });
  
  // 檢查 token 是否過期
  let expired = false;
  if (expiryDate && expiryDate < Date.now()) {
    expired = true;
  }
  
  if (expired && tokenData.refresh_token) {
    logger.info('Token 已過期，正在自動刷新...');
    try {
      // 用同步 callback 方式刷新 (避免 async/await 的複雜度)
      await new Promise((resolve, reject) => {
        creds.refreshToken(tokenData.refresh_token, (err, result, resp) => {
          if (err) reject(err);
          else {
            // 寫回更新後的 token
            const refreshedData = { ...tokenData };
            refreshedData.token = creds.token || creds.credentials.access_token;
            refreshedData.expiry = new Date(creds.expiryDate).toISOString();
            if (creds.refreshToken) {
              refreshedData.refresh_token = creds.refreshToken;
            }
            fs.writeFileSync(tokenPathObj, JSON.stringify(refreshedData, null, 2));
            logger.info('Token 刷新成功 ✓');
            resolve(result);
          }
        });
      });
    } catch (refreshError) {
      logger.error(`Token 刷新失敗: ${refreshError.message}`);
      throw new Error('無法刷新 OAuth token，請重新授權');
    }
  }
  
  // 返回 OAuth2 credentials (google.sheets auth 參數需要這個)
  // creds 物件本身已有 request() 方法
  return creds;
}

/**
 * 檢查試算表最後一列是否已經是今天
 * 
 * @param {string} dateStr - 日期字串
 * @returns {Promise<boolean>} - 如果已存在則回傳 true
 */
async function checkAlreadyExistsInSheets(dateStr) {
  const creds = getGoogleCredentials();
  const service = google.sheets({ version: 'v4', auth: creds });
  
  try {
    const response = await service.spreadsheets.values.get({
      spreadsheetId: config.SPREADSHEET_ID,
      range: `${config.SHEET_NAME}!A:A`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    
    const values = response.data.values || [];
    
    if (values.length === 0) {
      return false;
    }
    
    const lastRow = values[values.length - 1];
    if (lastRow && lastRow.length > 0) {
      return lastRow[0].trim() === dateStr.trim();
    }
    
    return false;
  } catch (error) {
    logger.error(`檢查資料失敗: ${error.message}`);
    return false;
  }
}

/**
 * 將一列資料寫入 Google Sheets
 * 
 * @param {Array} rowData - 一列的資料陣列
 * @returns {Promise<boolean>} - 寫入成功則回傳 true
 */
async function appendToSheets(rowData) {
  const creds = getGoogleCredentials();
  const service = google.sheets({ version: 'v4', auth: creds });
  
  // 檢查是否已存在
  const exists = await checkAlreadyExistsInSheets(rowData[0]);
  if (exists) {
    logger.info('今天已有資料，跳過寫入 ✗');
    return false;
  }
  
  try {
    const response = await service.spreadsheets.values.append({
      spreadsheetId: config.SPREADSHEET_ID,
      range: config.SHEET_NAME,
      valueInputOption: 'RAW',
      requestBody: {
        values: [rowData],
      },
    });
    
    logger.info(`寫入成功! 共有 ${response.data.updates?.updatedRows || 1} 列更新 ✓`);
    return true;
  } catch (error) {
    logger.error(`寫入失敗: ${error.message}`);
    return false;
  }
}

// ==============================================
// Section 6: 主程式
// ==============================================

async function main() {
  logger.info('='.repeat(50));
  logger.info('台灣股市每日資料自動抓取程式啟動 ✨');
  logger.info('='.repeat(50));
  
  // 取得今天日期
  const today = new Date();
  const dateStr = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}`;
  logger.info(`目標日期: ${dateStr}\n`);
  
  // ===== Step 1: 抓取 Yahoo Finance 資料 =====
  logger.info('--- 抓取 Yahoo Finance 資料 ---');
  
  // 1-A: 台股加權指數
  logger.info('1-A: 抓取台股指數 (^TWII)...');
  const market = await yahooGet('^TWII');
  logger.info(`  → 台股指數 (price): ${market.price || 'N/A'}`);
  await waitRandom();
  
  // 1-B: 台積電股價
  logger.info('1-B: 抓取台積電股價 (2330.TW)...');
  const tsmc = await yahooGet('2330.TW');
  logger.info(`  → 台積電股價 (price): ${tsmc.price || 'N/A'}`);
  await waitRandom();
  
  // 1-C: 台積電 ADR
  logger.info('1-C: 抓取台積電 ADR (TSM)...');
  const adr = await yahooGet('TSM');
  logger.info(`  → 台積電 ADR (price): ${adr.price || 'N/A'}`);
  await waitRandom();
  
  // 1-D: USD/TWD 匯率
  logger.info('1-D: 抓取 USD/TWD 匯率...');
  const fx = await getFxRate();
  logger.info(`  → USD/TWD: ${fx || 'N/A'}`);
  await waitRandom();
  
  // ===== 檢查是否有抓取到有效資料 =====
  if (!market || market.error) {
    logger.error(`台股指數抓取失敗: ${market.error || '未知錯誤'}`);
    return;
  }
  if (!tsmc || tsmc.error) {
    logger.error(`台積電股價抓取失敗: ${tsmc.error || '未知錯誤'}`);
    return;
  }
  if (!adr || adr.error) {
    logger.error(`ADR 抓取失敗: ${adr.error || '未知錯誤'}`);
    return;
  }
  if (fx === null) {
    logger.error('匯率抓取失敗');
    return;
  }
  
  logger.info('\n✅ 所有抓取完成!\n');
  
  // ===== Step 2: 計算漲跌 =====
  const taiexChange = calculateChange(market.price, market.prev_close);
  const taiexPct = calculatePct(market.price, market.prev_close);
  
  const tsmcChange = calculateChange(tsmc.price, tsmc.prev_close);
  const tsmcPct = calculatePct(tsmc.price, tsmc.prev_close);
  
  // ===== Step 3: 組合 15 列資料 =====
  const combinedRow = [
    dateStr,                    // 1. 日期
    'N/A',                      // 2. 星期 (稍後補上)
    market.price,               // 3. 台股指數
    taiexChange,                // 4. 漲跌
    taiexPct,                   // 5. 漲跌%
    'N/A',                      // 6. 成交金額 (未來補充)
    'N/A',                      // 7. 外資買賣超 (未來補充)
    'N/A',                      // 8. 外資多空單 (未來補充)
    'N/A',                      // 9. 增減 (未來補充)
    'N/A',                      // 10. 融資餘額 (未來補充)
    'N/A',                      // 11. 增減 (未來補充)
    tsmc.price,                 // 12. 台積電股價
    tsmcPct,                    // 13. 台積電漲跌%
    adr.price,                  // 14. ADR (USD)
    fx,                         // 15. 匯率
  ];
  
  // 修正星期 (放在最後一列)
  combinedRow[1] = getWeekday(dateStr);
  
  // ===== Step 4: 寫入 Google Sheets =====
  const writeResult = await appendToSheets(combinedRow);
  
  // ===== Step 5: 回報結果 =====
  if (writeResult) {
    logger.info('\n✅ 全部工作完成!\n');
    
    const headers = [
      '日期', '星期', '台股指數', '漲跌', '漲跌%',
      '成交金額', '外資買賣超', '外資多空單', '增減',
      '融資餘額', '增減', '台積電股價', '台積電漲跌%',
      'ADR (USD)', '匯率',
    ];
    
    for (let i = 0; i < headers.length; i++) {
      const val = combinedRow[i];
      const status = (val !== null && val !== undefined && val !== 'N/A') ? '✓' : '✗';
      logger.info(`  ${status} ${headers[i]}: ${val !== null && val !== undefined ? val : 'N/A'}`);
    }
  } else {
    logger.info('\n寫入跳過 (可能已存在今天的資料)。');
  }
}

// 程式入口點
main().catch(error => {
  logger.error(`程式執行發生嚴重錯誤: ${error.message}`);
  logger.error(error.stack);
  process.exit(1);
});
