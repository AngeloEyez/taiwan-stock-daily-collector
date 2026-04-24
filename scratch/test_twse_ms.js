async function testTwseMs() {
  try {
    const url = 'https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=20250801&type=MS';
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await resp.json();
    console.log('TWSE MI_INDEX MS Data:');
    if (data.tables) {
        data.tables.forEach((t, i) => {
            console.log(`Table ${i}: ${t.title}`);
            console.log('Fields:', t.fields);
            console.log('First row:', t.data[0]);
        });
    } else {
        console.log('Keys:', Object.keys(data));
        // Old format
        for (let i=0; i<10; i++) {
            if (data[`fields${i}`]) {
                console.log(`Table ${i}: fields${i}`);
                console.log('Fields:', data[`fields${i}`]);
                console.log('First row:', data[`data${i}`][0]);
            }
        }
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

testTwseMs();
