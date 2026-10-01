import { Pool } from '../core/pool.js';
import { damage } from './combat.js';
import { applyStatus } from './statuses.js';

const discCache = new Map();

// Pixel-art disc, cached per (kind, radius). Fire is dithered orange, oil is a dark slick with highlights.
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
    else g.fillStyle = edge ? '#1a1024' : (((x * 7 + y * 3) % 11 === 0) ? '#6a4a8a' : (chk ? '#2a1a38' : '#221430'));
    g.fillRect(x, y, 1, 1);
  }
  discCache.set(key, c);
  return c;
}

// Ground zones: burning pools, oil slicks. (Traps, cover and auras reuse this in Stage 4.)
export class Areas {
  constructor(match) {
    this.match = match;
    this.pool = new Pool(() => ({ kind: 'fire', x: 0, y: 0, r: 20, life: 1, max: 1, owner: null, dps: 0, tick: 0, emit: 0, itemId: null }), 128);
  }

  get count() { return this.pool.active.length; }

  spawn(kind, x, y, r, life, owner, params = {}) {
    const a = this.pool.acquire();
    if (!a) return null;
    a.kind = kind; a.x = x; a.y = y; a.r = Math.max(6, Math.round(r)); a.life = a.max = life; a.owner = owner;
    a.dps = params.dps || 0; a.itemId = params.itemId || null; a.tick = 0; a.emit = 0;
    return a;
  }

  update(dt) {
    const m = this.match, list = this.pool.active, tmp = m.tmp;
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      a.life -= dt;
      if (a.life <= 0) { this.pool.release(a); continue; }

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
      }
    }
  }

  draw(ctx, cam) {
    const list = this.pool.active;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const x = Math.round(a.x - cam.rx), y = Math.round(a.y - cam.ry);
      if (x < -60 || x > 540 || y < -60 || y > 330) continue;
      if (a.life < 0.6 && ((a.life * 20) | 0) % 2) continue; // flicker out
      const d = disc(a.kind, a.r);
      ctx.drawImage(d, x - a.r - 1, y - a.r - 1);
    }
  }
}
