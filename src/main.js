// src/main.js
/**
 * main.js - 主程式模組
 *
 * 串接所有功能模組，提供三種執行模式：
 *   1. 單日模式 (single): 抓取今日或指定日期資料
 *   2. 批次模式 (batch):  抓取指定日期區間的所有交易日資料
 *   3. 補齊模式 (fill):   檢查試算表並補齊遺漏的交易日
 *
 * 抓取架構：按「資料來源」批次抓取，而非按「日期」逐日抓取
 *   - Yahoo Finance、TAIFEX 原生支援區間，一次呼叫取得所有日期資料
 *   - Exchange、TWSE 不支援區間，仍逐日呼叫，但集中在各自的 batch 函數管理
 *   - 所有來源資料先以 Map<date, data> 暫存於記憶體，最後統一組合成列並寫入 Sheets
 *   - 刪除舊資料移至批次寫入前，讓資料抓取與 Sheets 操作不互相干擾
 */

const logger = require('./logger');
const { yahooGetHistoricalBatch } = require('./fetchYahoo');
const { getFxRateBatch } = require('./fetchExchange');
const {
  getGoogleCredentials,
  getAllDatesInSheets,
  batchAppendToSheets,
  sortSheetsByDate,
  deleteRowsByDateRange,
} = require('./googleSheets');
const { fetchTwseBatch } = require('./fetchTwse');
const { getForeignFuturesBatch } = require('./fetchTaifex');
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
// 批次資料抓取核心 (按來源，不按日期)
// ==============================================

/**
 * 按資料來源批次抓取整個日期區間的資料
 * 各來源各自以最少次數呼叫 API，結果存入記憶體 Map。
 *
 * @param {string[]} tradingDays - 交易日清單 (YYYY/MM/DD)
 * @param {string}   startDate   - 起始日期字串
 * @param {string}   endDate     - 結束日期字串
 * @returns {Promise<{yahooMap: Map, fxMap: Map, twseMap: Map, taifexMap: Map}>}
 */
async function fetchAllDataBatch(tradingDays, startDate, endDate) {
  // ── 1. Yahoo Finance (原生區間，3 個 ticker 各 1 次請求) ──────────────────
  logger.info('\n📡 [1/4] Yahoo Finance 批次抓取...');

  logger.info('  抓取台股指數 (^TWII)...');
  const twiiMap = await yahooGetHistoricalBatch('^TWII', startDate, endDate);
  await waitRandom();

  logger.info('  抓取台積電股價 (2330.TW)...');
  const tsmcMap = await yahooGetHistoricalBatch('2330.TW', startDate, endDate);
  await waitRandom();

  logger.info('  抓取台積電 ADR (TSM)...');
  const adrMap = await yahooGetHistoricalBatch('TSM', startDate, endDate);
  await waitRandom();

  // 合併三個 Yahoo ticker 的 Map 為單一 yahooMap
  const yahooMap = new Map();
  for (const dateStr of tradingDays) {
    yahooMap.set(dateStr, {
      twii: twiiMap.get(dateStr) || null,
      tsmc: tsmcMap.get(dateStr) || null,
      adr: adrMap.get(dateStr) || null,
    });
  }

  // ── 2. USD/TWD 匯率 (逐日，無原生區間支援) ────────────────────────────────
  logger.info('\n📡 [2/4] USD/TWD 匯率批次抓取...');
  const fxMap = await getFxRateBatch(tradingDays, true); // withWait=true，由內部控制等待

  // ── 3. TWSE 三大指標 (逐日，無原生區間支援) ──────────────────────────────
  logger.info('\n📡 [3/4] TWSE 批次抓取...');
  const twseMap = await fetchTwseBatch(tradingDays);
  await waitRandom();

  // ── 4. TAIFEX 期交所 (原生區間，單次請求取全部日期) ────────────────────
  logger.info('\n📡 [4/4] TAIFEX 批次抓取...');
  const taifexMap = await getForeignFuturesBatch(startDate, endDate);

  return { yahooMap, fxMap, twseMap, taifexMap };
}

