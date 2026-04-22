// src/googleSheets.js
/**
 * googleSheets.js - Google Sheets API 包裝
 *
 * 提供授權、讀取日期欄位、寫入資料、去重與排序等功能。
 */
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('./logger');

/**
 * 取得 Google Auth client
 */
async function getGoogleCredentials() {
  const keyPath = path.resolve(config.GOOGLE_SERVICE_ACCOUNT_FILE);
  if (!fs.existsSync(keyPath)) {
    throw new Error(`找不到 Service Account 金鑰檔案: ${keyPath}`);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return await auth.getClient();
}

/**
 * 讀取試算表中所有日期列 (Column A)
 * @returns {Promise<string[]>}
 */
async function getAllDatesInSheets() {
  const creds = await getGoogleCredentials();
  const service = google.sheets({ version: 'v4', auth: creds });
  const resp = await service.spreadsheets.values.get({
    spreadsheetId: config.SPREADSHEET_ID,
    range: `${config.SHEET_NAME}!A:A`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const values = resp.data.values || [];
  return values.map(row => (row[0] || '').trim()).filter(v => v !== '');
}

/**
 * 檢查指定日期是否已存在於試算表
 */
async function checkAlreadyExistsInSheets(dateStr) {
  const dates = await getAllDatesInSheets();
  return dates.includes(dateStr.trim());
}

/**
 * 寫入一列資料至試算表，若已存在則跳過
 * @param {Array} rowData
 * @returns {Promise<boolean>} 成功寫入回傳 true，已存在回傳 false
 */
async function appendToSheets(rowData) {
  const exists = await checkAlreadyExistsInSheets(rowData[0]);
  if (exists) {
    logger.info(`日期 ${rowData[0]} 已有資料，跳過寫入 ✗`);
    return false;
  }
  const creds = await getGoogleCredentials();
  const service = google.sheets({ version: 'v4', auth: creds });
  await service.spreadsheets.values.append({
    spreadsheetId: config.SPREADSHEET_ID,
    range: config.SHEET_NAME,
    valueInputOption: 'RAW',
    requestBody: { values: [rowData] },
  });
  logger.info(`寫入成功! 日期 ${rowData[0]}`);
  return true;
}

/**
 * 依日期欄位對工作表排序 (升冪)
 */
async function sortSheetsByDate() {
  const creds = await getGoogleCredentials();
  const service = google.sheets({ version: 'v4', auth: creds });
  const ss = await service.spreadsheets.get({ spreadsheetId: config.SPREADSHEET_ID });
  const sheet = ss.data.sheets.find(s => s.properties.title === config.SHEET_NAME);
  if (!sheet) throw new Error(`找不到工作表: ${config.SHEET_NAME}`);
  const sheetId = sheet.properties.sheetId;
  await service.spreadsheets.batchUpdate({
    spreadsheetId: config.SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          sortRange: {
            range: { sheetId, startRowIndex: 1 },
            sortSpecs: [{ dimensionIndex: 0, sortOrder: 'ASCENDING' }],
          },
        },
      ],
    },
  });
  logger.info('試算表排序完成');
}

module.exports = {
  getGoogleCredentials,
  getAllDatesInSheets,
  checkAlreadyExistsInSheets,
  appendToSheets,
  sortSheetsByDate,
};
