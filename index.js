#!/usr/bin/env node
/**
 * 台灣股市資料每日自動抓取與寫入 Google Sheets
 * 
 * 功能說明:
 * 1. 使用 Yahoo Finance API 取得市場價格資料 (指數、台積電股價、ADR)
 * 2. 使用 Exchange API (fawazahmed0) 取得 USD/TWD 匯率
 * 3. 將 15 個欄位寫入 Google Sheets (股市data 1)
 * 4. 支援指定日期區間批次抓取
 * 5. 試算表韌性機制：自動補齊遺漏資料
 * 
 * 資料來源 (4 個 API):
 *   - Yahoo Finance: ^TWII, 2330.TW, TSM
 *   - Exchange API: USD/TWD
 * 
 * Node.js 小白閱讀指南:
 *   本程式分為 8 個主要區塊 (Section):
 * 
 *   Section 1 (配置載入): 從 .env 讀取設定
 *   Section 2 (CLI 參數解析): 處理使用者輸入的日期參數
 *   Section 3 (Yahoo Finance 爬取): 用 Yahoo Finance 抓價格資料
 *   Section 4 (Exchange API): 取得 USD/TWD 匯率
 *   Section 5 (資料處理): 合併資料並計算漲跌/漲跌%
 *   Section 6 (日期工具): 處理時區、計算交易日
 *   Section 7 (Google Sheets API): 讀寫試算表 + 完整性檢查
 *   Section 8 (主程式): 串起所有功能
 * 
 * ★ 這個版本使用 Node.js 18+ 內建的 fetch API，不用安裝 axios!
 * ★ 支援指定任意日期區間批次抓取，自動補齊遺漏資料~
 */

const fs = require('fs');
const path = require('path');
// Node.js 18+ 內建的 fetch，不需要 npm install axios!
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
// Section 2: CLI 參數解析
// ==============================================

/**
 * 解析使用者輸入的 CLI 參數
 * 
 * 支援的參數:
 *   --date YYYY/MM/DD    : 指定單一日期
 *   --start YYYY/MM/DD   : 批次抓取起始日
 *   --end   YYYY/MM/DD   : 批次抓取結束日
 *   --fill               : 自動補齊試算表內遺漏的資料
 * 
 * @returns {Object} 解析後的參數物件
 *   {
 *     mode: 'single' | 'batch' | 'fill',
 *     date: YYYY/MM/DD 字串 (單一模式時使用),
 *     startDate: YYYY/MM/DD 字串 (批次模式使用),
 *     endDate: YYYY/MM/DD 字串 (批次模式使用)
 *   }
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    mode: 'single',       // 'single', 'batch', 或 'fill'
    date: null,            // 單一日期
    startDate: null,       // 批次起始日
    endDate: null,         // 批次結束日
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--date' && i + 1 < args.length) {
      result.mode = 'single';
      result.date = args[i + 1];
      i++; // 跳過日期值
    }
    else if (arg === '--start' && i + 1 < args.length) {
      result.mode = 'batch';
      result.startDate = args[i + 1];
      i++; // 跳過日期值
    }
    else if (arg === '--end' && i + 1 < args.length) {
      result.mode = 'batch';
      result.endDate = args[i + 1];
      i++; // 跳過日期值
    }
    else if (arg === '--fill') {
      result.mode = 'fill';
    }
  }
  
  // 如果使用者沒有輸入任何參數，預設為单日模式
  if (result.date === null && result.startDate === null && result.endDate === null) {
    result.mode = 'single';
  }

  // 檢查起始日和結束日的順序
  if (result.mode === 'batch' && result.startDate && result.endDate) {
    if (result.startDate > result.endDate) {
      logger.warn('起始日在結束日之後，自動交換日期順序');
      [result.startDate, result.endDate] = [result.endDate, result.startDate];
    }
  }

  return result;
}

/**
 * 驗證日期字串格式 (YYYY/MM/DD)
 * 
 * @param {string} dateStr - 日期字串
 * @returns {boolean} - 格式正確則回傳 true
 */
function isValidDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const regex = /^\d{4}\/\d{2}\/\d{2}$/;
  if (!regex.test(dateStr)) return false;
  
  const [yearStr, monthStr, dayStr] = dateStr.split('/');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  
  // 月份必須在 1-12 之間
  if (month < 1 || month > 12) return false;
  // 日期必須在 1-31 之間
  if (day < 1 || day > 31) return false;
  // 年份必須是正數
  if (year < 1900 || year > 2100) return false;
  
  return true;
}

