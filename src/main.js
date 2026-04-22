// src/main.js
/**
 * main.js - 主程式模組
 *
 * 串接所有功能模組，提供三種執行模式：
 *   1. 單日模式 (single): 抓取今日或指定日期資料
 *   2. 批次模式 (batch):  抓取指定日期區間的所有交易日資料
 *   3. 補齊模式 (fill):   檢查試算表並補齊遺漏的交易日
 */

const logger = require('./logger');
const { yahooGetHistorical } = require('./fetchYahoo');
const { getFxRate } = require('./fetchExchange');
const {
  getAllDatesInSheets,
  appendToSheets,
  sortSheetsByDate,
  deleteRowsByDateRange,
  batchAppendToSheets,
} = require('./googleSheets');
const {
  getMarketVolume,
  getMarginBalance,
  getForeignInvestment,
} = require('./fetchTwse');
const { getForeignFutures } = require('./fetchTaifex');
const {
  getTodayStr,
  getTradingDaysBetween,
  getNTradingDaysAgo,
  findMissingDates,
  getWeekday,
  waitRandom,
  calculateChange,
  calculatePct,
} = require('./utils');

// ==============================================
// CLI 參數解析
// ==============================================

/**
 * 解析使用者輸入的 CLI 參數
 *
 * 支援的參數:
 *   --date  YYYY/MM/DD  : 指定單一日期
 *   --start YYYY/MM/DD  : 批次抓取起始日
 *   --end   YYYY/MM/DD  : 批次抓取結束日
 *   --fill              : 自動補齊試算表遺漏的資料
 *
 * @returns {Object} { mode: 'single'|'batch'|'fill', date, startDate, endDate }
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    mode: 'single',
    date: null,
    startDate: null,
    endDate: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--date' && i + 1 < args.length) {
      result.mode = 'single';
      result.date = args[++i];
    } else if (arg === '--start' && i + 1 < args.length) {
      result.mode = 'batch';
      result.startDate = args[++i];
    } else if (arg === '--end' && i + 1 < args.length) {
      result.mode = 'batch';
      result.endDate = args[++i];
    } else if (arg === '--fill') {
      result.mode = 'fill';
    }
  }

  // 批次模式時確保起始日不晚於結束日
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
 * @param {string} dateStr
 * @returns {boolean}
 */
function isValidDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const regex = /^\d{4}\/\d{2}\/\d{2}$/;
  if (!regex.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('/').map(Number);
  return y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

// ==============================================
// 單日資料抓取與組合
// ==============================================

/**
 * 抓取並組合單一日的所有資料
 *
 * @param {string} dateStr - 日期字串 (YYYY/MM/DD)
 * @returns {Promise<{success: boolean, row?: Array, skip?: boolean, error?: string}>}
 */
async function fetchDay(dateStr) {
  logger.info(`--- 抓取 ${dateStr} 資料 ---`);

  // 依序抓取各來源資料
  logger.info('  抓取台股指數 (^TWII)...');
  const market = await yahooGetHistorical('^TWII', dateStr);
  await waitRandom();

  logger.info('  抓取台積電股價 (2330.TW)...');
  const tsmc = await yahooGetHistorical('2330.TW', dateStr);
  await waitRandom();

  logger.info('  抓取台積電 ADR (TSM)...');
  const adr = await yahooGetHistorical('TSM', dateStr);
  await waitRandom();

  logger.info('  抓取 USD/TWD 匯率...');
  const fx = await getFxRate(dateStr);
  await waitRandom();

  logger.info('  抓取大盤成交金額...');
  const volume = await getMarketVolume(dateStr);
  await waitRandom();

  logger.info('  抓取外資買賣超...');
  const foreign = await getForeignInvestment(dateStr);
  await waitRandom();

  logger.info('  抓取融資餘額...');
  const margin = await getMarginBalance(dateStr);
  await waitRandom();

  logger.info('  抓取期交所外資多空單...');
  const taifex = await getForeignFutures(dateStr);
  await waitRandom();

  const hasMarket = market && !market.error;
  const hasTsmc = tsmc && !tsmc.error;
  const hasAdr = adr && !adr.error;

  // 若所有主要資料均無效，視為非交易日跳過
  if (!hasMarket && !hasTsmc && !hasAdr) {
    logger.warn(`  ! 日期 ${dateStr} 所有來源均無效，可能為非交易日`);
    return { success: false, skip: true, error: '所有來源均無有效資料' };
  }

  // 記錄部分失敗狀況
  if (!hasMarket) logger.warn(`  ! 台股指數抓取失敗: ${market?.error || '未知錯誤'}`);
  if (!hasTsmc) logger.warn(`  ! 台積電股價抓取失敗: ${tsmc?.error || '未知錯誤'}`);
  if (!hasAdr) logger.warn(`  ! ADR 抓取失敗: ${adr?.error || '未知錯誤'}`);
  if (fx === null) logger.warn('  ! 匯率抓取失敗');
  if (volume === null) logger.warn('  ! 大盤成交金額抓取失敗');
  if (foreign === null) logger.warn('  ! 外資買賣超抓取失敗');
  if (margin === null) logger.warn('  ! 融資餘額抓取失敗');
  if (taifex === null) logger.warn('  ! 期交所外資多空單抓取失敗');

  logger.info('  ✅ 資料抓取流程完成');

  // 計算漲跌
  const taiexPrice = hasMarket ? market.price : null;
  const taiexPrev = hasMarket ? market.prev_close : null;
  const tsmcPrice = hasTsmc ? tsmc.price : null;
  const tsmcPrev = hasTsmc ? tsmc.prev_close : null;

  // 組合 15 欄資料
  const combinedRow = [
    dateStr,                                          // A. 日期
    getWeekday(dateStr),                              // B. 星期
    taiexPrice || 'N/A',                              // C. 台股指數
    calculateChange(taiexPrice, taiexPrev) || 'N/A', // D. 漲跌
    calculatePct(taiexPrice, taiexPrev) || 'N/A',    // E. 漲跌%
    volume !== null ? volume : 'N/A',                 // F. 成交金額
    foreign !== null ? foreign : 'N/A',               // G. 外資買賣超
    taifex !== null ? taifex.netOpenInterest : 'N/A', // H. 外資多空單
    taifex !== null ? taifex.diff : 'N/A',            // I. 增減
    margin !== null ? margin.balance : 'N/A',         // J. 融資餘額
    margin !== null ? margin.diff : 'N/A',            // K. 增減
    tsmcPrice || 'N/A',                               // L. 台積電股價
    calculatePct(tsmcPrice, tsmcPrev) || 'N/A',      // M. 台積電漲跌%
    (hasAdr ? adr.price : null) || 'N/A',             // N. ADR (USD)
    fx || 'N/A',                                      // O. 匯率
  ];

  return { success: true, row: combinedRow };
}

// ==============================================
// 各執行模式
// ==============================================

/**
 * 執行單日模式
 *
 * @param {string} dateStr - 日期字串 (YYYY/MM/DD)，若為 null 則執行預設區間
 */
async function runSingleDay(dateStr) {
  if (dateStr) {
    logger.info(`🎯 目標日期: ${dateStr} (指定模式)`);
    await runBatch(dateStr, dateStr);
  } else {
    const today = getTodayStr();
    const startDate = getNTradingDaysAgo(today, 3);
    logger.info(`🎯 目標區間: ${startDate} ~ ${today} (預設「當日+前3個交易日」模式)`);
    await runBatch(startDate, today);
  }
}

/**
 * 執行批次模式
 *
 * @param {string} startDate - 起始日期字串
 * @param {string} endDate   - 結束日期字串
 */
async function runBatch(startDate, endDate) {
  const tradingDays = getTradingDaysBetween(startDate, endDate);

  if (tradingDays.length === 0) {
    logger.warn(`ℹ️ 在 ${startDate} ~ ${endDate} 區間內沒有交易日`);
    return;
  }

  logger.info(`🚀 開始批次處理區間: ${startDate} ~ ${endDate} (共 ${tradingDays.length} 個交易日)`);

  // 1. 先刪除現有資料
  await deleteRowsByDateRange(startDate, endDate);

  // 2. 逐日抓取資料
  const rowsToAppend = [];
  let successCount = 0;
  let skipCount = 0;
  const failDays = [];

  for (let i = 0; i < tradingDays.length; i++) {
    const dateStr = tradingDays[i];
    logger.info(`\n[${i + 1}/${tradingDays.length}] 正在抓取 ${dateStr} 資料...`);

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

    rowsToAppend.push(result.row);
    successCount++;
    
    // 如果不是最後一天，等待一段隨機時間
    if (i < tradingDays.length - 1) {
      await waitRandom();
    }
  }

  // 3. 批次寫入
  if (rowsToAppend.length > 0) {
    await batchAppendToSheets(rowsToAppend);
  }

  logger.info('\n===== 任務執行報告 =====');
  logger.info(`成功抓取: ${successCount} 筆`);
  logger.info(`跳過 (無資料): ${skipCount} 筆`);
  logger.info(`失敗筆數: ${failDays.length} 筆`);

  if (failDays.length > 0) {
    logger.error('失敗日期詳情:');
    failDays.forEach(d => logger.error(`  - ${d.date}: ${d.error}`));
  }
}

/**
 * 執行補齊模式：讀取試算表現有資料，補齊最早至最晚日期範圍內遺漏的交易日
 */
async function runFill() {
  const allDates = await getAllDatesInSheets();

  if (allDates.length === 0) {
    logger.warn('⚠️ 試算表為空！建議使用單日模式先初始化資料');
    return;
  }

  const sortedDates = allDates.filter(d => d.trim() !== '').sort();
  const earliest = sortedDates[0];
  const latest = sortedDates[sortedDates.length - 1];

  logger.info(`🔍 試算表目前日期範圍: ${earliest} ~ ${latest}`);

  const requiredDays = getTradingDaysBetween(earliest, latest);
  const missing = findMissingDates(allDates, requiredDays);

  if (missing.length === 0) {
    logger.info('✅ 試算表資料完整！無遺漏資料');
    return;
  }

  logger.info(`💡 發現 ${missing.length} 筆遺漏資料，即將補齊...`);
  
  // 補齊模式我們使用 batchAppendToSheets 但不需要先刪除 (因為是補齊)
  const rowsToAppend = [];
  for (const dateStr of missing) {
    const result = await fetchDay(dateStr);
    if (result.success) {
      rowsToAppend.push(result.row);
      await waitRandom();
    }
  }
  
  if (rowsToAppend.length > 0) {
    await batchAppendToSheets(rowsToAppend);
  }
  logger.info('✨ 補齊作業完成');
}

// ==============================================
// 主程式入口
// ==============================================

/**
 * 主程式，解析 CLI 參數並執行對應模式
 */
async function main() {
  logger.info('='.repeat(50));
  logger.info('台灣股市每日資料自動抓取程式啟動 ✨');
  logger.info('='.repeat(50));

  const params = parseArgs();
  const today = getTodayStr();
  logger.info(`⏰ 目前台北時間: ${today}\n`);

  // 模式 1: 單日模式 (含無參數預設模式)
  if (params.mode === 'single') {
    if (params.date) {
      if (!isValidDate(params.date)) {
        logger.error(`❌ 無效的日期格式: ${params.date}，請使用 YYYY/MM/DD 格式`);
        process.exit(1);
      }
      await runSingleDay(params.date);
    } else {
      await runSingleDay(null); // 執行預設區間
    }
  }

  // 模式 2: 批次模式
  else if (params.mode === 'batch') {
    if (!params.startDate || !params.endDate) {
      logger.error('❌ 批次模式需要同時提供 --start 與 --end 參數');
      process.exit(1);
    }
    if (!isValidDate(params.startDate) || !isValidDate(params.endDate)) {
      logger.error('❌ 無效的日期格式，請使用 YYYY/MM/DD 格式');
      process.exit(1);
    }
    await runBatch(params.startDate, params.endDate);
  }

  // 模式 3: 補齊模式
  else if (params.mode === 'fill') {
    await runFill();
  }

  else {
    logger.error('❌ 無法判定的模式！請檢查參數');
    process.exit(1);
  }

  // 所有寫入完成後執行排序
  await sortSheetsByDate();
  logger.info('\n✅ 全部工作順利完成!\n');
}

module.exports = { main };
