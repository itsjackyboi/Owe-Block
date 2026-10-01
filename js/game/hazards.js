import { TILE } from '../config.js';
import { RNG } from '../core/rng.js';
import { damage } from './combat.js';
import { applyStatus } from './statuses.js';
import { T } from './map.js';

// Per-mode hazards, driven by the mode entry's `hazards` list: [{ type, ...params }]. Each type is a small handler here.
//  darkness   (Mines)    : light radius around each fighter; the match reads match.lightRadius for AI sight and the renderer for the overlay
//  caveIn     (Mines)    : a shadow ring for 1.2 s, then 25 damage and a stun
//  skylights  (Rooftops) : stand on a pane for 1 s and it gives way (you fall like into a gap)
//  conveyors  (Pipe Pit) : belts push whoever stands on them
//  steamVents (Pipe Pit) : a hiss telegraph, then a burst that hurts and shoves
export class Hazards {
  constructor(match, defs) {
    this.match = match;
    this.defs = defs || [];
    this.rng = new RNG((match.seed ^ 0x51ed270b) >>> 0);
    this.lightRadius = 0;
    this.caveT = 0; this.cave = null;
    this.sky = null; this.vents = null; this.push = 0;
    for (const d of this.defs) {
      if (d.type === 'darkness') this.lightRadius = d.radius;
      if (d.type === 'caveIn') { this.cave = d; this.caveT = this.rng.float(d.every[0], d.every[1]); }
      if (d.type === 'skylights') this.sky = (match.gen.skylights || []).map((s) => ({ tx: s.tx, ty: s.ty, t: 0, broken: false, d }));
      if (d.type === 'conveyors') this.push = d.push;
      if (d.type === 'steamVents') this.vents = (match.gen.vents || []).map((v) => ({ x: v.x, y: v.y, phase: v.phase, period: v.period, state: 'idle', t: 0, hit: [], d, tele: null }));
    }
    this.cavesPending = [];
  }

  // A tile that would not be a safe place to return to after a fall (an unbroken skylight pane).
  unsafe(tx, ty) {
    if (!this.sky) return false;
    for (const s of this.sky) if (!s.broken && s.tx === tx && s.ty === ty) return true;
    return false;
  }

  update(dt) {
    const m = this.match;
    if (this.cave) this.updateCave(dt);
    if (this.sky) this.updateSky(dt);
    if (this.push) this.updateConveyors();
    if (this.vents) this.updateVents(dt);
    void m;
  }

  // ---- cave-ins ----
  updateCave(dt) {
    const m = this.match, d = this.cave;
    this.caveT -= dt;
    if (this.caveT > 0) return;
    this.caveT = this.rng.float(d.every[0], d.every[1]);
    // aim at a living fighter now and then, otherwise anywhere in the safe area
    const alive = m.fighters.filter((f) => !f.dead);
    let x, y;
    if (alive.length && this.rng.chance(0.45)) { const f = alive[this.rng.int(0, alive.length)]; x = f.x + this.rng.float(-30, 30); y = f.y + this.rng.float(-30, 30); }
    else { const c = m.chambers[this.rng.int(0, m.chambers.length)]; x = (c.x + 0.5) * TILE + this.rng.float(-50, 50); y = (c.y + 0.5) * TILE + this.rng.float(-50, 50); }
    if (m.map.tileAtPx(x, y) !== T.FLOOR) return;
    m.telegraphs.add({ type: 'ring', x, y, r: d.radius, dur: d.warn, color: '#ffffff' });
    m.later(d.warn, () => this.collapse(x, y));
  }

  collapse(x, y) {
    const m = this.match, d = this.cave;
    m.hash.query(x, y, d.radius, m.tmp);
    for (let i = 0; i < m.tmp.length; i++) {
      const t = m.tmp[i];
      if (t.dead) continue;
      damage(m, t, d.damage, { kind: 'area', kb: 0 });
      applyStatus(t, 'stun', d.stun);
      m.fx.popup(t.x, t.y - 12, 'CAVE-IN', '#ffffff');
    }
    m.fx.sparks(x, y, 24, '#7a5a48', 130, 0.6);
    m.fx.dust(x, y, 10);
    m.fx.ring(x, y, d.radius, '#c8a888');
    const near = Math.hypot(m.player.x - x, m.player.y - y);
    if (near < 220) m.camera.addTrauma(0.5 * (1 - near / 220));
    m.sfx('cavein', x, y);
  }

