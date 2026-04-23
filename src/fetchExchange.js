// src/fetchExchange.js
/**
 * fetchExchange.js - 取得 USD/TWD 匯率
 *
 * Exchange API 採用日期作為 URL 的一部分，不支援區間查詢，
 * 因此批次模式仍需逐日呼叫，但統一透過 getFxRateBatch 管理。
 */
const { fetchJson, waitRandom } = require('./utils');
const config = require('../config');
const logger = require('./logger');

/**
 * 取得指定日期的 USD/TWD 匯率
 *
 * @param {string|null} dateStr - 日期 (YYYY/MM/DD)，若為 null 則取得最新匯率
 * @returns {Promise<number|null>} 匯率，失敗回傳 null
 */
async function getFxRate(dateStr = null) {
  const dateTag = dateStr ? dateStr.replace(/\//g, '-') : 'latest';

  const urls = [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${dateTag}/v1/currencies/usd.json`,
    `https://${dateTag}.currency-api.pages.dev/v1/currencies/usd.json`,
  ];

  for (const url of urls) {
    try {
      const data = await fetchJson(url, config.EXCHANGE_TIMEOUT * 1000);
      const twdRate = data?.usd?.twd;
      if (twdRate !== undefined && twdRate !== null) {
        return twdRate;
      }
    } catch (e) {
      // 繼續嘗試下一個備用 URL
    }
  }
  return null;
}

/**
 * 批次取得多個交易日的 USD/TWD 匯率
 * Exchange API 不支援區間查詢，仍需逐日呼叫，
 * 但集中在此函數管理，方便統一 logging 與等待。
 *
 * @param {string[]} tradingDays - 交易日陣列 (YYYY/MM/DD)
 * @param {boolean} [withWait=false] - 是否在每次請求後等待隨機時間 (批次模式由呼叫端控制等待)
 * @returns {Promise<Map<string, number|null>>} 以日期字串為 key 的 Map
 */
async function getFxRateBatch(tradingDays, withWait = false) {
  const resultMap = new Map();

  logger.info(`  抓取 USD/TWD 匯率 (共 ${tradingDays.length} 天)...`);

  for (const dateStr of tradingDays) {
    const rate = await getFxRate(dateStr);
    resultMap.set(dateStr, rate);

    if (withWait) {
      await waitRandom();
    }
  }

  const successCount = [...resultMap.values()].filter(v => v !== null).length;
  logger.info(`  ✅ 匯率批次查詢完成，成功 ${successCount}/${tradingDays.length} 筆`);

  return resultMap;
}

module.exports = { getFxRate, getFxRateBatch };
