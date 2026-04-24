async function testTwse() {
  try {
    const url = 'https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=20250801&stockNo=2330';
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await resp.json();
    console.log('TWSE Data for 2330 on 2025/08/01:');
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
}

testTwse();
