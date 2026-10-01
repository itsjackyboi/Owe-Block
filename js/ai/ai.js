import { RNG } from '../core/rng.js';
import { clamp } from '../core/math.js';
import { TIERS } from '../data/tiers.js';
import { ITEMS } from '../data/registry.js';
import { ACTIONS } from '../game/actions.js';

// AIController: produces exactly the intents the player produces (move, aim, use, special, dash, swap, pickup).
// Perception -> utility-scored state -> steering. Skill comes entirely from the tier table in js/data/tiers.js.
const STATES = { LOOT: 'LOOT', ENGAGE: 'ENGAGE', RETREAT: 'RETREAT', ZONE: 'ZONE', THIRD: 'THIRD', ROAM: 'ROAM' };
const RARITY_VALUE = { common: 0.5, uncommon: 0.65, rare: 0.85, relic: 1 };
const ZERO = Object.freeze({ x: 0, y: 0 });
const FLOW = { x: 0, y: 0 }; // scratch written by Nav.flowDir

const scratch = [];       // spatial-query results (single-threaded, reused)
const scratchLoot = [];

export class AIController {
  constructor(match, tierId, id) {
    this.match = match;
    this.tierId = tierId;
    this.tier = TIERS[tierId];
    this.rng = new RNG((match.seed ^ Math.imul(id + 1, 0x9e3779b1)) >>> 0);
    this.t = this.rng.float(0, this.tier.think);   // staggered thinking: each AI has its own phase
    this.state = STATES.ROAM; this.stateT = 0;

    this.target = null; this.lastSeenX = 0; this.lastSeenY = 0; this.lastSeenT = -99; this.reactT = 0; this.targetId = -1;
    this.path = null; this.pathIdx = 0; this.pathKey = -1; this.pathT = -99;
    this.roam = null;
    this.loot = null;
    this.hotspot = null; this.hot = null;

    this.aimNoise = 0; this.aimNoiseT = 0;
    this.strafe = this.rng.sign(); this.strafeT = 0;
    this.dodgeT = 0; this.dodgeX = 0; this.dodgeY = 0; this.wantDash = false; this.dashDx = 0; this.dashDy = 0;
    this.threat = false; this.lastThreatId = '';
    this.swapT = 0; this.wantPickup = false;
    this.charging = false;
    this.stuckT = 0; this.lastX = 0; this.lastY = 0; this.jiggle = 0; this.jiggleDir = 1;
    this.relicRoll = 0; this.drink = false; this.lastTeleId = -1;
    this.commit = false; this.commitUntil = 0;   // aggression = chance to pick a fight with a fighter it has just noticed
  }

  update(f, dt) {
    if (f.dead) return;
    this.t -= dt; this.stateT += dt; this.swapT -= dt; this.reactT -= dt; this.aimNoiseT -= dt; this.strafeT -= dt; this.dodgeT -= dt; this.jiggle -= dt;
    if (this.t <= 0) { this.t += this.tier.think; this.think(f); }
    this.act(f, dt);
  }

  // ---------------------------------------------------------------- thinking

