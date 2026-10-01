import { angleDiff, clamp } from '../core/math.js';
import { damage } from './combat.js';
import { applyStatus } from './statuses.js';
import { DASH } from '../config.js';

// Generic, parameterised item primitives. A weapon entry composes these; nothing here names a specific item.
// An action is { canUse?(c), press(c), hold?(c, dt), release?(c), keep?, cancel?(c) } where c is the shared context below.
//  - instant actions just implement press().
//  - channelled actions set f.busy in press() and are driven by hold(); `keep: true` means they last while the button is held
//    and release() fires them (bow draw, thunderclap). Without `keep` they run to completion; hold() returns true when finished.

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const C = { f: null, inst: null, kind: 'primary', p: null, match: null };

function rangeMul(f) { return f.stance ? 1.15 : 1; }   // aim stance: +15% range
function spreadMul(f) { return f.stance ? 0.5 : 1; }   // aim stance: tighter spread

function startCd(c, mult = 1) {
  const cd = c.inst.cooldown(c.kind, c.f) * mult;
  c.inst.cd[c.kind] = cd;
  c.inst.cdMax[c.kind] = cd;
}

// Hits every fighter inside an arc in front of f (and chips crystals). Returns the number hit.
function sweep(c, reach, arc, dmg, extra) {
  const { f, p, match } = c;
  const list = match.tmp;
  match.hash.query(f.x, f.y, reach, list);
  let hits = 0;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t === f || t.dead) continue;
    const dx = t.x - f.x, dy = t.y - f.y, d = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const half = arc / 2 + Math.atan2(t.r, Math.max(d, 1));
    if (Math.abs(angleDiff(f.aim, ang)) > half) continue;
    let mult = 1;
    if (p.backstab && Math.abs(angleDiff(t.aim, ang)) < 65 * DEG) mult = p.backstab;
    if (p.outerBonus && d > reach - (p.outerWidth || 10)) mult *= p.outerBonus; // sweet spot at the end of the chain
    damage(match, t, dmg * mult, { source: f, kind: 'melee', kb: (extra && extra.kb) || p.knockback, ang, itemId: c.inst.id, slamStun: (extra && extra.slamStun) || p.slamStun, status: extra && extra.status });
    hits++;
  }
  if (match.crystals.list.length) match.crystals.damageInArc(f, reach, arc, dmg);
  return hits;
}

function lunge(f, amount) {
  if (!amount) return;
  f.kx += Math.cos(f.aim) * amount;
  f.ky += Math.sin(f.aim) * amount;
}

function swingFx(c, arc, reach, dur, dir, color) {
  const { f, p } = c;
  f.swing.t = dur; f.swing.dur = dur; f.swing.dir = dir; f.swing.arc = arc;
  c.match.fx.slash(f, f.aim, arc, reach + 2, dur, color || p.color || '#ffffff', dir);
}

// One projectile from the item's params (speed, range, damage, pierce, bounce, hook, burst, trail ...).
function shoot(c, ang, extra) {
  const { f, inst, p, match } = c;
  const o = {
    x: f.x + Math.cos(ang) * 8, y: f.y - 3 + Math.sin(ang) * 8, angle: ang, speed: p.speed, range: p.range * rangeMul(f), r: p.radius || 2,
    damage: p.damage || 0, kb: p.knockback, pierce: p.pierce || 0, bounce: p.bounce || 0, returns: !!p.returns, catchCut: p.catchCut,
    curve: p.curve || 0, kind: p.kind, owner: f, inst, itemId: inst.id, status: p.status, hook: p.hook, pull: p.pull, burst: p.burst, trail: p.trail,
  };
  if (extra) Object.assign(o, extra);
  return match.projectiles.fly(o);
}

function cursorPoint(f, maxDist) {
  const dx = f.tx - f.x, dy = f.ty - f.y, d = Math.hypot(dx, dy) || 1;
  const r = Math.min(maxDist, d);
  return { x: f.x + (dx / d) * r, y: f.y + (dy / d) * r };
}

