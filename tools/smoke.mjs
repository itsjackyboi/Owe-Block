// Smoke + sim runner. Uses the globally installed Playwright with the preinstalled Chromium (never run `playwright install`).
//   node tools/smoke.mjs [--out dir] [--port 8099]
// Starts its own static server, loads the game, fails on any console error, takes screenshots, and checks core behaviour.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const outDir = resolve(opt('out', join(root, 'tools', 'out')));
const port = +opt('port', 8099);
mkdirSync(outDir, { recursive: true });

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', join(process.execPath, '..', '..', 'lib', 'node_modules', 'playwright', 'index.mjs')];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const spec = c.startsWith('/') ? pathToFileURL(c).href : createRequire(import.meta.url).resolve(c);
      const m = await import(spec);
      return m.chromium ? m : m.default;
    } catch { /* try next */ }
  }
  throw new Error('Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs');
}

// Serve the repo under /Owe-Block/ so a GitHub Pages subpath is exercised (all asset paths must be relative).
const siteRoot = mkdtempSync(join(tmpdir(), 'oweblock-'));
symlinkSync(root, join(siteRoot, 'Owe-Block'));
const server = spawn('http-server', [siteRoot, '-p', String(port), '-c-1', '-s'], { stdio: 'ignore' });
const base = `http://localhost:${port}/Owe-Block/`;
await new Promise((r) => setTimeout(r, 1200));

const failures = [];
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failures.push(msg); };

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();

async function open(query, { blockStorage = false, viewport = { width: 960, height: 540 } } = {}) {
  const ctx = await browser.newContext({ viewport });
  if (blockStorage) await ctx.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => errors.push('request failed: ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
  await page.goto(base + query);
  await page.waitForTimeout(900);
  return { page, ctx, errors };
}

try {
  // 1. title screen
  {
    const { page, ctx, errors } = await open('', { viewport: { width: 1440, height: 810 } });
    await page.screenshot({ path: join(outDir, '01-title.png') });
    check(errors.length === 0, 'title loads with no console errors ' + errors.join(' | '));
    await ctx.close();
  }

  // 2. match: movement, wall collision, dash, pit fall, perf
  {
    const { page, ctx, errors } = await open('?debug=1&seed=7&dummies=6');
    const P = () => page.evaluate(() => { const p = window.__oweblock.player; return { x: p.x, y: p.y, vx: p.vx, vy: p.vy, hp: p.hp, dashCd: p.dashCd, dashing: p.dashing }; });
    check((await page.evaluate(() => window.__oweblock.state)) === 'match', 'debug URL starts a match');
    const a = await P();
    await page.keyboard.down('KeyD'); await page.waitForTimeout(400); await page.keyboard.up('KeyD');
    const b = await P();
    check(b.x > a.x + 20 || b.y !== a.y, `player moves (x ${a.x.toFixed(0)} -> ${b.x.toFixed(0)})`);

    // dash
    await page.keyboard.press('Space');
    let peak = 0, sawDash = false;
    for (let i = 0; i < 8; i++) { const s = await P(); peak = Math.max(peak, Math.hypot(s.vx, s.vy)); sawDash ||= s.dashing; await page.waitForTimeout(15); }
    const after = await P();
    check(sawDash && peak > 250, `dash reaches ~330 px/s (peak ${peak.toFixed(0)})`);
    check(after.dashCd > 1, `dash goes on cooldown (${after.dashCd.toFixed(2)}s)`);

    // never inside a solid tile while holding every direction against the cave walls
    let inside = 0;
    for (const dir of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
      await page.keyboard.down(dir);
      for (let i = 0; i < 12; i++) {
        await page.waitForTimeout(100);
        if (await page.evaluate(() => { const m = window.__oweblock.match, p = m.player; return m.map.isSolidPx(p.x, p.y); })) inside++;
      }
      await page.keyboard.up(dir);
    }
    check(inside === 0, 'player never ends up inside a wall');

    // pit: standing on one deals damage and returns the player to the last safe tile
    const pit = await page.evaluate(() => {
      const m = window.__oweblock.match, map = m.map, p = m.player;
      for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === 2) { const tx = i % map.w, ty = (i / map.w) | 0; p.hp = 100; p.dashT = 0; p.x = p.px = (tx + 0.5) * 16; p.y = p.py = (ty + 0.5) * 16; return { ok: true }; }
      return { ok: false };
    });
    await page.waitForTimeout(150);
    const fell = await P();
    check(!pit.ok || (fell.hp === 80), `falling into a pit costs 20 HP and returns to safe ground (hp ${fell.hp})`);

    await page.mouse.move(700, 300);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(outDir, '02-match-hud.png') });
    const perf = await page.evaluate(() => window.__oweblock.perf());
    check(perf.avg < 8, `update+render under 8 ms avg (${perf.avg.toFixed(2)} ms, p99 ${perf.p99.toFixed(2)} ms)`);
    check(errors.length === 0, 'match runs with no console errors ' + errors.join(' | '));
    await ctx.close();
  }

  // 3. placeholders stay playable
  {
    const { page, ctx, errors } = await open('?debug=1&seed=7&dummies=6&placeholders=1');
    await page.keyboard.down('KeyD'); await page.waitForTimeout(400); await page.keyboard.up('KeyD');
    await page.screenshot({ path: join(outDir, '03-placeholders.png') });
    check(errors.length === 0, '?placeholders=1 runs with no console errors ' + errors.join(' | '));
    await ctx.close();
  }

  // 4. blocked localStorage must not crash
  {
    const { page, ctx, errors } = await open('?debug=1&seed=3', { blockStorage: true });
    check((await page.evaluate(() => window.__oweblock.state)) === 'match' && errors.length === 0, 'blocked localStorage does not crash ' + errors.join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
console.log('screenshots in', outDir);
process.exit(failures.length ? 1 : 0);
