// src/fetchTwse.js
/**
 * fetchTwse.js - 取得台灣證券交易所 (TWSE) 相關資料
 */
const { fetchJson } = require('./utils');
const config = require('../config');
const logger = require('./logger');

/**
 * 通用 TWSE 請求，有防呆和超時設定
 */
async function fetchTwse(url) {
  try {
    // 證交所 API 有時會比較慢，這裡給較長的 timeout
    const data = await fetchJson(url, config.EXCHANGE_TIMEOUT * 2000 || 15000);
    if (data && data.stat === 'OK') {
      return data;
    }
    return null;
  } catch (e) {
    logger.warn(`  ! TWSE API 失敗: ${e.message}`);
    return null;
  }
}

/**
 * 尋找包含特定關鍵字的資料表 (處理 TWSE 回傳 fields1, data1 等多表結構，以及新的 tables 陣列)
 */
function findTable(data, keyword) {
  // 支援新的 tables 格式
  if (data.tables && Array.isArray(data.tables)) {
    for (const t of data.tables) {
      if (t && t.fields && t.data) {
        // 檢查 fields 中是否包含關鍵字
        if (t.fields.some(f => f.includes(keyword))) {
          return { fields: t.fields, data: t.data };
        }
        // 檢查 data 裡面第一欄是否包含關鍵字
        for (const row of t.data) {
          if (row[0] && typeof row[0] === 'string' && row[0].includes(keyword)) {
            return { fields: t.fields, data: t.data };
          }
        }
      }
    }
  }

  // 檢查所有 keys (舊格式 fields1, data1 等)
  for (const key of Object.keys(data)) {
    if (key.startsWith('fields')) {
      const fieldArr = data[key];
      const dataKey = key.replace('fields', 'data');
      if (data[dataKey]) {
        // 檢查 fields 中是否包含關鍵字
        if (fieldArr.some(f => f.includes(keyword))) {
          return { fields: fieldArr, data: data[dataKey] };
        }
        // 檢查 data 裡面第一欄是否包含關鍵字
        for (const row of data[dataKey]) {
          if (row[0] && typeof row[0] === 'string' && row[0].includes(keyword)) {
            return { fields: fieldArr, data: data[dataKey] };
          }
        }
      }
    }
  }

  // 備用: 如果只有單一 fields / data
  if (data.fields && data.data) {
    return { fields: data.fields, data: data.data };
  }

  return null;
}

/**
 * 處理含逗號字串的數字解析
 */
function parseNumber(str) {
  if (!str) return 0;
  const num = parseFloat(str.replace(/,/g, ''));
  return isNaN(num) ? 0 : num;
}

/**
 * 1. 取得大盤成交金額 (億)
 * @param {string} dateStr YYYY/MM/DD
 * @returns {Promise<string|null>} 成交金額 (億)，失敗回傳 null
 */
async function getMarketVolume(dateStr) {
  const dateStrTwse = dateStr.replace(/\//g, '');
  const url = `https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=${dateStrTwse}&type=MS`;
  const res = await fetchTwse(url);
  if (!res) return null;

  const table = findTable(res, '成交金額');
  if (!table) return null;

  const colIdx = table.fields.findIndex(f => f.includes('成交金額'));
  if (colIdx === -1) return null;

  // 找尋 "總計" 或第一列
  let targetRow = table.data.find(r => r[0].includes('總計') || r[0].includes('加權指數'));
  if (!targetRow) {
      targetRow = table.data[0];
  }

  const val = parseNumber(targetRow[colIdx]);
  return (val / 100000000).toFixed(2); // 轉為億元
}

/**
 * 2. 取得融資餘額 (億) 與增減 (億)
 * @param {string} dateStr YYYY/MM/DD
 * @returns {Promise<{balance: string, diff: string}|null>} 失敗回傳 null
 */
async function getMarginBalance(dateStr) {
  const dateStrTwse = dateStr.replace(/\//g, '');
  const url = `https://www.twse.com.tw/exchangeReport/MI_MARGN?response=json&date=${dateStrTwse}&selectType=MS`;
  const res = await fetchTwse(url);
  if (!res) return null;

  const table = findTable(res, '融資');
  if (!table) return null;

  const targetRow = table.data.find(r => r[0].includes('融資金額'));
  if (!targetRow) return null;

  const todayIdx = table.fields.findIndex(f => f.includes('今日餘額'));
  const prevIdx = table.fields.findIndex(f => f.includes('前日餘額'));

  if (todayIdx === -1) return null;

  const todayVal = parseNumber(targetRow[todayIdx]);
  const prevVal = prevIdx !== -1 ? parseNumber(targetRow[prevIdx]) : null;

  const balanceE = (todayVal / 100000).toFixed(2); // 單位: 仟元 -> 億元
  const diffE = prevVal !== null ? ((todayVal - prevVal) / 100000).toFixed(2) : 'N/A';

  return {
    balance: balanceE,
    diff: diffE
  };
}

/**
 * 3. 取得外資買賣超金額 (億)
 * @param {string} dateStr YYYY/MM/DD
 * @returns {Promise<string|null>} 買賣超金額 (億)，失敗回傳 null
 */
async function getForeignInvestment(dateStr) {
  const dateStrTwse = dateStr.replace(/\//g, '');
  const url = `https://www.twse.com.tw/fund/BFI82U?response=json&dayDate=${dateStrTwse}&type=day`;
  const res = await fetchTwse(url);
  if (!res) return null;

  const table = findTable(res, '外資');
  if (!table) return null;

  const targetRow = table.data.find(r => r[0].includes('外資及陸資'));
  if (!targetRow) return null;

  const diffIdx = table.fields.findIndex(f => f.includes('買賣差額'));
  if (diffIdx === -1) return null;

  const val = parseNumber(targetRow[diffIdx]);
  return (val / 100000000).toFixed(2); // 轉為億元
}

module.exports = {
  getMarketVolume,
  getMarginBalance,
  getForeignInvestment
};
