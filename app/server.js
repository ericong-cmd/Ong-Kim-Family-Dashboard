#!/usr/bin/env node
// Local dashboard server for Claude Code (no dependencies): `npm start` → http://127.0.0.1:8787
//
// Serves the same page as the Cowork artifact, but the data lives in a file Claude Code can read
// and edit: data/state/okfo-state.json = { rev, savedAt, doc }. Every save from the page carries the
// revision it started from; if the file changed in between (Claude Code, tools/state.js), the save is
// refused (409) and the page reloads, so neither side overwrites the other.
//
// Endpoints (localhost only):
//   GET  /                   dashboard (state, seed and the Statements/Bank inbox embedded)
//   GET  /api/rev            { rev }                — the page polls this to pick up outside edits
//   GET  /api/state          { rev, savedAt, doc }
//   POST /api/state          { rev, doc } → { rev } | 409
//   POST /api/bank/process   run tools/bank_pdf_to_csv.py on Statements/Bank → JSON summary
//
// Env: PORT (8787), OKFO_DATA_DIR (data/state), OKFO_ROOT (project folder), OKFO_HOST (127.0.0.1).
const http = require('http'), fs = require('fs'), path = require('path'), { execFile } = require('child_process');
const { assemble, ROOT: DEFAULT_ROOT } = require('./lib/assemble');
const { readState, writeState } = require('./lib/statefile');

function createServer(opts){
  opts = opts || {};
  const root = opts.root || process.env.OKFO_ROOT || DEFAULT_ROOT;
  const dataDir = opts.dataDir || process.env.OKFO_DATA_DIR || path.join(root, 'data', 'state');
  const file = path.join(dataDir, 'okfo-state.json');
  const port = () => server.address() && server.address().port;

  const read = () => readState(file);
  const write = (state) => writeState(state, file);
  const send = (res, code, body, type) => {
    res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  // Only this machine, only this origin: blocks other web pages (CSRF) and DNS-rebinding tricks.
  const allowed = req => {
    const p = port(), hosts = ['127.0.0.1:' + p, 'localhost:' + p];
    if (!hosts.includes(String(req.headers.host || ''))) return false;
    const o = req.headers.origin; return !o || hosts.some(h => o === 'http://' + h);
  };
  const body = (req, limit) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit){ reject(new Error('Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); req.on('error', reject);
  });

  const server = http.createServer(async (req, res) => {
    try {
      if (!allowed(req)) return send(res, 403, { error: 'forbidden' });
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')){
        const st = read();
        const { html } = assemble({ root, serverState: { rev: st.rev, doc: st.doc, noWatch: !!opts.noWatch } });
        return send(res, 200, html, 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/api/rev') return send(res, 200, { rev: read().rev });
      if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, read());
      if (req.method === 'POST' && url.pathname === '/api/state'){
        if (!/application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'JSON only' });
        const msg = JSON.parse(await body(req, 50 * 1024 * 1024));
        const cur = read();
        if (Number(msg.rev) !== Number(cur.rev)) return send(res, 409, { error: 'stale', rev: cur.rev });
        if (!msg.doc || !msg.doc.stores) return send(res, 400, { error: 'no document' });
        const next = { rev: cur.rev + 1, savedAt: new Date().toISOString(), doc: msg.doc };
        write(next);
        return send(res, 200, { rev: next.rev, savedAt: next.savedAt });
      }
      if (req.method === 'POST' && url.pathname === '/api/bank/process'){
        const script = path.join(root, 'app', 'tools', 'bank_pdf_to_csv.py');
        execFile('python3', [script, '--folder', path.join(root, 'Statements', 'Bank')], { cwd: root, timeout: 15 * 60e3, maxBuffer: 20e6 }, (err, out, errOut) => {
          if (err) return send(res, 500, { error: (errOut || err.message || '').trim().split('\n').slice(-3).join(' ') || 'conversion failed' });
          let summary; try { summary = JSON.parse(out); } catch (e) { return send(res, 500, { error: 'unexpected output from bank_pdf_to_csv.py' }); }
          const files = Object.entries(summary.files || {}).map(([name, f]) => ({ name, status: f.status, lines: f.lines, issues: f.issues || [] }));
          send(res, 200, { changed: !!summary.changed, files, needsReview: files.filter(f => f.status === 'needs_review').map(f => f.name) });
        });
        return;
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      console.error(e); send(res, 500, { error: e.message });
    }
  });
  return { server, file, dataDir, read };
}

if (require.main === module){
  const port = Number(process.env.PORT || 8787), host = process.env.OKFO_HOST || '127.0.0.1';
  const { server, file } = createServer();
  server.listen(port, host, () => {
    console.log('Ong & Kim family office → http://' + (host === '127.0.0.1' ? 'localhost' : host) + ':' + port);
    console.log('Data file: ' + path.relative(process.cwd(), file) + (fs.existsSync(file) ? '' : ' (created on first open from the newest data/backups file)'));
  });
}
module.exports = { createServer };
