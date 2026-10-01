import { TILE } from '../config.js';
import { T } from './map.js';

// Amethyst crystals: player-grown cover blocks that fighters and projectiles cannot pass, 40 HP, breakable.
const CRYSTAL_HP = 40, LIFE = 25;

export class Crystals {
  constructor(match) {
    this.match = match;
    this.list = [];
  }

  // Grow a crystal on the tile under (wx, wy). Fails on walls, pits, other crystals and tiles with a fighter in them.
  grow(owner, wx, wy) {
    const m = this.match, map = m.map;
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    if (map.tile(tx, ty) !== T.FLOOR) return false;
    const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
    for (const f of m.fighters) if (!f.dead && Math.abs(f.x - cx) < TILE / 2 + f.r && Math.abs(f.y - cy) < TILE / 2 + f.r) return false;
    map.tiles[ty * map.w + tx] = T.CRYSTAL;
    this.list.push({ tx, ty, hp: CRYSTAL_HP, owner, life: LIFE, flash: 0 });
    m.fx.sparks(cx, cy, 10, '#c88aff', 70, 0.4);
    return true;
  }

  at(tx, ty) {
    for (const c of this.list) if (c.tx === tx && c.ty === ty) return c;
    return null;
  }

  damage(tx, ty, amount) {
    const c = this.at(tx, ty);
    if (!c) return;
    c.hp -= amount; c.flash = 0.1;
    this.match.fx.sparks((tx + 0.5) * TILE, (ty + 0.5) * TILE, 3, '#e0c8ff', 60, 0.2);
    if (c.hp <= 0) this.remove(c);
  }

  // Melee swings chip crystals inside the arc.
  damageInArc(f, reach, arc, amount) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      const dx = (c.tx + 0.5) * TILE - f.x, dy = (c.ty + 0.5) * TILE - f.y, d = Math.hypot(dx, dy);
      if (d > reach + 6) continue;
      let da = Math.atan2(dy, dx) - f.aim;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) <= arc / 2 + 0.4) this.damage(c.tx, c.ty, amount);
    }
  }

  remove(c) {
    const m = this.match;
    const i = this.list.indexOf(c);
    if (i >= 0) this.list.splice(i, 1);
    if (m.map.tiles[c.ty * m.map.w + c.tx] === T.CRYSTAL) m.map.tiles[c.ty * m.map.w + c.tx] = T.FLOOR;
    m.fx.sparks((c.tx + 0.5) * TILE, (c.ty + 0.5) * TILE, 12, '#c88aff', 90, 0.4);
  }

  // Shatter: every crystal owned by `owner` bursts into 8 slivers.
  shatter(owner, damage) {
    const m = this.match;
    let n = 0;
    for (const c of this.list.slice()) {
      if (c.owner !== owner) continue;
      const x = (c.tx + 0.5) * TILE, y = (c.ty + 0.5) * TILE;
      this.remove(c);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * 6.283 + 0.2;
        m.projectiles.fly({ x, y, angle: a, speed: 240, range: 90, r: 2, damage, kb: 40, owner, kind: 'sliver', itemId: 'amethyst_shard' });
      }
      n++;
    }
    return n;
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      c.life -= dt; if (c.flash > 0) c.flash -= dt;
      if (c.life <= 0 || (c.owner && c.owner.dead && c.life > 3)) { if (c.life <= 0) this.remove(c); }
    }
  }

  draw(ctx, cam) {
    for (const c of this.list) {
      const x = Math.round(c.tx * TILE - cam.rx), y = Math.round(c.ty * TILE - cam.ry);
      if (x < -16 || x > 496 || y < -16 || y > 286) continue;
      const hit = c.flash > 0;
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x + 1, y + 13, 14, 3);
      ctx.fillStyle = '#2a1840'; ctx.fillRect(x + 3, y + 2, 10, 12); ctx.fillRect(x + 1, y + 8, 14, 6); ctx.fillRect(x + 5, y, 6, 3);
      ctx.fillStyle = hit ? '#ffffff' : '#8a4ac8'; ctx.fillRect(x + 4, y + 3, 8, 10); ctx.fillRect(x + 2, y + 9, 12, 4); ctx.fillRect(x + 6, y + 1, 4, 3);
      ctx.fillStyle = hit ? '#ffffff' : '#c8a0ff'; ctx.fillRect(x + 5, y + 3, 2, 8); ctx.fillRect(x + 7, y + 1, 1, 2);
      // cracks as it takes damage
      if (c.hp < CRYSTAL_HP * 0.66) { ctx.fillStyle = '#2a1840'; ctx.fillRect(x + 9, y + 4, 1, 5); }
      if (c.hp < CRYSTAL_HP * 0.33) { ctx.fillRect(x + 6, y + 8, 4, 1); ctx.fillRect(x + 8, y + 10, 1, 3); }
    }
  }
}
