// scratch/test_calc.js
const { calculateChange, calculatePct } = require('../src/utils');

const current = 2050;
const prev = 2050;

const change = calculateChange(current, prev);
const pct = calculatePct(current, prev);

console.log('--- Test Data ---');
console.log(`Current: ${current}, Prev: ${prev}`);
console.log(`Change result: ${change} (Type: ${typeof change})`);
console.log(`Pct result: ${pct} (Type: ${typeof pct})`);

console.log('\n--- Simulation of main.js logic (using || "N/A") ---');
console.log(`Change Display: ${change || 'N/A'}`);
console.log(`Pct Display: ${pct || 'N/A'}`);

console.log('\n--- Proposed fix (using ?? "N/A") ---');
console.log(`Change Display: ${change ?? 'N/A'}`);
console.log(`Pct Display: ${pct ?? 'N/A'}`);
