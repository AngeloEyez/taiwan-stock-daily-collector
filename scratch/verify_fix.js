
const { yahooGetHistoricalBatch } = require('../src/fetchYahoo');

async function verify() {
  const ticker = '^TWII';
  const startDate = '2025/10/27';
  const endDate = '2025/10/27';
  
  console.log(`Verifying ${ticker} for ${startDate} using fixed fetchYahoo.js...`);
  
  const map = await yahooGetHistoricalBatch(ticker, startDate, endDate);
  
  if (map.has(startDate)) {
    const data = map.get(startDate);
    console.log('Data for 2025/10/27:');
    console.log(`  Price: ${data.price}`);
    console.log(`  Prev Close: ${data.prev_close}`);
    
    if (data.prev_close !== null) {
      console.log('✅ Success: Prev Close is found!');
      const change = data.price - data.prev_close;
      console.log(`  Calculated Change: ${change.toFixed(2)}`);
    } else {
      console.log('❌ Failure: Prev Close is still null.');
    }
  } else {
    console.log('❌ Failure: No data found for 2025/10/27.');
  }
}

verify();
