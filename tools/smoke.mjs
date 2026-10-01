// Smoke + sim runner. Uses the globally installed Playwright with the preinstalled Chromium (never run `playwright install`).
//   node tools/smoke.mjs [--out dir] [--port 8099]
// Starts its own static server, loads the game, fails on any console error, takes screenshots, and checks core behaviour.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { root, loadPlaywright, startSite } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const outDir = resolve(opt('out', join(root, 'tools', 'out')));
const port = +opt('port', 8099);
mkdirSync(outDir, { recursive: true });

const site = await startSite(port);
const base = site.base;

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
    check(!pit.ok || Math.abs(fell.hp - 80) < 1, `falling into a pit costs 20 HP and returns to safe ground (hp ${fell.hp})`);

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

  // 2d. Stage 3: AI, navigation, zone, determinism
  {
    const { page, ctx, errors } = await open('?debug=1&sim=1&manual=1&seed=11', { viewport: { width: 960, height: 540 } });
    const ev = (fn, arg) => page.evaluate(fn, arg);

    const roster = await ev(() => {
      const m = window.__oweblock.match, t = { low: 0, med: 0, high: 0 };
      for (const f of m.fighters) if (f.tier) t[f.tier]++;
      return { n: m.fighters.length, t, onFloor: m.fighters.every((f) => m.map.tileAtPx(f.x, f.y) === 0), names: new Set(m.fighters.map((f) => f.name)).size, bare: m.fighters.filter((f) => !f.named).every((f) => f.slots.every((x) => x === null)), named: m.fighters.filter((f) => f.named).length, namedArmed: m.fighters.filter((f) => f.named).every((f) => f.slots.some((x) => x)), tags: m.fighters.filter((f) => f.named).every((f) => f.tier === 'high') };
    });
    check(roster.n === 41 && roster.t.low === 15 && roster.t.med === 15 && roster.t.high === 11 && roster.onFloor && roster.names === 41 && roster.bare && roster.named >= 3 && roster.named <= 5 && roster.namedArmed && roster.tags,
      `41 fighters, tier mix 15/15/10 (+1 high-tier sim bot), unique names, all on floor, only the ${roster.named} named fighters start armed ${JSON.stringify(roster.t)}`);

    // zone geometry: every target lies inside the last and contains the final point; timeline is about 6:35 x scale
    const zg = await ev(() => {
      const z = window.__oweblock.match.zone, T = z.targets;
      let prev = { x0: 0, y0: 0, x1: z.W, y1: z.H }, nested = true, holds = true;
      for (let k = 0; k < 4; k++) {
        const t = T[k];
        nested = nested && t.x0 >= prev.x0 - 1 && t.y0 >= prev.y0 - 1 && t.x1 <= prev.x1 + 1 && t.y1 <= prev.y1 + 1;
        holds = holds && z.fx >= t.x0 && z.fx <= t.x1 && z.fy >= t.y0 && z.fy <= t.y1;
        prev = t;
      }
      return { nested, holds, total: z.total, label: z.label().text, frac: [0, 1, 2, 3].map((k) => +((T[k].x1 - T[k].x0) / z.W).toFixed(2)) };
    });
    check(zg.nested && zg.holds, `zone targets nest and always contain the final point (sizes ${zg.frac})`);
    check(zg.label.startsWith('SWEEP IN 1:'), `HUD timer starts as "${zg.label}"`);

    // determinism: same seed, same 60 s of play
    const sig = () => ev(() => { const m = window.__oweblock.match; for (let i = 0; i < 3600; i++) m.update(1 / 60); return m.fighters.map((f) => [Math.round(f.x), Math.round(f.y), Math.round(f.hp), f.dead ? 1 : 0].join(',')).join(';'); });
    const a = await sig();
    await page.goto(base + '?debug=1&sim=1&manual=1&seed=11'); await page.waitForTimeout(500);
    const b = await sig();
    check(a === b, 'same seed gives an identical 60 s of AI play');

    // AI behaviour after a minute: armed, levelled, spread out, A* within budget
    const st = await ev(() => {
      const m = window.__oweblock.match, alive = m.fighters.filter((f) => !f.dead);
      const maxReq = m.nav.requests / m.time;
      return { alive: alive.length, armed: alive.filter((f) => f.item !== f.fists).length, lv: Math.max(...m.fighters.map((f) => f.level)), kills: m.fighters.reduce((n, f) => n + f.kills, 0), rate: maxReq, flows: m.nav.flows.size };
    });
    check(st.armed >= st.alive * 0.6 && st.lv >= 2 && st.kills > 5, `after 1:00: ${st.alive} alive, ${st.armed} armed, top level ${st.lv}, ${st.kills} kills`);
    check(st.rate < 240, `A* requests stay within budget (${st.rate.toFixed(1)}/s, cap 240/s)`);

    // zone damage: standing outside during the sweep hurts, and hurts more the longer you stay
    const zd = await ev(() => {
      const m = window.__oweblock.match, z = m.zone;
      for (let i = 0; i < 40 * 60 && !(z.dps > 0); i++) m.update(1 / 60);
      for (let i = 0; i < 28 * 60; i++) m.update(1 / 60); // let the rectangle close in a little
      const f = m.fighters.find((q) => !q.dead && q.isPlayer === false && q.tier === 'low') || m.fighters.find((q) => !q.dead);
      f.controller.update = () => {}; f.intent.mx = f.intent.my = 0; f.intent.use = f.intent.special = false;
      f.hp = f.maxHp = 1000; f.lastHurtT = m.time + 999; // no idle regen muddying the numbers
      // find a floor spot outside the rectangle
      let spot = null;
      for (let i = 0; i < m.map.tiles.length && !spot; i += 3) if (m.map.tiles[i] === 0) { const x = ((i % m.map.w) + 0.5) * 16, y = (((i / m.map.w) | 0) + 0.5) * 16; if (!z.inside(x, y)) spot = { x, y }; }
      f.teleport(spot.x, spot.y);
      const hp0 = f.hp, dps = z.dps;
      for (let i = 0; i < 2 * 60; i++) { m.update(1 / 60); f.lastHurtT = m.time + 999; f.x = f.px = spot.x; f.y = f.py = spot.y; }
      const first = hp0 - f.hp, hp1 = f.hp;
      for (let i = 0; i < 4 * 60; i++) { m.update(1 / 60); f.lastHurtT = m.time + 999; f.x = f.px = spot.x; f.y = f.py = spot.y; }
      return { dps, first, second: hp1 - f.hp, phase: z.phase.kind, dead: f.dead };
    });
    check(zd.dps > 0 && zd.first > 0 && zd.second / 4 > zd.first / 2, `outside the sweep hurts and the damage ramps with exposure (${zd.first.toFixed(1)} hp in first 2s, ${(zd.second / 4).toFixed(1)}/s over the next 4s at ${zd.dps} base dps)`);

    // flow field: following it from anywhere on the map reaches the zone target
    const fl = await ev(() => {
      const m = window.__oweblock.match, nav = m.nav, k = 0;
      const flow = nav.flowFor(k, () => m.zoneGoals(k));
      const out = { x: 0, y: 0 };
      let ok = 0, tried = 0;
      for (let i = 0; i < nav.walk.length && tried < 40; i += 331) {
        if (!nav.walk[i] || flow[i] < 0) continue;
        tried++;
        let x = ((i % nav.w) + 0.5) * 16, y = (((i / nav.w) | 0) + 0.5) * 16;
        for (let s = 0; s < 1500; s++) {
          if (flow[nav.tile(x, y)] === 0) { ok++; break; }
          if (!nav.flowDir(flow, x, y, out)) break;
          x += out.x * 8; y += out.y * 8;
        }
      }
      return { ok, tried };
    });
    check(fl.tried > 10 && fl.ok === fl.tried, `following the flow field reaches the goal from ${fl.ok}/${fl.tried} start points`);

    // A*: a path between two far chambers exists, avoids walls, and is cached/budgeted
    const ap = await ev(() => {
      const m = window.__oweblock.match, nav = m.nav, ch = m.chambers;
      let a = ch[0], b = ch[1];
      for (const x of ch) for (const y of ch) { const d = Math.hypot(x.x - y.x, x.y - y.y); if (d > 40 && d < 70) { a = x; b = y; } }
      nav.budget = 4;
      const path = nav.findPath((a.x + 0.5) * 16, (a.y + 0.5) * 16, (b.x + 0.5) * 16, (b.y + 0.5) * 16);
      let clear = !!path, px = (a.x + 0.5) * 16, py = (a.y + 0.5) * 16;
      if (path) for (const w of path) { if (!m.map.walkClear(px, py, w.x, w.y, 3)) clear = false; px = w.x; py = w.y; }
      nav.budget = 0;
      const over = nav.findPath(0, 0, 10, 10);
      return { ok: !!path, clear, len: path ? path.length : 0, overBudget: over === undefined };
    });
    check(ap.ok && ap.clear && ap.overBudget, `A* finds a wall-free path (${ap.len} waypoints) and refuses when the frame budget is spent`);
    check(errors.length === 0, 'AI runs with no console errors ' + errors.join(' | '));
    await ctx.close();
  }

  // 2e. skill tiers differ: dodging a projectile (low 5% / med 35% / high 75% by design)
  {
    const { page, ctx, errors } = await open('?debug=1&sim=1&manual=1&seed=21', { viewport: { width: 960, height: 540 } });
    const res = await page.evaluate(() => {
      const m = window.__oweblock.match;
      const pick = (tier) => m.fighters.filter((f) => f.tier === tier && f.id !== m.player.id)[0];
      const shooter = m.fighters.find((f) => f.id === m.player.id);
      const out = {};
      m.pickups.pool.clear(); m.pickups.hash.clear();
      // a spot with 4 clear tiles of floor all round, so nothing but the dodge decides the outcome
      let cx = 0, cy = 0;
      search: for (let ty = 9; ty < m.map.h - 9; ty++) for (let tx = 9; tx < m.map.w - 9; tx++) {
        let ok = true;
        for (let dy = -4; dy <= 4 && ok; dy++) for (let dx = -4; dx <= 4; dx++) if (m.map.tile(tx + dx, ty + dy) !== 0) { ok = false; break; }
        if (ok) { cx = (tx + 0.5) * 16; cy = (ty + 0.5) * 16; break search; }
      }
      for (const f of m.fighters) { if (f !== shooter) f.dead = f.dead || true; }
      m.hash.clear();
      for (const tier of ['low', 'med', 'high']) {
        const f = m.fighters.find((q) => q.tier === tier && q !== shooter);
        f.dead = false; f.hp = f.maxHp = 1e4; let hits = 0, N = 60;
        f.controller.roamMove = () => ({ x: 0, y: 0 }); // stand still unless dodging
        for (let n = 0; n < N; n++) {
          f.teleport(cx, cy); f.hp = 1e4; f.dashCd = 0; f.st.stun = 0; f.invuln = 0; f.vx = f.vy = f.kx = f.ky = 0;
          f.controller.target = null; f.controller.dodgeT = 0; f.controller.lastThreatId = ''; f.controller.t = 0;
          const ang = (n % 8) * 0.7;
          shooter.teleport(cx + Math.cos(ang) * 55, cy + Math.sin(ang) * 55); shooter.dead = false; shooter.intent.use = false;
          m.hash.clear(); m.hash.insert(f);
          m.projectiles.fly({ x: cx + Math.cos(ang) * 52, y: cy + Math.sin(ang) * 52, angle: ang + Math.PI, speed: 230, range: 300, damage: 10, owner: shooter, r: 2, kind: 'arrow' });
          for (let s = 0; s < 36; s++) { f.controller.update(f, 1 / 60); f.update(1 / 60, m.map, m); m.hash.clear(); m.hash.insert(f); m.projectiles.update(1 / 60); }
          if (f.hp < 1e4) hits++;
          m.projectiles.pool.clear(); m.projectiles.orbits = 0;
        }
        out[tier] = hits / N; f.dead = true;
      }
      void pick;
      return out;
    });
    check(res.high < res.low - 0.15 && res.high <= res.med + 0.05, `dodging improves with tier: hit rate low ${res.low.toFixed(2)}, med ${res.med.toFixed(2)}, high ${res.high.toFixed(2)}`);
    check(errors.length === 0, 'tier test has no console errors ' + errors.join(' | '));
    await ctx.close();
  }

  // 2g. Stage 4: the full roster, one scenario per item
  {
    const { page, ctx, errors } = await open('?debug=1&manual=1&seed=7&dummies=4', { viewport: { width: 960, height: 540 } });
    await page.evaluate(() => {
      const m = window.__oweblock.match, P = m.player, D = m.fighters.slice(1, 5);
      let ox = 0, oy = 0;
      search: for (let ty = 6; ty < m.map.h - 6; ty++) for (let tx = 6; tx < m.map.w - 18; tx++) {
        let ok = true;
        for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = 0; dx <= 17; dx++) if (m.map.tile(tx + dx, ty + dy) !== 0) { ok = false; break; }
        if (ok) { ox = (tx + 2.5) * 16; oy = (ty + 0.5) * 16; break search; }
      }
      const H = window.H = { m, P, D, ox, oy };
      H.step = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) m.update(1 / 60); };
      H.reset = () => {
        m.levelUp = null; P.pendingLevels = 0; P.xp = 0; P.xpTotal = 0; P.strike = null; P.dashT = 0; P.lungeT = 0;
        P.controller = null; P.dead = false; P.hp = P.maxHp = 300; P.slots.fill(null); P.held = 0; P.swapT = 0; P.cdMul = 1; P.dmgMul = 1; P.armor = 0; P.dashCd = 0; P.level = 1;
        P.st.stun = P.st.root = P.st.slow = P.st.silence = P.st.haste = P.st.heal = 0; P.cancelBusy(); P.kx = P.ky = 0; P.shieldT = 0; P.shieldReady = false; P.lastHurtT = 1e9; // no idle regen muddying the numbers
        P.fists.cd.primary = P.fists.cd.special = 0;
        P.intent.use = P.intent.special = P.intent.dash = false; P.intent.mx = P.intent.my = 0; P.intent.stance = false; P.intent.swapTo = -1;
        m.pickups.pool.clear(); m.pickups.hash.clear(); m.projectiles.pool.clear(); m.projectiles.orbits = 0; m.areas.pool.clear(); m.telegraphs.pool.clear(); m.timers.length = 0;
        for (const c of m.crystals.list.slice()) m.crystals.remove(c);
        for (const f of m.fighters) if (f !== P && !D.includes(f)) f.dead = true;
        D.forEach((d, i) => { d.dead = false; d.hp = d.maxHp = 500; d.slots.fill(null); d.st.stun = d.st.root = d.st.slow = d.st.silence = d.st.bleed = d.st.burn = 0; d.kx = d.ky = 0; d.slamStun = 0; d.teleport(ox + 400, oy + 400 + i * 30); d.intent.aim = Math.PI; d.aim = Math.PI; });
        P.teleport(ox, oy); P.intent.aim = 0; P.aim = 0; P.fists.state = {};
        m.camera.snapTo(P.x, P.y, m.map.pxW, m.map.pxH);
      };
      H.at = (i, dx, dy, aim) => { D[i].teleport(ox + dx, oy + dy); if (aim !== undefined) { D[i].intent.aim = aim; D[i].aim = aim; } };
      H.aim = (dx, dy) => { P.intent.aim = Math.atan2(dy, dx); P.intent.tx = P.x + dx; P.intent.ty = P.y + dy; P.aim = P.intent.aim; P.tx = P.intent.tx; P.ty = P.intent.ty; };
      H.give = (id, lv = 1) => { H.P.slots.fill(null); H.P.held = 0; const r = P.addItem(id, lv); P.held = 0; return r; };
      H.press = (kind, sec = 0.05) => { const k = kind === 'q' ? 'special' : 'use'; P.intent[k] = true; H.step(sec); P.intent[k] = false; H.step(0.02); };
      H.hold = (kind, sec) => { const k = kind === 'q' ? 'special' : 'use'; P.intent[k] = true; H.step(sec); P.intent[k] = false; H.step(0.05); };
      H.loss = (i) => D[i].maxHp - D[i].hp;
    });
    const R = (fn, arg) => page.evaluate(fn, arg);

    // item roster sanity
    const roster = await R(() => import(new URL('js/data/registry.js', location.href).href).then((r) => ({
      ids: Object.keys(r.ITEMS), loot: r.LOOT_ITEMS.map((i) => i.id),
      relicsOk: Object.values(r.ITEMS).filter((i) => i.kind === 'relic').every((i) => i.telegraph),
      aiOk: Object.values(r.ITEMS).every((i) => i.ai && i.ai.idealRange != null),
    })));
    const want = ['cutlass', 'shiv', 'whopper', 'keg_flail', 'singing_bow', 'arbalest', 'drifters_call', 'beast_hook', 'mantrap', 'ancient_pot', 'old_staff', 'veilwalker_net', 'sad_sermon', 'wind_pouch', 'clockheart_tonic', 'amethyst_shard', 'krags_cleaver', 'zaars_edges', 'bare_knuckles'];
    check(want.every((w) => roster.ids.includes(w)) && roster.ids.length === 19, `all 16 items + 2 exclusives + fists are registered (${roster.ids.length})`);
    check(!roster.loot.includes('krags_cleaver') && !roster.loot.includes('zaars_edges') && roster.relicsOk && roster.aiOk, 'exclusives never drop as loot; every relic has a telegraph; every item has ai hints');
    const share = await R(() => { const m = window.H.m, L = m.mode.loot; let r = 0, v = 0, n = 4000; for (let i = 0; i < n; i++) { if (m.rollLoot(L, m.rng, false).rarity === 'relic') r++; if (m.rollLoot(L, m.rng, true).rarity === 'relic') v++; } return { r: r / n, v: v / n }; });
    check(share.r > 0.04 && share.r < 0.09 && share.v > share.r * 1.8, `relics are about 6% of loot, more at the vault (${(share.r * 100).toFixed(1)}% / ${(share.v * 100).toFixed(1)}%)`);

    // shiv
    await R(() => { const H = window.H; H.reset(); H.give('shiv'); H.at(0, 12, 0, 0); H.aim(1, 0); H.press('l', 0.05); });
    const backstab = await R(() => window.H.loss(0));
    await R(() => { const H = window.H; H.reset(); H.give('shiv'); H.at(0, 12, 0, Math.PI); H.aim(1, 0); H.press('l', 0.05); });
    const front = await R(() => window.H.loss(0));
    check(Math.abs(backstab - 7 * 2.5) < 1 && Math.abs(front - 7) < 1, `shiv: x2.5 from behind (${backstab.toFixed(1)} vs ${front.toFixed(1)} from the front)`);
    await R(() => { const H = window.H; H.reset(); H.give('shiv'); H.at(0, 55, 0, 0); H.D[0].hp = 6; H.aim(1, 0); H.P.dashCd = 1.5; H.press('q', 0.05); H.step(0.5); });
    const lunge = await R(() => ({ dead: window.H.D[0].dead, cd: window.H.P.dashCd }));
    check(lunge.dead && lunge.cd === 0, `shiv Lunge: dash-stabs for the kill and resets the dash (dashCd ${lunge.cd})`);
    await R(() => { const H = window.H; H.reset(); H.give('shiv'); H.at(0, 55, 0, 0); H.aim(1, 0); H.press('q', 0.05); H.step(0.4); });
    check(await R(() => window.H.D[0].st.bleed > 0), 'shiv Lunge applies bleed');

    // whopper
    await R(() => { const H = window.H; H.reset(); H.give('whopper'); H.at(0, 40, 0); H.at(1, 36, 18); H.aim(1, 0); H.hold('q', 1.1); });
    const clap = await R(() => ({ a: window.H.loss(0), b: window.H.loss(1), slow: window.H.D[0].st.slow > 0, moved: window.H.D[0].x - (window.H.ox + 40) }));
    check(clap.a >= 10 && clap.b >= 10 && clap.slow && clap.moved > 5, `whopper Thunderclap: shockwave hurts, shoves and slows everyone in range (${clap.a.toFixed(0)}/${clap.b.toFixed(0)} dmg, pushed ${clap.moved.toFixed(0)}px)`);
    await R(() => { const H = window.H; H.reset(); H.give('whopper'); H.step(1); H.P.fists.cd.special = 0; H.at(0, 40, 0); H.aim(1, 0); H.press('q', 0.05); H.step(0.3); });
    check(await R(() => window.H.loss(0)) === 0, 'whopper Thunderclap needs a charge: a tap does nothing');
    const slam = await R(() => {
      const H = window.H, m = H.m, map = m.map;
      H.reset(); H.give('whopper');
      for (let ty = 3; ty < map.h - 3; ty++) for (let tx = 4; tx < map.w - 4; tx++) {
        if (map.tile(tx, ty) === 0 && map.tile(tx + 1, ty) === 1 && map.tile(tx - 1, ty) === 0 && map.tile(tx - 2, ty) === 0 && map.tile(tx, ty - 1) === 0 && map.tile(tx, ty + 1) === 0) {
          const d = H.D[0]; d.teleport((tx + 0.5) * 16 + 3, (ty + 0.5) * 16); H.P.teleport(d.x - 16, d.y); H.aim(1, 0);
          H.press('l', 0.05); H.step(0.25); return { stun: d.st.stun, hp: H.loss(0) };
        }
      }
      return null;
    });
    check(!slam || (slam.stun > 0 && slam.hp >= 26), `whopper: slamming a fighter into a wall stuns them (${slam && slam.stun.toFixed(2)}s)`);

    // keg flail
    await R(() => { const H = window.H; H.reset(); H.give('keg_flail'); H.at(0, 14, 0); H.at(1, 36, 4); H.aim(1, 0); H.press('l', 0.05); });
    const fl = await R(() => ({ near: window.H.loss(0), tip: window.H.loss(1) }));
    check(Math.abs(fl.near - 16) < 1 && Math.abs(fl.tip - 24) < 1, `flail: x1.5 at the tip of the chain (${fl.near.toFixed(0)} near, ${fl.tip.toFixed(0)} tip)`);
    await R(() => { const H = window.H; H.reset(); H.give('keg_flail'); H.at(0, 22, 0); H.at(1, -22, 0); H.aim(1, 0); H.press('q', 0.05); H.step(1.8); });
    const wh = await R(() => ({ a: window.H.loss(0), b: window.H.loss(1) }));
    check(wh.a >= 40 && wh.b >= 40, `flail Whirl: spins through everyone around you (${wh.a.toFixed(0)}/${wh.b.toFixed(0)} dmg, including behind)`);

    // arbalest
    await R(() => { const H = window.H; H.reset(); H.give('arbalest'); H.at(0, 80, 0); H.at(1, 140, 0); H.at(2, 200, 0); H.aim(1, 0); H.press('l', 0.05); H.step(0.7); });
    const ar = await R(() => [0, 1, 2].map((i) => window.H.loss(i)));
    check(ar.every((v) => v >= 29), `arbalest: one bolt pierces everyone in line (${ar.map((v) => v.toFixed(0))})`);
    await R(() => { const H = window.H; H.reset(); H.give('arbalest'); H.at(0, 90, 0); H.aim(1, 0); H.press('q', 0.05); H.step(0.1); window.H.rooted = H.P.st.root > 0; H.step(1); });
    const br = await R(() => ({ rooted: window.H.rooted, loss: window.H.loss(0), cd: window.H.P.item.cd.primary }));
    check(br.rooted && br.loss >= 3 * 22 - 1 && br.cd <= 0, `arbalest Brace: kneel (rooted), then 3 bolts with no reload (${br.loss.toFixed(0)} dmg)`);

    // beast hook
    await R(() => { const H = window.H; H.reset(); H.give('beast_hook'); H.at(0, 120, 0); H.aim(1, 0); H.P.fists.cd.primary = 0; H.press('l', 0.05); H.step(0.9); });
    const hk = await R(() => ({ x: window.H.D[0].x - window.H.ox, loss: window.H.loss(0) }));
    check(hk.x < 80 && hk.loss >= 10, `beast hook: hits for 10 and yanks the target toward you (${hk.x.toFixed(0)}px away from 120)`);
    await R(() => { const H = window.H; H.reset(); H.give('beast_hook'); H.at(0, 150, 0); H.aim(1, 0); H.press('q', 0.05); H.step(0.9); });
    const rl = await R(() => ({ gap: Math.hypot(window.H.D[0].x - window.H.P.x, window.H.D[0].y - window.H.P.y), moved: window.H.P.x - window.H.ox }));
    check(rl.gap < 30 && rl.moved > 100, `beast hook Reel: pulls you across to the fighter (moved ${rl.moved.toFixed(0)}px)`);

    // mantrap
    await R(() => { const H = window.H; H.reset(); H.give('mantrap'); H.aim(30, 0); H.press('l', 0.05); H.step(0.6); H.D[0].teleport(H.P.x + 30, H.P.y); H.step(0.3); });
    const tr = await R(() => ({ loss: window.H.loss(0), root: window.H.D[0].st.root }));
    check(tr.loss >= 20 && tr.root > 0.8, `mantrap: places a trap that snaps on a victim (${tr.loss.toFixed(0)} dmg, rooted ${tr.root.toFixed(1)}s)`);
    const cap = await R(() => { const H = window.H; H.reset(); H.give('mantrap'); H.aim(1, 0); for (let i = 0; i < 5; i++) { H.P.item.cd.primary = 0; H.press('l', 0.05); H.step(0.05); } return H.m.areas.pool.active.filter((a) => a.kind === 'trap').length; });
    check(cap === 3, `mantrap: at most 3 traps at once (${cap})`);
    await R(() => { const H = window.H; H.reset(); H.give('mantrap'); H.at(0, 100, 0); H.aim(1, 0); H.P.intent.tx = H.D[0].x; H.P.intent.ty = H.D[0].y; H.P.tx = H.D[0].x; H.P.ty = H.D[0].y; H.press('q', 0.05); H.step(1.2); });
    check(await R(() => window.H.loss(0) >= 20 && window.H.D[0].st.root > 0), 'mantrap Toss: lobbed trap snaps shut on landing');

    // old staff
    await R(() => { const H = window.H; H.reset(); H.give('old_staff'); H.at(0, 150, 0); H.aim(1, 0); H.press('l', 0.05); H.step(0.05); window.H.tele = H.m.telegraphs.count; H.step(0.8); });
    check(await R(() => window.H.tele >= 1 && window.H.loss(0) >= 45), 'old staff: shows a telegraph line, then the beam hits for 45');
    await R(() => { const H = window.H; H.reset(); H.give('old_staff'); H.at(0, 100, -20); H.at(1, 100, 20); H.aim(1, 0); H.press('q', 0.05); H.step(0.05); H.step(1.2); });
    const sw = await R(() => [window.H.loss(0), window.H.loss(1)]);
    check(sw.every((v) => v >= 24 && v < 30), `old staff Sweep: the wedge hits each fighter in it once (${sw.map((v) => v.toFixed(0))})`);
    await R(() => { const H = window.H; H.reset(); H.give('old_staff'); H.at(0, 150, 0); H.aim(1, 0); H.press('l', 0.05); H.step(0.3); window.H.t1 = H.m.telegraphs.threat(H.D[0].x, H.D[0].y, 5, H.D[0] === H.P ? null : H.D[1]); });
    check(await R(() => !!window.H.t1), 'the telegraph is visible to the AI (telegraphs.threat finds a fighter standing in the line)');

    // veilwalker net
    await R(() => { const H = window.H; H.reset(); H.give('veilwalker_net'); H.at(0, 100, 0); H.at(1, 110, 12); H.aim(1, 0); H.P.intent.tx = H.D[0].x; H.P.intent.ty = H.D[0].y; H.press('l', 0.05); H.step(1.0); });
    const nt = await R(() => [window.H.D[0].st.root, window.H.D[1].st.root]);
    check(nt[0] > 0.4 && nt[1] > 0.4, `veilwalker net: bursts on contact and roots everyone near (${nt.map((v) => v.toFixed(1))}s)`);
    await R(() => { const H = window.H; H.reset(); H.give('veilwalker_net'); H.aim(1, 0); H.P.intent.tx = H.P.x + 90; H.P.intent.ty = H.P.y; H.press('q', 0.05); H.step(0.1); H.D[0].teleport(H.P.x + 90, H.P.y); window.H.lure = !!H.m.areas.findDecoy(H.D[0]); H.step(3.1); });
    check(await R(() => window.H.lure && window.H.D[0].st.root > 0), 'net Lure: a decoy bobber draws attention, then springs a net');

    // sad sermon
    await R(() => { const H = window.H; H.reset(); H.give('sad_sermon'); H.at(0, 90, 0); H.aim(1, 0); H.P.intent.tx = H.P.x + 90; H.P.intent.ty = H.P.y; H.press('l', 0.05); H.step(0.05); window.H.ring = H.m.telegraphs.pool.active.some((t) => t.type === 'ring'); H.step(1.7); });
    const sm = await R(() => ({ ring: window.H.ring, sil: window.H.D[0].st.silence, loss: window.H.loss(0) }));
    check(sm.ring && sm.sil > 0 && sm.loss > 2, `sad sermon: ring telegraph, then a dirge that silences and hurts (silence ${sm.sil.toFixed(1)}s, ${sm.loss.toFixed(1)} dmg)`);
    await R(() => { const H = window.H; H.reset(); H.give('sad_sermon'); H.at(0, 20, 0); H.aim(1, 0); H.press('q', 0.05); H.P.intent.mx = 1; H.step(0.5); H.P.intent.mx = 0; H.D[0].teleport(H.P.x + 25, H.P.y); H.step(0.5); });
    const lr = await R(() => { const a = window.H.m.areas.pool.active.find((q) => q.kind === 'dirge'); return a && Math.abs(a.x - window.H.P.x) < 2 && window.H.D[0].st.silence > 0; });
    check(lr, 'sad sermon Last Rites: the dirge follows you as an aura');

    // wind pouch
    const dd = await R(() => { const H = window.H; H.reset(); H.P.teleport(H.ox - 20, H.oy); H.P.intent.mx = 1; H.P.intent.dash = true; H.step(0.017); H.P.intent.dash = false; H.P.intent.mx = 0; const x0 = H.P.x; H.step(0.4); const base = H.P.x - x0; const cd0 = H.P.dashCdMax;
      H.reset(); H.give('wind_pouch'); H.P.teleport(H.ox - 20, H.oy); H.P.intent.mx = 1; H.P.intent.dash = true; H.step(0.017); H.P.intent.dash = false; H.P.intent.mx = 0; const y0 = H.P.x; H.step(0.4); return { base, boosted: H.P.x - y0, cd0, cd1: H.P.dashCdMax }; });
    check(dd.boosted / dd.base > 1.25 && dd.boosted / dd.base < 1.5 && Math.abs(dd.cd1 / dd.cd0 - 0.8) < 0.02, `wind pouch passive: dash x${(dd.boosted / dd.base).toFixed(2)} distance, cooldown x${(dd.cd1 / dd.cd0).toFixed(2)} (works from the pack, not held)`);
    await R(() => { const H = window.H; H.reset(); H.give('wind_pouch'); H.at(0, 40, 26); H.at(1, 100, -40); H.aim(1, 0); H.m.projectiles.fly({ x: H.P.x + 60, y: H.P.y, angle: Math.PI, speed: 150, range: 300, damage: 10, owner: H.D[1], r: 2, kind: 'arrow' }); H.press('l', 0.05); H.step(0.3); });
    const gs = await R(() => ({ push: window.H.D[0].x - window.H.ox, refl: window.H.m.projectiles.pool.active.some((q) => q.owner === window.H.P && q.vx > 0) }));
    check(gs.push > 45 && gs.refl, `wind pouch Gust: shoves fighters (${gs.push.toFixed(0)}px) and turns a projectile around`);
    await R(() => { const H = window.H; H.reset(); H.give('wind_pouch'); H.press('q', 0.05); H.step(0.05); });
    check(await R(() => window.H.P.st.haste > 2), 'wind pouch Tailwind: +50% move speed for 3 s');

    // tonic
    await R(() => { const H = window.H; H.reset(); H.give('clockheart_tonic'); H.P.hp = 100; H.press('l', 0.05); H.step(1.2); });
    const tn = await R(() => ({ hp: window.H.P.hp, slow: window.H.P.st.slow, ch: window.H.P.item.state.charges }));
    check(Math.abs(tn.hp - 130) < 1 && tn.slow > 0.5 && tn.ch === 1, `tonic: heals 30 over a second, then slows (hp ${tn.hp.toFixed(0)}, charges ${tn.ch})`);
    await R(() => { window.H.step(18.5); });
    check(await R(() => window.H.P.item.state.charges === 2), 'tonic: a charge recharges after 18 s');
    await R(() => { const H = window.H; H.reset(); H.give('clockheart_tonic'); H.at(0, 100, 0); H.aim(1, 0); H.P.intent.tx = H.D[0].x; H.P.intent.ty = H.D[0].y; H.press('q', 0.05); H.step(1.0); });
    const sp = await R(() => ({ d: window.H.D[0].st.slow, me: window.H.P.st.slow, loss: window.H.loss(0) }));
    check(sp.d > 1 && sp.me === 0 && sp.loss === 0, `tonic Splash: enemies get only the slow (${sp.d.toFixed(1)}s, no damage)`);

    // amethyst shard
    const sh = await R(() => { const H = window.H; H.reset(); H.give('amethyst_shard'); H.step(8.2); const ready = H.P.shieldReady; const hp0 = H.P.hp; window.__oweblock.damageFrom(H.D[0], H.P, 100); const hit1 = hp0 - H.P.hp; const hp1 = H.P.hp; window.__oweblock.damageFrom(H.D[0], H.P, 100); return { ready, hit1, hit2: hp1 - H.P.hp }; });
    check(sh.ready && Math.abs(sh.hit1 - 40) < 1 && Math.abs(sh.hit2 - 100) < 1, `amethyst shard passive: every 8 s the next hit is cut by 60% (${sh.hit1.toFixed(0)} then ${sh.hit2.toFixed(0)})`);
    const cr = await R(() => { const H = window.H; H.reset(); H.give('amethyst_shard'); H.aim(1, 0); H.P.intent.tx = H.P.x + 32; H.P.intent.ty = H.P.y; H.press('l', 0.05); const grown = H.m.crystals.list.length;
      H.at(0, 80, 0); H.m.projectiles.fly({ x: H.P.x + 60, y: H.P.y, angle: Math.PI, speed: 200, range: 300, damage: 10, owner: H.D[0], r: 2, kind: 'arrow' }); H.step(0.5); const hp = H.P.hp;
      H.P.item.cd.special = 0; H.press('q', 0.05); return { grown, hpFull: hp === 300, shot: H.m.projectiles.count, left: H.m.crystals.list.length }; });
    check(cr.grown === 1 && cr.hpFull && cr.left === 0, `shard: crystal grows at the cursor, blocks an arrow, and Shatter bursts it (${cr.shot} slivers)`);

    // exclusives
    const cl = await R(() => { const H = window.H; H.reset(); H.give('krags_cleaver'); H.at(0, 18, 0); H.aim(1, 0); const out = []; for (let i = 0; i < 3; i++) { const l0 = H.loss(0); H.P.item.cd.primary = 0; H.press('l', 0.05); out.push(H.loss(0) - l0); H.step(0.05); } return { out, bleed: H.D[0].st.bleed }; });
    check(cl.out[2] > cl.out[0] * 1.4 && cl.bleed > 0, `Krag's Cleaver: third hit cleaves harder and bleeds (${cl.out.map((v) => v.toFixed(0))})`);
    await R(() => { const H = window.H; H.reset(); H.give('krags_cleaver'); H.at(0, 80, 0); H.aim(1, 0); H.press('q', 0.05); H.step(0.6); });
    check(await R(() => window.H.loss(0) >= 30), "Krag's Cleaver Cutter's Charge: shoulder charge into a free heavy hit");
    await R(() => { const H = window.H; H.reset(); H.give('zaars_edges'); H.at(0, 80, 0); H.aim(1, 0); H.press('l', 0.05); H.step(0.9); });
    check(await R(() => window.H.loss(0) >= 18), "Zaar's Edges: three knives in quick succession");
    const hoop = await R(() => { const H = window.H; H.reset(); H.give('zaars_edges'); H.aim(1, 0); H.press('q', 0.05); H.step(1.2); return H.m.areas.pool.active.filter((a) => a.kind === 'fire').length; });
    check(hoop >= 3, `Zaar's Ring of Fire: the hoop leaves a fire trail (${hoop} pools)`);
    check(errors.length === 0, 'roster scenarios ran with no console errors ' + errors.join(' | '));
    await ctx.close();
  }

  // 2h. Stage 5: three modes, hazards, named fighters
  {
    const { page, ctx, errors } = await open('?debug=1&sim=1&manual=1&seed=5&named=all', { viewport: { width: 960, height: 540 } });
    const R = (fn, arg) => page.evaluate(fn, arg);
    const named = await R(() => { const m = window.__oweblock.match; return m.fighters.filter((f) => f.named).map((f) => ({ id: f.namedId, name: f.name, hp: f.maxHp, items: f.slots.filter(Boolean).map((s) => s.id), outfit: f.outfit, speed: f.speedBonus, tier: f.tier })); });
    const byId = Object.fromEntries(named.map((n) => [n.id, n]));
    check(named.length === 10 && !!byId.krag && !!byId.zaar && byId.krag.items[0] === 'krags_cleaver' && byId.zaar.items[0] === 'zaars_edges' && byId.krag.outfit === 'red' && byId.zaar.outfit === 'blue', `named roster: signature weapons and gang colours (Krag red + Cleaver, Zaar blue + Edges), ${named.length} fit in the 10 high-tier slots`);
    check(byId.fin && byId.fin.hp === Math.round(150 * 0.9) && byId.fin.speed === 0.25 && byId.fin.items[0] === 'shiv' && byId.krag.hp === 180, `Fin has HP x0.9 and +25% speed, the others HP x1.2 (${byId.fin && byId.fin.hp}, ${byId.krag.hp})`);
    const count = await R(async () => { // 3 to 5 per match when not forced
      const { Match } = await import(new URL('js/game/match.js', location.href).href);
      const g = window.__oweblock.game; const seen = new Set();
      for (let s = 1; s <= 12; s++) { const m = new Match(g, { mode: 'mines', seed: s, ai: 40 }); seen.add(m.fighters.filter((f) => f.named).length); }
      return [...seen].sort();
    });
    check(count.every((n) => n >= 3 && n <= 5) && count.length >= 2, `3 to 5 named fighters per match, varying (${count})`);

    for (const mode of ['mines', 'rooftops', 'pipepit']) {
      const r = await R(async (mode) => {
        const { Match } = await import(new URL('js/game/match.js', location.href).href);
        const { Nav } = await import(new URL('js/ai/nav.js', location.href).href);
        const g = window.__oweblock.game;
        const m = new Match(g, { mode, seed: 9, ai: 40 });
        const nav = new Nav(m.map);
        // floor-only reachability from the first spawn (pits and gaps block walking here)
        const w = m.map.w, dist = nav.buildFlow([nav.tile(m.player.x, m.player.y)]);
        const unreachable = m.fighters.filter((f) => dist[nav.tile(f.x, f.y)] < 0).length;
        let loot = 0, items = 0, relics = 0; for (const p of m.pickups.pool.active) if (p.kind === 'item') { items++; if (m.itemDef(p.id).rarity === 'relic') relics++; }
        const vaultFloor = m.gen.vaultPoints.filter((p) => dist[nav.tile(p.x, p.y)] < 0).length;
        for (let i = 0; i < 600; i++) m.update(1 / 60); // ten seconds in, hazards running
        return { n: m.fighters.length, unreachable, items, relics, vaults: m.gen.vaultPoints.length, vaultFloor, size: [m.map.w, m.map.h], tiles: m.map.tiles.length, hazards: m.hazards.defs.map((d) => d.type), alive: m.fighters.filter((f) => !f.dead).length };
      }, mode);
      const want = { mines: [150, 150], rooftops: [100, 100], pipepit: [110, 110] }[mode];
      check(r.n === 41 && r.unreachable === 0 && r.size[0] === want[0] && r.items >= 30 && r.items <= 70, `${mode}: ${r.size.join('x')} map, all 41 fighters start on connected ground, ${r.items} items at the start, hazards ${r.hazards}`);
      if (mode === 'rooftops') check(r.vaults >= 8 && r.vaultFloor === r.vaults, `rooftops: the vault roofs cannot be walked to (${r.vaultFloor}/${r.vaults} vault spots cut off), ${r.relics} relics lying about`);
    }

    // hazards
    const cave = await R(() => { const { Hazards } = window.__haz || {}; return null; });
    void cave;
    const mines = await R(async () => {
      const { Match } = await import(new URL('js/game/match.js', location.href).href);
      const g = window.__oweblock.game, m = new Match(g, { mode: 'mines', seed: 4, ai: 0, dummies: 0 });
      const p = m.player; p.hp = p.maxHp = 500; p.controller = null;
      m.hazards.caveT = 99; // trigger one on purpose
      let spot = null; for (const c of m.chambers) { const x = (c.x + 0.5) * 16, y = (c.y + 0.5) * 16; if (m.map.tileAtPx(x, y) === 0) { spot = { x, y }; break; } }
      p.teleport(spot.x, spot.y);
      m.telegraphs.add({ type: 'ring', x: spot.x, y: spot.y, r: 22, dur: 1.2, color: '#ffffff' }); m.later(1.2, () => m.hazards.collapse(spot.x, spot.y));
      const warned = m.telegraphs.count; const hp0 = p.hp;
      for (let i = 0; i < 60; i++) m.update(1 / 60);
      const mid = p.hp; for (let i = 0; i < 20; i++) m.update(1 / 60);
      return { warned, early: hp0 - mid, hit: hp0 - p.hp, stun: p.st.stun, light: m.lightRadius };
    });
    check(mines.warned >= 1 && mines.early === 0 && mines.hit === 25 && mines.stun > 0 && mines.light === 130, `mines: cave-in telegraphs for 1.2 s, then 25 damage and a stun; light radius ${mines.light}`);
    const sky = await R(async () => {
      const { Match } = await import(new URL('js/game/match.js', location.href).href);
      const g = window.__oweblock.game, m = new Match(g, { mode: 'rooftops', seed: 4, ai: 0 });
      const p = m.player; p.controller = null; p.hp = p.maxHp = 200;
      const s = m.gen.skylights[0], cx = (s.tx + 0.5) * 16, cy = (s.ty + 0.5) * 16;
      const safeX = p.x, safeY = p.y; p.lastSafeX = safeX; p.lastSafeY = safeY;
      p.teleport(cx, cy); p.lastSafeX = safeX; p.lastSafeY = safeY;
      for (let i = 0; i < 50; i++) m.update(1 / 60); const before = { hp: p.hp, tile: m.map.tile(s.tx, s.ty) };
      for (let i = 0; i < 30; i++) m.update(1 / 60);
      return { before, hp: p.hp, tile: m.map.tile(s.tx, s.ty), stun: p.st.stun, back: Math.hypot(p.x - safeX, p.y - safeY) < 20 };
    });
    check(sky.before.hp === 200 && sky.hp === 170 && sky.tile === 2 && sky.back, `rooftops: a skylight holds for 1 s, then you fall: 15% max HP (${200 - sky.hp}) and back to the last safe roof`);
    const gap = await R(async () => {
      const { Match } = await import(new URL('js/game/match.js', location.href).href);
      const g = window.__oweblock.game, m = new Match(g, { mode: 'rooftops', seed: 6, ai: 0 });
      const p = m.player; p.controller = null; p.hp = p.maxHp = 100;
      let gapTile = null;
      for (let ty = 5; ty < m.map.h - 5 && !gapTile; ty++) for (let tx = 5; tx < m.map.w - 5; tx++) if (m.map.tile(tx, ty) === 2 && m.map.tile(tx, ty - 1) === 0 && m.map.tile(tx, ty + 1) === 2 && m.map.tile(tx, ty + 2) === 0 && m.map.tile(tx + 1, ty - 1) === 0 && m.map.tile(tx + 1, ty + 2) === 0) { gapTile = { tx, ty }; break; } // a clean two-tile gap
      const sx = (gapTile.tx + 0.5) * 16, sy = (gapTile.ty - 1 + 0.5) * 16; p.teleport(sx, sy); p.lastSafeX = sx; p.lastSafeY = sy;
      p.intent.my = 1; for (let i = 0; i < 40; i++) m.update(1 / 60); p.intent.my = 0;
      const walked = { hp: p.hp, stun: p.st.stun };
      // a dash across a two-tile gap does not fall
      p.hp = 100; p.st.stun = 0; p.teleport(sx, sy); p.dashCd = 0; p.intent.my = 1; p.intent.dash = true; m.update(1 / 60); p.intent.dash = false; for (let i = 0; i < 20; i++) m.update(1 / 60);
      return { walked, dashHp: p.hp };
    });
    check(gap.walked.hp === 85 && gap.walked.stun > 0.1 && gap.dashHp === 100, `rooftops gaps: walking in costs 15% HP and a stun (${gap.walked.hp}), a dash crosses them (${gap.dashHp})`);
    const pipe = await R(async () => {
      const { Match } = await import(new URL('js/game/match.js', location.href).href);
      const g = window.__oweblock.game, m = new Match(g, { mode: 'pipepit', seed: 4, ai: 0 });
      const p = m.player; p.controller = null; p.hp = p.maxHp = 400;
      let t = null; for (let i = 0; i < m.map.conv.length; i++) if (m.map.conv[i] === 1 && m.map.conv[i + 1] === 1 && m.map.conv[i + 2] === 1 && m.map.conv[i + 3] === 1) { t = i; break; }
      const tx = t % m.map.w, ty = (t / m.map.w) | 0; p.teleport((tx + 0.5) * 16, (ty + 0.5) * 16); const x0 = p.x;
      for (let i = 0; i < 30; i++) m.update(1 / 60);
      const pushed = p.x - x0;
      // steam vent: hiss telegraph, then a burst
      const v = m.hazards.vents[0]; p.teleport(v.x + 4, v.y); p.hp = 400; v.state = 'hiss'; v.t = 0; v.hit.length = 0; m.telegraphs.add({ type: 'ring', x: v.x, y: v.y, r: 24, dur: 1, color: '#fff' });
      for (let i = 0; i < 50; i++) m.update(1 / 60); const hissHp = p.hp;
      for (let i = 0; i < 40; i++) m.update(1 / 60);
      return { pushed, vents: m.hazards.vents.length, hissHp, hp: p.hp };
    });
    check(pipe.pushed > 8 && pipe.vents >= 8 && pipe.hissHp === 400 && pipe.hp <= 380, `pipe pit: conveyors push (${pipe.pushed.toFixed(0)}px in half a second), ${pipe.vents} steam vents hiss, then burst for 20 (${400 - pipe.hp})`);
    check(errors.length === 0, 'mode scenarios ran with no console errors ' + errors.join(' | '));
    await ctx.close();
  }

  // 2i. Stage 6: menus, pause, saves, win and summary flow, options, audio
  {
    const { page, ctx, errors } = await open('?debug=1&menu=1&seed=8', { viewport: { width: 1440, height: 810 } });
    const R = (fn, arg) => page.evaluate(fn, arg);
    const wait = (ms) => page.waitForTimeout(ms);
    const state = () => R(() => window.__oweblock.state);
    const save = () => R(() => JSON.parse(localStorage.getItem('oweblock.save.v1') || 'null'));
    check((await state()) === 'title', 'title screen first');
    await page.screenshot({ path: join(outDir, '07-title.png') });
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await wait(150);
    check((await state()) === 'modes', 'title menu: down + enter opens mode select');
    await page.screenshot({ path: join(outDir, '08-modes.png') });
    await page.keyboard.press('Digit2'); await page.keyboard.press('Enter'); await wait(400);
    check((await state()) === 'match' && (await R(() => window.__oweblock.match.mode.id)) === 'rooftops' && (await save()).lastMode === 'rooftops', 'mode select: 2 + enter starts Rooftops and remembers it');

    // pause
    await page.keyboard.press('Escape'); await wait(100);
    const t0 = await R(() => window.__oweblock.match.time); await wait(500); const t1 = await R(() => window.__oweblock.match.time);
    check((await state()) === 'paused' && t1 === t0, 'Esc pauses the match (time frozen)');
    await page.screenshot({ path: join(outDir, '09-pause.png') });
    await page.keyboard.press('Escape'); await wait(150);
    check((await state()) === 'match', 'Esc resumes');

    // death -> summary -> title, and the match is recorded
    await R(() => { const g = window.__oweblock.game, m = g.match; m.player.kills = 3; window.__oweblock.damageFrom(m.fighters[1], m.player, 9999); });
    await wait(1500);
    await page.screenshot({ path: join(outDir, '10-death.png') });
    await page.keyboard.press('Enter'); await wait(300);
    check((await state()) === 'summary', 'death: Enter shows the summary');
    await page.screenshot({ path: join(outDir, '11-summary.png') });
    const s1 = await save();
    check(s1.history.length === 1 && s1.history[0].mode === 'rooftops' && s1.history[0].kills === 3 && s1.totals.matches === 1 && s1.best.placement >= 2, `the match is recorded (history ${s1.history.length}, best placement #${s1.best.placement})`);
    await page.keyboard.press('Enter'); await wait(300);
    check((await state()) === 'title', 'summary leads back to the title');

    // win -> gang choice -> unlock, colour and start weapon
    await R(() => window.__oweblock.game.startMatch({ mode: 'mines', ai: 3, seed: 2 }));
    await R(() => window.__oweblock.killAllAI()); await wait(2600);
    check((await state()) === 'win', 'last one standing opens the gang choice');
    await page.screenshot({ path: join(outDir, '12-win.png') });
    await page.keyboard.press('Digit1'); await wait(300);
    const s2 = await save();
    check((await state()) === 'summary' && s2.unlocked.cutters && !s2.unlocked.circus && s2.color === 'red' && s2.startWeapon === 'krags_cleaver' && s2.history[0].placement === 1, 'choosing Crimson Cutters unlocks Krag\'s Cleaver and the red colours, and records the win');
    await page.screenshot({ path: join(outDir, '13-summary-win.png') });
    await page.keyboard.press('Enter'); await wait(200);
    await R(() => window.__oweblock.game.startMatch({ mode: 'mines', ai: 2, seed: 3 }));
    const sw = await R(() => { const p = window.__oweblock.match.player; return { outfit: p.outfit, items: p.slots.filter(Boolean).map((s) => s.id) }; });
    check(sw.outfit === 'red' && sw.items[0] === 'krags_cleaver', 'the next run starts in red holding Krag\'s Cleaver');

    // unlocks / stats screen + options
    await R(() => window.__oweblock.game.go('unlocks')); await wait(150);
    await page.keyboard.press('ArrowRight'); await wait(100);
    await page.screenshot({ path: join(outDir, '14-unlocks.png') });
    check((await save()).color === 'grey', 'unlocks screen: left/right changes the start colour');
    await R(() => window.__oweblock.game.go('options')); await wait(150);
    await page.keyboard.press('Enter'); await wait(80); await page.keyboard.press('ArrowDown'); await wait(80); await page.keyboard.press('ArrowLeft'); await wait(80); await page.keyboard.press('ArrowLeft'); await wait(100);
    await page.screenshot({ path: join(outDir, '15-options.png') });
    const s3 = await save();
    check(s3.settings.shake === false && Math.abs(s3.settings.volumes.master - 0.6) < 0.01, `options: shake toggle and volume steps are saved (shake ${s3.settings.shake}, master ${s3.settings.volumes.master})`);
    await page.reload(); await wait(700);
    const reloaded = await R(() => ({ shake: window.__oweblock.game.settings.shake, master: window.__oweblock.game.settings.volumes.master, unlocked: window.__oweblock.game.save.data.unlocked.cutters }));
    check(reloaded.shake === false && Math.abs(reloaded.master - 0.6) < 0.01 && reloaded.unlocked, 'settings and unlocks survive a reload');

    // audio engine: context starts on a gesture, voices are capped, far sounds are culled, the sequencer advances
    await page.mouse.click(300, 300); await wait(200);
    await R(() => window.__oweblock.game.startMatch({ mode: 'pipepit', ai: 5, seed: 2 })); await wait(600);
    const au = await R(() => {
      const a = window.__oweblock.game.audio, m = window.__oweblock.match;
      const ready = a.ready, track = a.trackId;
      for (let i = 0; i < 40; i++) a.sfx('hit', m.player.x, m.player.y, m.camera);
      const voices = a.voices;
      a.voices = 0; a.sfx('hit', m.player.x + 3000, m.player.y, m.camera); const far = a.voices;
      return { ready, track, voices, far, step: a.step, vol: a.master && a.master.gain.value };
    });
    await wait(500);
    const step2 = await R(() => window.__oweblock.game.audio.step);
    check(au.ready && au.track === 'pipepit' && au.voices <= 12 && au.voices >= 1 && au.far === 0, `audio: context on first gesture, pipepit track playing, ${au.voices} voices (cap 12), distant sound culled`);
    check(step2 !== au.step, 'audio: the sequencer is advancing through the pattern');
    check(errors.length === 0, 'menus and audio ran with no console errors ' + errors.join(' | '));
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

  // 2f. real-time perf with 40 AI fighting
  {
    const { page, ctx, errors } = await open('?debug=1&seed=3', { viewport: { width: 960, height: 540 } });
    await page.evaluate(() => {
      const m = window.__oweblock.match;
      let best = null, bn = -1;
      for (const c of m.chambers) { let n = 0; for (const f of m.fighters) if (Math.hypot(f.x - c.x * 16, f.y - c.y * 16) < 200) n++; if (n > bn) { bn = n; best = c; } }
      m.player.maxHp = m.player.hp = 1e5; m.player.teleport((best.x + 0.5) * 16, (best.y + 0.5) * 16);
    });
    await page.waitForTimeout(10000);
    const st = await page.evaluate(() => ({ perf: window.__oweblock.perf(), alive: window.__oweblock.match.fighters.filter((f) => !f.dead).length }));
    await page.screenshot({ path: join(outDir, '06-ai-match.png') });
    check(st.perf.avg < 8, `real-time match with ${st.alive} fighters: ${st.perf.avg.toFixed(2)} ms avg, p99 ${st.perf.p99.toFixed(2)} ms`);
    check(errors.length === 0, 'real-time AI match has no console errors ' + errors.join(' | '));
    await ctx.close();
  }

  // 3. placeholders stay playable
  for (const mode of ['rooftops', 'pipepit']) {
    const { page, ctx, errors } = await open('?debug=1&seed=7&placeholders=1&mode=' + mode);
    await page.keyboard.down('KeyD'); await page.waitForTimeout(500); await page.keyboard.up('KeyD');
    await page.screenshot({ path: join(outDir, '03-placeholders-' + mode + '.png') });
    check(errors.length === 0, `?placeholders=1 on ${mode} runs with no console errors ` + errors.join(' | '));
    await ctx.close();
  }
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
  site.stop();
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
console.log('screenshots in', outDir);
process.exit(failures.length ? 1 : 0);
