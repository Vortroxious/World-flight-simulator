// Browser end-to-end tests (Playwright + Chromium). Starts a Vite dev server, drives the real app with
// keyboard/mouse and the window.__sim test API, and saves screenshots to tests/e2e/output/.
// Usage: npm run test:e2e   (CHROMIUM_PATH=/path/to/chrome to override the browser binary)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'tests/e2e/output');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5199;
const URL = `http://localhost:${PORT}/`;

const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'pipe' });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('vite did not start')), 30000);
  server.stdout.on('data', (d) => { if (String(d).includes('Local')) { clearTimeout(t); resolve(); } });
});

const exe = process.env.CHROMIUM_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) pageErrors.push(m.text()); });

const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push([name, true, Date.now() - t0]); console.log(`  ✓ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { results.push([name, false, Date.now() - t0, e.message]); console.log(`  ✗ ${name}: ${e.message}`); await page.screenshot({ path: path.join(OUT, `FAIL-${name.replace(/\W+/g, '_')}.png`) }).catch(() => {}); }
}
const assert = (c, msg) => { if (!c) throw new Error(msg); };
const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });
const sim = (fn, arg) => page.evaluate(fn, arg);

console.log('World Flight Simulator — browser E2E');
await test('app boots to the main menu without errors', async () => {
  await page.goto(URL);
  await page.waitForSelector('#menu', { timeout: 60000 });
  await page.waitForSelector('#boot', { state: 'detached', timeout: 60000 });
  assert(pageErrors.length === 0, 'page errors: ' + pageErrors.join(' | '));
  await shot('01-menu');
});

await test('airport search finds KSFO by IATA code and selects it', async () => {
  await page.fill('#airport-search', 'SFO');
  await page.waitForSelector('#airport-results .row[data-ident="KSFO"]', { timeout: 5000 });
  await page.click('#airport-results .row[data-ident="KSFO"]');
  await page.waitForSelector('#start-position select#spawn', { timeout: 20000 });
  const opts = await page.$$eval('#spawn option', (o) => o.map((x) => x.textContent));
  assert(opts.some((t) => t.includes('28R')), 'runway 28R listed: ' + opts.join(','));
});

await test('world map tab renders airports and selects on click', async () => {
  await page.click('[data-tab="map"]');
  await page.waitForSelector('#worldmap');
  await page.waitForTimeout(500);
  await shot('02-worldmap');
  await page.click('[data-tab="flight"]');
});

await test('start flight on runway 28R: aircraft rests on the runway', async () => {
  await page.selectOption('#start-mode', 'runway');
  await page.waitForSelector('#spawn');
  await page.selectOption('#spawn', { label: (await page.$$eval('#spawn option', (o) => o.map((x) => x.textContent))).find((t) => t.includes('28R')) });
  await page.click('#start-flight');
  await page.waitForFunction(() => window.__sim?.ac && !document.getElementById('loading'), null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  const s = await sim(() => window.__sim.state());
  assert(s.surface === 'runway', 'surface ' + s.surface);
  assert(Math.abs(((s.heading - 298) + 540) % 360 - 180) < 3, 'heading ' + s.heading);
  assert(s.agl > 0.8 && s.agl < 1.3 && s.onGround, 'resting on gear, agl ' + s.agl);
  await shot('03-cockpit-runway');
});

await test('keyboard: flaps (F7), throttle (PageUp hold), HUD toggle (H), view cycle (V)', async () => {
  await page.locator('#view').focus();
  await page.keyboard.press('F7');
  assert((await sim(() => window.__sim.ac.controls.flapsLever)) === 1, 'flap lever 1');
  await page.keyboard.press('F6');
  const t0 = await sim(() => window.__sim.ac.controls.throttle);
  await page.keyboard.down('PageUp');
  const ok = await page.waitForFunction((t) => window.__sim.ac.controls.throttle > t + 0.05, t0, { timeout: 15000 }).then(() => true, () => false);
  await page.keyboard.up('PageUp');
  assert(ok, 'throttle increased while PageUp held');
  await page.keyboard.press('KeyH');
  assert(await page.$eval('#hud', (e) => e.style.display === 'none'), 'HUD hidden');
  await page.keyboard.press('KeyH');
  await page.keyboard.press('KeyV');
  assert((await sim(() => window.__sim.flight.rig.mode)) === 'chase', 'chase view');
  await page.keyboard.press('KeyC');
});

await test('mouse: clicking cockpit controls changes simulation state', async () => {
  await page.mouse.move(10, 10);
  const target = await sim(() => {
    const f = window.__sim.flight; const cam = window.__sim.app.camera;
    f.rig.look.pitch = -0.35; f.rig.look.yaw = 0.05;
    return true;
  });
  void target;
  await page.waitForTimeout(800);
  const pos = await sim(() => {
    const f = window.__sim.flight, cam = window.__sim.app.camera;
    const m = f.cockpit.switchMeshes.beacon; m.updateMatrixWorld(true);
    const v = m.getWorldPosition(m.position.clone()).project(cam);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, before: window.__sim.ac.elec.switches.beacon };
  });
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(300);
  const after = await sim(() => window.__sim.ac.elec.switches.beacon);
  assert(after !== pos.before, `beacon switch toggled by click at ${pos.x.toFixed(0)},${pos.y.toFixed(0)}`);
  await shot('04-cockpit-instruments');
});

await test('takeoff and climb (scripted pilot, real terrain + airport surfaces)', async () => {
  const r = await sim(() => {
    const S = window.__sim, hdg0 = S.flight.spawn.heading;
    S.flight.override = null;
    S.ac.controls.throttle = 1; S.ac.controls.parkingBrake = false; S.ac.setBrakesHeld = false;
    let lift = null;
    for (let i = 0; i < 60; i++) {
      const s = S.advance(1, (st, ac) => {
        const kt = st.ias / 0.514444, he = ((hdg0 - st.heading + 540) % 360) - 180;
        ac.controls.elevator = kt > 55 ? Math.max(-1, Math.min(1, 0.08 * (9 - st.pitch) - 0.03 * st.q)) : 0;
        ac.controls.aileron = Math.max(-1, Math.min(1, -0.05 * st.roll + (st.onGround ? 0 : 0.03 * he)));
        ac.controls.rudder = st.onGround ? Math.max(-1, Math.min(1, 0.2 * he)) : 0;
        ac.controls.brakeL = ac.controls.brakeR = 0;
      });
      if (!lift && !s.onGround) lift = s.t;
    }
    S.flight.override = { elevator: 0, aileron: 0, rudder: 0 };
    return { lift, s: S.state(), dmg: S.damage().destroyed };
  });
  assert(r.lift && r.lift < 30, 'lifted off at ' + r.lift);
  assert(r.s.agl > 80 && r.s.vs > 1.5 && !r.dmg, `climbing: agl ${r.s.agl.toFixed(0)} vs ${r.s.vs.toFixed(1)}`);
  await sim(() => window.__sim.view('chase'));
  await page.waitForTimeout(2500);
  await shot('05-climb-chase');
});

await test('crash into terrain -> damage telemetry -> crash report -> replay -> restart', async () => {
  const r = await sim(() => {
    const S = window.__sim;
    S.teleport(37.45, -122.30, 2600, 230, 120);
    S.advance(60, (st, ac) => { ac.controls.elevator = -0.5; ac.controls.throttle = 1; ac.controls.aileron = -0.04 * st.roll; });
    return { crashed: S.flight.crashed, dmg: S.damage(), events: S.ac.damage.events.length };
  });
  assert(r.crashed && r.dmg.destroyed, 'destroyed: ' + JSON.stringify(r.dmg));
  assert(r.events > 0, 'damage events logged');
  await page.waitForSelector('#crash', { timeout: 30000 });
  await shot('06-crash-report');
  await page.click('#btn-replay');
  await page.waitForTimeout(2000);
  await shot('07-replay');
  await page.click('.replaybar button');
  await page.waitForSelector('#btn-restart');
  await page.click('#btn-restart');
  await page.waitForFunction(() => window.__sim?.ac && !window.__sim.flight.crashed && !document.getElementById('loading'), null, { timeout: 90000 });
  const s = await sim(() => window.__sim.state());
  assert(s.onGround && !(await sim(() => window.__sim.damage().destroyed)), 'restarted on the ground, undamaged');
});

await test('procedural airport (KOAK) approach start + return to menu', async () => {
  await sim(() => window.__sim.menu());
  await page.waitForSelector('#menu', { state: 'visible' });
  await sim(() => window.__sim.start({ airport: 'KOAK', startMode: 'approach', spawn: '', approachNm: 3 }));
  await page.waitForFunction(() => window.__sim?.ac && !document.getElementById('loading'), null, { timeout: 90000 });
  const s = await sim(() => window.__sim.state());
  assert(!s.onGround && s.agl > 150 && s.agl < 400, 'on final, agl ' + s.agl);
  await page.waitForTimeout(2500);
  await shot('08-koak-final');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#pause');
  await page.click('#pause button:nth-child(3)');
  await page.waitForSelector('#menu', { state: 'visible' });
});

await test('no uncaught errors during the session', async () => {
  const last = await sim(() => window.__sim.lastError());
  assert(!last, 'render loop error: ' + last);
  assert(pageErrors.length === 0, pageErrors.join(' | '));
});

await page.goto('about:blank'); // stop the desktop page rendering while the phone test runs

await test('phone (touch, landscape): menu reachable, stick / throttle / flaps / cockpit tap / look-around', async () => {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => pageErrors.push('[mobile] ' + e.message));
  const cdp = await ctx.newCDPSession(p);
  const t = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const box = (sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, top: r.top }; });
  await p.goto(URL);
  await p.waitForSelector('#menu', { timeout: 60000 });
  await p.evaluate(() => { try { localStorage.clear(); } catch {} });
  await p.tap('#start-flight');
  await p.waitForFunction(() => window.__sim?.ac && !document.getElementById('loading'), null, { timeout: 90000 });
  assert(await p.$('#touch-controls'), 'touch controls shown on a touch device');
  const thr = await box('.tthr');
  await t('touchStart', thr.x, thr.top + thr.h - 4); await t('touchMove', thr.x, thr.top + thr.h / 2); await t('touchMove', thr.x, thr.top + 2); await t('touchEnd');
  assert((await p.evaluate(() => window.__sim.ac.controls.throttle)) > 0.95, 'throttle lever sets full power');
  const flapDown = await (await p.$$('.tbuttons .tbtn'))[1].boundingBox();
  await t('touchStart', flapDown.x + 20, flapDown.y + 15); await t('touchEnd');
  assert((await p.evaluate(() => window.__sim.ac.controls.flapsLever)) === 1, 'flap button lowers flaps');
  const st = await box('.tstick');
  await t('touchStart', st.x, st.y); await t('touchMove', st.x + st.w * 0.2, st.y + st.h * 0.3);
  const ax = await p.evaluate(() => window.__sim.flight.input.update(0.016, window.__sim.ac));
  assert(ax.elevator > 0.3 && ax.aileron > 0.1, `stick drives elevator/aileron ${ax.elevator.toFixed(2)}/${ax.aileron.toFixed(2)}`);
  await t('touchEnd');
  assert(!(await p.evaluate(() => window.__sim.flight.input.touch.active)), 'stick re-centres on release');
  const yaw0 = await p.evaluate(() => window.__sim.flight.rig.look.yaw);
  await t('touchStart', 420, 120); await t('touchMove', 470, 125); await t('touchMove', 520, 130); await t('touchEnd');
  assert((await p.evaluate(() => window.__sim.flight.rig.look.yaw)) !== yaw0, 'one-finger drag looks around');
  // stop the aircraft (it has been rolling at full power) so the cockpit is steady for the tap
  await p.evaluate(() => { const ac = window.__sim.ac; ac.controls.throttle = 0; ac.v = [0, 0, 0]; ac.w = [0, 0, 0]; ac.controls.parkingBrake = true; const r = window.__sim.flight.rig; r.look.yaw = 0.05; r.look.pitch = -0.35; });
  // wait until the rendered camera has settled (two projections 0.5 s apart agree)
  const project = () => p.evaluate(() => { const f = window.__sim.flight, cam = window.__sim.app.camera; const m = f.cockpit.switchMeshes.beacon; const v = m.getWorldPosition(m.position.clone()).project(cam); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, b: window.__sim.ac.elec.switches.beacon }; });
  let sw = await project();
  for (let i = 0; i < 40; i++) { await p.waitForTimeout(500); const n = await project(); const still = Math.hypot(n.x - sw.x, n.y - sw.y) < 1; sw = n; if (still) break; }
  await t('touchStart', sw.x, sw.y); await t('touchEnd');
  assert((await p.evaluate(() => window.__sim.ac.elec.switches.beacon)) !== sw.b, 'tapping a cockpit switch toggles it');
  await p.screenshot({ path: path.join(OUT, '09-phone-landscape.png') });
  await ctx.close();
});

await browser.close();
server.kill();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${path.relative(ROOT, OUT)}/`);
process.exit(failed.length ? 1 : 0);
