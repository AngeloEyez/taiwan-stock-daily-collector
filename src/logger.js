// src/logger.js
/**
 * logger.js - Winston logger 設定
 *
 * 依據 config.js 中的 LOG_LEVEL 設定日誌層級。
 */
const winston = require('winston');
const config = require('./config');

const logger = winston.createLogger({
  level: config.LOG_LEVEL || 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()],
});

module.exports = logger;