  think(f) {
    const m = this.match, tier = this.tier, hp = f.hp / f.maxHp;
    this.perceive(f);
    this.scanThreats(f);
    const loot = this.pickLoot(f);
    this.loot = loot;
    const zoneS = this.zoneScore(f);
    const hot = this.findHotspot(f);

    const kind = f.item.def.kind;
    const armed = kind === 'weapon' || kind === 'relic' || kind === 'exclusive';
    const tg = this.target;
    this.relicRoll = this.rng.next();
    const dist = tg ? Math.hypot(tg.x - f.x, tg.y - f.y) : 999;

    // a fight is on if we chose it, or if the target is hurting us
    const provoked = !!tg && f.lastAttacker === tg && m.time - f.lastHurtT < 5;
    if (provoked) { this.commit = true; this.commitUntil = m.time + 10; }
    if (this.commit && m.time > this.commitUntil) { this.commit = !!tg && this.rng.next() < tier.aggression * 0.5; this.commitUntil = m.time + 8; }

    const s = {};
    s.ENGAGE = tg && this.commit ? (0.3 + tier.aggression * 0.75) * (armed ? 1 : 0.55) * (0.55 + 0.45 * hp) * (dist < 70 ? 1.25 : 1) : 0;
    s.RETREAT = tg && hp < 0.35 ? (1.15 - tier.aggression * 0.6) * (1 - hp) * (dist < 160 ? 1 : 0.5) : 0;
    s.LOOT = loot ? loot.score : 0;
    s.ZONE = zoneS;
    s.THIRD = hot && !tg ? 0.5 * (tier.third === 'seek' ? 1 : 0.55) : 0;
    const lure = m.areas.findDecoy(f);              // a decoy bobber draws every AI nearby, whatever its tier
    if (lure && !(tg && this.commit)) { s.THIRD = Math.max(s.THIRD, 0.85); this.lure = lure; } else this.lure = null;
    // low on health with a tonic in the bag: go drink it
    if (hp < 0.5 && f.slots.some((q) => q && q.def.ai && q.def.ai.heal && q.state.charges > 0)) this.drink = true;
    else if (hp > 0.85) this.drink = false;
    s.ROAM = 0.12;
    // hysteresis: the current state gets a bonus so decisions do not flicker
    s[this.state] = (s[this.state] || 0) * 1.25 + 0.02;
    let best = STATES.ROAM, bv = -1;
    for (const k in s) if (s[k] > bv) { bv = s[k]; best = k; }
    if (best !== this.state) { this.state = best; this.stateT = 0; this.path = null; }
    this.hot = this.lure ? { x: this.lure.x, y: this.lure.y } : hot;

    this.manageItems(f, dist);
    if (this.aimNoiseT <= 0) { this.aimNoise = this.rng.normal() * tier.aimErr; this.aimNoiseT = 0.35; }
  }

  perceive(f) {
    const m = this.match, tier = this.tier;
    m.hash.query(f.x, f.y, m.lightRadius ? Math.min(tier.perceive, m.lightRadius) : tier.perceive, scratch);
    let best = null, bs = 0;
    for (let i = 0; i < scratch.length; i++) {
      const t = scratch[i];
      if (t === f || t.dead) continue;
      if (!m.map.clearLine(f.x, f.y, t.x, t.y)) continue;
      const d = Math.hypot(t.x - f.x, t.y - f.y);
      // closeness, plus a bias toward hurt targets (focus fire) scaled by the tier
      let sc = 1 / (d + 24) * (1 + tier.focusWeak * 2.2 * (1 - t.hp / t.maxHp));
      if (this.target === t) sc *= 1.35; // stick with the current target
      if (sc > bs) { bs = sc; best = t; }
    }
    if (best) {
      if (best.id !== this.targetId) {
        this.targetId = best.id;
        this.reactT = this.rng.float(tier.react[0], tier.react[1]); // reaction time before engaging a new target
        this.commit = this.rng.next() < tier.aggression; this.commitUntil = m.time + 10;
      }
      this.target = best; this.lastSeenX = best.x; this.lastSeenY = best.y; this.lastSeenT = m.time;
    } else if (this.target && (this.target.dead || m.time - this.lastSeenT > 2)) {
      this.target = null; this.targetId = -1;
    }
    if (this.target && this.target.dead) { this.target = null; this.targetId = -1; }
  }