// ==============================================
// Section 3: 日期工具函數 (UTC+8 時區處理 + 交易日計算)
// ==============================================

/**
 * 取得目前 UTC+8 (台北時間) 的日期字串
 * 
 * @returns {string} 日期字串 (YYYY/MM/DD)
 */
function getTodayStr() {
  // 建立目前時間物件
  const now = new Date();
  
  // 取得 UTC 時間的零點 (台北時間)
  // 方法：先取得 UTC 時間，加上 8 小時，再取零點
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
  const taipeiTime = new Date(utcMs + (8 * 3600000));
  
  const year = taipeiTime.getUTCFullYear();
  const month = String(taipeiTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(taipeiTime.getUTCDate()).padStart(2, '0');
  
  return `${year}/${month}/${day}`;
}

/**
 * 日期字串 (YYYY/MM/DD) 轉為 Date 物件 (使用 UTC 零點)
 * 
 * @param {string} dateStr - 日期字串
 * @returns {Date} Date 物件
 */
function dateStrToDate(dateStr) {
  const [yearStr, monthStr, dayStr] = dateStr.split('/');
  return new Date(Date.UTC(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, parseInt(dayStr, 10)));
}

/**
 * Date 物件轉為日期字串 (YYYY/MM/DD)
 * 使用 UTC+8 時區
 * 
 * @param {Date} date - Date 物件
 * @returns {string} 日期字串 (YYYY/MM/DD)
 */
function dateToStr(date) {
  // 先轉為 UTC+8 的 Date 物件
  const utcMs = date.getTime() + (date.getTimezoneOffset() * 60000);
  const taipeiTime = new Date(utcMs + (8 * 3600000));
  
  const year = taipeiTime.getUTCFullYear();
  const month = String(taipeiTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(taipeiTime.getUTCDate()).padStart(2, '0');
  
  return `${year}/${month}/${day}`;
}

/**
 * 判斷是否為週末 (星期六或星期日)
 * 
 * @param {Date} date - Date 物件 (使用 getDay 判斷)
 * @returns {boolean} - 是週末則回傳 true
 */
function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6; // 0=星期日, 6=星期六
}

/**
 * 判斷是否為國定假日 (簡化版，僅檢查日期字串)
 * 國定假日參考：元旦(01/01)、和平紀念日(02/28)、中秋節、國慶日(10/10)等
 * 注意：實際假日每年可能調整，這裡只做基本檢查
 * 
 * @param {string} dateStr - 日期字串 (YYYY/MM/DD)
 * @returns {boolean} - 是假日則回傳 true
 */
function isHoliday(dateStr) {
  const [yearStr, monthStr, dayStr] = dateStr.split('/');
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  
  // 元旦：01/01
  if (month === 1 && day === 1) return true;
  // 和平紀念日：02/28
  if (month === 2 && day === 28) return true;
  // 國慶日：10/10
  if (month === 10 && day === 10) return true;
  // 跨年：12/31
  if (month === 12 && day === 31) return true;
  // 中秋節：通常在農曆八月十五，這裡簡化為 09/15-10/15 範圍內的週一~週五
  
  return false;
}

/**
 * 判斷當天是否有股市開市
 * 排除週末和國定假日
 * 
 * @param {string} dateStr - 日期字串 (/YYYY/MM/DD)
 * @returns {boolean} - 開市則回傳 true
 */
function isTradingDay(dateStr) {
  const date = dateStrToDate(dateStr);
  
  // 先檢查是否為週末
  if (isWeekend(date)) return false;
  
  // 再檢查是否為國定假日
  if (isHoliday(dateStr)) return false;
  
  return true;
}

/**
 * 產生日期區間內的所有交易日
 * 
 * @param {string} startDate - 起始日期字串
 * @param {string} endDate - 結束日期字串
 * @returns {string[]} 交易日日期字串陣列
 */
function getTradingDaysBetween(startDate, endDate) {
  const tradingDays = [];
  let currentDate = dateStrToDate(startDate);
  const end = dateStrToDate(endDate);
  
  // 從起始日到結束日逐一檢查
  while (currentDate <= end) {
    const dateStr = dateToStr(currentDate);
    
    if (isTradingDay(dateStr)) {
      tradingDays.push(dateStr);
    }
    
    // 移動到下一天
    currentDate = new Date(currentDate.getTime() + 86400000); // 86400000 ms = 1 day
  }
  
  return tradingDays;
}

// ==============================================
// Section 4: Yahoo Finance API (使用原生 fetch)
// ==============================================

/**
 * HTTP 標頭 - 讓 Yahoo Finance 認為我們是正常的瀏覽器
 */
const TWSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

/**
 * HTTP 請求函數 - 使用 Node.js 18+ 內建的 fetch
 * 
 * 參數:
 *   url: 要請求的 URL
 *   timeout: 逾時時間（毫秒）
 *   headers: HTTP 標頭
 * 
 * 回傳:
 *   Promise<Object>: HTTP 回應物件 (response object)
 */
async function fetchJson(url, timeout = 15000, headers = TWSE_HEADERS) {
  // fetch 的 AbortController 用來設定 timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      headers: headers,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    // 檢查 response 狀態（例如 404, 500 等）
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    
    // 將 text 轉成 JSON
    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    throw error; // 拋給呼叫端處理
  }
}