export const ACTIONS = {
  // Sweeping arc in front of you. Optional combo (n hits, the last wider/harder) and outer-end bonus.
  meleeArc: {
    press(c) {
      const { f, inst, p, match } = c;
      const reach = p.reach * rangeMul(f);
      let arc = p.arc * DEG, mult = 1, status = null, full = false;
      if (p.combo) {
        const st = inst.state;
        if (match.time - (st.last || -9) > 0.8) st.n = 0;
        st.n = (st.n || 0) + 1; st.last = match.time;
        if (st.n >= p.combo) { full = true; st.n = 0; arc = (p.finisherArc || p.arc) * DEG; mult = p.finisherMult || 1; status = p.finisherStatus || null; }
      }
      const dir = (inst.state.dir = -(inst.state.dir || 1));
      swingFx(c, arc, reach, full ? 0.18 : 0.14, dir, full && p.finisherColor);
      sweep(c, reach, arc, p.damage * mult, { status });
      lunge(f, p.lunge);
      match.sfx('swing', f.x, f.y);
      startCd(c, full && p.comboCd ? p.comboCd / p.cooldownBase : 1);
    },
  },

  // Narrow, quick jab. Optional combo (n quick hits, then a longer recovery) and backstab multiplier.
  thrust: {
    press(c) {
      const { f, inst, p, match } = c;
      const st = inst.state;
      if (match.time - (st.last || -9) > 0.7) st.n = 0;
      st.n = (st.n || 0) + 1; st.last = match.time;
      const reach = p.reach * rangeMul(f), arc = p.arc * DEG;
      swingFx(c, arc, reach, 0.1, st.n % 2 ? 1 : -1);
      sweep(c, reach, arc, p.damage, { status: p.status });
      lunge(f, p.lunge);
      match.sfx('swing', f.x, f.y);
      const full = p.combo && st.n >= p.combo;
      if (full) st.n = 0;
      startCd(c, full ? p.comboCd / p.cooldownBase : 1);
    },
  },

  // Short dash that ends in a strike (Shiv's Lunge, Krag's Cutter's Charge). A kill can reset the dash.
  dashStrike: {
    press(c) {
      const { f, inst, p, match } = c;
      let dx = f.intent.mx, dy = f.intent.my;
      if (!dx && !dy) { dx = Math.cos(f.aim); dy = Math.sin(f.aim); }
      const l = Math.hypot(dx, dy) || 1;
      f.dashDx = dx / l; f.dashDy = dy / l;
      f.dashT = (p.dist * rangeMul(f)) / DASH.speed;
      f.cancelBusy();
      f.strike = { inst, p, kind: c.kind };
      f.aim = Math.atan2(f.dashDy, f.dashDx); f.intent.aim = f.aim;
      match.fx.dust(f.x, f.y + 4, 5);
      match.sfx('dash', f.x, f.y);
      startCd(c);
    },
  },

  // Fires one or more projectiles in a fan. Flags: pierce, bounce, returns (boomerang), hook (pull / self), burst (net), trail (fire hoop).
  projectile: {
    canUse(c) { return !((c.p.returns || c.p.hook) && c.inst.state.out); },
    press(c) {
      const { f, inst, p, match } = c;
      const n = p.count || 1, fan = (p.fan || 0) * DEG;
      let range;
      if (p.toCursor) range = clamp(Math.hypot(f.tx - f.x, f.ty - f.y), 30, p.range * rangeMul(f)); // bursts at the cursor
      for (let i = 0; i < n; i++) {
        const base = n > 1 ? (i / (n - 1) - 0.5) * fan : 0;
        const err = (p.spread || 0) * DEG * spreadMul(f) * match.rng.normal() * 0.5;
        shoot(c, f.aim + base + err, range ? { range } : null);
      }
      if (p.returns || p.hook) inst.state.out = true;
      f.recoil = 1;
      match.sfx(p.hook ? 'hook' : (p.kind === 'arrow' || p.kind === 'bolt' ? 'shoot' : 'throw'), f.x, f.y);
      startCd(c);
    },
  },

  // Hold to draw, release to loose. Damage, speed and piercing scale with the draw.
  chargeRelease: {
    keep: true,
    press(c) {
      const { f, inst, kind, p } = c;
      f.busy = { inst, kind, t: 0, full: false, frac: 0, ready: false, slow: p.slow || 1 };
    },
    hold(c, dt) {
      const b = c.f.busy, p = c.p;
      b.t += dt;
      b.frac = clamp((b.t - p.minCharge) / (p.maxCharge - p.minCharge), 0, 1);
      b.ready = b.t >= p.minCharge;
      if (!b.full && b.t >= p.maxCharge) { b.full = true; c.match.fx.sparks(c.f.x, c.f.y - 6, 5, '#ffffff', 50, 0.2); c.match.sfx('ready', c.f.x, c.f.y); }
    },
    release(c) {
      const { f, p, match } = c;
      const b = f.busy;
      f.busy = null;
      if (b.t < p.minCharge) return; // let go too early: no shot, no cooldown
      const frac = clamp((b.t - p.minCharge) / (p.maxCharge - p.minCharge), 0, 1);
      const err = (p.spread || 0) * DEG * spreadMul(f) * (1 - frac * 0.7) * match.rng.normal() * 0.5;
      shoot(c, f.aim + err, {
        speed: p.minSpeed + (p.speed - p.minSpeed) * frac, damage: p.damage * (p.minDamageFrac + (1 - p.minDamageFrac) * frac),
        kb: p.knockback * (0.5 + 0.5 * frac), pierce: frac >= 1 ? p.pierceFull : 0,
      });
      f.recoil = 1;
      match.sfx('shoot', f.x, f.y);
      startCd(c);
    },
  },

  // Hold to charge, release for a shockwave around you (radius grows with the charge): damage, knockback and a slow.
  shockwave: {
    keep: true,
    press(c) { const { f, inst, kind, p } = c; f.busy = { inst, kind, t: 0, frac: 0, ready: false, full: false, slow: p.slow || 0.5 }; },
    hold(c, dt) {
      const b = c.f.busy, p = c.p;
      b.t += dt;
      b.frac = clamp((b.t - p.minCharge) / (p.maxCharge - p.minCharge), 0, 1);
      b.ready = b.t >= p.minCharge;
      if (!b.full && b.t >= p.maxCharge) { b.full = true; c.match.fx.dust(c.f.x, c.f.y + 4, 6); }
    },
    release(c) {
      const { f, inst, p, match } = c;
      const b = f.busy;
      f.busy = null;
      if (b.t < p.minCharge) return;
      const frac = clamp((b.t - p.minCharge) / (p.maxCharge - p.minCharge), 0, 1);
      const R = (p.radiusMin + (p.radiusMax - p.radiusMin) * frac) * rangeMul(f);
      const list = match.tmp;
      match.hash.query(f.x, f.y, R, list);
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (t === f || t.dead) continue;
        const ang = Math.atan2(t.y - f.y, t.x - f.x);
        damage(match, t, p.damage * (0.6 + 0.4 * frac), { source: f, kind: 'melee', kb: p.knockback * (0.6 + 0.4 * frac), ang, itemId: inst.id, slamStun: p.slamStun, status: { name: 'slow', dur: p.slowDur, power: p.slowPow } });
      }
      match.fx.ring(f.x, f.y + 3, R, '#e8d0a8');
      match.fx.dust(f.x, f.y + 3, 10);
      match.sfx('slam', f.x, f.y);
      if (f.isPlayer) match.camera.addTrauma(0.35);
      startCd(c);
    },
  },

  // 360 degree spin: hits everything around you on a fixed beat while you keep moving at reduced speed.
  spin: {
    press(c) { const { f, inst, kind, p } = c; f.busy = { inst, kind, t: 0, next: 0, slow: p.slow || 0.7 }; },
    hold(c, dt) {
      const { f, p, match } = c, b = f.busy;
      b.t += dt;
      if (b.t >= b.next) {
        b.next += p.interval;
        const reach = p.reach * rangeMul(f);
        f.swing.t = p.interval; f.swing.dur = p.interval; f.swing.arc = TAU; f.swing.dir = 1;
        match.fx.slash(f, f.aim + b.t * 6, 2.4, reach + 2, p.interval * 0.9, '#ffe0a0', 1);
        const save = f.aim;
        sweep(c, reach, TAU, p.damage, null);
        f.aim = save;
        match.sfx('swing', f.x, f.y);
      }
      if (b.t >= p.duration) { startCd(c); return true; }
      return false;
    },
  },

  // A rooted wind-up, then a rapid sequence of shots (Brace: 3 bolts, no reload; Zaar's Edges: three ricocheting knives).
  sequence: {
    press(c) {
      const { f, inst, kind, p } = c;
      if (p.windup) f.st.root = Math.max(f.st.root, p.windup);
      f.busy = { inst, kind, t: 0, shots: 0, slow: 1 };
    },
    hold(c, dt) {
      const { f, p, match } = c, b = f.busy;
      b.t += dt;
      while (b.shots < p.count && b.t >= (p.windup || 0) + b.shots * p.interval) {
        const err = (p.spread || 0) * DEG * spreadMul(f) * match.rng.normal() * 0.5 + (p.jitter ? (b.shots - (p.count - 1) / 2) * p.jitter * DEG : 0);
        shoot(c, f.aim + err, null);
        f.recoil = 1;
        match.sfx(p.kind === 'bolt' ? 'bolt' : 'throw', f.x, f.y);
        b.shots++;
      }
      if (b.shots >= p.count) { startCd(c); return true; }
      return false;
    },
  },

  // Lobs something to the cursor that lands and leaves a ground area (fire pool, oil slick, trap, tonic splash ...).
  throwArea: {
    press(c) {
      const { f, inst, p, match } = c;
      const maxR = p.range * rangeMul(f);
      const pt = cursorPoint(f, maxR);
      const free = match.map.lastOpenPoint(f.x, f.y, pt.x, pt.y); // lobs fly over cover but not over walls
      const area = Object.assign({}, p.area, { itemId: inst.id });
      match.projectiles.lob({ x: f.x, y: f.y - 4, tx: free.x, ty: free.y, speed: p.flightSpeed, owner: f, inst, itemId: inst.id, kind: p.kind || 'pot', area });
      if (inst.def.charges) inst.state.charges--;
      f.recoil = 1;
      match.sfx('throw', f.x, f.y);
      startCd(c);
    },
  },

  // Place a trap at the cursor (close to you). Up to `max` at once; the oldest goes when you place another.
  placeTrap: {
    press(c) {
      const { f, inst, p, match } = c;
      const pt = cursorPoint(f, p.range * rangeMul(f));
      if (!match.map.walkClear(f.x, f.y, pt.x, pt.y, 1)) return;
      match.areas.spawn('trap', pt.x, pt.y, 9, 60, f, Object.assign({}, p.area, { itemId: inst.id, armT: 0.4 }));
      match.sfx('click', pt.x, pt.y);
      startCd(c);
    },
  },

  // Channelled beam with a telegraph line: aim is locked in (with a slow turn), then the beam pierces walls and fighters.
  channelBeam: {
    press(c) {
      const { f, inst, kind, p, match } = c;
      const tele = match.telegraphs.add({ type: 'line', x: f.x, y: f.y - 3, ang: f.aim, len: p.length, dur: p.channel, owner: f, follow: true });
      f.busy = { inst, kind, t: 0, ang: f.aim, tele, slow: p.moveSlow || 0.35, onCancel: () => match.telegraphs.remove(tele) };
      match.sfx('charge', f.x, f.y);
    },
    hold(c, dt) {
      const { f, p, match } = c, b = f.busy;
      b.t += dt;
      b.ang += clamp(angleDiff(b.ang, f.aim), -p.turn * dt, p.turn * dt);
      b.tele.ang = b.ang;
      if (b.t < p.channel) return false;
      beamHit(match, f, f.x, f.y - 3, b.ang, p.length, p.width, p.damage, p.knockback, c.inst.id, null);
      match.fx.beam(f.x, f.y - 3, f.x + Math.cos(b.ang) * p.length, f.y - 3 + Math.sin(b.ang) * p.length, 0.28);
      match.sfx('beam', f.x, f.y);
      if (f.isPlayer) match.camera.addTrauma(0.45);
      match.telegraphs.remove(b.tele);
      startCd(c);
      return true;
    },
  },

  // A beam that sweeps across an arc after a wedge telegraph; each fighter is hit once.
  sweepBeam: {
    press(c) {
      const { f, inst, kind, p, match } = c;
      const tele = match.telegraphs.add({ type: 'arc', x: f.x, y: f.y - 3, ang: f.aim, arc: p.arc * DEG, len: p.length, dur: p.windup, owner: f, follow: true });
      f.busy = { inst, kind, t: 0, ang: f.aim, tele, hit: [], slow: p.moveSlow || 0.35, onCancel: () => match.telegraphs.remove(tele) };
      match.sfx('charge', f.x, f.y);
    },
    hold(c, dt) {
      const { f, p, match } = c, b = f.busy;
      b.t += dt;
      if (b.t < p.windup) { b.tele.ang = b.ang = f.aim; return false; }
      const u = clamp((b.t - p.windup) / p.sweep, 0, 1);
      const a = b.ang + (u - 0.5) * p.arc * DEG;
      beamHit(match, f, f.x, f.y - 3, a, p.length, p.width, p.damage, p.knockback, c.inst.id, b.hit);
      match.fx.beam(f.x, f.y - 3, f.x + Math.cos(a) * p.length, f.y - 3 + Math.sin(a) * p.length, 0.08);
      if (u >= 1) { match.telegraphs.remove(b.tele); match.sfx('beam', f.x, f.y); startCd(c); return true; }
      if (b.t - dt < p.windup) match.telegraphs.remove(b.tele);
      return false;
    },
  },

  // A ring telegraph at the cursor, then a lingering area (the dirge) appears there.
  delayedArea: {
    press(c) {
      const { f, inst, p, match } = c;
      const pt = cursorPoint(f, p.range * rangeMul(f));
      const free = match.map.lastOpenPoint(f.x, f.y, pt.x, pt.y);
      match.telegraphs.add({ type: 'ring', x: free.x, y: free.y, r: p.area.r, dur: p.delay, owner: f });
      const area = Object.assign({}, p.area, { itemId: inst.id });
      match.later(p.delay, () => { if (!match.over) match.areas.spawn(area.kind, free.x, free.y, area.r, area.life, f, area); match.sfx('dirge', free.x, free.y); });
      match.sfx('charge', f.x, f.y);
      startCd(c);
    },
  },

  // An area that follows you for a while (Last Rites).
  areaAura: {
    press(c) {
      const { f, inst, p, match } = c;
      match.areas.spawn(p.area.kind, f.x, f.y, p.area.r, p.duration, f, Object.assign({}, p.area, { itemId: inst.id, follow: f }));
      match.sfx('dirge', f.x, f.y);
      startCd(c);
    },
  },

  // A decoy at the cursor that draws AI aggro for a few seconds, then springs a small net.
  decoy: {
    press(c) {
      const { f, inst, p, match } = c;
      const pt = cursorPoint(f, p.range * rangeMul(f));
      const free = match.map.lastOpenPoint(f.x, f.y, pt.x, pt.y);
      match.areas.spawn('decoy', free.x, free.y, 10, p.duration, f, Object.assign({}, p.area, { itemId: inst.id }));
      match.sfx('click', free.x, free.y);
      startCd(c);
    },
  },

  // Gust: a cone that shoves fighters and turns projectiles back.
  gust: {
    press(c) {
      const { f, inst, p, match } = c;
      const reach = p.range * rangeMul(f), half = (p.arc * DEG) / 2;
      const list = match.tmp;
      match.hash.query(f.x, f.y, reach, list);
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (t === f || t.dead) continue;
        const ang = Math.atan2(t.y - f.y, t.x - f.x);
        if (Math.abs(angleDiff(f.aim, ang)) > half) continue;
        damage(match, t, p.damage, { source: f, kind: 'melee', kb: p.knockback, ang, itemId: inst.id });
        t.kx += Math.cos(ang) * p.knockback; t.ky += Math.sin(ang) * p.knockback;
      }
      const pr = match.projectiles.pool.active;
      for (let i = 0; i < pr.length; i++) {
        const q = pr[i];
        if (q.mode !== 0 || q.owner === f) continue;
        const dx = q.x - f.x, dy = q.y - f.y, d = Math.hypot(dx, dy);
        if (d > reach || Math.abs(angleDiff(f.aim, Math.atan2(dy, dx))) > half) continue;
        const sp = Math.hypot(q.vx, q.vy);
        q.vx = Math.cos(f.aim) * sp; q.vy = Math.sin(f.aim) * sp; q.owner = f; q.hits.length = 0; q.reflected = true;
      }
      match.fx.gust(f.x, f.y - 3, f.aim, reach, half);
      match.sfx('gust', f.x, f.y);
      startCd(c);
    },
  },

  // A timed buff on yourself.
  selfBuff: {
    press(c) {
      const { f, p, match } = c;
      applyStatus(f, p.status, p.duration, p.power || 0);
      match.fx.sparks(f.x, f.y, 8, '#ffffff', 80, 0.4);
      match.sfx('gust', f.x, f.y);
      startCd(c);
    },
  },

  // Drink: heal over time, then a slow. Uses a charge.
  consume: {
    canUse(c) { return c.inst.state.charges > 0; },
    press(c) {
      const { f, inst, p, match } = c;
      applyStatus(f, 'heal', p.healTime, p.heal / p.healTime);
      if (p.slowDur) applyStatus(f, 'slow', p.slowDur, p.slowPow);
      inst.state.charges--;
      match.fx.sparks(f.x, f.y - 4, 10, '#7ae0a0', 60, 0.6);
      match.sfx('drink', f.x, f.y);
      startCd(c);
    },
  },

  // Grow a crystal block at the cursor.
  spawnCover: {
    press(c) {
      const { f, p, match } = c;
      const pt = cursorPoint(f, p.range * rangeMul(f));
      if (!match.crystals.grow(f, pt.x, pt.y)) return;
      match.sfx('crystal', pt.x, pt.y);
      startCd(c);
    },
  },

  // Burst every crystal you own into slivers.
  shatter: {
    canUse(c) { return c.match.crystals.list.some((k) => k.owner === c.f); },
    press(c) {
      const { f, p, match } = c;
      if (match.crystals.shatter(f, p.damage) > 0) { match.sfx('shatter', f.x, f.y); startCd(c); }
    },
  },

  // Blades circling you; hit what they touch and shoot down incoming projectiles.
  orbit: {
    canUse(c) { return !c.inst.state.orbit; },
    press(c) {
      const { f, inst, p, match } = c;
      const n = p.count || 1;
      for (let i = 0; i < n; i++) {
        const o = match.projectiles.orbit({ x: f.x, y: f.y, angle: (i / n) * TAU, radius: p.radius, duration: p.duration, damage: p.damage, kb: p.knockback, blocks: p.blocks, owner: f, inst, itemId: inst.id, kind: 'blade' });
        if (o) inst.state.orbit = true;
      }
      match.sfx('orbit', f.x, f.y);
      startCd(c);
    },
  },

  // Short stance that reflects projectiles and answers a melee hit with a counter-slash and a stun.
  parry: {
    press(c) {
      const { f, inst, p } = c;
      f.parryT = p.duration; f.parryArc = p.arc * DEG; f.parryCounter = p.counterDamage || 0; f.parryStun = p.counterStun || 0; f.parryItem = inst.id;
      startCd(c);
    },
  },
};

