const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();

async function testTicker(ticker) {
  try {
    const startDateObj = new Date('2025-07-25T00:00:00Z');
    const endDateObj = new Date('2025-08-05T23:59:59Z');

    const result = await yahooFinance.chart(ticker, {
      period1: startDateObj,
      period2: endDateObj,
      interval: '1d',
    });

    console.log('\n--- Ticker:', ticker, '---');
    for (const q of result.quotes) {
      if (q.date.toISOString().includes('2025-08-01')) {
          console.log(`Date: ${q.date}, Close: ${q.close}, High: ${q.high}, Low: ${q.low}, Open: ${q.open}`);
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

async function run() {
    await testTicker('2330.TW');
    await testTicker('^TWII');
    await testTicker('TSM');
}

run();
