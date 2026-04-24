async function testTwseInd() {
  try {
    const url = 'https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=20250801&type=IND';
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await resp.json();
    console.log('TWSE MI_INDEX IND Data:');
    if (data.tables) {
        data.tables.forEach((t, i) => {
            console.log(`\nTable ${i}: ${t.title}`);
            console.log('Fields:', t.fields);
            if (t.data) {
                const row = t.data.find(r => r[0].includes('發行量加權股價指數'));
                if (row) console.log('Found Index Row:', row);
            }
        });
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

testTwseInd();