// Damage everything within `width` of a segment (beams ignore walls). `hit` (array) makes each fighter hit once per sweep.
function beamHit(match, f, x, y, ang, len, width, dmg, kb, itemId, hit) {
  const c = Math.cos(ang), s = Math.sin(ang);
  for (let i = 0; i < match.fighters.length; i++) {
    const t = match.fighters[i];
    if (t === f || t.dead) continue;
    const dx = t.x - x, dy = t.y - y, along = dx * c + dy * s, across = -dx * s + dy * c;
    if (along < 0 || along > len || Math.abs(across) > width + t.r) continue;
    if (hit) { if (hit.indexOf(t.id) >= 0) continue; hit.push(t.id); }
    damage(match, t, dmg, { source: f, kind: 'projectile', kb, ang, itemId });
  }
}

// ---- dash-strike resolution ----

const SC = { f: null, inst: null, kind: 'primary', p: null, match: null };
function tickStrike(f, match) {
  const s = f.strike;
  let contact = false;
  if (f.dashing) { // stop early when we run into someone
    match.hash.query(f.x + Math.cos(f.aim) * 6, f.y + Math.sin(f.aim) * 6, 8, match.tmp);
    for (let i = 0; i < match.tmp.length; i++) if (match.tmp[i] !== f && !match.tmp[i].dead) { contact = true; break; }
    if (contact) { f.dashT = 0; f.vx *= 0.2; f.vy *= 0.2; }
  }
  if (f.dashing) return;
  f.strike = null;
  SC.f = f; SC.inst = s.inst; SC.kind = s.kind; SC.p = s.p; SC.match = match;
  const p = s.p;
  if (p.resetOnKill) f.lungeT = 0.5; // a kill from this strike resets the dash (see combat.kill)
  const hits = sweep(SC, p.reach, p.arc * DEG, p.damage, { status: p.status, kb: p.knockback, slamStun: p.slamStun });
  match.fx.slash(f, f.aim, p.arc * DEG, p.reach + 2, 0.12, p.color || '#ffd0d0', 1);
  if (hits) match.sfx('hit', f.x, f.y);
}

