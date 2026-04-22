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
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();

// 載入配置
const config = require('./config');

// 檔案：config.js
// 檔案：index.js
// 修改者：AI Agent
// 修改時間：2026/04/22
// 修改原因：新增批次抓取功能

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
 * 判斷當天是否有股市開市
 * 僅排除週末
 * 
 * @param {string} dateStr - 日期字串 (/YYYY/MM/DD)
 * @returns {boolean} - 非週末則回傳 true
 */
function isTradingDay(dateStr) {
  const date = dateStrToDate(dateStr);

  // 僅檢查是否為週末
  return !isWeekend(date);
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
  const date = dateStrToDate(dateStr);
  const startTime = Math.floor(date.getTime() / 1000);
  const endTime = startTime + 86400; // 目標日期後 24 小時

  try {
    // 擴大範圍到往前 2 天，確保能抓到歷史資料與前一收盤價
    const startTimeLocal = startTime - 86400 * 2;
    const result = await yahooFinance.chart(ticker, {
      period1: startTimeLocal,
      period2: endTime,
      interval: '1d',
    });

    if (!result || !result.quotes || result.quotes.length === 0) {
      return { error: 'Yahoo Finance 回傳空的結果' };
    }

    const quotes = result.quotes;
    const meta = result.meta;

    // 找出最接近目標日期的資料 (timestamp 在 metadata 中通常代表最後交易時間)
    const targetTs = Math.floor(date.getTime() / 1000);
    let nearestIdx = quotes.length - 1;

    for (let i = quotes.length - 1; i >= 0; i--) {
      const qDate = new Date(quotes[i].date);
      const qTs = Math.floor(qDate.getTime() / 1000);
      const tsDiff = Math.abs(qTs - targetTs);

      // 如果時間戳記在 24 小時以內 (因為是 1d interval)，認為是該日的資料
      if (tsDiff < 86400) {
        nearestIdx = i;
        break;
      }
    }

    const quote = quotes[nearestIdx];

    return {
      symbol: meta.symbol || ticker,
      price: quote.close || meta.regularMarketPrice || null,
      prev_close: meta.chartPreviousClose || null,
      open: quote.open || null,
      close: quote.close || null,
      high: quote.high || null,
      low: quote.low || null,
      volume: quote.volume || meta.regularMarketVolume || null,
      currency: meta.currency,
      timestamp: Math.floor(new Date(quote.date).getTime() / 1000),
      dateMatched: true,
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
 * 讀取 Service Account 憑證並建立 Google API Auth 客戶端
 * 
 * 回傳:
 *   authClient: Google Auth 客戶端物件
 */
async function getGoogleCredentials() {
  const keyPath = path.resolve(config.GOOGLE_SERVICE_ACCOUNT_FILE);

  if (!fs.existsSync(keyPath)) {
    throw new Error(`找不到 Service Account 金鑰檔案: ${keyPath}`);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const authClient = await auth.getClient();
  return authClient;
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

/**
 * 對試算表進行排序 (按日期 Column A, 由小到大)
 */
async function sortSheetsByDate() {
  const creds = await getGoogleCredentials();
  const service = google.sheets({ version: 'v4', auth: creds });

  try {
    // 取得試算表資訊以獲得 Sheet ID
    const spreadsheet = await service.spreadsheets.get({
      spreadsheetId: config.SPREADSHEET_ID,
    });

    const sheet = spreadsheet.data.sheets.find(s => s.properties.title === config.SHEET_NAME);
    if (!sheet) {
      throw new Error(`找不到工作表: ${config.SHEET_NAME}`);
    }

    const sheetId = sheet.properties.sheetId;

    logger.info('正在對試算表進行日期排序...');

    await service.spreadsheets.batchUpdate({
      spreadsheetId: config.SPREADSHEET_ID,
      requestBody: {
        requests: [
          {
            sortRange: {
              range: {
                sheetId: sheetId,
                startRowIndex: 1, // 跳過標題列
              },
              sortSpecs: [
                {
                  dimensionIndex: 0, // Column A (日期)
                  sortOrder: 'ASCENDING',
                },
              ],
            },
          },
        ],
      },
    });

    logger.info('✅ 試算表排序完成!');
  } catch (error) {
    logger.error(`排序試算表失敗: ${error.message}`);
  }
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
  const hasMarket = market && !market.error;
  const hasTsmc = tsmc && !tsmc.error;
  const hasAdr = adr && !adr.error;

  // 如果所有主要資料都沒有抓到，則視為當天不開市或無資料
  if (!hasMarket && !hasTsmc && !hasAdr) {
    logger.warn(`  ! 日期 ${dateStr} 所有來源均無效資料，可能為非交易日。`);
    return { success: false, skip: true, error: '所有來源均無有效資料' };
  }

  // 即使只有部分資料抓取失敗，我們也記錄下來 (填入 N/A)
  if (!hasMarket) logger.warn(`  ! 台股指數抓取失敗: ${market?.error || '未知錯誤'}`);
  if (!hasTsmc) logger.warn(`  ! 台積電股價抓取失敗: ${tsmc?.error || '未知錯誤'}`);
  if (!hasAdr) logger.warn(`  ! ADR 抓取失敗: ${adr?.error || '未知錯誤'}`);

  if (fx === null) {
    logger.warn('  ! 匯率抓取失敗');
  }

  logger.info('  ✅ 資料抓取流程完成');

  // 計算漲跌 (如果資料缺失則回傳 null)
  const taiexPrice = hasMarket ? market.price : null;
  const taiexPrev = hasMarket ? market.prev_close : null;
  const taiexChange = calculateChange(taiexPrice, taiexPrev);
  const taiexPct = calculatePct(taiexPrice, taiexPrev);

  const tsmcPrice = hasTsmc ? tsmc.price : null;
  const tsmcPrev = hasTsmc ? tsmc.prev_close : null;
  const tsmcChange = calculateChange(tsmcPrice, tsmcPrev);
  const tsmcPct = calculatePct(tsmcPrice, tsmcPrev);

  // 組合 15 列資料
  const combinedRow = [
    dateStr,                              // 1. 日期
    getWeekday(dateStr),                  // 2. 星期
    taiexPrice || 'N/A',                  // 3. 台股指數
    taiexChange || 'N/A',                 // 4. 漲跌
    taiexPct || 'N/A',                    // 5. 漲跌%
    'N/A',                                // 6. 成交金額
    'N/A',                                // 7. 外資買賣超
    'N/A',                                // 8. 外資多空單
    'N/A',                                // 9. 增減
    'N/A',                                // 10. 融資餘額
    'N/A',                                // 11. 增減
    tsmcPrice || 'N/A',                   // 12. 台積電股價
    tsmcPct || 'N/A',                     // 13. 台積電漲落%
    (hasAdr ? adr.price : null) || 'N/A', // 14. ADR (USD)
    fx || 'N/A',                          // 15. 匯率
  ];

  return { success: true, row: combinedRow };
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

  // 寫入後執行排序
  await sortSheetsByDate();
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
    if (result.skip) {
      logger.warn(`- 日期 ${dateStr} 跳過 (API 無任何有效資料)`);
    } else {
      logger.error(`✗ 日期 ${dateStr} 抓取失敗: ${result.error}`);
    }
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
      if (result.skip) {
        logger.warn(`- 日期 ${dateStr} 跳過 (API 無任何有效資料)`);
        skipCount++;
      } else {
        failDays.push({ date: dateStr, error: result.error });
      }
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
