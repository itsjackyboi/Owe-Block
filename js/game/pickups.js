import { Pool } from '../core/pool.js';
import { SpatialHash } from '../core/grid.js';
import { GRID_CELL } from '../config.js';
import { ITEMS } from '../data/registry.js';
import { grantXp } from './levelup.js';

const MAGNET = 34;      // base XP-cap magnet radius, scaled by the fighter's pickupMul
const TAKE = 10;        // distance at which loot is picked up automatically
const PROMPT = 17;      // distance at which the swap prompt appears

const RARITY_COLOR = { common: '#d8d8e0', uncommon: '#7ae0a0', rare: '#7ab0ff', relic: '#c88aff' };

// Items on the ground and XP caps. Collection rules for every fighter live here, so AI and player behave the same.
export class Pickups {
  constructor(match) {
    this.match = match;
    this.pool = new Pool(() => ({ kind: 'item', id: null, level: 1, value: 0, x: 0, y: 0, vx: 0, vy: 0, bob: 0, delayUntil: 0, delayId: -1 }), 1500);
    this.hash = new SpatialHash(match.map.pxW, match.map.pxH, GRID_CELL);
    this.cand = [];
  }

  get count() { return this.pool.active.length; }

  dropItem(id, level, x, y, rng, delayFor = null) {
    const p = this.pool.acquire();
    if (!p) return null;
    p.kind = 'item'; p.id = id; p.level = level; p.value = 0;
    this.place(p, x, y, rng);
    if (delayFor) { p.delayId = delayFor.id; p.delayUntil = this.match.time + 0.8; } else { p.delayId = -1; p.delayUntil = 0; }
    return p;
  }

  dropXp(value, x, y, rng) {
    const p = this.pool.acquire();
    if (!p) return null;
    p.kind = 'xp'; p.id = null; p.level = 1; p.value = value; p.delayId = -1; p.delayUntil = 0;
    this.place(p, x, y, rng);
    return p;
  }

  place(p, x, y, rng) {
    const a = rng.float(0, 6.283), s = rng.float(30, 90);
    p.x = x; p.y = y; p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s; p.bob = rng.float(0, 6.28);
    // spawn at rest on the spot when the loot is placed at match start (no scatter)
    if (this.match.time === 0) { p.vx = p.vy = 0; }
  }

  update(dt) {
    const m = this.match, list = this.pool.active, map = m.map;
    // scatter motion for freshly dropped loot
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.bob += dt * 4;
      if (p.vx || p.vy) {
        const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
        if (!map.isSolidPx(nx, p.y)) p.x = nx; else p.vx = 0;
        if (!map.isSolidPx(p.x, ny)) p.y = ny; else p.vy = 0;
        const d = Math.exp(-6 * dt); p.vx *= d; p.vy *= d;
        if (Math.abs(p.vx) + Math.abs(p.vy) < 4) p.vx = p.vy = 0;
      }
    }
    this.hash.clear();
    for (let i = 0; i < list.length; i++) this.hash.insert(list[i]);

    const fs = m.fighters, tmp = m.tmp2;
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      if (f.dead) continue;
      f.prompt = null;
      let best = null, bd = PROMPT * PROMPT;
      const magnet = MAGNET * f.pickupMul;
      this.hash.query(f.x, f.y, Math.max(magnet, PROMPT), tmp);
      for (let k = 0; k < tmp.length; k++) {
        const p = tmp[k];
        if (p.kind === 'gone') continue;
        const dx = f.x - p.x, dy = f.y - p.y, d2 = dx * dx + dy * dy;
        if (p.kind === 'xp') {
          if (d2 < magnet * magnet) {
            const d = Math.sqrt(d2) || 1, pull = 70 + (1 - d / magnet) * 170;
            p.x += (dx / d) * pull * dt; p.y += (dy / d) * pull * dt;
            if (d < 6) { grantXp(m, f, p.value); m.fx.sparks(p.x, p.y, 3, '#ffd860', 40, 0.2); if (f.isPlayer) m.sfx('xp', f.x, f.y); this.remove(p); }
          }
        } else {
          if (p.delayId === f.id && m.time < p.delayUntil) continue;
          if (d2 < TAKE * TAKE && f.canTake(p.id)) {
            f.addItem(p.id, p.level);
            m.fx.sparks(p.x, p.y, 6, RARITY_COLOR[ITEMS[p.id].rarity] || '#fff', 70, 0.3);
            m.fx.popup(f.x, f.y - 14, f.lastPickupMsg, '#ffffff');
            m.sfx('pickup', f.x, f.y);
            this.remove(p);
          } else if (d2 < bd) { bd = d2; best = p; }
        }
      }
      if (best && best.kind !== 'gone') f.prompt = best;
      if (f.intent.pickup && f.prompt && f.prompt.kind === 'item') this.swapWith(f, f.prompt);
    }
  }

  remove(p) { p.kind = 'gone'; this.pool.release(p); }

  // E: swap the held item for the one on the ground. The old one drops where the new one was.
  swapWith(f, p) {
    const idx = f.held;
    const old = f.slots[idx];
    const id = p.id, level = p.level, x = p.x, y = p.y;
    this.remove(p);
    f.prompt = null;
    f.slots[idx] = null;
    f.addItem(id, level);
    if (old) this.dropItem(old.id, old.level, x, y, this.match.rng, f);
  }

  draw(ctx, cam, assets) {
    const list = this.pool.active;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const x = Math.round(p.x - cam.rx), y = Math.round(p.y - cam.ry);
      if (x < -16 || x > 496 || y < -16 || y > 286) continue;
      const bob = Math.round(Math.sin(p.bob) * 1.5);
      if (p.kind === 'xp') {
        const big = p.value >= 12;
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x - 2, y + 2, 5, 1);
        ctx.fillStyle = '#6a4a10'; ctx.fillRect(x - 2, y - 2 + bob, 5, 4);
        ctx.fillStyle = big ? '#ffb020' : '#ffd860'; ctx.fillRect(x - 1, y - 2 + bob, 3, 3);
        ctx.fillStyle = '#fff4b0'; ctx.fillRect(x - 1, y - 2 + bob, 1, 1);
      } else {
        const d = ITEMS[p.id];
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x - 5, y + 5, 10, 2);
        const col = RARITY_COLOR[d.rarity] || '#fff';
        ctx.fillStyle = col; ctx.fillRect(x - 6, y + 6, 12, 1); // rarity underline
        assets.drawIcon(ctx, p.id, x - 8, y - 9 + bob);
        if (p.level > 1) { ctx.fillStyle = '#ffd860'; for (let l = 0; l < p.level; l++) ctx.fillRect(x - 6 + l * 3, y + 8, 2, 2); }
      }
    }
  }
}