  // Look for projectiles that will pass close to us. Roll the tier's dodge chance once per projectile.
  scanThreats(f) {
    const m = this.match, tier = this.tier;
    const list = m.projectiles.pool.active;
    this.threat = false;
    let bestT = 9, bp = null, bd = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.mode !== 0 || p.owner === f || p.damage <= 0) continue;
      const rx = p.x - f.x, ry = p.y - f.y;
      if (rx * rx + ry * ry > 150 * 150) continue;
      const v2 = p.vx * p.vx + p.vy * p.vy;
      if (v2 < 1) continue;
      const tt = -(rx * p.vx + ry * p.vy) / v2;
      if (tt < 0 || tt > 0.7) continue;
      const cx = rx + p.vx * tt, cy = ry + p.vy * tt;
      const d = Math.hypot(cx, cy);
      if (d > f.r + p.r + 6) continue;
      this.threat = true;
      if (tt < bestT) { bestT = tt; bp = p; bd = d; }
    }
    // telegraphed attacks (beam lines, wedges, dirge rings): step out of the danger area
    const tele = m.telegraphs.threat(f.x, f.y, f.r, f);
    if (tele) {
      this.threat = true;
      if (tele.id !== this.lastTeleId) {
        this.lastTeleId = tele.id;
        if (this.rng.next() < tier.dodge) {
          let nx, ny;
          if (tele.type === 'ring') { const d = Math.hypot(f.x - tele.x, f.y - tele.y) || 1; nx = (f.x - tele.x) / d; ny = (f.y - tele.y) / d; }
          else { const c = Math.cos(tele.ang), s = Math.sin(tele.ang), across = -(f.x - tele.x) * s + (f.y - tele.y) * c; const sg = across >= 0 ? 1 : -1; nx = -s * sg; ny = c * sg; }
          this.dodgeX = nx; this.dodgeY = ny; this.dodgeT = Math.max(0.6, tele.dur - tele.t);
          if ((tier.dash === 'dodge' || tier.dash === 'full') && f.dashCd <= 0 && tele.dur - tele.t < 0.45) { this.wantDash = true; this.dashDx = nx; this.dashDy = ny; }
        }
      }
    }
    if (!bp) return;
    const key = bp._pi + ':' + (bp.owner ? bp.owner.id : 0) + ':' + Math.round(bp.travelled);
    if (this.lastThreatId === bp._pi + ':' + (bp.owner ? bp.owner.id : 0)) return;
    this.lastThreatId = bp._pi + ':' + (bp.owner ? bp.owner.id : 0);
    void key;
    if (this.rng.next() >= tier.dodge) return;
    // perpendicular to the projectile's path, on the side we are already on
    const sp = Math.hypot(bp.vx, bp.vy) || 1;
    let nx = -bp.vy / sp, ny = bp.vx / sp;
    const side = (f.x - bp.x) * nx + (f.y - bp.y) * ny;
    if (side < 0 || (side === 0 && bd === 0 && this.rng.chance(0.5))) { nx = -nx; ny = -ny; }
    this.dodgeX = nx; this.dodgeY = ny; this.dodgeT = 0.3;
    if ((tier.dash === 'dodge' || tier.dash === 'full') && f.dashCd <= 0 && bestT < 0.28) { this.wantDash = true; this.dashDx = nx; this.dashDy = ny; }
  }

  zoneScore(f) {
    const z = this.match.zone, tier = this.tier;
    if (!z) return 0;
    if (!z.inside(f.x, f.y)) return 1.6;         // being outside the zone beats everything
    const tg = z.target;
    const inNext = f.x >= tg.x0 + 20 && f.x <= tg.x1 - 20 && f.y >= tg.y0 + 20 && f.y <= tg.y1 - 20;
    if (inNext) return 0;
    const left = z.untilShrink, closing = z.shrinking;
    // when to start moving for the next rectangle depends on the tier
    const lead = tier.zone === 'early' ? 16 : tier.zone === 'moderate' ? 5 : -1;
    if (closing) return tier.zone === 'late' ? 0.4 : 1.1;
    if (lead > 0 && left < lead) return 0.95;
    return 0;
  }

  // The best nearby pickup, as { x, y, score, kind }, or null.
  pickLoot(f) {
    const m = this.match, tier = this.tier;
    const R = tier.perceive + 80;
    m.pickups.hash.query(f.x, f.y, R, scratchLoot);
    const armed = f.item.def.kind !== 'default' && f.item.def.kind !== 'everyday';
    let best = null;
    for (let i = 0; i < scratchLoot.length; i++) {
      const p = scratchLoot[i];
      if (p.kind === 'gone') continue;
      const d = Math.hypot(p.x - f.x, p.y - f.y);
      let score;
      if (p.kind === 'xp') score = 0.3 * (1 - d / R);
      else {
        const def = ITEMS[p.id];
        if (!m.nav.sameComp(f.x, f.y, p.x, p.y)) continue; // lying on an island roof
        const take = f.canTake(p.id);
        const need = take ? (armed ? 0.9 : 1.5) : 0.25;
        score = (0.35 + 0.5 * (RARITY_VALUE[def.rarity] || 0.5)) * need * (1 - d / R);
        if (f.prefers && f.prefers.includes(p.id)) score *= 1.7;
        if (def.kind === 'everyday' && armed) score *= 0.7;
        if (p.delayId === f.id && m.time < p.delayUntil) score = 0;
      }
      if (!best || score > best.score) best = { x: p.x, y: p.y, score, kind: p.kind, id: p.id };
    }
    return best && best.score > 0.05 ? best : null;
  }

  findHotspot(f) {
    const tier = this.tier, m = this.match;
    if (tier.third === 'none') return null;
    if (tier.third === 'sometimes' && this.rng.next() > 0.35) return this.hotspot;
    const R = tier.third === 'seek' ? 400 : 260;
    let best = null, bd = R;
    for (const h of m.hotspots) {
      if (m.time - h.t > 4) continue;
      const d = Math.hypot(h.x - f.x, h.y - f.y);
      if (d < bd && d > 60) { bd = d; best = h; }
    }
    this.hotspot = best;
    return best;
  }

  // Choose which slot to hold, and whether to swap for the item on the ground.
  manageItems(f, dist) {
    const it = f.intent, tier = this.tier;
    const held = f.slots[f.held];
    if (this.drink) { // go for the tonic
      const ti = f.slots.findIndex((q) => q && q.def.ai && q.def.ai.heal && q.state.charges > 0);
      if (ti >= 0) { if (ti !== f.held) it.swapTo = ti; return; }
      this.drink = false;
    }
    if (!held) { // empty hand: grab the first item we have
      let i = f.slots.findIndex((s) => s && s.def.kind !== 'everyday');
      if (i < 0) i = f.slots.findIndex((s) => s);
      if (i >= 0) it.swapTo = i;
    } else if (this.swapT <= 0 && tier.id !== 'low' && this.target && f.slots.filter((s) => s).length > 1) {
      let best = f.held, bs = -1;
      for (let i = 0; i < f.slots.length; i++) {
        const s = f.slots[i];
        if (!s) continue;
        const ai = s.def.ai || { idealRange: 30 };
        let sc = 1 / (1 + Math.abs(ai.idealRange - dist) / 40);
        if (s.def.kind === 'everyday') sc *= 0.2; // pouches, tonics and shards are for support
        if (s.cd.primary > 0.5 && s.cd.special > 0.5) sc *= 0.4; // everything on cooldown: prefer another
        if (i === f.held) sc *= 1.15;
        if (sc > bs) { bs = sc; best = i; }
      }
      if (best !== f.held) { it.swapTo = best; this.swapT = 1.4; }
    }
    // swap the held item for the one under us if it is clearly better
    const pr = f.prompt;
    if (pr && pr.kind === 'item' && tier.id !== 'low') {
      const pd = ITEMS[pr.id];
      const worth = (RARITY_VALUE[pd.rarity] || 0.5) + pr.level * 0.1;
      const have = held ? (RARITY_VALUE[held.def.rarity] || 0.5) + held.level * 0.1 : 0;
      if (worth > have + 0.15 && held && held.def.kind !== 'relic') this.wantPickup = true;
    }
  }

  // ---------------------------------------------------------------- acting (every step)

  act(f, dt) {
    const m = this.match, it = f.intent, tier = this.tier;
    if (it.swapTo === f.held) it.swapTo = -1;
    it.pickup = this.wantPickup; this.wantPickup = false;
    it.dash = false; it.use = false; it.special = false; it.stance = false; it.swapDir = 0;

    // ---- decide where to go
    let mvx = 0, mvy = 0;
    const tg = this.target && !this.target.dead ? this.target : null;
    const visible = tg && m.time - this.lastSeenT < 0.3;
    switch (this.state) {
      case STATES.ENGAGE: ({ x: mvx, y: mvy } = this.engageMove(f, tg, visible)); break;
      case STATES.RETREAT: ({ x: mvx, y: mvy } = this.retreatMove(f, tg)); break;
      case STATES.LOOT: ({ x: mvx, y: mvy } = this.loot ? this.moveToward(f, this.loot.x, this.loot.y) : ZERO); break;
      case STATES.ZONE: ({ x: mvx, y: mvy } = this.zoneMove(f)); break;
      case STATES.THIRD: ({ x: mvx, y: mvy } = this.hot ? this.moveToward(f, this.hot.x, this.hot.y) : ZERO); break;
      default: ({ x: mvx, y: mvy } = this.roamMove(f));
    }

    // ---- dodge overrides movement briefly
    if (this.dodgeT > 0) { mvx = this.dodgeX; mvy = this.dodgeY; }
    if (this.wantDash && f.dashCd <= 0) { it.dash = true; it.mx = this.dashDx; it.my = this.dashDy; }
    this.wantDash = false;

    // ---- panic dash (low tier) / escape dash
    if (tg && f.hp / f.maxHp < 0.3 && f.dashCd <= 0 && Math.hypot(tg.x - f.x, tg.y - f.y) < 45 && !it.dash) {
      const a = Math.atan2(f.y - tg.y, f.x - tg.x);
      it.dash = true; mvx = Math.cos(a); mvy = Math.sin(a);
    }
    // high tier closes the gap with a dash when it fights up close
    if (tier.dash === 'full' && this.state === STATES.ENGAGE && visible && f.dashCd <= 0 && this.reactT <= 0 && !it.dash) {
      const d = Math.hypot(tg.x - f.x, tg.y - f.y), ai = f.item.def.ai;
      if (ai && ai.idealRange < 40 && d > 70 && d < 130) { it.dash = true; mvx = (tg.x - f.x) / d; mvy = (tg.y - f.y) / d; }
    }

    // ---- stuck detection: if we barely moved while trying to, sidestep for a moment
    this.stuckT += dt;
    if (this.stuckT >= 0.8) {
      const moved = Math.hypot(f.x - this.lastX, f.y - this.lastY);
      if (moved < 5 && (Math.abs(mvx) + Math.abs(mvy) > 0.1) && !f.dashing) { this.jiggle = 0.5; this.jiggleDir = this.rng.sign(); this.path = null; }
      this.lastX = f.x; this.lastY = f.y; this.stuckT = 0;
    }
    if (this.jiggle > 0) { const nx = -mvy * this.jiggleDir, ny = mvx * this.jiggleDir; mvx = nx + mvx * 0.3; mvy = ny + mvy * 0.3; }

    if (!it.dash) { const s = this.steer(f, mvx, mvy); it.mx = s.x; it.my = s.y; }

    // ---- aim and fire
    this.aimAndFire(f, tg, visible);
    // drinking a tonic when hurt
    if (this.drink && f.item.def.ai && f.item.def.ai.heal && f.item.state.charges > 0 && f.hp / f.maxHp < 0.85) f.intent.use = true;
  }

  // ---- movement behaviours

  engageMove(f, tg, visible) {
    const tier = this.tier;
    if (!tg) return ZERO;
    if (!visible) return this.moveToward(f, this.lastSeenX, this.lastSeenY);
    const ai = f.item.def.ai || { idealRange: 24, minRange: 0 };
    const dx = tg.x - f.x, dy = tg.y - f.y, d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    const ideal = ai.idealRange, min = ai.minRange || 0;
    if (this.reactT > 0 && tier.id !== 'low') return ZERO; // still reacting
    if (tier.kite === 'none') return d > Math.max(10, ideal * 0.7) ? this.moveToward(f, tg.x, tg.y) : ZERO;
    if (d < min) return { x: -ux, y: -uy };                          // too close for this weapon: back off
    if (d > ideal * 1.2) return this.moveToward(f, tg.x, tg.y);       // close the gap
    if (tier.kite === 'basic') return ZERO;                           // hold the ideal range
    // strafe: circle the target at the ideal range
    if (this.strafeT <= 0) { this.strafe = this.rng.sign(); this.strafeT = this.rng.float(0.8, 1.8); }
    const k = clamp((d - ideal) / 30, -1, 1);
    return { x: -uy * this.strafe + ux * k * 0.6, y: ux * this.strafe + uy * k * 0.6 };
  }

  retreatMove(f, tg) {
    if (!tg) return this.zoneMove(f);
    const dx = f.x - tg.x, dy = f.y - tg.y, d = Math.hypot(dx, dy) || 1;
    // run away, but prefer the safe-zone direction when it points roughly away from the threat
    const z = this.zoneMove(f);
    const away = { x: dx / d, y: dy / d };
    if (z.x * away.x + z.y * away.y > 0) return { x: (z.x + away.x) / 2, y: (z.y + away.y) / 2 };
    return away;
  }

  zoneMove(f) {
    const m = this.match, z = m.zone;
    if (!z) return ZERO;
    const k = z.upcoming;
    const flow = m.nav.flowFor(k, () => m.zoneGoals(k));
    if (m.nav.flowDir(flow, f.x, f.y, FLOW)) return { x: FLOW.x, y: FLOW.y };
    return ZERO;
  }

  roamMove(f) {
    const m = this.match;
    if (!this.roam || Math.hypot(this.roam.x - f.x, this.roam.y - f.y) < 24 || this.stateT > 20) {
      // pick a chamber inside the safe area
      const ch = m.chambers;
      for (let n = 0; n < 6; n++) {
        const c = ch[this.rng.int(0, ch.length)];
        const x = (c.x + 0.5) * 16, y = (c.y + 0.5) * 16;
        if (!m.zone || m.zone.inside(x, y, 24)) { this.roam = { x, y }; break; }
      }
      this.stateT = 0;
    }
    return this.roam ? this.moveToward(f, this.roam.x, this.roam.y) : ZERO;
  }

  // Head for (gx, gy): straight when the line is clear, else along a cached, budgeted A* path.
  moveToward(f, gx, gy) {
    const m = this.match, nav = m.nav;
    const dx = gx - f.x, dy = gy - f.y, d = Math.hypot(dx, dy);
    if (d < 6) return ZERO;
    if (d < 220 && m.map.walkClear(f.x, f.y, gx, gy, 4)) { this.path = null; return { x: dx / d, y: dy / d }; }
    if (!nav.sameComp(f.x, f.y, gx, gy)) return ZERO; // across a gap: no walk will get us there
    const key = nav.tile(gx, gy);
    if (!this.path || key !== this.pathKey || m.time - this.pathT > 1) {
      const p = nav.findPath(f.x, f.y, gx, gy);
      if (p !== undefined) { this.path = p; this.pathIdx = 0; this.pathKey = key; this.pathT = m.time; }
    }
    if (this.path && this.path.length) {
      while (this.pathIdx < this.path.length - 1 && Math.hypot(this.path[this.pathIdx].x - f.x, this.path[this.pathIdx].y - f.y) < 8) this.pathIdx++;
      const w = this.path[this.pathIdx];
      const wx = w.x - f.x, wy = w.y - f.y, wd = Math.hypot(wx, wy) || 1;
      return { x: wx / wd, y: wy / wd };
    }
    // no path (yet): follow the zone flow so we are at least heading somewhere sensible
    if (this.path === null && d > 1) return this.zoneMove(f);
    return ZERO;
  }

  // Local steering: whisker wall avoidance, separation from other fighters, avoid fire.
  steer(f, dx, dy) {
    const m = this.match, map = m.map;
    let x = dx, y = dy;
    const len = Math.hypot(x, y);
    if (len < 0.01) return { x: 0, y: 0 };
    x /= len; y /= len;
    const base = Math.atan2(y, x);
    let rx = 0, ry = 0;
    for (let k = -1; k <= 1; k++) {
      const a = base + k * 0.7;
      if (map.isBlockedPx(f.x + Math.cos(a) * 11, f.y + Math.sin(a) * 11)) { const w = k === 0 ? 1.4 : 0.9; rx -= Math.cos(a) * w; ry -= Math.sin(a) * w; }
    }
    // separation
    m.hash.query(f.x, f.y, 13, scratch);
    for (let i = 0; i < scratch.length; i++) {
      const o = scratch[i];
      if (o === f) continue;
      const ox = f.x - o.x, oy = f.y - o.y, d = Math.hypot(ox, oy) || 1;
      rx += (ox / d) * 0.8; ry += (oy / d) * 0.8;
    }
    // fire pools: step away
    const areas = m.areas.pool.active;
    for (let i = 0; i < areas.length; i++) {
      const a = areas[i];
      if (a.kind !== 'fire') continue;
      const ax = f.x - a.x, ay = f.y - a.y, d = Math.hypot(ax, ay) || 1;
      if (d < a.r + 10) { rx += (ax / d) * 1.5; ry += (ay / d) * 1.5; }
    }
    x += rx * 1.1; y += ry * 1.1;
    const l2 = Math.hypot(x, y) || 1;
    return { x: x / l2, y: y / l2 };
  }

  // ---- aiming and item use

  aimAndFire(f, tg, visible) {
    const it = f.intent, tier = this.tier, inst = f.item;
    const ai = inst.def.ai || { idealRange: 24, aim: 'direct', useWhen: 'inRange' };
    if (!tg || !visible) {
      it.aim = Math.atan2(it.my || Math.sin(f.aim), it.mx || Math.cos(f.aim));
      it.tx = f.x + Math.cos(it.aim) * 60; it.ty = f.y + Math.sin(it.aim) * 60;
      this.charging = false;
      return;
    }
    const dx = tg.x - f.x, dy = tg.y - f.y, dist = Math.hypot(dx, dy);
    const p = inst.params('primary');

    // aim point: direct, lead (predict movement), or lob (predict over the flight time)
    let ax = tg.x, ay = tg.y;
    const speed = p.speed || p.flightSpeed || 300;
    const flight = dist / speed;
    if (ai.aim === 'lead' || ai.aim === 'lob') {
      ax += (tg.vx + tg.kx) * flight * tier.lead;
      ay += (tg.vy + tg.ky) * flight * tier.lead;
    }
    const ang = Math.atan2(ay - f.y, ax - f.x) + this.aimNoise;
    it.aim = ang;
    const aimDist = Math.hypot(ax - f.x, ay - f.y);
    it.tx = f.x + Math.cos(ang) * aimDist; it.ty = f.y + Math.sin(ang) * aimDist;
    if (ai.aim === 'lob') { it.tx = ax + Math.cos(this.aimNoise) * 2; it.ty = ay + Math.sin(this.aimNoise) * 2; }

    // only shoot at someone we chose to fight (or who is hurting us), once we have reacted to them
    if (!this.commit || this.reactT > 0 || (this.state === STATES.RETREAT && ai.idealRange < 40)) { this.charging = false; return; }
    const attackRange = ai.attackRange || (ai.aim === 'direct' ? Math.max(ai.idealRange * 1.2, ai.idealRange + 8) : Math.min(p.range ? p.range * 0.85 : 999, ai.idealRange * 1.7));
    const inRange = dist <= attackRange;

    // primary, then special. Channelled items (bow draw, thunderclap) are held for a tier-dependent fraction of their charge.
    for (let k = 0; k < 2; k++) {
      const kind = k === 0 ? 'primary' : 'special', def = inst.def[kind];
      if (!def) continue;
      const pk = inst.params(kind), act = ACTIONS[def.action];
      const busy = f.busy && f.busy.inst === inst && f.busy.kind === kind;
      const want = kind === 'primary' ? (inRange && this.wantUse(f, inst, tg, dist)) : (inst.cd.special <= 0 && this.wantSpecial(f, inst, tg, dist, ai));
      let down = false;
      if (act.keep) {
        if (busy) down = f.busy.t < pk.minCharge + (pk.maxCharge - pk.minCharge) * tier.charge && (want || kind === 'primary' && inRange);
        else down = want && inst.cd[kind] <= 0;
        if (kind === 'primary') this.charging = down;
      } else down = want;
      if (kind === 'primary') it.use = down; else it.special = down;
    }
  }

  // Relic timing by tier: random / when the target is in range and slow / predictive (nets on cornered or rooted targets,
  // beams along lines, sermons onto fights).
  relicOk(f, inst, tg, dist) {
    const tier = this.tier, ai = inst.def.ai || {};
    if (dist > (ai.idealRange || 100) * 1.8) return false;
    switch (tier.relic) {
      case 'random': return this.relicRoll < 0.25;
      case 'inRange': return Math.hypot(tg.vx, tg.vy) < 40 || tg.st.slow > 0 || tg.st.root > 0 || this.relicRoll < 0.12;
      default:
        switch (ai.relicWhen) {
          case 'cornered': return this.cornered(tg, f) || tg.st.root > 0 || tg.st.slow > 0;
          case 'fight': return this.clustered(tg) >= 2 || tg.st.slow > 0 || tg.st.root > 0 || (this.commit && dist < 90);
          default: return true; // 'line' and anything else
        }
    }
  }

  // Is the target pinned against a wall on the side away from us?
  cornered(tg, f) {
    const dx = tg.x - f.x, dy = tg.y - f.y, d = Math.hypot(dx, dy) || 1;
    return this.match.map.isBlockedPx(tg.x + (dx / d) * 14, tg.y + (dy / d) * 14);
  }

  wantUse(f, inst, tg, dist) {
    if (inst.def.kind === 'relic') return inst.cd.primary <= 0 && this.relicOk(f, inst, tg, dist);
    const when = (inst.def.ai && inst.def.ai.useWhen) || 'inRange';
    switch (when) {
      case 'targetRooted': return tg.st.root > 0 || tg.st.stun > 0 || this.tier.id === 'low';
      case 'lowHp': return f.hp / f.maxHp < 0.5;
      case 'clustered': return this.clustered(tg) >= 2;
      default: return true;
    }
  }

  // How many fighters (including the target) stand close to the target.
  clustered(tg) {
    this.match.hash.query(tg.x, tg.y, 36, scratch);
    return scratch.length;
  }

  wantSpecial(f, inst, tg, dist, ai) {
    if (inst.def.kind === 'relic') return this.relicOk(f, inst, tg, dist);
    const when = ai.specialWhen || 'inRange';
    const roll = this.rng.next();
    switch (when) {
      case 'gapClose': return dist > 35 && dist < 100;
      case 'surrounded': { this.match.hash.query(f.x, f.y, 44, scratch); return scratch.length >= 3; }
      case 'retreating': return this.state === STATES.RETREAT;
      case 'underMelee': return (dist < 30 && (tg.swing.t > 0 || tg.item.cd.primary > tg.item.cdMax.primary - 0.1)) || (this.threat && roll < 0.5);
      case 'clustered': return this.clustered(tg) >= 2 && dist < 220;
      case 'targetFleeing': return Math.hypot(tg.vx, tg.vy) > 50 && dist < 150;
      case 'incomingProjectile': return this.threat;
      case 'cornered': return f.hp / f.maxHp < 0.45 && dist < 40;
      case 'lowHp': return f.hp / f.maxHp < 0.4;
      default: return dist < (ai.idealRange * 1.5 + 10) && roll < 0.25;
    }
  }
}