  // ---- skylights ----
  updateSky(dt) {
    const m = this.match;
    for (const s of this.sky) {
      if (s.broken) continue;
      const cx = (s.tx + 0.5) * TILE, cy = (s.ty + 0.5) * TILE;
      m.hash.query(cx, cy, 6, m.tmp);
      let on = false;
      for (let i = 0; i < m.tmp.length; i++) {
        const f = m.tmp[i];
        if (!f.dead && !f.dashing && Math.abs(f.x - cx) < TILE / 2 && Math.abs(f.y - cy) < TILE / 2) { on = true; break; }
      }
      if (on) s.t += dt; else s.t = Math.max(0, s.t - dt * 0.5);
      if (s.t >= s.d.crack) { // the pane gives way: everyone standing on it falls
        s.broken = true;
        const standing = m.tmp.slice();
        m.map.setTile(s.tx, s.ty, T.PIT);
        m.fx.sparks(cx, cy, 14, '#bfe8ff', 120, 0.5);
        m.sfx('glass', cx, cy);
        for (const f of standing) if (!f.dead && !f.dashing && Math.abs(f.x - cx) < TILE / 2 + 2 && Math.abs(f.y - cy) < TILE / 2 + 2) f.fall(m);
      }
    }
  }

  // ---- conveyors ----
  updateConveyors() {
    const m = this.match, map = m.map, conv = map.conv, fs = m.fighters;
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      f.cvx = f.cvy = 0;
      if (f.dead || f.dashing || !conv) continue;
      const c = conv[Math.floor(f.y / TILE) * map.w + Math.floor(f.x / TILE)];
      if (!c) continue;
      f.cvx = c === 1 ? this.push : c === 2 ? -this.push : 0;
      f.cvy = c === 3 ? this.push : c === 4 ? -this.push : 0;
    }
  }

  // ---- steam vents ----
  updateVents(dt) {
    const m = this.match;
    for (const v of this.vents) {
      const d = v.d;
      v.t += dt;
      if (v.state === 'idle') {
        if (((m.time + v.phase) % v.period) < dt) { v.state = 'hiss'; v.t = 0; v.hit.length = 0; v.tele = m.telegraphs.add({ type: 'ring', x: v.x, y: v.y, r: d.radius, dur: d.hiss, color: '#e8f0ff' }); }
      } else if (v.state === 'hiss') {
        if (Math.random() < dt * 40) m.fx.spark(v.x + (Math.random() - 0.5) * 8, v.y, (Math.random() - 0.5) * 10, -20 - Math.random() * 20, 0.6, '#e8f0ff', 2, 0, 0);
        if (v.t >= d.hiss) { v.state = 'burst'; v.t = 0; m.sfx('steam', v.x, v.y); }
      } else if (v.state === 'burst') {
        for (let k = 0; k < 4; k++) { const a = Math.random() * 6.283, s = 30 + Math.random() * 90; m.fx.spark(v.x, v.y, Math.cos(a) * s, Math.sin(a) * s * 0.6 - 20, 0.5, k % 2 ? '#ffffff' : '#c8d8f0', 3, 0, 3); }
        m.hash.query(v.x, v.y, d.radius, m.tmp);
        for (let i = 0; i < m.tmp.length; i++) {
          const t = m.tmp[i];
          if (t.dead || v.hit.indexOf(t.id) >= 0) continue;
          v.hit.push(t.id);
          const ang = Math.atan2(t.y - v.y, t.x - v.x);
          damage(m, t, d.damage, { kind: 'area', kb: d.kb, ang });
          m.fx.popup(t.x, t.y - 12, 'STEAM', '#e8f0ff');
        }
        if (v.t >= d.burst) { v.state = 'idle'; v.t = 0; }
      }
    }
  }

  // Skylight panes, vent grates and the darkness overlay.
  draw(ctx, cam) {
    const m = this.match;
    if (this.sky) {
      for (const s of this.sky) {
        if (s.broken) continue;
        const x = Math.round(s.tx * TILE - cam.rx), y = Math.round(s.ty * TILE - cam.ry);
        if (x < -16 || x > 496 || y < -16 || y > 286) continue;
        ctx.fillStyle = '#1c2a3c'; ctx.fillRect(x + 1, y + 1, 14, 14);
        ctx.fillStyle = s.t > 0 && ((s.t * 14) | 0) % 2 ? '#e8f8ff' : '#7ab8e0'; ctx.fillRect(x + 2, y + 2, 12, 12);
        ctx.fillStyle = '#c8ecff'; ctx.fillRect(x + 3, y + 3, 4, 1); ctx.fillRect(x + 3, y + 3, 1, 4);
        ctx.fillStyle = '#1c2a3c'; ctx.fillRect(x + 8, y + 2, 1, 12); ctx.fillRect(x + 2, y + 8, 12, 1);
        if (s.t > 0.3) { ctx.fillStyle = '#10101c'; ctx.fillRect(x + 4, y + 5, 3, 1); ctx.fillRect(x + 6, y + 6, 1, 3); ctx.fillRect(x + 9, y + 9, 3, 1); if (s.t > 0.65) { ctx.fillRect(x + 3, y + 10, 4, 1); ctx.fillRect(x + 10, y + 4, 1, 4); } }
      }
    }
    if (this.vents) {
      for (const v of this.vents) {
        const x = Math.round(v.x - cam.rx), y = Math.round(v.y - cam.ry);
        if (x < -20 || x > 500 || y < -20 || y > 290) continue;
        ctx.fillStyle = '#10101c'; ctx.fillRect(x - 5, y - 3, 10, 6);
        ctx.fillStyle = v.state === 'burst' ? '#ffffff' : (v.state === 'hiss' ? '#ffd0a0' : '#5a6070'); ctx.fillRect(x - 4, y - 2, 8, 4);
        ctx.fillStyle = '#10101c'; for (let k = -3; k <= 3; k += 2) ctx.fillRect(x + k, y - 2, 1, 4);
      }
    }
    void m;
  }
}

