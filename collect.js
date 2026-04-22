#!/usr/bin/env node
/**
 * collect.js - CLI 入口點
 *
 * 使用方式:
 *   node collect.js                              # 抓取今日資料
 *   node collect.js --date 2026/04/22           # 抓取指定日期
 *   node collect.js --start 2026/04/01 --end 2026/04/22  # 批次抓取
 *   node collect.js --fill                       # 補齊遺漏資料
 *
 *   或使用 npm script:
 *   npm run collect
 */
const { main } = require('./src/main');

main().catch(error => {
  console.error(`程式執行發生嚴重錯誤: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});
