// src/fetchTaifex.js
/**
 * fetchTaifex.js - 取得台灣期貨交易所 (TAIFEX) 相關資料
 *
 * TAIFEX 的 futContractsDateDown 端點原生支援日期區間批次下載 (POST queryStartDate/queryEndDate)，
 * 支援近三年歷史資料，一次請求即可取得整個區間所有交易日的 CSV 資料。
 */
const { dateStrToDate, dateToStr, getNTradingDaysAgo, getTodayStr } = require('./utils');
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
    
    // 決定查詢終點日期
    let queryEndDate = endDate;
    const todayStr = getTodayStr();
    
    // 如果結束日期是今天 (或未來)，且尚未到 15:00 (資料更新時間)，則查詢日期上限設為前一交易日
    if (endDate >= todayStr) {
        const now = new Date();
        const taipeiHour = (now.getUTCHours() + 8) % 24;
        if (taipeiHour < 15) {
            // 尚未更新，取前一個交易日
            queryEndDate = getNTradingDaysAgo(todayStr, 1);
            logger.info(`  [備註] 今日資料尚未更新，查詢區間調整為至 ${queryEndDate}`);
        } else {
            // 已過 15:00，但如果今天非交易日，queryEndDate 仍可能導致錯誤，
            // 不過通常 endDate 帶入 todayStr 時，若是週末，TAIFEX 會回傳到上週五。
            // 為了保險起見，我們讓後續的 HTML 偵測處理。
        }
    } else {
        // 如果 endDate 是過去的日期，但剛好是週末，且是該區間的最末日，
        // 期交所也可能噴 DateTime error。這裡我們暫不主動調整，交由 HTML 偵測。
    }

    logger.info(`  抓取期交所外資多空單 (${startDate} ~ ${endDate})...`);

    const url = 'https://www.taifex.com.tw/cht/3/futContractsDateDown';
    let csvText = '';
    let retryCount = 0;
    const maxRetries = 1;

    while (retryCount <= maxRetries) {
      const formData = new URLSearchParams();
      formData.append('queryStartDate', queryStartDate);
      formData.append('queryEndDate', queryEndDate);
      formData.append('commodityId', 'TXF');

      const response = await fetch(url, {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://www.taifex.com.tw/cht/3/futContractsDateView',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      const decoder = new TextDecoder('big5');
      csvText = decoder.decode(buffer);

      if (csvText.includes('<!DOCTYPE HTML')) {
        if (csvText.includes('DateTime error') && retryCount < maxRetries) {
          const oldEndDate = queryEndDate;
          queryEndDate = getNTradingDaysAgo(queryEndDate, 1);
          logger.warn(`  ! TAIFEX 回傳 DateTime error (${oldEndDate})，嘗試調整為 ${queryEndDate} 並重試...`);
          retryCount++;
          continue;
        }
        logger.warn('  ! TAIFEX 回傳了 HTML 錯誤頁面，可能是被擋或參數錯誤');
        return resultMap;
      }
      break; // 成功取得 CSV，跳出循環
    }

    // 解析 CSV，篩選出 臺股期貨 及 外資及陸資 的資料
    const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
    logger.debug(`  TAIFEX CSV 取得 ${lines.length} 行資料`);

    // 原始記錄清單 (包含延伸查詢的前幾天)
    const allRecords = [];

    // 從第一行 (非標題行) 開始處理
    for (let i = 1; i < lines.length; i++) {
      const columns = lines[i].split(',');
      if (columns.length < 14) continue;

      // 移除可能的雙引號與前後空白
      const rowDate = columns[0].replace(/"/g, '').trim();
      const commodity = columns[1].replace(/"/g, '').trim();
      const identity = columns[2].replace(/"/g, '').trim();

      if (commodity === '臺股期貨' && identity === '外資及陸資') {
        const netOpenInterest = parseInt(columns[13].replace(/"/g, '').trim(), 10);
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

      let diff = '';
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
