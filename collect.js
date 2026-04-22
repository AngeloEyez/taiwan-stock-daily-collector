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
const start = Date.now();
console.log('\x1b[36m%s\x1b[0m', '🚀 正在初始化台灣股市抓取環境，請稍候...');

/**
 * 延遲載入主程式模組，避免 require 過程長時間無輸出
 */
async function startApp() {
  try {
    // 提示正在載入核心模組 (尤其是 googleapis 較慢)
    console.log('📦 正在載入系統模組與 API 配置...');
    const { main } = require('./src/main');
    
    const loadTime = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`✅ 環境初始化完成 (耗時 ${loadTime}s)`);
    
    await main();
  } catch (error) {
    console.error(`\n❌ 程式執行發生嚴重錯誤: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

startApp();