// ---- darkness (Mines): a dark veil with a soft light around every fighter and every fire ----
let lightSprite = null, veil = null;
function makeLight(r) {
  const c = document.createElement('canvas');
  c.width = c.height = r * 2;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(r, r, r * 0.35, r, r, r);
  grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(0.55, 'rgba(0,0,0,0.85)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, r * 2, r * 2);
  return c;
}

export function drawDarkness(ctx, cam, match) {
  const R = match.hazards.lightRadius;
  if (!R) return;
  if (!lightSprite || lightSprite.height !== R * 2) lightSprite = makeLight(R);
  if (!veil) { veil = document.createElement('canvas'); veil.width = 480; veil.height = 270; }
  const g = veil.getContext('2d');
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, 480, 270);
  g.fillStyle = 'rgba(6,3,14,0.9)'; g.fillRect(0, 0, 480, 270);
  g.globalCompositeOperation = 'destination-out';
  const fs = match.fighters;
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i];
    if (f.dead) continue;
    const x = f.x - cam.rx, y = f.y - cam.ry;
    if (x < -R || x > 480 + R || y < -R || y > 270 + R) continue;
    const flick = f.isPlayer ? 1 : 0.62; // you carry the brightest lamp; others glow a little less
    g.globalAlpha = flick; g.drawImage(lightSprite, Math.round(x - R), Math.round(y - R));
  }
  g.globalAlpha = 0.9;
  const areas = match.areas.pool.active;
  for (let i = 0; i < areas.length; i++) {
    const a = areas[i];
    if (a.kind !== 'fire') continue;
    const r = Math.min(R, a.r * 2.4), x = a.x - cam.rx, y = a.y - cam.ry;
    g.drawImage(lightSprite, Math.round(x - r), Math.round(y - r), r * 2, r * 2);
  }
  g.globalAlpha = 1;
  ctx.drawImage(veil, 0, 0);
}
