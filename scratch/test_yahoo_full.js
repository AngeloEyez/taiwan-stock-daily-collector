const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();

async function test() {
  try {
    const ticker = '2330.TW';
    const startDateObj = new Date('2025-07-31T00:00:00Z');
    const endDateObj = new Date('2025-08-02T23:59:59Z');

    const result = await yahooFinance.chart(ticker, {
      period1: startDateObj,
      period2: endDateObj,
      interval: '1d',
    });

    for (const q of result.quotes) {
      console.log('Date:', q.date);
      console.log('Full Quote:', JSON.stringify(q, null, 2));
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
