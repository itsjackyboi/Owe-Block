import { angleDiff, clamp } from '../core/math.js';
import { damage } from './combat.js';

// Generic, parameterised item primitives. A weapon entry composes these; nothing here names a specific item.
// An action is { canUse?(c), press(c), hold?(c, dt), release?(c), cancel?(c) } where c is the shared context below.
// Actions with hold/release are "channelled": press sets f.busy and the driver keeps calling hold until the button is let go.

const DEG = Math.PI / 180;
const C = { f: null, inst: null, kind: 'primary', p: null, match: null };

function rangeMul(f) { return f.stance ? 1.15 : 1; }   // aim stance: +15% range
function spreadMul(f) { return f.stance ? 0.5 : 1; }   // aim stance: tighter spread

function startCd(c, mult = 1) {
  const cd = c.inst.cooldown(c.kind, c.f) * mult;
  c.inst.cd[c.kind] = cd;
  c.inst.cdMax[c.kind] = cd;
}

// Hits every fighter inside an arc in front of f. Returns the number hit.
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
    damage(match, t, dmg * mult, { source: f, kind: 'melee', kb: p.knockback, ang, itemId: c.inst.id, slamStun: p.slamStun, status: extra && extra.status });
    hits++;
  }
  return hits;
}

function lunge(f, amount) {
  if (!amount) return;
  f.kx += Math.cos(f.aim) * amount;
  f.ky += Math.sin(f.aim) * amount;
}

function swingFx(c, arc, reach, dur, dir) {
  const { f, p } = c;
  f.swing.t = dur; f.swing.dur = dur; f.swing.dir = dir; f.swing.arc = arc;
  c.match.fx.slash(f, f.aim, arc, reach + 2, dur, p.color || '#ffffff', dir);
}

