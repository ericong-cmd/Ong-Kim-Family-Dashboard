// Copy the fenced code block whose first line is `// @file <path>` from the plan into <path>.
const fs = require('fs'), path = require('path');
const PLAN = 'docs/superpowers/plans/2026-09-27-family-office-dashboard.md';
const want = process.argv[2];
if (!want) { console.error('usage: node app/tools/extract.js <path>'); process.exit(2); }
const md = fs.readFileSync(PLAN, 'utf8');
// The fence is built at runtime: a literal triple backtick here would end this very code block.
const F = '`'.repeat(3);
const re = new RegExp(F + '[a-z]*\\n// @file (\\S+)\\n([\\s\\S]*?)' + F, 'g');
let m, found = null;
while ((m = re.exec(md))) if (m[1] === want) found = m[2];
if (found == null) { console.error('no block for ' + want); process.exit(1); }
fs.mkdirSync(path.dirname(want), { recursive: true });
fs.writeFileSync(want, found);
console.log('wrote ' + want + ' (' + found.split('\n').length + ' lines)');
