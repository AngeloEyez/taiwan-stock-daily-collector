// scratch/verify_module_fix.js
const { getForeignInvestment } = require('../src/fetchTwse');

async function verify() {
  const dates = ['2024/04/22', '2024/04/19', '2024/04/18'];
  for (const date of dates) {
    const val = await getForeignInvestment(date);
    console.log(`${date}: 外資買賣超 = ${val} 億`);
    await new Promise(r => setTimeout(r, 2000));
  }
}

verify();