/**
 * 向 Yahoo Finance 取得指定日期的歷史資料
 * 
 * 參數:
 *   ticker: Yahoo Finance ticker (例如 ^TWII, 2330.TW, TSM)
 *   date:   指定日期字串 (YYYY/MM/DD)
 * 
 * 回傳:
 *   Promise<Object>: 包含價格、開盤、高低、成交量等
 */
async function yahooGetHistorical(ticker, dateStr) {
  // Yahoo Finance chart API 支援查詢特定日期
  // startTime 和 endTime 使用 Unix timestamp (秒)
  const date = dateStrToDate(dateStr);
  // 設定查詢日期為目標日期的全天
  const endTime = Math.floor(date.getTime() / 1000);
  const startTime = endTime - 86400; // 往前一小時，確保查到當天資料
  
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&period1=${startTime}&period2=${endTime}`;
  
  try {
    const data = await fetchJson(url);
    const result = data.chart?.result;
    
    if (!result || result.length === 0) {
      return { error: 'Yahoo Finance 回傳空的結果' };
    }
    
    const meta = result[0].meta || {};
    const quotes = result[0].indicators?.quote?.[0] || {};
    const timestamps = result[0].timestamp || [];
    
    // 找出最接近目標日期的資料
    // 如果該日期有資料，使用該資料，否則使用最近一筆可用資料
    const targetTs = Math.floor(date.getTime() / 1000);
    let nearestIdx = timestamps.length - 1; // 預設用最後一筆
    
    for (let i = timestamps.length - 1; i >= 0; i--) {
      const tsDiff = Math.abs(timestamps[i] - targetTs);
      // 如果時間戳記在 2 小時以內，認為是目標日期的資料
      if (tsDiff < 7200) {
        nearestIdx = i;
        break;
      }
    }
    
    return {
      symbol: meta.symbol || ticker,
      price: meta.regularMarketPrice || quotes.close?.[nearestIdx] || null,
      prev_close: meta.chartPreviousClose || null,
      open: quotes.open?.[nearestIdx] || null,
      close: quotes.close?.[nearestIdx] || null,
      high: quotes.high?.[nearestIdx] || null,
      low: quotes.low?.[nearestIdx] || null,
      volume: meta.regularMarketVolume || quotes.volume?.[nearestIdx] || null,
      currency: meta.currency,
      timestamp: timestamps[nearestIdx] || null,
      dateMatched: nearestIdx < timestamps.length - 1, // 是否精確匹配到目標日期
    };
    
  } catch (error) {
    return { error: `Yahoo Finance 請求失敗: ${error.message}` };
  }
}

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
      // fetch 取代 axios.get()
      const data = await fetchJson(url, config.EXCHANGE_TIMEOUT * 1000);
      
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
// Section 5: 資料處理函數
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
// Section 6: Google Sheets API
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
 * 讀取試算表中所有日期列 (Column A)
 * 
 * 回傳:
 *   Promise<string[]> - 所有日期字串 (包含表列)
 */
async function getAllDatesInSheets() {
  const creds = await getGoogleCredentials();
  const service = google.sheets({ version: 'v4', auth: creds });
  
  try {
    const response = await service.spreadsheets.values.get({
      spreadsheetId: config.SPREADSHEET_ID,
      range: `${config.SHEET_NAME}!A:A`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    
    const values = response.data.values || [];
    
    if (values.length === 0) {
      return [];
    }
    
    // 回傳所有的日期 (包含表列)
    return values.map(row => row[0] || '').filter(d => d.trim() !== '');
  } catch (error) {
    logger.error(`讀取試算表失敗: ${error.message}`);
    return [];
  }
}

/**
 * 檢查指定日期列表中是否有遺漏的交易日
 * 
 * @param {string[]} existingDates - 試算表中現有的日期 (格式 YYYY/MM/DD)
 * @param {string[]} requiredDates - 需要的日期列表 (格式 YYYY/MM/DD)
 * @returns {string[]} - 遺漏的日期列表
 */
function findMissingDates(existingDates, requiredDates) {
  // 建立現有其他日期的 Set (去除空格)
  const existingSet = new Set(existingDates.map(d => d.trim()));
  
  // 找出遺漏的日期
  const missing = requiredDates.filter(date => !existingSet.has(date.trim()));
  
  return missing;
}

/**
 * 指定日期是否已存在於試算表中
 * 
 * @param {string} dateStr - 日期字串
 * @returns {Promise<boolean>} - 如果已存在則回傳 true
 */
async function checkAlreadyExistsInSheets(dateStr) {
  const dates = await getAllDatesInSheets();
  return dates.some(d => d.trim() === dateStr.trim());
}

/**
 * 將一列資料寫入 Google Sheets
 * 
 * @param {Array} rowData - 一列的資料陣列
 * @returns {Promise<boolean>} - 寫入成功則回傳 true
 */
async function appendToSheets(rowData) {
  const creds = await getGoogleCredentials();
  const service = google.sheets({ version: 'v4', auth: creds });
  
  // 先檢查是否已存在
  const exists = await checkAlreadyExistsInSheets(rowData[0]);
  if (exists) {
    logger.info(`日期 ${rowData[0]} 已有資料，跳過寫入 ✗`);
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

/**
 * 檢查試算表在某個日期區間內的完整性
 * 
 * @param {string} startDate - 起始日期
 * @param {string} endDate - 結束日期
 * @returns {Promise<{missing: string[], missingCount: number, totalCount: number}>}
 */
async function checkSheetCoverage(startDate, endDate) {
  const allDates = await getAllDatesInSheets();
  const requiredDays = getTradingDaysBetween(startDate, endDate);
  const missing = findMissingDates(allDates, requiredDays);
  
  logger.info(`試算表檢查: 需要 ${requiredDays.length} 筆資料，已有 ${allDates.length} 筆 (範圍外)`)
  logger.info(`遺漏日期 (${missing.length}): ${missing.join(', ') || '無'}`);
  
  return {
    missing,
    missingCount: missing.length,
    totalCount: requiredDays.length,
  };
}

// ==============================================
// Section 7: 抓取單一日期資料
// ==============================================

/**
 * 抓取並組合單一日的資料
 * 
 * @param {string} dateStr - 日期字串 (YYYY/MM/DD)
 * @returns {Promise<{success: boolean, row: Array|null, error?: string}>}
 */
async function fetchDay(dateStr) {
  logger.info(`--- 抓取 ${dateStr} 資料 ---`);
  
  // 抓取 Yahoo Finance 歷史資料
  logger.info('  抓取台股指數 (^TWII)...');
  const market = await yahooGetHistorical('^TWII', dateStr);
  await waitRandom();
  
  logger.info('  抓取台積電股價 (2330.TW)...');
  const tsmc = await yahooGetHistorical('2330.TW', dateStr);
  await waitRandom();
  
  logger.info('  抓取台積電 ADR (TSM)...');
  const adr = await yahooGetHistorical('TSM', dateStr);
  await waitRandom();
  
  // 匯率是現價，不需要歷史查詢
  logger.info('  抓取 USD/TWD 匯率...');
  const fx = await getFxRate();
  await waitRandom();
  
  // 檢查是否有抓取到有效資料
  if (!market || market.error) {
    logger.error(`  ✗ 台股指數抓取失敗: ${market.error || '未知錯誤'}`);
    return { success: false, error: `台股指數抓取失敗: ${market.error || '未知錯誤'}` };
  }
  if (!tsmc || tsmc.error) {
    logger.error(`  ✗ 台積電股價抓取失敗: ${tsmc.error || '未知錯誤'}`);
    return { success: false, error: `台積電股價抓取失敗: ${tsmc.error || '未知錯誤'}` };
  }
  if (!adr || adr.error) {
    logger.error(`  ✗ ADR 抓取失敗: ${adr.error || '未知錯誤'}`);
    return { success: false, error: `ADR 抓取失敗: ${adr.error || '未知錯誤'}` };
  }
  if (fx === null) {
    logger.error('  ✗ 匯率抓取失敗');
    return { success: false, error: '匯率抓取失敗' };
  }
  
  logger.info('  ✅ 所有抓取完成!');
  
  // 計算漲跌
  const taiexChange = calculateChange(market.price, market.prev_close);
  const taiexPct = calculatePct(market.price, market.prev_close);
  
  const tsmcChange = calculateChange(tsmc.price, tsmc.prev_close);
  const tsmcPct = calculatePct(tsmc.price, tsmc.prev_close);
  
  // 組合 15 列資料
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
    tsmcPct,                    // 13. 台積電漲落%
    adr.price,                  // 14. ADR (USD)
    fx,                         // 15. 匯率
  ];
  
  // 修正星期 (放在第二列)
  combinedRow[1] = getWeekday(dateStr);
  
  return { success: true, row: combinedRow, data: { market, tsmc, adr, fx } };
}

// ==============================================
// Section 8: 主程式
// ==============================================

/**
 * 主程式入口
 * 
 * 支援三种模式:
 *   1. 单日模式 (預設): 抓取今日資料 (使用 UTC+8 台北時間)
 *   2. 批次模式: 抓取指定日期區間的所有交易日資料
 *   3. 補齊模式: 檢查試算表並補齊遺漏的交易日
 */
async function main() {
  logger.info('='.repeat(50));
  logger.info('台灣股市每日資料自動抓取程式啟動 ✨ (no axios!)');
  logger.info('='.repeat(50));
  
  // ===== 第一步: 解析 CLI 參數 =====
  const params = parseArgs();
  
  // 取得目前台北時間的日期
  const today = getTodayStr();
  logger.info(`目前台北時間: ${today}\n`);
  
  // ===== 模式 1: 單日模式 =====
  if (params.mode === 'single' && params.date) {
    // 使用者指定單一日期
    if (!isValidDate(params.date)) {
      logger.error(`無效的日期格式: ${params.date}，請使用 YYYY/MM/DD 格式`);
      process.exit(1);
    }
    logger.info(`指定日期: ${params.date}`);
    await runSingleDay(params.date);
  }
  else if (params.mode === 'single') {
    // 預设模式：抓取今日資料
    logger.info('預設模式 (单日模式): 抓取今日資料');
    logger.info(`使用日期: ${today}`);
    await runSingleDay(today);
  }
  
  // ===== 模式 2: 批次模式 =====
  else if (params.mode === 'batch' && params.startDate && params.endDate) {
    if (!isValidDate(params.startDate) || !isValidDate(params.endDate)) {
      logger.error(`無效的日期格式，請使用 YYYY/MM/DD 格式`);
      process.exit(1);
    }
    logger.info(`批次模式: ${params.startDate} ~ ${params.endDate}`);
    await runBatch(params.startDate, params.endDate);
  }
  
  // ===== 模式 3: 補齊模式 =====
  else if (params.mode === 'fill') {
    logger.info('補齊模式: 檢查並補齊試算表遺漏的資料');
    
    // 取得試算表中的所有資料
    const allDates = await getAllDatesInSheets();
    
    if (allDates.length === 0) {
      logger.warn('試算表為空！建議使用單日模式先初始化資料');
      return;
    }
    
    // 找出最近的日期和最舊的日期
    // 注意: 日期格式 YYYY/MM/DD，可以直接字符串比較
    const sortedDates = allDates.filter(d => d.trim() !== '').sort();
    const earliest = sortedDates[0];
    const latest = sortedDates[sortedDates.length - 1];
    
    // 找出遺漏的交易日
    const requiredDays = getTradingDaysBetween(earliest, latest);
    const missing = findMissingDates(allDates, requiredDays);
    
    if (missing.length === 0) {
      logger.info('✓ 試算表資料完整！無遺漏資料');
      return;
    }
    
    // 詢問使用者是否補齊
    logger.info(`發現 ${missing.length} 筆遺漏資料！`);
    logger.info('即將補齊以下日期:');
    missing.forEach(d => logger.info(`  - ${d}`));
    
    // 自動補齊 (如果沒有其他互動需求，直接執行)
    const missingData = [];
    for (const dateStr of missing) {
      const result = await fetchDay(dateStr);
      if (result.success && result.data) {
        missingData.push({ date: dateStr, ...result.data });
      } else {
        logger.error(`  ✗ 日期 ${dateStr} 抓取失敗: ${result.error || '未知錯誤'}`);
      }
    }
    
    // 寫入試算表
    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;
    
    for (const item of missingData) {
      const combinedRow = [
        item.date,
        getWeekday(item.date),
        item.market.price,
        calculateChange(item.market.price, item.market.prev_close),
        calculatePct(item.market.price, item.market.prev_close),
        'N/A', 'N/A', 'N/A', 'N/A', 'N/A', 'N/A',
        item.tsmc.price,
        calculatePct(item.tsmc.price, item.tsmc.prev_close),
        item.adr.price,
        item.fx,
      ];
      
      const writeResult = await appendToSheets(combinedRow);
      if (writeResult) successCount++;
      else skipCount++;
    }
    
    logger.info(`\n===== 補齊完成 ============`);
    logger.info(`成功寫入: ${successCount} 筆`);
    logger.info(`跳過 (已存在): ${skipCount} 筆`);
    logger.info(`抓取失敗: ${missing.length - missingData.length} 筆`);
  }
  
  // ===== 無法判定的模式 ============
  else {
    logger.error('無法判定的模式！請檢查參數');
    process.exit(1);
  }
}

/**
 * 執行單日模式
 * 
 * @param {string} dateStr - 日期字串 (YYYY/MM/DD)
 */
async function runSingleDay(dateStr) {
  logger.info(`目標日期: ${dateStr}\n`);
  
  // 抓取單一日期資料
  const result = await fetchDay(dateStr);
  
  if (!result.success) {
    logger.error(`✗ 日期 ${dateStr} 抓取失敗: ${result.error}`);
    return;
  }
  
  const combinedRow = result.row;
  
  // 寫入 Google Sheets
  const writeResult = await appendToSheets(combinedRow);
  
  // 回報結果
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

/**
 * 執行批次模式
 * 
 * @param {string} startDate - 起始日期
 * @param {string} endDate - 結束日期
 */
async function runBatch(startDate, endDate) {
  // 產生交易日列表
  const tradingDays = getTradingDaysBetween(startDate, endDate);
  
  if (tradingDays.length === 0) {
    logger.warn(`在 ${startDate} ~ ${endDate} 區間內沒有交易日`);
    return;
  }
  
  logger.info(`區間內共 ${tradingDays.length} 個交易日\n`);
  
  // 檢查試算表完整性
  logger.info('=== 檢查試算表完整性 ===');
  const coverage = await checkSheetCoverage(startDate, endDate);
  
  let daysToFetch;
  if (coverage.missingCount === 0) {
    logger.info('試算表資料完整！無需抓取\n');
    return;
  } else {
    daysToFetch = coverage.missing;
    logger.info(`需要抓取 ${daysToFetch.length} 筆遺漏資料\n`);
  }
  
  // 逐一抓取遺漏的日期
  let successCount = 0;
  let skipCount = 0;
  let failDays = [];
  
  for (const dateStr of daysToFetch) {
    logger.info(`[${successCount + 1}/${daysToFetch.length}] 抓取 ${dateStr}...`);
    
    const result = await fetchDay(dateStr);
    if (!result.success) {
      failDays.push({ date: dateStr, error: result.error });
      continue;
    }
    
    // 寫入試算表
    const writeResult = await appendToSheets(result.row);
    if (writeResult) successCount++;
    else skipCount++;
    
    logger.info(''); // 空行分隔
  }
  
  // 回報統計
  logger.info('===== 批次抓取完成 =====');
  logger.info(`成功寫入: ${successCount} 筆`);
  logger.info('跳過 (已存在): ${skipCount} 筆');
  logger.error(`抓取失敗: ${failDays.length} 筆`);
  
  if (failDays.length > 0) {
    logger.error('失敗日期:');
    failDays.forEach(d => logger.error(`  - ${d.date}: ${d.error}`));
  }
}

// 程式入口點
main().catch(error => {
  logger.error(`程式執行發生嚴重錯誤: ${error.message}`);
  logger.error(error.stack);
  process.exit(1);
});
