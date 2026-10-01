import { Pool } from '../core/pool.js';
import { damage } from './combat.js';
import { applyStatus } from './statuses.js';

const discCache = new Map();

// Pixel-art disc, cached per (kind, radius). Fire is dithered orange, oil is a dark slick, the dirge a grey-blue ring field.
function disc(kind, r) {
  const key = kind + r;
  let c = discCache.get(key);
  if (c) return c;
  const d = r * 2 + 2;
  c = document.createElement('canvas'); c.width = d; c.height = d;
  const g = c.getContext('2d');
  for (let y = 0; y < d; y++) for (let x = 0; x < d; x++) {
    const dx = x - r, dy = y - r, dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > r) continue;
    const edge = dist > r - 2, chk = (x + y) & 1;
    if (kind === 'fire') g.fillStyle = edge ? '#7a1e10' : (dist < r * 0.45 ? (chk ? '#ffa030' : '#ff7a20') : (chk ? '#e0501c' : '#b8341a'));
    else if (kind === 'dirge') {
      const ring = Math.abs(dist - r * 0.4) < 1 || Math.abs(dist - r * 0.75) < 1 || edge;
      if (!ring && !(chk && dist < r * 0.9 && (x * 5 + y * 3) % 9 === 0)) continue;
      g.fillStyle = edge ? '#8aa0c8' : (ring ? '#6a82b0' : '#a8b8d8');
    } else g.fillStyle = edge ? '#1a1024' : (((x * 7 + y * 3) % 11 === 0) ? '#6a4a8a' : (chk ? '#2a1a38' : '#221430'));
    g.fillRect(x, y, 1, 1);
  }
  discCache.set(key, c);
  return c;
}

// Ground zones: burning pools, oil slicks, mantraps, dirges, decoys. Fire-pool and oil rules live in update().
export class Areas {
  constructor(match) {
    this.match = match;
    this.pool = new Pool(() => ({ kind: 'fire', x: 0, y: 0, r: 20, life: 1, max: 1, owner: null, dps: 0, tick: 0, emit: 0, itemId: null, damage: 0, root: 0, armT: 0, sprung: false, follow: null, status: null, noteT: 0 }), 160);
  }

  get count() { return this.pool.active.length; }

  spawn(kind, x, y, r, life, owner, params = {}) {
    if (kind === 'splash') { this.splash(x, y, r, owner, params); return null; }
    if (kind === 'trap') this.limitTraps(owner, 3);
    const a = this.pool.acquire();
    if (!a) return null;
    a.kind = kind; a.x = x; a.y = y; a.r = Math.max(kind === 'trap' ? 6 : 6, Math.round(r)); a.life = a.max = life; a.owner = owner;
    a.dps = params.dps || 0; a.itemId = params.itemId || null; a.tick = 0; a.emit = 0;
    a.damage = params.damage || 0; a.root = params.root || 0; a.armT = params.armT || 0; a.sprung = false; a.follow = params.follow || null;
    a.status = params.status || null; a.noteT = 0;
    if (kind === 'trap') this.checkTrap(a); // a tossed trap snaps shut on whoever it lands on
    return a;
  }

  // Keep at most `n` traps per owner: the oldest goes.
  limitTraps(owner, n) {
    const list = this.pool.active;
    const mine = [];
    for (const a of list) if (a.kind === 'trap' && a.owner === owner && !a.sprung) mine.push(a);
    while (mine.length >= n) { const old = mine.shift(); old.life = 0; }
  }

  // Instant area effect (tonic splash): a status on everyone around the landing point except the thrower.
  splash(x, y, r, owner, params) {
    const m = this.match;
    m.hash.query(x, y, r, m.tmp);
    for (let k = 0; k < m.tmp.length; k++) {
      const t = m.tmp[k];
      if (t.dead || t === owner || !params.status) continue;
      applyStatus(t, params.status.name, params.status.dur, params.status.power || 0, owner);
      m.fx.popup(t.x, t.y - 12, 'SLOWED', '#7ab0ff');
    }
    m.fx.sparks(x, y, 14, '#7ab0ff', 80, 0.5);
    m.fx.ring(x, y, r, '#9ad0ff');
  }

