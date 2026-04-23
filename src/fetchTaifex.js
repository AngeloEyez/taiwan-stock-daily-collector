// src/fetchTaifex.js
/**
 * fetchTaifex.js - 取得台灣期貨交易所 (TAIFEX) 相關資料
 *
 * TAIFEX 的 futContractsDateDown 端點原生支援日期區間批次下載 (POST queryStartDate/queryEndDate)，
 * 支援近三年歷史資料，一次請求即可取得整個區間所有交易日的 CSV 資料。
 */
const { dateStrToDate, dateToStr } = require('./utils');
const logger = require('./logger');

/**
 * 取得指定日期區間內每日的外資多空單淨額 (未平倉口數淨額) 及與前一日的增減
 *
 * @param {string} startDate - 起始日期字串 (YYYY/MM/DD)
 * @param {string} endDate   - 結束日期字串 (YYYY/MM/DD)
 * @returns {Promise<Map<string, {netOpenInterest: number, diff: number|string}>>}
 *   以日期字串 (YYYY/MM/DD) 為 key 的 Map；失敗回傳空 Map。
 */
async function getForeignFuturesBatch(startDate, endDate) {
  const resultMap = new Map();

  try {
    // 為了計算 startDate 當天的增減，往前多抓 15 天，確保能涵蓋到前一個交易日
    const startDateObj = dateStrToDate(startDate);
    const extendedStart = new Date(startDateObj.getTime() - 15 * 86400000);
    const queryStartDate = dateToStr(extendedStart);
    const queryEndDate = endDate;

    logger.info(`  抓取期交所外資多空單 (${startDate} ~ ${endDate})...`);

    const url = 'https://www.taifex.com.tw/cht/3/futContractsDateDown';
    const formData = new URLSearchParams();
    formData.append('queryStartDate', queryStartDate);
    formData.append('queryEndDate', queryEndDate);
    formData.append('commodityId', ''); // 空值代表全部商品

    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    // TAIFEX CSV 採用 BIG5 編碼
    const decoder = new TextDecoder('big5');
    const csvText = decoder.decode(buffer);

    // 解析 CSV，篩選出 臺股期貨 及 外資及陸資 的資料
    const lines = csvText.split('\n').filter(line => line.trim() !== '');

    // 原始記錄清單 (包含延伸查詢的前幾天)
    const allRecords = [];

    // 從第一行 (非標題行) 開始處理
    for (let i = 1; i < lines.length; i++) {
      const columns = lines[i].split(',');
      if (columns.length < 15) continue;

      const rowDate = columns[0].trim();
      const commodity = columns[1].trim();
      const identity = columns[2].trim();

      if (commodity === '臺股期貨' && identity === '外資及陸資') {
        const netOpenInterest = parseInt(columns[13].trim(), 10);
        if (!isNaN(netOpenInterest)) {
          allRecords.push({ date: rowDate, netOpenInterest });
        }
      }
    }

    if (allRecords.length === 0) {
      logger.warn('  ! TAIFEX CSV 未解析到任何有效資料');
      return resultMap;
    }

    // 依日期排序 (較舊的在前)
    allRecords.sort((a, b) => new Date(a.date) - new Date(b.date));

    // 計算每日增減，並只保留目標區間的資料
    for (let i = 0; i < allRecords.length; i++) {
      const rec = allRecords[i];
      // 只保留在目標區間 startDate ~ endDate 內的日期
      if (rec.date < startDate || rec.date > endDate) continue;

      let diff = 'N/A';
      if (i > 0) {
        const prevRec = allRecords[i - 1];
        diff = rec.netOpenInterest - prevRec.netOpenInterest;
      }

      resultMap.set(rec.date, {
        netOpenInterest: rec.netOpenInterest,
        diff,
      });
    }

    logger.info(`  ✅ TAIFEX 批次查詢完成，取得 ${resultMap.size} 筆`);
    return resultMap;

  } catch (error) {
    logger.warn(`  ! TAIFEX API 失敗: ${error.message}`);
    return resultMap;
  }
}

/**
 * 取得指定單一日期的外資多空單淨額 (單日版本，複用批次函數)
 *
 * @param {string} dateStr - 日期字串 (YYYY/MM/DD)
 * @returns {Promise<{netOpenInterest: string|number, diff: string|number}|null>}
 */
async function getForeignFutures(dateStr) {
  const map = await getForeignFuturesBatch(dateStr, dateStr);
  return map.has(dateStr) ? map.get(dateStr) : null;
}

module.exports = {
  getForeignFutures,
  getForeignFuturesBatch,
};
