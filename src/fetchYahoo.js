// src/fetchYahoo.js
/**
 * fetchYahoo.js - Yahoo Finance 歷史資料抓取模組
 *
 * 提供從 Yahoo Finance 抓取指定日期、指定 ticker 歷史資料的函式。
 */
const YahooFinance = require('yahoo-finance2').default;
const { dateStrToDate } = require('./utils');
const logger = require('./logger');

// 建立 Yahoo Finance 實例
const yahooFinance = new YahooFinance();

/**
 * 向 Yahoo Finance 取得指定 ticker 在指定日期的歷史資料
 *
 * @param {string} ticker - Yahoo Finance 代碼 (e.g. ^TWII, 2330.TW, TSM)
 * @param {string} dateStr - 日期字串 (YYYY/MM/DD)
 * @returns {Promise<Object>} 包含 price、prev_close 等欄位；失敗時回傳 { error: string }
 */
async function yahooGetHistorical(ticker, dateStr) {
  const date = dateStrToDate(dateStr);
  const startTime = Math.floor(date.getTime() / 1000);
  const endTime = startTime + 86400; // 24 小時

  try {
    // 擴大查詢範圍到前兩天，確保能取得前收盤價
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

    // 找出最接近目標日期的資料
    const targetTs = Math.floor(date.getTime() / 1000);
    let nearestIdx = quotes.length - 1;

    for (let i = quotes.length - 1; i >= 0; i--) {
      const qDate = new Date(quotes[i].date);
      const qTs = Math.floor(qDate.getTime() / 1000);
      // 時間差在 24 小時以內則認定為目標日期
      if (Math.abs(qTs - targetTs) < 86400) {
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
    return { error: `Yahoo Finance 請求失敗 [${ticker}]: ${error.message}` };
  }
}

module.exports = { yahooGetHistorical };
