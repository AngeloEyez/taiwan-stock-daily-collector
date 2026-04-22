/**
 * 環境變數配置載入器
 * 
 * 功能:
 *   1. 載入 .env 檔案 (如果存在)
 *   2. 將值提供給應用程式
 *   3. 提供預設值當 .env 不存在
 * 
 * 使用方式:
 *   const config = require('./config');
 *   const spreadsheetId = config.SPREADSHEET_ID;
 *   const tokenPath = config.TOKEN_PATH;
 */

// 載入 .env 檔案
require('dotenv').config();

/**
 * 取得布林值字串，轉換為 true/false
 */
function getBool(key, defaultValue) {
  const val = process.env[key];
  if (val === undefined || val === null) return defaultValue;
  return val.toLowerCase() === 'true' || val.toLowerCase() === '1' || val === 'yes';
}

/**
 * 取得整數值字串，轉換為整數
 */
function getInt(key, defaultValue) {
  const val = process.env[key];
  if (val === undefined || val === null) return defaultValue;
  const num = parseInt(val, 10);
  return isNaN(num) ? defaultValue : num;
}

/**
 * 取得字串值，如果不存在則回傳預設值
 */
function getString(key, defaultValue) {
  return process.env[key] || defaultValue;
}

/**
 * 全域配置字典
 * 所有設定都從 .env 檔案或是系統環境變數讀取
 */
const config = {
  // Google Sheets 設定
  SPREADSHEET_ID: getString('SPREADSHEET_ID', ''),
  SHEET_NAME: getString('SHEET_NAME', '工作表1'),
  
  // OAuth 憑證路徑
  TOKEN_PATH: getString('TOKEN_PATH', '/root/.hermes/google_token.json'),
  CLIENT_SECRET_PATH: getString('CLIENT_SECRET_PATH', '/root/.hermes/google_client_secret.json'),
  
  // API 設定
  YAHOO_TIMEOUT: getInt('YAHOO_TIMEOUT', 15),
  EXCHANGE_TIMEOUT: getInt('EXCHANGE_TIMEOUT', 10),
  
  // 爬取設定 (秒)
  MIN_WAIT: getInt('MIN_WAIT', 6),
  MAX_WAIT: getInt('MAX_WAIT', 15),
  
  // 日誌等級: DEBUG, INFO, WARNING, ERROR
  LOG_LEVEL: getString('LOG_LEVEL', 'info'),
  
  // 自動補齊模式：預設檢查當日往前 N 天的紀錄
  DEFAULT_FILL_DAYS: getInt('DEFAULT_FILL_DAYS', 7),
};

module.exports = config;

// 如果直接執行此檔案，顯示當前配置
if (require.main === module) {
  console.log('=== 當前配置 ===');
  for (const [key, value] of Object.entries(config)) {
    // 遮蔽敏感資訊
    let displayValue = value;
    if (/TOKEN|SECRET|SPREADSHEET/i.test(key) && value) {
      displayValue = `${value.slice(0, 4)}***(已遮蔽)`;
    }
    console.log(`  ${key}: ${displayValue}`);
  }
}
