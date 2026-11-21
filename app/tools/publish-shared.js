#!/usr/bin/env node
// Publish the shared view-only snapshot (https://ong-kim-shared.vercel.app) from a backup — by default
// the newest data/backups/portfolio-ledger_backup_*.json. Runs on the Mac:
//
//   npm run publish:shared                 newest backup → build → deploy
//   npm run publish:shared -- <file.json>  a specific backup
//   npm run publish:shared -- --force      deploy even if that backup was already published
//
// The local dashboard calls this by itself after Backup JSON, and whenever a new backup file lands in
// data/backups while it runs (server.js). Secrets never live in the repo:
//   passphrase   OKFO_SHARE_PASS, else macOS Keychain item "okfo-share-pass"
//                (save once: security add-generic-password -s okfo-share-pass -a okfo -w)
//   Vercel login VERCEL_TOKEN, else Keychain item "okfo-vercel-token", else the Vercel CLI's own login
//                (once: npx vercel login)
const fs = require('fs'), path = require('path'), { execFile, execFileSync } = require('child_process');
const { newest, ROOT } = require('../lib/assemble');
const PROJECT = require('../vercel-shared.json');   // ids of the ong-kim-shared project (not secret)

function keychain(service){
  if (process.platform !== 'darwin') return null;
  try { return execFileSync('security', ['find-generic-password', '-s', service, '-w'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null; }
  catch (e) { return null; }
}
const stateFile = root => path.join(root, 'data', 'backups', '.published.json');
function lastPublished(root){ try { return JSON.parse(fs.readFileSync(stateFile(root), 'utf8')); } catch (e) { return null; } }
const stamp = f => { const st = fs.statSync(f); return path.basename(f) + '|' + st.size + '|' + Math.round(st.mtimeMs); };

// → Promise<{ url, file, skipped? }>
function publishShared(opts){
  opts = opts || {};
  const root = opts.root || ROOT, log = opts.log || (m => console.log(m));
  return new Promise((resolve, reject) => {
    const file = opts.file ? path.resolve(opts.file) : newest(path.join(root, 'data', 'backups'), /^portfolio-ledger_backup_.*\.json$/);
    if (!file || !fs.existsSync(file)) return reject(new Error('No backup to publish — save one with Backup JSON or node app/tools/state.js export'));
    const prev = lastPublished(root);
    if (!opts.force && prev && prev.stamp === stamp(file)) return resolve({ skipped: true, url: prev.url, file });
    const pass = process.env.OKFO_SHARE_PASS || keychain('okfo-share-pass');
    if (!pass) return reject(new Error('No passphrase for the shared link. Save it once in the Keychain: security add-generic-password -s okfo-share-pass -a okfo -w'));
    const dist = path.join(root, 'app', 'dist', 'shared');
    log('Building the shared snapshot from ' + path.basename(file) + ' …');
    execFile(process.execPath, [path.join(root, 'app', 'build.js'), '--shared', file], { cwd: root, env: Object.assign({}, process.env, { OKFO_SHARE_PASS: pass }) }, (err, out, errOut) => {
      if (err) return reject(new Error('Build failed: ' + (errOut || err.message).trim().split('\n').pop()));
      fs.mkdirSync(path.join(dist, '.vercel'), { recursive: true });
      fs.writeFileSync(path.join(dist, '.vercel', 'project.json'), JSON.stringify({ projectId: PROJECT.projectId, orgId: PROJECT.orgId }));
      const token = process.env.VERCEL_TOKEN || keychain('okfo-vercel-token');
      const args = ['-y', 'vercel@latest', 'deploy', '--prod', '--yes'].concat(token ? ['--token', token] : []);
      log('Deploying to ' + PROJECT.url + ' …');
      execFile(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { cwd: dist, timeout: 10 * 60e3, maxBuffer: 20e6 }, (e2, o2, err2) => {
        const text = (o2 || '') + (err2 || '');
        if (e2) return reject(new Error('Deploy failed: ' + (text.replace(/--token \S+/g, '').trim().split('\n').filter(Boolean).pop() || e2.message) + (token ? '' : ' (log in once with: npx vercel login)')));
        const rec = { file: path.basename(file), stamp: stamp(file), url: PROJECT.url, at: new Date().toISOString() };
        try { fs.writeFileSync(stateFile(root), JSON.stringify(rec, null, 2)); } catch (e) {}
        log('Published ' + rec.file + ' → ' + PROJECT.url);
        resolve(rec);
      });
    });
  });
}

if (require.main === module){
  const args = process.argv.slice(2);
  publishShared({ file: args.find(a => !a.startsWith('--')), force: args.includes('--force') })
    .then(r => { if (r.skipped) console.log('Already published: ' + path.basename(r.file) + ' → ' + r.url + ' (use --force to redeploy)'); })
    .catch(e => { console.error(e.message); process.exit(1); });
}
module.exports = { publishShared };
