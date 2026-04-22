// src/fetchExchange.js
/**
 * fetchExchange.js - 取得 USD/TWD 匯率
 */
const { fetchJson } = require('./utils');
const config = require('../config');
const logger = require('./logger');

/**
 * 取得 USD/TWD 匯率
 * @returns {Promise<number|null>} 匯率，失敗回傳 null
 */
async function getFxRate() {
  const urls = [
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    'https://latest.currency-api.pages.dev/v1/currencies/usd.json',
  ];
  for (const url of urls) {
    try {
      const data = await fetchJson(url, config.EXCHANGE_TIMEOUT * 1000);
      const twdRate = data?.usd?.twd;
      if (twdRate !== undefined && twdRate !== null) {
        return twdRate;
      }
    } catch (e) {
      // 繼續下一個 URL
    }
  }
  return null;
}

module.exports = { getFxRate };
