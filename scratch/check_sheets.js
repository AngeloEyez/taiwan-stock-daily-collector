const sheets = require('@googleapis/sheets');
console.log('Keys in @googleapis/sheets:', Object.keys(sheets));
if (sheets.auth) {
    console.log('auth exists');
}
const s = sheets.sheets('v4');
console.log('sheets instance created');
