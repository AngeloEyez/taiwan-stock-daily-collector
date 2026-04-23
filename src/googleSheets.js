// src/googleSheets.js
/**
 * googleSheets.js - Google Sheets API 包裝
 *
 * 提供授權、讀取日期欄位、寫入資料、去重與排序等功能。
 *
 * 注意：googleapis 套件改為延遲引入 (在函數內部 require)，
 * 讓啟動後的 API 抓取作業可以立即開始，googleapis 的初始化時間
 * (約 1~2 秒) 被「藏」在資料下載的等待過程中。
 */
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('./logger');

/**
 * 取得 Google Auth client
 * googleapis 在此函數被首次呼叫時才載入 (延遲引入)
 *
 * @returns {Promise<Object>} Google Auth client
 */
async function getGoogleCredentials() {
  // 延遲引入：只有第一次呼叫 Sheets 相關函數時才載入 @googleapis/sheets
  // 使用輕量級套件 @googleapis/sheets 替代完整的 googleapis
  const google = require('@googleapis/sheets');

  const keyPath = path.resolve(config.GOOGLE_SERVICE_ACCOUNT_FILE);
  if (!fs.existsSync(keyPath)) {
    throw new Error(`找不到 Service Account 金鑰檔案: ${keyPath}`);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return { client: await auth.getClient(), google };
}

/**
 * 讀取試算表中所有日期列 (Column A)
 *
 * @returns {Promise<string[]>}
 */
async function getAllDatesInSheets() {
  const { client, google } = await getGoogleCredentials();
  const service = google.sheets({ version: 'v4', auth: client });
  const resp = await service.spreadsheets.values.get({
    spreadsheetId: config.SPREADSHEET_ID,
    range: `${config.SHEET_NAME}!A:A`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const values = resp.data.values || [];
  return values.map(row => (row[0] || '').trim()).filter(v => v !== '');
}

/**
 * 刪除指定日期區間內的資料行
 *
 * @param {string} startDate - 起始日期 (YYYY/MM/DD)
 * @param {string} endDate   - 結束日期 (YYYY/MM/DD)
 */
async function deleteRowsByDateRange(startDate, endDate) {
  logger.info(`🔍 正在檢查試算表以刪除區間: ${startDate} ~ ${endDate}`);

  const { client, google } = await getGoogleCredentials();
  const service = google.sheets({ version: 'v4', auth: client });

  // 取得所有日期
  const resp = await service.spreadsheets.values.get({
    spreadsheetId: config.SPREADSHEET_ID,
    range: `${config.SHEET_NAME}!A:A`,
  });

  const values = resp.data.values || [];
  const rowsToDelete = [];

  // 找出落在區間內的行號 (0-indexed)
  for (let i = 0; i < values.length; i++) {
    const dateStr = (values[i][0] || '').trim();
    if (!dateStr || dateStr === '日期') continue; // 跳過標題或空行

    if (dateStr >= startDate && dateStr <= endDate) {
      rowsToDelete.push(i);
    }
  }

  if (rowsToDelete.length === 0) {
    logger.info('  - 未發現目標日期區間的資料，無需刪除');
    return;
  }

  logger.info(`  - 發現 ${rowsToDelete.length} 筆資料落在區間內，準備執行整行刪除...`);

  const ss = await service.spreadsheets.get({ spreadsheetId: config.SPREADSHEET_ID });
  const sheet = ss.data.sheets.find(s => s.properties.title === config.SHEET_NAME);
  const sheetId = sheet.properties.sheetId;

  // 由後往前排列索引，確保刪除時不會影響前面的索引
  rowsToDelete.sort((a, b) => b - a);

  const requests = rowsToDelete.map(rowIndex => ({
    deleteDimension: {
      range: {
        sheetId,
        dimension: 'ROWS',
        startIndex: rowIndex,
        endIndex: rowIndex + 1,
      },
    },
  }));

  await service.spreadsheets.batchUpdate({
    spreadsheetId: config.SPREADSHEET_ID,
    requestBody: { requests },
  });

  logger.info(`  ✅ 成功刪除 ${rowsToDelete.length} 行資料`);
}

/**
 * 批次寫入多列資料至試算表
 *
 * @param {Array[]} rows - 資料陣列的陣列
 */
async function batchAppendToSheets(rows) {
  if (!rows || rows.length === 0) {
    logger.warn('⚠️ 批次寫入資料為空，跳過動作');
    return;
  }

  logger.info(`📝 正在批次寫入 ${rows.length} 筆資料至試算表...`);

  const { client, google } = await getGoogleCredentials();
  const service = google.sheets({ version: 'v4', auth: client });

  await service.spreadsheets.values.append({
    spreadsheetId: config.SPREADSHEET_ID,
    range: config.SHEET_NAME,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });

  logger.info(`  ✅ 批次寫入完成！共 ${rows.length} 筆`);
}

/**
 * 檢查指定日期是否已存在於試算表
 *
 * @param {string} dateStr
 * @returns {Promise<boolean>}
 */
async function checkAlreadyExistsInSheets(dateStr) {
  const dates = await getAllDatesInSheets();
  return dates.includes(dateStr.trim());
}

/**
 * 寫入一列資料至試算表 (先刪除現有同日期的資料以確保更新)
 *
 * @param {Array} rowData
 * @returns {Promise<boolean>} 成功寫入回傳 true
 */
async function appendToSheets(rowData) {
  const dateStr = rowData[0];
  await deleteRowsByDateRange(dateStr, dateStr);
  await batchAppendToSheets([rowData]);
  return true;
}

/**
 * 依日期欄位對工作表排序 (升冪)
 */
async function sortSheetsByDate() {
  const { client, google } = await getGoogleCredentials();
  const service = google.sheets({ version: 'v4', auth: client });
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
  logger.info('✨ 試算表排序完成');
}

module.exports = {
  getGoogleCredentials,
  getAllDatesInSheets,
  checkAlreadyExistsInSheets,
  appendToSheets,
  deleteRowsByDateRange,
  batchAppendToSheets,
  sortSheetsByDate,
};
