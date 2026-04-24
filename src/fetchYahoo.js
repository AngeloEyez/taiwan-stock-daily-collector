// src/fetchYahoo.js
/**
 * fetchYahoo.js - Yahoo Finance 歷史資料抓取模組
 *
 * 提供從 Yahoo Finance 抓取指定 ticker 歷史資料的函式。
 * 支援單日查詢與日期區間批次查詢兩種模式。
 */
const YahooFinance = require('yahoo-finance2').default;
const { dateStrToDate, dateToStr } = require('./utils');
const logger = require('./logger');

// 建立 Yahoo Finance 實例
const yahooFinance = new YahooFinance();

/**
 * 向 Yahoo Finance 取得指定 ticker 在指定日期區間的歷史資料
 * 利用 chart() API 的 period1/period2 原生區間能力，一次請求取回所有日期資料。
 *
 * @param {string} ticker    - Yahoo Finance 代碼 (e.g. ^TWII, 2330.TW, TSM)
 * @param {string} startDate - 起始日期字串 (YYYY/MM/DD)
 * @param {string} endDate   - 結束日期字串 (YYYY/MM/DD)
 * @returns {Promise<Map<string, Object>>}
 *   以日期字串 (YYYY/MM/DD) 為 key 的 Map；
 *   value 包含 { price, prev_close, open, close, high, low, volume, symbol }；
 *   失敗回傳空 Map。
 */
async function yahooGetHistoricalBatch(ticker, startDate, endDate) {
  const resultMap = new Map();

  try {
    const startDateObj = dateStrToDate(startDate);
    const endDateObj = dateStrToDate(endDate);

    // 往前多取 15 天，確保 startDate 當天有 prev_close 可計算漲跌
    const period1 = new Date(startDateObj.getTime() - 15 * 86400000);
    // 往後多取 1 天，確保 endDate 本身包含在查詢範圍內
    const period2 = new Date(endDateObj.getTime() + 86400000);

    const result = await yahooFinance.chart(ticker, {
      period1: period1,
      period2: period2,
      interval: '1d',
    });

    if (!result || !result.quotes || result.quotes.length === 0) {
      logger.warn(`  ! Yahoo Finance [${ticker}] 區間查詢回傳空結果`);
      return resultMap;
    }

    const quotes = result.quotes;
    const meta = result.meta;

    // 將所有 quotes 建立為日期索引，方便後續查找
    const quotesByDate = new Map();
    for (const q of quotes) {
      const qDate = dateToStr(new Date(q.date));
      quotesByDate.set(qDate, q);
    }

    // 遍歷 quotes，填入 startDate ~ endDate 範圍內的資料
    // 同時利用前一筆資料計算 prev_close
    let prevClose = null;
    const sortedDates = [...quotesByDate.keys()].sort();

    for (const dateStr of sortedDates) {
      const q = quotesByDate.get(dateStr);
      const closePrice = q.close || null;

      // 判斷是否在目標區間內
      if (dateStr >= startDate && dateStr <= endDate) {
        resultMap.set(dateStr, {
          symbol: meta.symbol || ticker,
          price: closePrice,
          prev_close: prevClose,
          open: q.open || null,
          close: closePrice,
          high: q.high || null,
          low: q.low || null,
          volume: q.volume || null,
        });
      }

      // 更新前收盤價（不論是否在目標區間都要更新，以確保相鄰日的 prev_close 正確）
      if (closePrice !== null) {
        prevClose = closePrice;
      }
    }

    logger.info(`  ✅ Yahoo [${ticker}] 區間查詢完成，取得 ${resultMap.size} 筆`);
    return resultMap;

  } catch (error) {
    logger.warn(`  ! Yahoo Finance 區間查詢失敗 [${ticker}]: ${error.message}`);
    return resultMap;
  }
}

/**
 * 向 Yahoo Finance 取得指定 ticker 在指定日期的歷史資料 (單日)
 * 內部複用 yahooGetHistoricalBatch，維持介面相容性。
 *
 * @param {string} ticker   - Yahoo Finance 代碼 (e.g. ^TWII, 2330.TW, TSM)
 * @param {string} dateStr  - 日期字串 (YYYY/MM/DD)
 * @returns {Promise<Object>} 包含 price、prev_close 等欄位；失敗時回傳 { error: string }
 */
async function yahooGetHistorical(ticker, dateStr) {
  // 複用 batch 函數，僅抓單日
  const map = await yahooGetHistoricalBatch(ticker, dateStr, dateStr);
  if (map.has(dateStr)) {
    return map.get(dateStr);
  }
  return { error: `Yahoo Finance 未回傳 ${dateStr} 的資料 [${ticker}]` };
}

module.exports = { yahooGetHistorical, yahooGetHistoricalBatch };