// ---- driver: runs every step for every fighter after movement ----

export function updateItemUse(f, match, dt) {
  if (f.dead) return;
  if (f.strike) tickStrike(f, match);
  const it = f.intent;
  const inst = f.item;

  if (f.busy && (f.busy.inst !== inst || f.st.stun > 0 || f.swapT > 0 || f.dashing)) f.cancelBusy();
  const blocked = f.swapT > 0 || f.st.stun > 0 || f.strike;

  for (let k = 0; k < 2; k++) {
    const kind = k === 0 ? 'primary' : 'special';
    const down = k === 0 ? it.use : it.special;
    const pressed = down && !f.prevDown[k];
    f.prevDown[k] = down;
    const def = inst.def[kind];
    if (!def || blocked) continue;
    const act = ACTIONS[def.action];
    C.f = f; C.inst = inst; C.kind = kind; C.p = inst.params(kind); C.p.cooldownBase = inst.cooldown(kind, f) || 1; C.match = match;

    if (f.busy && f.busy.kind === kind) {
      if (act.hold && act.hold(C, dt)) { f.busy = null; continue; }
      if (act.keep && !down) act.release(C);
      continue;
    }
    if (f.busy) continue;
    const auto = !act.keep && kind === 'primary' && !act.hold; // hold the button to keep swinging
    if ((pressed || (down && auto)) && inst.cd[kind] <= 0 && !(inst.def.charges && inst.state.charges <= 0) && (!act.canUse || act.canUse(C))) act.press(C);
  }
}
