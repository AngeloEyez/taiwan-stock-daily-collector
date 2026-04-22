// src/utils.js
/**
 * utils.js - 共用工具函式
 * 包含日期處理、HTTP fetch、計算函式等。
 */
const config = require('../config');
const logger = require('./logger');

/**
 * 取得目前 UTC+8 (台北時間) 的日期字串 (YYYY/MM/DD)
 */
function getTodayStr() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const taipeiTime = new Date(utcMs + 8 * 3600000);
  const year = taipeiTime.getUTCFullYear();
  const month = String(taipeiTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(taipeiTime.getUTCDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

/**
 * 將 YYYY/MM/DD 轉為 Date 物件 (UTC 零點)
 */
function dateStrToDate(dateStr) {
  const [y, m, d] = dateStr.split('/');
  return new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10)));
}

/**
 * Date 物件轉為 YYYY/MM/DD (使用 UTC+8 時區)
 */
function dateToStr(date) {
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60000;
  const taipeiTime = new Date(utcMs + 8 * 3600000);
  const year = taipeiTime.getUTCFullYear();
  const month = String(taipeiTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(taipeiTime.getUTCDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

/**
 * 判斷是否為週末
 */
function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * 判斷是否為交易日 (目前僅排除週末)
 */
function isTradingDay(dateStr) {
  const date = dateStrToDate(dateStr);
  return !isWeekend(date);
}

/**
 * 產生兩日期之間的所有交易日陣列
 */
function getTradingDaysBetween(startDate, endDate) {
  const days = [];
  let cur = dateStrToDate(startDate);
  const end = dateStrToDate(endDate);
  while (cur <= end) {
    const str = dateToStr(cur);
    if (isTradingDay(str)) days.push(str);
    cur = new Date(cur.getTime() + 86400000);
  }
  return days;
}

/**
 * 找出缺漏日期
 */
function findMissingDates(existingDates, requiredDates) {
  const existingSet = new Set(existingDates.map(d => d.trim()));
  return requiredDates.filter(d => !existingSet.has(d.trim()));
}

/**
 * 取得星期幾中文名稱
 */
function getWeekday(dateStr) {
  const dt = new Date(dateStr.replace(/\//g, '-'));
  const map = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return map[dt.getDay()];
}

/**
 * 隨機等待，以模擬真人操作速度
 */
function waitRandom() {
  const delay = Math.random() * (config.MAX_WAIT - config.MIN_WAIT) + config.MIN_WAIT;
  logger.info(`等待 ${delay.toFixed(1)} 秒 (模擬真人)...`);
  return new Promise(res => setTimeout(res, delay * 1000));
}

/**
 * 計算漲跌點數
 */
function calculateChange(current, prev) {
  if (current == null || prev == null) return null;
  return Math.round((current - prev) * 100) / 100;
}

/**
 * 計算漲跌百分比
 */
function calculatePct(current, prev) {
  if (current == null || prev == null || prev === 0) return null;
  return Math.round(((current - prev) / prev) * 100 * 100) / 100;
}

/**
 * 使用 Node 內建 fetch 取得 JSON，支援 timeout
 */
async function fetchJson(url, timeout = 15000, headers = { 'User-Agent': 'Mozilla/5.0' }) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(id);
    if (!resp.ok) throw new Error(`HTTP error: ${resp.status}`);
    return await resp.json();
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

/**
 * 回推指定數量的交易日 (不含週末)
 * @param {string} startDateStr - 起始日期 (YYYY/MM/DD)
 * @param {number} n - 要回推的交易日數量
 * @returns {string} 回推後的日期字串 (YYYY/MM/DD)
 */
function getNTradingDaysAgo(startDateStr, n) {
  let count = 0;
  let cur = dateStrToDate(startDateStr);
  
  while (count < n) {
    // 往前推一天
    cur = new Date(cur.getTime() - 86400000);
    const str = dateToStr(cur);
    if (isTradingDay(str)) {
      count++;
    }
  }
  return dateToStr(cur);
}

module.exports = {
  getTodayStr,
  dateStrToDate,
  dateToStr,
  isWeekend,
  isTradingDay,
  getTradingDaysBetween,
  getNTradingDaysAgo,
  findMissingDates,
  getWeekday,
  waitRandom,
  calculateChange,
  calculatePct,
  fetchJson,
};
