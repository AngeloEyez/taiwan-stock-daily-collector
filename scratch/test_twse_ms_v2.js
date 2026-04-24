async function testTwseMs() {
  try {
    const url = 'https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=20250801&type=MS';
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await resp.json();
    console.log('TWSE MI_INDEX MS Data keys:', Object.keys(data));
    
    if (data.tables) {
        data.tables.forEach((t, i) => {
            console.log(`\nTable ${i}: ${t.title}`);
            console.log('Fields:', t.fields);
            if (t.data && t.data.length > 0) {
                console.log('First 3 rows:');
                t.data.slice(0, 3).forEach(r => console.log('  ', r));
            } else {
                console.log('No data');
            }
        });
    } else {
        // Old format check
        Object.keys(data).forEach(key => {
            if (key.startsWith('fields')) {
                const i = key.replace('fields', '');
                console.log(`\nTable ${i}: ${key}`);
                console.log('Fields:', data[key]);
                const dataKey = `data${i}`;
                if (data[dataKey] && data[dataKey].length > 0) {
                    console.log('First 3 rows:');
                    data[dataKey].slice(0, 3).forEach(r => console.log('  ', r));
                }
            }
        });
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

testTwseMs();
