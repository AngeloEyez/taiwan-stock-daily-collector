
const { getForeignFuturesBatch } = require('../src/fetchTaifex');
const logger = require('../src/logger');

async function verify() {
    console.log('--- 驗證修正效果 ---');
    console.log('模擬日期: 2026/04/27 (週一)');
    console.log('預期行為: 由於 04/26 為週日，queryEndDate 應調整為 04/24 (週五)');
    
    // 注意：實際執行時會呼叫真正的 getTodayStr()。
    // 如果今天在現實中真的是 2026/04/27 早上，則會觸發調整。
    // 但如果現在是現實中的 2024/2025，則 endDate >= todayStr 可能不成立 (除非 endDate 傳入 2026)。
    
    const startDate = '2026/04/22';
    const endDate = '2026/04/27';

    try {
        const result = await getForeignFuturesBatch(startDate, endDate);
        console.log('結果筆數:', result.size);
        for (const [date, data] of result) {
            console.log(`${date}: NetOI=${data.netOpenInterest}, Diff=${data.diff}`);
        }
    } catch (e) {
        console.error('執行失敗:', e);
    }
}

verify();
