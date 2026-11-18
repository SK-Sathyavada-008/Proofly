const fs = require('fs');
const path = require('path');

// 1. Inspect Challenge Catalog
const catalogFile = path.resolve('src/data/challengeCatalog.ts');
const catalogContent = fs.readFileSync(catalogFile, 'utf8');
const squadMatches = catalogContent.match(/"Squade_\d+":/g) || [];
console.log(`Discovered ${squadMatches.length} Squads in challengeCatalog.ts:`, squadMatches.slice(0, 10).map(s => s.replace(/[:"]/g, '')));

// Let's check how many total issues are in the catalog
const issueMatches = catalogContent.match(/"issueNumber":\s*(\d+)/g) || [];
console.log(`Total issues across catalog: ${issueMatches.length}`);
