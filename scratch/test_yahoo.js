const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();

async function test() {
  try {
    const ticker = '2330.TW';
    const startDate = '2025/07/25';
    const endDate = '2025/08/05';

    const startDateObj = new Date('2025-07-25T00:00:00Z');
    const endDateObj = new Date('2025-08-05T23:59:59Z');

    const result = await yahooFinance.chart(ticker, {
      period1: startDateObj,
      period2: endDateObj,
      interval: '1d',
    });

    console.log('Ticker:', ticker);
    console.log('Quotes count:', result.quotes.length);
    for (const q of result.quotes) {
      console.log(`Date: ${q.date}, Close: ${q.close}, High: ${q.high}, Low: ${q.low}, Open: ${q.open}`);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
