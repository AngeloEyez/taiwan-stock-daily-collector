// scratch/test_bfi82u_new.js

async function testNewBfi82u(dateStr) {
  const dateStrTwse = dateStr.replace(/\//g, '');
  // New API format found by browser subagent
  const url = `https://www.twse.com.tw/rwd/zh/fund/BFI82U?type=day&dayDate=${dateStrTwse}&response=json`;
  
  console.log(`Fetching: ${url}`);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.twse.com.tw/zh/trading/foreign/bfi82u.html',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
      }
    });
    
    if (!response.ok) {
      console.error(`HTTP error! status: ${response.status}`);
      return;
    }
    
    const data = await response.json();
    if (data.stat !== 'OK') {
      console.log(`Stat: ${data.stat}`);
      return;
    }

    console.log(`Date: ${data.date}`);
    console.log(`Fields: ${JSON.stringify(data.fields)}`);
    console.log('Data:');
    data.data.forEach(row => {
      console.log(`  ${JSON.stringify(row)}`);
    });

  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
}

// Test with different dates to see if data changes
const dates = ['20240422', '20240419', '20240418'];
(async () => {
  for (const date of dates) {
    await testNewBfi82u(date);
    console.log('---');
    await new Promise(r => setTimeout(r, 2000));
  }
})();
