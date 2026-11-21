// Local (Claude Code) mode end to end: start app/server.js on a temp data dir, open the dashboard it
// serves in jsdom, and check the data lands in the state file, survives a reopen, and that stale or
// foreign writes are refused.
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_PATH || 'jsdom');
const { createServer } = require('../server');
let failed = 0; const ok = (c, n) => { console.log((c ? '  PASS' : '  FAIL') + '  ' + n); if (!c) failed++; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms){ const t = Date.now(); while (Date.now() - t < (ms || 8000)){ if (await fn()) return true; await wait(100); } return false; }
function raw(port, opts, body){
  return new Promise((resolve, reject) => {
    const req = http.request(Object.assign({ host: '127.0.0.1', port }, opts), res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okfo-state-'));
  const { server, file, read } = createServer({ dataDir, noWatch: true, publish: false });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port, base = 'http://127.0.0.1:' + port + '/';
  const errorsOf = [];
  async function open(){
    const html = await (await fetch(base)).text();
    const errors = []; const vc = new VirtualConsole();
    vc.on('jsdomError', e => errors.push('jsdom: ' + (e && (e.message || e))));
    vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));
    const dom = new JSDOM(html, { url: base, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(w){
        w.fetch = (u, o) => fetch(new URL(u, base), o);
        w.DecompressionStream = DecompressionStream; w.Response = Response; w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder;
        w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = function(){}; w.print = () => {};
      } });
    await dom.window.__bootDone; await dom.window.__refreshDone;
    errorsOf.push(errors);
    return { w: dom.window, d: dom.window.document, ev: s => dom.window.eval(s), errors };
  }

  ok((await (await fetch(base + 'api/rev')).json()).rev === 0, 'fresh data dir: revision 0, no state file yet');
  const html = await (await fetch(base)).text();
  ok(/id="server-state"/.test(html) && /id="seed"/.test(html), 'server embeds the saved state and the seed in the page');

  // first open: seed from the newest backup → saved to the state file
  const a = await open();
  ok(a.ev('STORE_BACKEND') === 'file' && a.ev('STORE_SOURCE') === 'seed', 'first open: file backend, seeded from data/backups');
  ok(await until(() => fs.existsSync(file) && read().rev >= 1), 'first open wrote data/state/okfo-state.json');
  const s1 = read(), seedTx = a.ev('JSON.parse(document.getElementById("seed").textContent).transactions.length');
  ok(Object.keys(s1.doc.stores.transactions).length === seedTx && Object.keys(s1.doc.stores.policies).length >= 36 && Object.keys(s1.doc.stores.properties).length >= 8,
    'state file holds the full ledger (' + seedTx + ' txns), policies and properties');
  ok(Object.keys(s1.doc.stores.cash).length >= 100 && s1.doc.stores.meta['fill:registry-2026-09-28'] && s1.doc.stores.meta['fix:inspecie-v1'], 'state file holds bank lines and the one-time fix/fill flags');
  ok(/Saved to data\/state/.test(a.d.getElementById('sideStatus').textContent), 'sidebar says where the data is saved');
  a.ev("sAdd('rules', { ticker: 'D05', buy1: 40, cut: 35, sell1: 50 })");
  ok(await until(() => Object.keys(read().doc.stores.rules).length === 1), 'a rule created in the page is written to the file');
  a.w.close();

  // reopen: the page shows what is in the file
  const b = await open();
  ok(b.ev('STORE_SOURCE') === 'saved' && Object.keys(b.ev('DOC.stores.rules')).length === 1, 'reopen loads the state file (rule still there)');
  const revB = read().rev;
  // an outside edit (Claude Code / tools) bumps the revision → the page's next save is refused
  const st = read(); st.rev += 1; st.doc.stores.meta.outside = { key: 'outside', value: 1 }; fs.writeFileSync(file, JSON.stringify(st));
  const stale = await raw(port, { method: 'POST', path: '/api/state', headers: { 'Content-Type': 'application/json' } }, JSON.stringify({ rev: revB, doc: st.doc }));
  ok(stale.status === 409 && read().doc.stores.meta.outside, 'a save from an out-of-date page is refused (409) — outside edits are kept');
  b.w.close();

  // only this machine / this origin
  const foreign = await raw(port, { method: 'POST', path: '/api/state', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' } }, '{}');
  const rebind = await raw(port, { method: 'GET', path: '/api/state', headers: { Host: 'evil.example:' + port } });
  ok(foreign.status === 403 && rebind.status === 403, 'requests from other sites or other host names are refused (403)');

  // bank PDFs (needs python3 + tesseract/poppler only when there is a new PDF to read)
  let py = true; try { require('child_process').execFileSync('python3', ['--version']); } catch (e) { py = false; }
  if (py){
    const r = await raw(port, { method: 'POST', path: '/api/bank/process', headers: { 'Content-Type': 'application/json' } }, '{}');
    const j = JSON.parse(r.body);
    ok(r.status === 200 && Array.isArray(j.files) && j.files.some(f => /January 2026/.test(f.name) && f.status === 'ok'), 'Process new PDFs runs the converter through the server');
  } else console.log('  SKIP  bank PDF endpoint (python3 not found)');

  const errs = errorsOf.flat();
  ok(errs.length === 0, 'no console errors' + (errs.length ? ' → ' + errs.join(' | ') : ''));
  server.close();
  console.log(failed ? '\n' + failed + ' TEST(S) FAILED' : '\nALL TESTS PASSED'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
