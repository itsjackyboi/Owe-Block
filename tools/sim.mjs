// Headless AI simulation runner.
//   node tools/sim.mjs [--seeds 10] [--first 1] [--port 8098] [--frames]
// Runs full 41-fighter matches (the "player" is a high-tier bot) by stepping the match without rendering,
// and reports match length, population over time, who won (by tier) and navigation load.
// With --frames it also plays a normal-speed match in real time and reports frame times (update + render).
import { startSite, loadPlaywright } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const seeds = +opt('seeds', 10), first = +opt('first', 1), port = +opt('port', 8098);
const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

const site = await startSite(port);
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const rows = [];
try {
  for (let seed = first; seed < first + seeds; seed++) {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${site.base}?debug=1&sim=1&manual=1&seed=${seed}`);
    await page.waitForTimeout(600);
    const t0 = Date.now();
    let result = null;
    const marks = {};
    for (let i = 0; i < 60 && !result; i++) { // 60 x 20 s of game time is the hard cap
      result = await page.evaluate(() => window.__oweblock.fastForward(20));
    }
    const wall = Date.now() - t0;
    rows.push({ seed, result, wall, errors });
    const r = result;
    console.log(`seed ${String(seed).padStart(2)}  ${r ? fmt(r.duration) : 'TIMEOUT'}  alive/min [${r ? r.aliveLog.join(' ') : '-'}]  winner ${r && r.winner ? r.winner.name + ' (' + r.winner.tier + ', ' + r.winner.kills + ' kills)' : 'none'}  A* ${r ? r.requests : '-'}  sim ${wall} ms${errors.length ? '  ERRORS: ' + errors.join(' | ') : ''}`);
    await page.close();
    void marks;
  }

  const done = rows.filter((x) => x.result);
  const durs = done.map((x) => x.result.duration).sort((a, b) => a - b);
  const avg = durs.reduce((n, d) => n + d, 0) / (durs.length || 1);
  console.log(`\nmatch length: min ${fmt(durs[0] || 0)}  avg ${fmt(avg)}  max ${fmt(durs[durs.length - 1] || 0)}   (target 6:00-8:00)`);
  const inTarget = durs.filter((d) => d >= 360 && d <= 480).length;
  console.log(`${inTarget}/${durs.length} matches inside 6:00-8:00`);

  const tiers = {};
  for (const x of done) for (const [k, v] of Object.entries(x.result.byTier)) {
    const t = tiers[k] || (tiers[k] = { n: 0, survive: 0, kills: 0, wins: 0 });
    t.n += v.n; t.survive += v.survive * v.n; t.kills += v.kills; t.wins += v.wins;
  }
  console.log('by tier (all matches):');
  for (const [k, t] of Object.entries(tiers)) console.log(`  ${k.padEnd(5)} fighters ${t.n}  avg survival ${fmt(t.survive / t.n)}  kills/fighter ${(t.kills / t.n).toFixed(2)}  wins ${t.wins}`);

  if (args.includes('--frames')) {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    await page.goto(`${site.base}?debug=1&seed=3`);
    await page.waitForTimeout(500);
    // a real-time match at normal speed: put the camera in the thick of it and measure
    await page.evaluate(() => {
      const m = window.__oweblock.match;
      let best = null, bn = -1;
      for (const c of m.chambers) { let n = 0; for (const f of m.fighters) if (Math.hypot(f.x - c.x * 16, f.y - c.y * 16) < 200) n++; if (n > bn) { bn = n; best = c; } }
      m.player.teleport((best.x + 0.5) * 16, (best.y + 0.5) * 16);
    });
    await page.waitForTimeout(12000);
    const perf = await page.evaluate(() => ({ perf: window.__oweblock.perf(), alive: window.__oweblock.match.fighters.filter((f) => !f.dead).length, proj: window.__oweblock.match.projectiles.count, parts: window.__oweblock.match.fx.count }));
    console.log(`\nnormal speed, ${perf.alive} fighters alive: ${perf.perf.avg.toFixed(2)} ms avg update+render, p99 ${perf.perf.p99.toFixed(2)} ms (budget 8 ms avg)`);
    await page.close();
  }
} finally {
  await browser.close();
  site.stop();
}