export const ACTIONS = {
  // Sweeping arc in front of you.
  meleeArc: {
    press(c) {
      const { f, inst, p } = c;
      const reach = p.reach * rangeMul(f), arc = p.arc * DEG;
      const dir = (inst.state.dir = -(inst.state.dir || 1));
      swingFx(c, arc, reach, 0.14, dir);
      sweep(c, reach, arc, p.damage);
      lunge(f, p.lunge);
      startCd(c);
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
      sweep(c, reach, arc, p.damage);
      lunge(f, p.lunge);
      const full = p.combo && st.n >= p.combo;
      if (full) st.n = 0;
      startCd(c, full ? p.comboCd / p.cooldownBase : 1);
    },
  },

  // Fires one or more projectiles in a fan. Flags: pierce, bounce, returns (boomerang).
  projectile: {
    canUse(c) { return !(c.p.returns && c.inst.state.out); },
    press(c) {
      const { f, inst, p, match } = c;
      const n = p.count || 1, fan = (p.fan || 0) * DEG;
      for (let i = 0; i < n; i++) {
        const base = n > 1 ? (i / (n - 1) - 0.5) * fan : 0;
        const err = (p.spread || 0) * DEG * spreadMul(f) * match.rng.normal() * 0.5;
        const a = f.aim + base + err;
        match.projectiles.fly({
          x: f.x + Math.cos(a) * 8, y: f.y - 3 + Math.sin(a) * 8, angle: a, speed: p.speed, range: p.range * rangeMul(f), r: p.radius || 2,
          damage: p.damage, kb: p.knockback, pierce: p.pierce || 0, bounce: p.bounce || 0, returns: !!p.returns, catchCut: p.catchCut,
          curve: p.curve || 0, kind: p.kind, owner: f, inst, itemId: inst.id, status: p.status,
        });
      }
      if (p.returns) inst.state.out = true;
      f.recoil = 1;
      startCd(c);
    },
  },

  // Hold to draw, release to loose. Damage, speed and piercing scale with the draw.
  chargeRelease: {
    press(c) {
      const { f, inst, kind, p } = c;
      f.busy = { inst, kind, t: 0, full: false, frac: 0, ready: false, slow: p.slow || 1 };
    },
    hold(c, dt) {
      const b = c.f.busy, p = c.p;
      b.t += dt;
      b.frac = clamp((b.t - p.minCharge) / (p.maxCharge - p.minCharge), 0, 1);
      b.ready = b.t >= p.minCharge;
      if (!b.full && b.t >= p.maxCharge) { b.full = true; c.match.fx.sparks(c.f.x, c.f.y - 6, 5, '#ffffff', 50, 0.2); }
    },
    release(c) {
      const { f, inst, p, match } = c;
      const b = f.busy;
      f.busy = null;
      if (b.t < p.minCharge) return; // let go too early: no shot, no cooldown
      const frac = clamp((b.t - p.minCharge) / (p.maxCharge - p.minCharge), 0, 1);
      const err = (p.spread || 0) * DEG * spreadMul(f) * (1 - frac * 0.7) * match.rng.normal() * 0.5;
      const a = f.aim + err;
      match.projectiles.fly({
        x: f.x + Math.cos(a) * 8, y: f.y - 3 + Math.sin(a) * 8, angle: a,
        speed: p.minSpeed + (p.speed - p.minSpeed) * frac, range: p.range * rangeMul(f), r: p.radius || 2,
        damage: p.damage * (p.minDamageFrac + (1 - p.minDamageFrac) * frac), kb: p.knockback * (0.5 + 0.5 * frac),
        pierce: frac >= 1 ? p.pierceFull : 0, kind: p.kind, owner: f, inst, itemId: inst.id,
      });
      f.recoil = 1;
      startCd(c);
    },
    cancel(c) { c.f.busy = null; },
  },

  // Lobs something to the cursor that lands and leaves a ground area (fire pool, oil slick ...).
  throwArea: {
    press(c) {
      const { f, inst, p, match } = c;
      const maxR = p.range * rangeMul(f);
      const dx = f.tx - f.x, dy = f.ty - f.y, d = Math.hypot(dx, dy) || 1;
      const r = Math.min(maxR, d);
      let tx = f.x + (dx / d) * r, ty = f.y + (dy / d) * r;
      const free = match.map.lastOpenPoint(f.x, f.y, tx, ty); // lobs fly over cover but not over walls
      tx = free.x; ty = free.y;
      const area = Object.assign({}, p.area, { itemId: inst.id });
      match.projectiles.lob({ x: f.x, y: f.y - 4, tx, ty, speed: p.flightSpeed, owner: f, inst, itemId: inst.id, kind: 'pot', area });
      f.recoil = 1;
      startCd(c);
    },
  },

  // Blades circling you; hit what they touch and shoot down incoming projectiles.
  orbit: {
    canUse(c) { return !c.inst.state.orbit; },
    press(c) {
      const { f, inst, p, match } = c;
      const n = p.count || 1;
      for (let i = 0; i < n; i++) {
        const o = match.projectiles.orbit({ x: f.x, y: f.y, angle: (i / n) * Math.PI * 2, radius: p.radius, duration: p.duration, damage: p.damage, kb: p.knockback, blocks: p.blocks, owner: f, inst, itemId: inst.id, kind: 'blade' });
        if (o) inst.state.orbit = true;
      }
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

// ---- driver: runs every step for every fighter after movement ----

export function updateItemUse(f, match, dt) {
  if (f.dead) return;
  const it = f.intent;
  const inst = f.item;

  if (f.busy && (f.busy.inst !== inst || f.st.stun > 0 || f.swapT > 0 || f.dashing)) f.busy = null;
  const blocked = f.swapT > 0 || f.st.stun > 0;

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
      if (act.hold) act.hold(C, dt);
      if (!down) act.release(C);
      continue;
    }
    if (f.busy) continue;
    const auto = !act.hold && kind === 'primary'; // hold the button to keep swinging
    if ((pressed || (down && auto)) && inst.cd[kind] <= 0 && (!act.canUse || act.canUse(C))) act.press(C);
  }
}