// ==============================================
// 記憶體組合：Map → 資料列
// ==============================================

/**
 * 將單一日期的多來源資料組合成一列 (15 欄)
 *
 * @param {string}      dateStr    - 日期字串 (YYYY/MM/DD)
 * @param {Object|null} yahooData  - { twii, tsmc, adr } 各自包含 price/prev_close 等欄位
 * @param {number|null} fxRate     - USD/TWD 匯率
 * @param {Object|null} twseData   - { volume, foreign, margin }
 * @param {Object|null} taifexData - { netOpenInterest, diff }
 * @returns {{ row: Array|null, skip: boolean }}
 *   若主要 Yahoo 資料均無效則 skip=true，表示非交易日
 */
function combineRow(dateStr, yahooData, fxRate, twseData, taifexData) {
  const twii = yahooData?.twii;
  const tsmc = yahooData?.tsmc;
  const adr = yahooData?.adr;

  const hasMarket = twii && !twii.error && twii.price != null;
  const hasTsmc = tsmc && !tsmc.error && tsmc.price != null;
  const hasAdr = adr && !adr.error && adr.price != null;

  // 若所有主要 Yahoo 資料均無效，視為非交易日跳過
  if (!hasMarket && !hasTsmc && !hasAdr) {
    logger.warn(`  ! 日期 ${dateStr} Yahoo 所有來源均無效，可能為非交易日`);
    return { row: null, skip: true };
  }

  // 記錄部分失敗狀況
  if (!hasMarket) logger.warn(`  ! ${dateStr} 台股指數抓取失敗`);
  if (!hasTsmc)  logger.warn(`  ! ${dateStr} 台積電股價抓取失敗`);
  if (!hasAdr)   logger.warn(`  ! ${dateStr} ADR 抓取失敗`);
  if (fxRate == null) logger.warn(`  ! ${dateStr} 匯率抓取失敗`);
  if (!twseData?.volume)  logger.warn(`  ! ${dateStr} 大盤成交金額抓取失敗`);
  if (!twseData?.foreign) logger.warn(`  ! ${dateStr} 外資買賣超抓取失敗`);
  if (!twseData?.margin)  logger.warn(`  ! ${dateStr} 融資餘額抓取失敗`);
  if (!taifexData) logger.warn(`  ! ${dateStr} 期交所外資多空單抓取失敗`);

  const taiexPrice = hasMarket ? twii.price : null;
  const taiexPrev  = hasMarket ? twii.prev_close : null;
  const tsmcPrice  = hasTsmc  ? tsmc.price : null;
  const tsmcPrev   = hasTsmc  ? tsmc.prev_close : null;

  // 組合 15 欄資料
  const row = [
    dateStr,                                           // A. 日期
    getWeekday(dateStr),                               // B. 星期
    taiexPrice ?? '',                                  // C. 台股指數
    calculateChange(taiexPrice, taiexPrev) ?? '',      // D. 漲跌
    calculatePct(taiexPrice, taiexPrev) ?? '',         // E. 漲跌%
    twseData?.volume  ?? '',                           // F. 成交金額
    twseData?.foreign ?? '',                           // G. 外資買賣超
    taifexData?.netOpenInterest ?? '',                 // H. 外資多空單
    taifexData?.diff ?? '',                            // I. 增減
    twseData?.margin?.balance ?? '',                   // J. 融資餘額
    twseData?.margin?.diff    ?? '',                   // K. 增減
    tsmcPrice ?? '',                                   // L. 台積電股價
    calculatePct(tsmcPrice, tsmcPrev) ?? '',          // M. 台積電漲跌%
    hasAdr ? (adr.price ?? '') : '',                  // N. ADR (USD)
    fxRate ?? '',                                      // O. 匯率
  ];

  return { row, skip: false };
}

