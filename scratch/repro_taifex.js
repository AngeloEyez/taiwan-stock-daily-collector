
const { dateStrToDate, dateToStr } = require('../src/utils');

async function testTaifex() {
    const startDate = '2026/04/22';
    const endDate = '2026/04/26'; // Adjusted as in the log
    
    const startDateObj = dateStrToDate(startDate);
    const extendedStart = new Date(startDateObj.getTime() - 15 * 86400000);
    const queryStartDate = dateToStr(extendedStart);
    const queryEndDate = endDate;

    console.log(`Testing TAIFEX with Start: ${queryStartDate}, End: ${queryEndDate}`);

    const url = 'https://www.taifex.com.tw/cht/3/futContractsDateDown';
    const formData = new URLSearchParams();
    formData.append('queryStartDate', queryStartDate);
    formData.append('queryEndDate', queryEndDate);
    formData.append('commodityId', 'TXF');

    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.taifex.com.tw/cht/3/futContractsDateView',
      },
    });

    console.log(`Status: ${response.status}`);
    const buffer = await response.arrayBuffer();
    const decoder = new TextDecoder('big5');
    const csvText = decoder.decode(buffer);

    if (csvText.includes('<!DOCTYPE HTML')) {
        console.log('Error: Received HTML instead of CSV');
        // Save HTML to a file to inspect
        const fs = require('fs');
        fs.writeFileSync('taifex_error.html', csvText);
        console.log('Saved error page to taifex_error.html');
    } else {
        console.log('Success: Received CSV');
        console.log(csvText.substring(0, 500));
    }
}

testTaifex();