  findDecoy(f) {
    const list = this.pool.active;
    let best = null, bd = 1e9;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.kind !== 'decoy' || a.owner === f) continue;
      const d = Math.hypot(a.x - f.x, a.y - f.y);
      if (d < bd && d < 220) { bd = d; best = a; }
    }
    return best;
  }

  checkTrap(a) {
    if (a.sprung || a.armT > 0) return;
    const m = this.match;
    m.hash.query(a.x, a.y, a.r, m.tmp);
    for (let k = 0; k < m.tmp.length; k++) {
      const t = m.tmp[k];
      if (t.dead || t === a.owner || t.dashing) continue;
      damage(m, t, a.damage, { source: a.owner, kind: 'area', kb: 0, itemId: a.itemId, status: { name: 'root', dur: a.root } });
      m.fx.sparks(a.x, a.y, 10, '#d8dce8', 100, 0.3);
      m.fx.popup(t.x, t.y - 12, 'SNAP', '#ffffff');
      m.sfx('snap', a.x, a.y);
      a.sprung = true; a.life = Math.min(a.life, 2);
      return;
    }
  }

  update(dt) {
    const m = this.match, list = this.pool.active, tmp = m.tmp;
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      a.life -= dt;
      if (a.follow) { a.x = a.follow.x; a.y = a.follow.y; if (a.follow.dead) a.life = 0; }
      if (a.life <= 0) {
        if (a.kind === 'decoy') this.springDecoy(a);
        this.pool.release(a);
        continue;
      }

      if (a.kind === 'fire') {
        a.emit += dt * a.r * 0.9;
        while (a.emit >= 1) { a.emit -= 1; const ang = Math.random() * 6.283, d = Math.sqrt(Math.random()) * a.r * 0.9; m.fx.flame(a.x + Math.cos(ang) * d, a.y + Math.sin(ang) * d * 0.8); }
        a.tick -= dt;
        if (a.tick <= 0) {
          a.tick = 0.25;
          m.hash.query(a.x, a.y, a.r, tmp);
          for (let k = 0; k < tmp.length; k++) {
            const t = tmp[k];
            if (t.dead) continue;
            damage(m, t, a.dps * 0.25, { source: a.owner, kind: 'area', quiet: true, itemId: a.itemId });
            applyStatus(t, 'burn', 1.3, 4, a.owner);
          }
        }
      } else if (a.kind === 'oil') {
        m.hash.query(a.x, a.y, a.r, tmp);
        let lit = false;
        for (let k = 0; k < tmp.length; k++) {
          const t = tmp[k];
          if (t.dead) continue;
          applyStatus(t, 'slippery', 0.3);
          if (t.st.burn > 0) lit = true;
        }
        if (!lit) {
          for (let j = 0; j < list.length; j++) {
            const f = list[j];
            if (f.kind === 'fire' && Math.hypot(f.x - a.x, f.y - a.y) < f.r + a.r) { lit = true; break; }
          }
        }
        if (lit) { // fire turns the slick into a big blaze
          a.kind = 'fire'; a.r = Math.round(a.r * 1.45); a.life = a.max = 4; a.dps = 11;
          m.fx.sparks(a.x, a.y, 14, '#ffc040', 120, 0.4);
        }
      } else if (a.kind === 'trap') {
        if (a.armT > 0) a.armT -= dt; else this.checkTrap(a);
      } else if (a.kind === 'dirge') {
        a.tick -= dt;
        if (a.tick <= 0) {
          a.tick = 0.25;
          m.hash.query(a.x, a.y, a.r, tmp);
          for (let k = 0; k < tmp.length; k++) {
            const t = tmp[k];
            if (t.dead || t === a.owner) continue;
            applyStatus(t, 'silence', 0.5, 0, a.owner);
            damage(m, t, a.dps * 0.25, { source: a.owner, kind: 'area', quiet: true, itemId: a.itemId });
          }
          if (Math.random() < 0.5) m.fx.spark(a.x + (Math.random() - 0.5) * a.r * 1.6, a.y + (Math.random() - 0.5) * a.r, 0, -30, 0.8, '#a8b8d8', 2, 0, 0);
        }
      } else if (a.kind === 'decoy') {
        a.noteT -= dt;
        if (a.noteT <= 0) { a.noteT = 0.3; m.noteFight(a.x, a.y); }
      }
    }
  }

  // The lure springs a small net on whoever fell for it.
  springDecoy(a) {
    const m = this.match;
    m.hash.query(a.x, a.y, 24, m.tmp);
    for (let k = 0; k < m.tmp.length; k++) {
      const t = m.tmp[k];
      if (t.dead || t === a.owner) continue;
      applyStatus(t, 'root', 1.0, 0, a.owner);
      m.fx.popup(t.x, t.y - 12, 'NETTED', '#c8e8ff');
    }
    m.fx.ring(a.x, a.y, 24, '#c8e8ff');
    m.fx.sparks(a.x, a.y, 10, '#c8e8ff', 80, 0.4);
  }

  draw(ctx, cam, viewer) {
    const list = this.pool.active;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const x = Math.round(a.x - cam.rx), y = Math.round(a.y - cam.ry);
      if (x < -60 || x > 540 || y < -60 || y > 330) continue;
      if (a.kind === 'trap') { this.drawTrap(ctx, a, x, y, viewer); continue; }
      if (a.kind === 'decoy') { this.drawDecoy(ctx, a, x, y); continue; }
      if (a.life < 0.6 && ((a.life * 20) | 0) % 2) continue; // flicker out
      ctx.drawImage(disc(a.kind, a.r), x - a.r - 1, y - a.r - 1);
    }
  }

  // An iron jaw that only glints for fighters who are close (and is always visible to its owner).
  drawTrap(ctx, a, x, y, viewer) {
    const near = viewer && (a.owner === viewer || Math.hypot(a.x - viewer.x, a.y - viewer.y) < 44);
    const t = this.match.time;
    if (!near && !a.sprung) { if (((t * 1.2 + a.x) % 1.4) < 0.1) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y - 1, 1, 1); } return; }
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x - 5, y + 2, 10, 2);
    ctx.fillStyle = '#2a2a38'; ctx.fillRect(x - 5, y - 1, 10, 3);
    ctx.fillStyle = a.sprung ? '#8088a0' : '#c8ccd8';
    if (a.sprung) { ctx.fillRect(x - 4, y - 3, 8, 2); ctx.fillRect(x - 4, y - 1, 8, 1); }
    else for (let k = -4; k <= 3; k += 2) { ctx.fillRect(x + k, y - 3, 1, 3); ctx.fillRect(x + k + 1, y - 2, 1, 2); }
    if (!a.sprung && a.armT <= 0 && ((t * 3) | 0) % 4 === 0) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 3, y - 3, 1, 1); }
  }

  drawDecoy(ctx, a, x, y) {
    const t = this.match.time, bob = Math.round(Math.sin(t * 5)) ;
    ctx.fillStyle = '#6a82b0';
    const r = ((t * 6) % 8) + 2;
    for (let k = 0; k < 12; k++) { const ang = (k / 12) * 6.283; ctx.fillRect(Math.round(x + Math.cos(ang) * r), Math.round(y + 2 + Math.sin(ang) * r * 0.5), 1, 1); }
    ctx.fillStyle = '#10101c'; ctx.fillRect(x - 3, y - 6 + bob, 6, 8);
    ctx.fillStyle = '#e04030'; ctx.fillRect(x - 2, y - 5 + bob, 4, 4);
    ctx.fillStyle = '#f4f0e8'; ctx.fillRect(x - 2, y - 1 + bob, 4, 2);
    ctx.fillStyle = '#10101c'; ctx.fillRect(x, y - 9 + bob, 1, 3);
  }
}
