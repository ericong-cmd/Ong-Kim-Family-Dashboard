// data/state/okfo-state.json — the dashboard's data when it runs locally (npm start) and what
// Claude Code reads and edits. Shape: { rev, savedAt, doc } where doc = { version, savedAt, seq,
// stores: { transactions, prices, boundaries, histprices, meta, rules, cash, properties, policies,
// people, maps } } (each store is an object keyed by its key field — see KEYPATH in src/store.js).
// Every write bumps rev; the open dashboard notices and reloads. The first version of each day is
// kept in data/state/history/ before it is overwritten.
const fs = require('fs'), path = require('path');
const { ROOT } = require('./assemble');

function stateFile(dataDir){ return path.join(dataDir || process.env.OKFO_DATA_DIR || path.join(ROOT, 'data', 'state'), 'okfo-state.json'); }
function readState(file){
  file = file || stateFile();
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return { rev: 0, savedAt: null, doc: null }; throw e; }
}
function writeState(state, file){
  file = file || stateFile();
  const histDir = path.join(path.dirname(file), 'history');
  fs.mkdirSync(histDir, { recursive: true });
  const snap = path.join(histDir, 'okfo-state_' + new Date().toISOString().slice(0, 10) + '.json');
  if (fs.existsSync(file) && !fs.existsSync(snap)) fs.copyFileSync(file, snap);
  const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(state)); fs.renameSync(tmp, file);
  return state;
}
// Apply a change to the document and save it as the next revision.
function updateDoc(mutator, file){
  const cur = readState(file);
  if (!cur.doc) throw new Error('No dashboard data yet — run `npm start` and open the page once, or `node app/tools/state.js import <backup.json>`');
  const doc = cur.doc; mutator(doc);
  doc.savedAt = new Date().toISOString();
  return writeState({ rev: (cur.rev || 0) + 1, savedAt: doc.savedAt, doc }, file);
}
module.exports = { stateFile, readState, writeState, updateDoc };
