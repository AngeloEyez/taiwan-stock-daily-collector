// scratch/test_twse_all_new.js
async function testTwse(name, url) {
  console.log(`Testing ${name}: ${url}`);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.twse.com.tw/',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
      }
    });
    const data = await response.json();
    console.log(`  Stat: ${data.stat}`);
    if (data.stat === 'OK') {
      console.log(`  Data Rows: ${data.data ? data.data.length : 'N/A'}`);
      if (data.tables) console.log(`  Tables: ${data.tables.length}`);
    }
  } catch (e) {
    console.error(`  Error: ${e.message}`);
  }
}

const date = '20240422';
(async () => {
  await testTwse('Market Volume (MI_INDEX)', `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${date}&type=MS&response=json`);
  await testTwse('Margin Balance (MI_MARGN)', `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${date}&selectType=MS&response=json`);
  await testTwse('Foreign Investment (BFI82U)', `https://www.twse.com.tw/rwd/zh/fund/BFI82U?type=day&dayDate=${date}&response=json`);
  await testTwse('Stock Day (2330)', `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${date}&stockNo=2330&response=json`);
})();
