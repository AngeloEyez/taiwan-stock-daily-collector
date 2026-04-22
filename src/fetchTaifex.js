// src/fetchTaifex.js
/**
 * fetchTaifex.js - 取得台灣期貨交易所 (TAIFEX) 相關資料
 */
const { dateStrToDate, dateToStr } = require('./utils');
const logger = require('./logger');

/**
 * 取得指定日期的外資多空單淨額 (未平倉口數淨額) 及與前一日的增減
 * @param {string} dateStr YYYY/MM/DD
 * @returns {Promise<{netOpenInterest: string|number, diff: string|number}|null>}
 */
async function getForeignFutures(dateStr) {
  try {
    // 為了計算增減，我們往前推 15 天來抓取資料，確保能涵蓋到前一個交易日
    const targetDate = dateStrToDate(dateStr);
    const startDate = new Date(targetDate.getTime() - 15 * 86400000);
    const queryStartDate = dateToStr(startDate);
    const queryEndDate = dateStr;

    const url = 'https://www.taifex.com.tw/cht/3/futContractsDateDown';
    const data = new URLSearchParams();
    data.append('queryStartDate', queryStartDate);
    data.append('queryEndDate', queryEndDate);
    data.append('commodityId', ''); // 空值代表全部商品

    const response = await fetch(url, {
      method: 'POST',
      body: data,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    // TAIFEX CSV 採用 BIG5 編碼
    const decoder = new TextDecoder('big5');
    const csvText = decoder.decode(buffer);

    // 解析 CSV，並篩選出 臺股期貨 及 外資及陸資
    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    const records = [];

    // 從第一行 (非標題行) 開始處理
    for (let i = 1; i < lines.length; i++) {
      // 處理 CSV 的逗號，這裡 TAIFEX 輸出的欄位通常不會有被雙引號包夾的逗號
      const columns = lines[i].split(',');
      if (columns.length < 15) continue;

      const rowDate = columns[0].trim();
      const commodity = columns[1].trim();
      const identity = columns[2].trim();

      if (commodity === '臺股期貨' && identity === '外資及陸資') {
        const netOpenInterest = parseInt(columns[13].trim(), 10);
        records.push({ date: rowDate, netOpenInterest });
      }
    }

    // 依日期排序 (較舊的在前面)
    records.sort((a, b) => new Date(a.date) - new Date(b.date));

    // 找尋目標日期的資料
    const targetIndex = records.findIndex(r => r.date === dateStr);
    if (targetIndex === -1) {
      return null; // 當日無資料 (可能非交易日或未更新)
    }

    const targetRecord = records[targetIndex];
    let diff = 'N/A';

    // 如果有前一筆資料，則計算增減
    if (targetIndex > 0) {
      const prevRecord = records[targetIndex - 1];
      diff = targetRecord.netOpenInterest - prevRecord.netOpenInterest;
    }

    return {
      netOpenInterest: targetRecord.netOpenInterest,
      diff: diff
    };

  } catch (error) {
    logger.warn(`  ! TAIFEX API 失敗: ${error.message}`);
    return null;
  }
}

module.exports = {
  getForeignFutures
};
