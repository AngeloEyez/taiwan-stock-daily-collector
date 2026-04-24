
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();

async function debug() {
  const ticker = '2330.TW';
  const startDate = '2025/10/27';
  
  const [y, m, d] = startDate.split('/').map(Number);
  const startDateObj = new Date(Date.UTC(y, m - 1, d));
  
  const period1 = new Date(startDateObj.getTime() - 10 * 86400000); 
  const period2 = new Date(startDateObj.getTime() + 1 * 86400000);
  
  console.log(`Fetching ${ticker} from ${period1.toISOString()} to ${period2.toISOString()}`);
  
  try {
    const result = await yahooFinance.chart(ticker, {
      period1: period1,
      period2: period2,
      interval: '1d',
    });
    
    console.log('Quotes found:', result.quotes.length);
    result.quotes.forEach(q => {
      console.log(`${new Date(q.date).toISOString().split('T')[0]}: ${q.close}`);
    });
  } catch (e) {
    console.error(e);
  }
}

debug();
