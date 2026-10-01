import { damage } from './combat.js';

// Statuses are plain timers on fighter.st. Damage-over-time is credited to whoever applied it.
export function newStatusBag() {
  return { stun: 0, root: 0, slow: 0, slowPow: 0, burn: 0, burnDps: 0, burnSrc: null, bleed: 0, bleedDps: 0, bleedSrc: null, silence: 0, slippery: 0, tick: 0 };
}

// power: slow fraction (0..1) or dps for burn/bleed. Longer duration or stronger power wins.
export function applyStatus(f, name, dur, power = 0, src = null) {
  const st = f.st;
  if (f.dead || dur <= 0) return;
  switch (name) {
    case 'slow': st.slow = Math.max(st.slow, dur); st.slowPow = Math.max(st.slowPow, power); break;
    case 'burn': st.burn = Math.max(st.burn, dur); st.burnDps = Math.max(st.burnDps, power); st.burnSrc = src || st.burnSrc; break;
    case 'bleed': st.bleed = Math.max(st.bleed, dur); st.bleedDps = Math.max(st.bleedDps, power); st.bleedSrc = src || st.bleedSrc; break;
    default: st[name] = Math.max(st[name] || 0, dur);
  }
}

export function clearStatuses(f) {
  const st = f.st;
  st.stun = st.root = st.slow = st.slowPow = st.burn = st.bleed = st.silence = st.slippery = 0;
}

export function updateStatuses(f, dt, match) {
  const st = f.st;
  if (st.stun > 0) st.stun -= dt;
  if (st.root > 0) st.root -= dt;
  if (st.silence > 0) st.silence -= dt;
  if (st.slippery > 0) st.slippery -= dt;
  if (st.slow > 0) { st.slow -= dt; if (st.slow <= 0) st.slowPow = 0; }
  const dot = (st.burn > 0 ? st.burnDps : 0) + (st.bleed > 0 ? st.bleedDps : 0);
  if (st.burn > 0) { st.burn -= dt; if (st.burn <= 0) st.burnDps = 0; }
  if (st.bleed > 0) { st.bleed -= dt; if (st.bleed <= 0) st.bleedDps = 0; }
  if (dot > 0) {
    st.tick += dt;
    if (st.tick >= 0.25) {
      st.tick -= 0.25;
      const src = st.burn > 0 ? st.burnSrc : st.bleedSrc;
      damage(match, f, dot * 0.25, { source: src, kind: 'dot', quiet: true, noArmor: false });
    }
    if (st.burn > 0 && Math.random() < dt * 14) match.fx.flame(f.x + (Math.random() - 0.5) * 6, f.y - 2, 0.5);
  }
}

export const isStunned = (f) => f.st.stun > 0;
export const isRooted = (f) => f.st.root > 0 || f.st.stun > 0;
