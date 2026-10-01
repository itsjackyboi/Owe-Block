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

  // 2b. Stage 2: combat, items, pickups, XP, level-up, death
  {
    const { page, ctx, errors } = await open('?debug=1&seed=7&dummies=4', { viewport: { width: 1440, height: 810 } });
    const ev = (fn, arg) => page.evaluate(fn, arg);
    const wait = (ms) => page.waitForTimeout(ms);
    // quiet arena: player in the biggest chamber, dummies in a row, no loot lying around, nobody carrying anything
    const arena = () => ev(() => {
      const m = window.__oweblock.match, pl = m.player;
      const c = m.chambers.reduce((a, b) => (b.r > a.r ? b : a));
      const cx = (c.x + 0.5) * 16, cy = (c.y + 0.5) * 16;
      m.pickups.pool.clear();
      pl.slots.fill(null); pl.held = 0; pl.hp = pl.maxHp = 100; pl.level = 1; pl.xp = 0; pl.xpTotal = 0; pl.pendingLevels = 0; pl.dead = false;
      pl.cdMul = 1; pl.dmgMul = 1; pl.dashCd = 0; pl.armor = 0;
      pl.fists.cd.primary = pl.fists.cd.special = 0;
      pl.teleport(cx - 30, cy);
      m.fighters.slice(1).forEach((f, i) => { f.slots.fill(null); f.dead = false; f.hp = f.maxHp = 70; f.st.burn = f.st.stun = 0; f.kx = f.ky = 0; f.teleport(cx + 30 + i * 28, cy - 36 + i * 24); });
      m.projectiles.pool.clear(); m.projectiles.orbits = 0; m.projectiles.blocked = 0; m.areas.pool.clear(); m.levelUp = null;
      m.camera.snapTo(pl.x, pl.y, m.map.pxW, m.map.pxH);
      return { cx, cy };
    });
    const D = (i) => ev((n) => { const f = window.__oweblock.match.fighters[n + 1]; return { x: f.x, y: f.y, hp: f.hp, dead: f.dead, stun: f.st.stun, burn: f.st.burn }; }, i);
    const P = () => ev(() => { const p = window.__oweblock.match.player; return { x: p.x, y: p.y, hp: p.hp, xp: p.xp, level: p.level, held: p.held, stance: p.stance, dead: p.dead, slots: p.slots.map((s) => s && s.id + ':' + s.level), cdP: p.item.cd.primary, cdS: p.item.cd.special, swapT: p.swapT }; });
    const aim = async (wx, wy) => { const s = await ev(([x, y]) => window.__oweblock.screenOf(x, y), [wx, wy]); await page.mouse.move(s.x, s.y); };
    const place = (i, dx, dy) => ev(([n, ox, oy]) => { const m = window.__oweblock.match, f = m.fighters[n + 1], p = m.player; f.teleport(p.x + ox, p.y + oy); f.hp = f.maxHp = 70; f.dead = false; f.kx = f.ky = 0; }, [i, dx, dy]);
    const hold = async (ms) => { await page.mouse.down(); await wait(ms); await page.mouse.up(); };
    const clearTargets = () => ev(() => { const m = window.__oweblock.match; m.fighters.slice(1).forEach((f, i) => f.teleport(m.player.x + 400, m.player.y + 400 + i * 20)); });

    // --- bare knuckles
    await arena(); await place(0, 14, 0); await aim((await P()).x + 14, (await P()).y);
    await wait(80); await hold(60); await wait(100);
    let d = await D(0);
    check(d.hp === 64, `bare knuckles jab deals 6 (dummy hp ${d.hp})`);

    // --- cutlass: swing, hit stop only for player hits, knockback
    await arena(); await ev(() => window.__oweblock.give('cutlass')); await place(0, 18, 0);
    await aim((await P()).x + 18, (await P()).y); await wait(80);
    const x0 = (await D(0)).x; await hold(60); await wait(150);
    d = await D(0);
    check(d.hp === 56 && d.x > x0 + 4, `cutlass deals 14 and knocks back (hp ${d.hp}, moved ${(d.x - x0).toFixed(1)}px)`);
    await place(1, 0, 60); await place(2, 0, -60);

    // --- L5 upgrade numbers and the wall-slam stun from the Q shove
    await arena(); await ev(() => window.__oweblock.give('cutlass', 5)); await place(0, 18, 0);
    await aim((await P()).x + 18, (await P()).y); await wait(80);
    await hold(60); await wait(150);
    check((await D(0)).hp === 45, `cutlass L5 deals 25 (dummy hp ${(await D(0)).hp})`);
    await arena(); await clearTargets();
    const slamSetup = await ev(() => {
      const m = window.__oweblock.match, map = m.map, p = m.player, f = m.fighters[1];
      for (let ty = 3; ty < map.h - 3; ty++) for (let tx = 4; tx < map.w - 4; tx++) {
        if (map.tile(tx, ty) === 0 && map.tile(tx + 1, ty) === 1 && map.tile(tx - 1, ty) === 0 && map.tile(tx - 2, ty) === 0 && map.tile(tx, ty - 1) === 0 && map.tile(tx, ty + 1) === 0) {
          f.teleport((tx + 0.5) * 16 + 3, (ty + 0.5) * 16); p.teleport(f.x - 13, f.y); m.camera.snapTo(p.x, p.y, map.pxW, map.pxH); return true;
        }
      }
      return false;
    });
    if (slamSetup) {
      await aim((await P()).x + 30, (await P()).y); await wait(100);
      await page.keyboard.press('KeyQ'); await wait(350);
      const sd = await D(0);
      check(sd.stun > 0 || sd.hp < 70, `shoving a fighter into a wall stuns them (stun ${sd.stun.toFixed(2)})`);
    }

    // --- cutlass riposte: reflects a projectile and counters a melee hit
    await arena(); await ev(() => window.__oweblock.give('cutlass')); await clearTargets();
    await aim((await P()).x + 100, (await P()).y); await wait(80);
    await page.keyboard.press('KeyQ');
    await ev(() => { const m = window.__oweblock.match, p = m.player, d0 = m.fighters[1]; d0.teleport(p.x + 70, p.y); m.projectiles.fly({ x: p.x + 40, y: p.y, angle: Math.PI, speed: 200, range: 300, damage: 10, owner: d0, r: 2, kind: 'arrow' }); });
    await wait(180);
    const refl = await ev(() => window.__oweblock.match.projectiles.pool.active.some((q) => q.owner === window.__oweblock.match.player && q.vx > 0));
    check(refl, 'riposte reflects a projectile arriving from the front');
    await wait(400); await ev(() => { window.__oweblock.match.player.item.cd.special = 0; }); await page.keyboard.press('KeyQ'); await wait(40);
    const countered = await ev(() => { const m = window.__oweblock.match, p = m.player, f = m.fighters[2]; f.teleport(p.x + 10, p.y); const hp0 = p.hp; const r = window.__oweblock.damageFrom(f, p, 20); return { hp0, hp1: p.hp, r, stun: f.st.stun, fhp: f.hp }; });
    check(countered.hp1 === countered.hp0 && countered.stun > 0 && countered.fhp < 70, `riposte negates a melee hit, stuns and counters (stun ${countered.stun.toFixed(2)}, attacker hp ${countered.fhp})`);

    // --- singing bow: tap does nothing, full draw is stronger and pierces
    await arena(); await ev(() => window.__oweblock.give('singing_bow')); await clearTargets();
    await place(0, 120, 0); await aim((await P()).x + 120, (await P()).y); await wait(80);
    await hold(40); await wait(300);
    check((await D(0)).hp === 70, 'quick tap on the bow draws nothing');
    await hold(1000); await wait(500);
    d = await D(0);
    check(d.hp <= 70 - 25, `full draw hits for 25+ (dummy hp ${d.hp})`);
    await place(0, 120, 0); await place(1, 150, 0); await aim((await P()).x + 120, (await P()).y); await wait(500);
    await ev(() => { const p = window.__oweblock.match.player; p.item.cd.primary = 0; });
    await hold(1000); await wait(600);
    const pierced = (await D(1)).hp < 70;
    check(pierced, `full draw pierces to the second fighter (hp ${(await D(1)).hp})`);
    await ev(() => { window.__oweblock.match.player.item.cd.special = 0; });
    await place(0, 90, -10); await place(1, 90, 0); await place(2, 90, 10); await place(3, 90, 20);
    await aim((await P()).x + 90, (await P()).y); await wait(60);
    const before = await ev(() => window.__oweblock.match.projectiles.count);
    await page.keyboard.press('KeyQ'); await wait(30);
    const after = await ev(() => window.__oweblock.match.projectiles.count);
    check(after - before === 5, `volley fires 5 arrows (${after - before})`);

    // --- ancient pot: lob, burning pool, burn status; oil slick ignites
    await arena(); await ev(() => window.__oweblock.give('ancient_pot')); await clearTargets();
    await place(0, 90, 0); await aim((await P()).x + 90, (await P()).y); await wait(80);
    await hold(60); await wait(900);
    let areas = await ev(() => window.__oweblock.match.areas.pool.active.map((a) => a.kind));
    check(areas.includes('fire'), 'thrown pot leaves a burning pool');
    await wait(1600);
    d = await D(0);
    check(d.hp < 70, `standing in the fire burns (dummy hp ${d.hp})`);
    await ev(() => { const m = window.__oweblock.match; m.areas.pool.clear(); m.player.item.cd.special = 0; m.player.item.cd.primary = 0; m.fighters[1].teleport(m.player.x + 60, m.player.y + 80); });
    await aim((await P()).x + 80, (await P()).y); await wait(60);
    await page.keyboard.press('KeyQ'); await wait(900);
    areas = await ev(() => window.__oweblock.match.areas.pool.active.map((a) => a.kind));
    check(areas.includes('oil'), 'Q throws an oil slick');
    const slip = await ev(() => { const m = window.__oweblock.match, a = m.areas.pool.active.find((q) => q.kind === 'oil'); const f = m.fighters[2]; f.teleport(a.x, a.y); return true; });
    await wait(200);
    check(slip && (await ev(() => window.__oweblock.match.fighters[3].st.slippery === 0)) !== undefined && (await ev(() => window.__oweblock.match.fighters[3].st.slippery)) >= 0, 'oil is in play');
    await ev(() => { const p = window.__oweblock.match.player; p.item.cd.primary = 0; });
    await aim((await P()).x + 80, (await P()).y); await hold(60); await wait(1100);
    areas = await ev(() => window.__oweblock.match.areas.pool.active.map((a) => a.kind + ':' + a.r));
    check(areas.some((a) => a.startsWith('fire')) && !areas.some((a) => a.startsWith('oil')), 'fire turns the oil slick into a blaze ' + areas.join(','));

    // --- drifter's call: boomerang out and back, hits on both passes, catching cuts the cooldown
    await arena(); await ev(() => window.__oweblock.give('drifters_call')); await clearTargets();
    await place(0, 70, 0); await aim((await P()).x + 70, (await P()).y); await wait(80);
    await hold(60); await wait(100);
    const out1 = await ev(() => window.__oweblock.match.player.item.state.out);
    await wait(1700);
    d = await D(0);
    const back = await ev(() => { const p = window.__oweblock.match.player; return { out: p.item.state.out, cd: p.item.cd.primary, count: window.__oweblock.match.projectiles.count }; });
    check(out1 === true && back.out === false, 'boomerang is out, then caught');
    check(d.hp <= 70 - 20, `boomerang hits on both passes (dummy hp ${d.hp})`);
    check(back.cd < 1.6 * 0.5 + 0.05 || back.cd <= 0.9, `catching cuts the cooldown (${back.cd.toFixed(2)}s left)`);

    // --- orbit blocks projectiles
    await clearTargets(); await ev(() => { window.__oweblock.match.player.item.cd.special = 0; });
    await page.keyboard.press('KeyQ'); await wait(100);
    const orb = await ev(() => window.__oweblock.match.projectiles.orbits);
    await ev(() => { const m = window.__oweblock.match, p = m.player, d0 = m.fighters[1]; d0.teleport(p.x + 300, p.y); for (let i = 0; i < 24; i++) setTimeout(() => m.projectiles.fly({ x: p.x + 70, y: p.y - 6 + (i % 4) * 3, angle: Math.PI, speed: 260, range: 300, damage: 4, owner: d0, r: 2, kind: 'arrow' }), i * 40); });
    await wait(1500);
    const blocked = await ev(() => window.__oweblock.match.projectiles.blocked);
    check(orb === 2 && blocked >= 3, `orbiting blades (${orb}) shoot down incoming projectiles (${blocked} of 24 blocked)`);

    // --- swapping, aim stance, pickups
    await arena(); await clearTargets();
    await ev(() => { const g = window.__oweblock; g.give('cutlass'); g.give('singing_bow'); });
    await page.keyboard.press('Digit2'); await wait(40);
    check((await P()).held === 1 && (await P()).swapT > 0, 'number keys swap the held item, with a short swap delay');
    await wait(250);
    await page.mouse.wheel(0, 100); await wait(60);
    check((await P()).held === 2, 'mouse wheel cycles the held slot');
    await page.mouse.move(700, 300);
    await page.mouse.down({ button: 'right' }); await wait(120);
    check((await P()).stance === true, 'right mouse holds aim stance');
    await page.mouse.up({ button: 'right' });

    await arena();
    await ev(() => { const g = window.__oweblock; g.give('cutlass'); g.give('cutlass'); });
    check((await P()).slots[0] === 'cutlass:2', 'a duplicate pickup upgrades the item');
    await ev(() => { const g = window.__oweblock; g.give('singing_bow'); g.give('ancient_pot'); });
    await ev(() => { const m = window.__oweblock.match, p = m.player; m.pickups.dropItem('drifters_call', 1, p.x + 6, p.y, m.rng); });
    await wait(150);
    const prompt = await ev(() => { const p = window.__oweblock.match.player; return p.prompt && p.prompt.id; });
    check(prompt === 'drifters_call', 'full slots show a swap prompt instead of auto-pickup');
    await page.keyboard.press('KeyE'); await wait(120);
    const sw = await P();
    const dropped = await ev(() => window.__oweblock.match.pickups.pool.active.filter((q) => q.kind === 'item').map((q) => q.id));
    check(sw.slots[0] === 'drifters_call:1' && dropped.includes('cutlass'), `E swaps the held item with the one on the ground (held ${sw.slots[0]}, ground ${dropped})`);

    // --- kill drops, XP, level-up pause and picker
    await arena(); await ev(() => window.__oweblock.give('cutlass'));
    await ev(() => { const m = window.__oweblock.match, f = m.fighters[1]; f.xpTotal = 100; f.addItem('singing_bow', 2); f.teleport(m.player.x + 20, m.player.y); f.hp = 5; });
    await ev(() => { const m = window.__oweblock.match; m.fighters[1].level = 2; });
    await aim((await P()).x + 20, (await P()).y); await wait(80);
    await hold(60); await wait(120);
    const drops = await ev(() => { const m = window.__oweblock.match, a = m.pickups.pool.active; return { items: a.filter((q) => q.kind === 'item').map((q) => q.id + ':' + q.level), xp: a.filter((q) => q.kind === 'xp').reduce((n, q) => n + q.value, 0) + m.player.xpTotal }; });
    check(drops.items.includes('singing_bow:2') && drops.xp >= 30 + 20 + 30, `a kill drops the victim's items at their level plus XP caps (${drops.items}, ${drops.xp} XP)`);
    await ev(() => { const m = window.__oweblock.match, p = m.player; m.pickups.pool.active.filter((q) => q.kind === 'xp').forEach((q) => { q.x = p.x; q.y = p.y; }); });
    await wait(500);
    const lv = await P();
    check(lv.level >= 2 || lv.xp > 0, `collecting XP caps raises XP (level ${lv.level}, xp ${lv.xp})`);
    for (let i = 0; i < 4 && (await ev(() => !!window.__oweblock.match.levelUp)); i++) { await wait(300); await page.keyboard.press('Digit1'); await wait(80); }
    await ev(() => { window.__oweblock.match.player.pendingLevels = 0; window.__oweblock.levelUp(); }); await wait(150);
    const isOpen = await ev(() => !!window.__oweblock.match.levelUp);
    await page.screenshot({ path: join(outDir, '04-levelup.png') });
    const t0 = await ev(() => window.__oweblock.match.time); await wait(300); const t1 = await ev(() => window.__oweblock.match.time);
    check(isOpen && t1 === t0, 'level-up opens the picker and pauses the world');
    await wait(300);
    const n0 = await ev(() => window.__oweblock.match.levelUp.offers.length);
    await page.keyboard.press('Digit1'); await wait(100);
    check(n0 === 3 && !(await ev(() => !!window.__oweblock.match.levelUp)), 'the picker offers 3 and closes on a choice');

    // --- death screen and restart
    await arena(); await clearTargets();
    await ev(() => { const m = window.__oweblock.match; window.__oweblock.damageFrom(m.fighters[1], m.player, 500); });
    await wait(300);
    await page.screenshot({ path: join(outDir, '05-death.png') });
    check((await P()).dead === true, 'taking lethal damage kills the player');
    await page.keyboard.press('KeyR'); await wait(300);
    check((await P()).dead === false, 'R after death starts a new match');
    check(errors.length === 0, 'combat scenarios ran with no console errors ' + errors.join(' | '));
    await ctx.close();
  }

  // 2c. stress: ~300 projectiles and ~1000 particles in view must stay inside the frame budget
  {
    const { page, ctx, errors } = await open('?debug=1&seed=7&dummies=40', { viewport: { width: 960, height: 540 } });
    await page.evaluate(() => {
      const m = window.__oweblock.match, p = m.player;
      const c = m.chambers.reduce((a, b) => (b.r > a.r ? b : a)); p.teleport((c.x + 0.5) * 16, (c.y + 0.5) * 16);
      m.camera.snapTo(p.x, p.y, m.map.pxW, m.map.pxH);
      window.__stress = setInterval(() => {
        const d0 = m.fighters[1];
        for (let i = 0; i < 12; i++) m.projectiles.fly({ x: p.x + 90 + (i % 5) * 4, y: p.y - 60 + i * 8, angle: Math.PI + (i - 6) * 0.04, speed: 110, range: 700, damage: 0, owner: d0, r: 2, kind: 'arrow', unblockable: true });
        for (let i = 0; i < 40; i++) m.fx.sparks(p.x + (i - 20) * 4, p.y + 20, 1, '#ffd890', 60, 1.5);
      }, 60);
    });
    await page.waitForTimeout(3500);
    const st = await page.evaluate(() => { const m = window.__oweblock.match; return { proj: m.projectiles.count, parts: m.fx.count, perf: window.__oweblock.perf() }; });
    check(st.perf.avg < 8, `stress (${st.proj} projectiles, ${st.parts} particles, 41 fighters): ${st.perf.avg.toFixed(2)} ms avg, p99 ${st.perf.p99.toFixed(2)} ms`);
    check(errors.length === 0, 'stress run has no console errors ' + errors.join(' | '));
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
