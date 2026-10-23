// Builds the shareable preview (Claude Artifact) from the app and works out what to republish.
//
//   node scripts/build-artifact.mjs                    build + prepare dist/artifact.html + print changed-file map
//   node scripts/build-artifact.mjs --verify           ...and smoke-test the bundle in headless Chromium first
//   node scripts/build-artifact.mjs --no-build         skip `vite build` (re-use dist/)
//   node scripts/build-artifact.mjs --commit-manifest  record dist/ as published (run after a successful publish)
//
// Artifact hosting differences handled here: the page is content-only (the host adds <html>/<head>),
// binary files are not served (terrain .bin packs are shipped as base64 .bin.json), and one publish
// accepts at most 255 files (changed files are split into batches).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ROOT } from './lib.mjs';

export const ARTIFACT_URL = 'https://claude.ai/artifact/RaMNjP2ByxPgw9KgJipyGC';
const DIST = path.join(ROOT, 'dist');
const STATE = path.join(ROOT, '.artifact');
const MANIFEST = path.join(ROOT, 'scripts', 'artifact-manifest.json');
const BATCH = 250;
const args = new Set(process.argv.slice(2));

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out); else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/** Files that make up the published artifact (published path -> absolute source). */
function publishable() {
  return walk(DIST).filter((f) => f !== 'index.html' && f !== 'artifact.html' && !f.endsWith('.bin')).sort();
}

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(DIST, f))).digest('hex');

function writeArtifactPage() {
  const assets = fs.readdirSync(path.join(DIST, 'assets'));
  const js = assets.find((a) => /^index-.*\.js$/.test(a)), css = assets.find((a) => a.endsWith('.css'));
  if (!js || !css) throw new Error('build output missing index-*.js or *.css');
  fs.writeFileSync(path.join(DIST, 'artifact.html'), [
    '<title>World Flight Simulator</title>',
    '<meta name="claude:viewport-fit-sides" content="cover">',
    '<style>:root { color-scheme: dark; } html, body { height: 100%; background: #0b1016; }</style>',
    `<link rel="stylesheet" href="./assets/${css}">`,
    '<canvas id="view" tabindex="0"></canvas>',
    '<div id="ui"></div>',
    `<script type="module" src="./assets/${js}"></script>`, '',
  ].join('\n'));
}

function encodeBinaries() {
  for (const f of walk(DIST).filter((x) => x.endsWith('.bin'))) {
    const b = fs.readFileSync(path.join(DIST, f));
    fs.writeFileSync(path.join(DIST, f + '.json'), JSON.stringify({ b64: b.toString('base64') }));
  }
}

/** Serve dist/ like the artifact host (artifact.html as the page, no .bin files) and load it in Chromium. */
async function verify() {
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/artifact.html';
    const file = path.join(DIST, p);
    if (p.endsWith('.bin') || !file.startsWith(DIST) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    let body = fs.readFileSync(file);
    if (p === '/artifact.html') body = Buffer.from(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${body}</body></html>`);
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, r));
  const { chromium } = await import('playwright');
  const exe = process.env.CHROMIUM_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
  const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${server.address().port}/`);
    await page.waitForSelector('#menu', { timeout: 60000 });
    const packs = await page.evaluate(() => window.__sim.app.terrain.packs.map((p) => `z${p.z}:${p.tiles.size}`));
    const airports = await page.evaluate(() => window.__sim.app.db.rows.length);
    await page.evaluate(() => window.__sim.start({ airport: 'KSFO', startMode: 'runway', spawn: '' }));
    await page.waitForFunction(() => window.__sim?.ac && !document.getElementById('loading'), null, { timeout: 90000 });
    const s = await page.evaluate(() => window.__sim.state());
    if (packs.length < 2) throw new Error('terrain packs not loaded: ' + packs);
    if (!s.onGround || s.surface !== 'runway') throw new Error(`flight did not start on the runway (${s.surface})`);
    if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
    console.log(`verify: OK — menu, ${airports} airports, terrain packs ${packs.join(' ')}, flight started on KSFO runway`);
  } finally { await browser.close(); server.close(); }
}

if (args.has('--commit-manifest')) {
  const m = Object.fromEntries(publishable().map((f) => [f, sha(f)]));
  fs.writeFileSync(MANIFEST, JSON.stringify({ url: ARTIFACT_URL, files: m }, null, 0) + '\n');
  console.log(`manifest recorded: ${Object.keys(m).length} files published at ${ARTIFACT_URL}`);
  process.exit(0);
}

if (!args.has('--no-build')) execFileSync(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'warn'], { cwd: ROOT, stdio: 'inherit' });
encodeBinaries();
writeArtifactPage();
if (args.has('--verify')) await verify();

const prev = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).files : {};
const now = publishable();
const changed = now.filter((f) => prev[f] !== sha(f));
const removed = Object.keys(prev).filter((f) => !now.includes(f));
const entries = [...changed.map((f) => [f, 'dist/' + f]), ...removed.map((f) => [f, null])];
fs.mkdirSync(STATE, { recursive: true });
for (const f of fs.readdirSync(STATE)) if (f.startsWith('files-')) fs.unlinkSync(path.join(STATE, f));
const batches = [];
for (let i = 0; i < entries.length; i += BATCH) batches.push(Object.fromEntries(entries.slice(i, i + BATCH)));
batches.forEach((b, i) => fs.writeFileSync(path.join(STATE, `files-${i + 1}.json`), JSON.stringify(b)));
console.log(`artifact: ${ARTIFACT_URL}`);
console.log(`page: dist/artifact.html · ${changed.length} changed/new file(s), ${removed.length} removed`);
batches.forEach((b, i) => console.log(`publish batch ${i + 1}/${batches.length}: .artifact/files-${i + 1}.json\n${JSON.stringify(b)}`));
if (!batches.length) console.log('No supporting files changed — publish dist/artifact.html alone (or skip if the page is unchanged).');
