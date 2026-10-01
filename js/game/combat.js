import { clamp, angleDiff } from '../core/math.js';
import { applyStatus } from './statuses.js';
import { xpFromKill } from './levelup.js';

// Everything that changes a fighter's health goes through damage(). Feel (flash, shake, hit-stop, knockback) lives here.
// o: { source, kind:'melee'|'projectile'|'area'|'dot'|'fall'|'counter', kb, ang, itemId, slamStun, status:{name,dur,power}, quiet }
export function damage(match, t, amount, o = {}) {
  if (t.dead || amount <= 0) return 0;
  if (t.invuln > 0 && o.kind !== 'fall') return 0;
  const src = o.source || null;

  // riposte: a melee hit into the front arc of a parrying fighter is negated and answered
  if (t.parryT > 0 && o.kind === 'melee' && src && src !== t) {
    const a = Math.atan2(src.y - t.y, src.x - t.x);
    if (Math.abs(angleDiff(t.aim, a)) <= t.parryArc / 2) {
      parried(match, t, src, a);
      return 0;
    }
  }

  if (src) amount *= src.dmgMul;
  amount *= 1 - t.armor;
  if (t.shieldReady && o.kind !== 'fall') { amount *= 0.4; t.shieldReady = false; }
  t.hp -= amount;
  t.lastHurtT = match.time;
  t.hurtShownAt = performance.now() / 1000;
  t.lastAttacker = src;
  t.lastItem = o.itemId || null;
  t.lastKind = o.kind || null;
  if (src && src !== t && (o.kind === 'melee' || o.kind === 'projectile' || o.kind === 'counter')) match.noteFight(t.x, t.y);
  if (src && src !== t) src.damageDealt += amount;
  t.damageTaken += amount;

  const quiet = !!o.quiet;
  if (!quiet) {
    t.hitFlash = 0.08;
    t.squash = Math.min(1, 0.4 + amount / 40);
    const ang = o.ang != null ? o.ang : (src ? Math.atan2(t.y - src.y, t.x - src.x) : 0);
    if (o.kb) knock(t, ang, o.kb, o.slamStun || 0);
    const involved = t.isPlayer || (src && src.isPlayer);
    match.fx.hitSparks(t.x, t.y, ang, amount, t.isPlayer);
    match.sfx('hit', t.x, t.y);
    if (involved) {
      match.fx.popup(t.x, t.y - 12, String(Math.max(1, Math.round(amount))), t.isPlayer ? '#ff6a5a' : '#ffffff');
      match.game.loop.stopFor(clamp(0.035 + amount * 0.0012, 0.04, 0.07));
      match.camera.addTrauma(t.isPlayer ? clamp(0.12 + amount / 80, 0.15, 0.5) : clamp(0.05 + amount / 160, 0.06, 0.25));
    }
  }
  if (o.status && t.hp > 0) applyStatus(t, o.status.name, o.status.dur, o.status.power || 0, src);

  if (t.hp <= 0) { t.hp = 0; kill(match, t, src, o.itemId); }
  return amount;
}

export function heal(f, n) { f.hp = Math.min(f.maxHp, f.hp + n); }

// Velocity impulse that decays with friction (see Fighter.update). slamStun: stun if this shoves them into a wall.
export function knock(t, ang, force, slamStun = 0) {
  t.kx += Math.cos(ang) * force;
  t.ky += Math.sin(ang) * force;
  if (slamStun > t.slamStun) t.slamStun = slamStun;
}

function parried(match, t, src, ang) {
  t.parryT = 0;
  match.fx.sparks(t.x + Math.cos(ang) * 8, t.y + Math.sin(ang) * 8, 10, '#ffffff', 90);
  match.fx.popup(t.x, t.y - 14, 'RIPOSTE', '#9ad0ff');
  match.sfx('parry', t.x, t.y);
  if (t.isPlayer || src.isPlayer) { match.game.loop.stopFor(0.07); match.camera.addTrauma(0.3); }
  if (t.parryCounter > 0) {
    damage(match, src, t.parryCounter, { source: t, kind: 'counter', kb: 170, ang: Math.atan2(src.y - t.y, src.x - t.x), itemId: t.parryItem });
    applyStatus(src, 'stun', t.parryStun, 0, t);
    match.fx.slash(t, Math.atan2(src.y - t.y, src.x - t.x), 2.2, 24, 0.14, '#9ad0ff', 1);
  }
}

// Removes the victim, drops their gear and XP, credits the killer.
export function kill(match, v, killer, itemId) {
  if (v.dead) return;
  v.dead = true;
  v.killedBy = killer || null;
  v.killedByItem = itemId || null;
  v.surviveTime = match.time;
  v.deathKind = v.lastKind;
  v.cancelBusy();
  const k = killer && killer !== v ? killer : null;
  if (k) { k.kills++; if (k.lungeT > 0) { k.dashCd = 0; k.lungeT = 0; k.hitFlash = 0; match.fx.popup(k.x, k.y - 14, 'DASH READY', '#9ad0ff'); } }
  match.onKill(v, k, itemId);

  if (v.isPlayer) v.finalBuild = v.slots.filter(Boolean).map((s) => ({ id: s.id, level: s.level })); // for the summary screen
  match.sfx('kill', v.x, v.y);
  const px = v.x, py = v.y;
  match.fx.deathBurst(px, py, v.outfit);
  // gear drops at current levels
  for (let i = 0; i < v.slots.length; i++) {
    const inst = v.slots[i];
    if (inst) { match.pickups.dropItem(inst.id, inst.level, px, py, match.rng); v.slots[i] = null; }
  }
  // XP caps: 30 + 10 x level + 30% of banked XP, in a few piles
  const total = xpFromKill(v);
  const n = clamp(Math.round(total / 14), 3, 9);
  let left = total;
  for (let i = 0; i < n; i++) {
    const v = i === n - 1 ? left : Math.round(total / n); // last pile takes the rounding remainder
    left -= v;
    match.pickups.dropXp(Math.max(1, v), px, py, match.rng);
  }
}