/**
 * 遍歷所有交易日，將各來源 Map 的資料組合成最終的資料列陣列
 *
 * @param {string[]} tradingDays - 交易日清單
 * @param {Map}      yahooMap    - 各日 Yahoo 資料
 * @param {Map}      fxMap       - 各日匯率
 * @param {Map}      twseMap     - 各日 TWSE 資料
 * @param {Map}      taifexMap   - 各日 TAIFEX 資料
 * @returns {{ rows: Array[], successCount: number, skipCount: number, failDays: Object[] }}
 */
function buildRows(tradingDays, yahooMap, fxMap, twseMap, taifexMap) {
  const rows = [];
  let successCount = 0;
  let skipCount = 0;
  const failDays = [];

  for (const dateStr of tradingDays) {
    const yahooData  = yahooMap.get(dateStr) || null;
    const fxRate     = fxMap.get(dateStr) ?? null;
    const twseData   = twseMap.get(dateStr) || null;
    const taifexData = taifexMap.get(dateStr) || null;

    const { row, skip } = combineRow(dateStr, yahooData, fxRate, twseData, taifexData);

    if (skip) {
      skipCount++;
      continue;
    }

    if (row) {
      rows.push(row);
      successCount++;
    } else {
      failDays.push({ date: dateStr, error: '資料組合失敗' });
    }
  }

  return { rows, successCount, skipCount, failDays };
}

/**
 * 輸出任務執行報告
 *
 * @param {number}   successCount
 * @param {number}   skipCount
 * @param {Object[]} failDays
 */
function printReport(successCount, skipCount, failDays) {
  logger.info('\n===== 任務執行報告 =====');
  logger.info(`成功抓取: ${successCount} 筆`);
  logger.info(`跳過 (非交易日/無資料): ${skipCount} 筆`);
  logger.info(`失敗筆數: ${failDays.length} 筆`);

  if (failDays.length > 0) {
    logger.error('失敗日期詳情:');
    failDays.forEach(d => logger.error(`  - ${d.date}: ${d.error}`));
  }
}

// ==============================================
// 各執行模式
// ==============================================

/**
 * 執行單日模式
 *
 * @param {string|null} dateStr - 日期字串 (YYYY/MM/DD)，若為 null 則執行預設區間
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
 * 流程：按來源批次抓取 → 記憶體組合 → 刪除舊資料 → 批次寫入
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

  // Step 1: 按來源批次抓取 (googleapis 趁此期間在背景初始化)
  const { yahooMap, fxMap, twseMap, taifexMap } =
    await fetchAllDataBatch(tradingDays, startDate, endDate);

  // Step 2: 在記憶體中組合所有日期的資料列
  logger.info('\n🔧 組合資料列...');
  const { rows, successCount, skipCount, failDays } =
    buildRows(tradingDays, yahooMap, fxMap, twseMap, taifexMap);

  // Step 3: 刪除 Sheets 中的舊資料 (資料全部備妥後才操作 Sheets，降低空窗期)
  if (rows.length > 0) {
    await deleteRowsByDateRange(startDate, endDate);

    // Step 4: 批次寫入
    await batchAppendToSheets(rows);
  } else {
    logger.warn('⚠️ 無任何有效資料可寫入，跳過 Sheets 操作');
  }

  // Step 5: 執行報告
  printReport(successCount, skipCount, failDays);
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
  logger.info(`   遺漏日期: ${missing.join(', ')}`);

  // 找出遺漏日期的實際區間，利用批次抓取
  const missingStart = missing[0];
  const missingEnd = missing[missing.length - 1];

  // 按來源批次抓取遺漏日期區間的資料
  const { yahooMap, fxMap, twseMap, taifexMap } =
    await fetchAllDataBatch(missing, missingStart, missingEnd);

  // 只組合遺漏的日期
  const { rows, successCount, skipCount, failDays } =
    buildRows(missing, yahooMap, fxMap, twseMap, taifexMap);

  // 補齊模式：直接 append，不刪除現有資料
  if (rows.length > 0) {
    await batchAppendToSheets(rows);
  }

  printReport(successCount, skipCount, failDays);
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
