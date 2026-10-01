import { Pool } from '../core/pool.js';

// Readable warnings for dangerous attacks (beam lines, arcs, rings). The AI reads these too, so what you can see is what it can dodge.
// type: 'line' (x,y,ang,len), 'arc' (x,y,ang,arc,len) or 'ring' (x,y,r)
export class Telegraphs {
  constructor(match) {
    this.match = match;
    this.pool = new Pool(() => ({ type: 'line', x: 0, y: 0, ang: 0, len: 0, arc: 0, r: 0, t: 0, dur: 1, owner: null, color: '#c88aff', follow: false, id: 0 }), 64);
    this.nextId = 1;
  }

  get count() { return this.pool.active.length; }

  add(o) {
    const t = this.pool.acquire();
    if (!t) return null;
    t.type = o.type; t.x = o.x; t.y = o.y; t.ang = o.ang || 0; t.len = o.len || 0; t.arc = o.arc || 0; t.r = o.r || 0;
    t.t = 0; t.dur = o.dur; t.owner = o.owner || null; t.color = o.color || '#c88aff'; t.follow = !!o.follow; t.id = this.nextId++;
    return t;
  }

  remove(t) { if (t && t.id) { t.id = 0; this.pool.release(t); } }

  update(dt) {
    const a = this.pool.active;
    for (let i = a.length - 1; i >= 0; i--) {
      const t = a[i];
      t.t += dt;
      if (t.follow && t.owner) { t.x = t.owner.x; t.y = t.owner.y - 3; }
      if (t.t >= t.dur || (t.owner && t.owner.dead)) { t.id = 0; this.pool.release(t); }
    }
  }

  // Is the circle (x, y, r) inside any danger area of a telegraph not owned by `except`? Returns that telegraph or null.
  threat(x, y, r, except) {
    const a = this.pool.active;
    for (let i = 0; i < a.length; i++) {
      const t = a[i];
      if (t.owner === except) continue;
      if (t.type === 'ring') { if (Math.hypot(x - t.x, y - t.y) < t.r + r) return t; continue; }
      // distance from the point to the segment (line) or wedge (arc)
      const dx = x - t.x, dy = y - t.y, c = Math.cos(t.ang), s = Math.sin(t.ang);
      const along = dx * c + dy * s, across = -dx * s + dy * c;
      if (t.type === 'line') { if (along > -r && along < t.len + r && Math.abs(across) < r + 7) return t; continue; }
      const d = Math.hypot(dx, dy);
      if (d < t.len + r) {
        let da = Math.atan2(dy, dx) - t.ang;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        if (Math.abs(da) < t.arc / 2 + Math.atan2(r + 4, Math.max(d, 1))) return t;
      }
    }
    return null;
  }

  draw(ctx, cam) {
    const a = this.pool.active;
    for (let i = 0; i < a.length; i++) {
      const t = a[i];
      const u = t.t / t.dur, on = ((t.t * (6 + 14 * u)) | 0) % 2 === 0;
      const ox = t.x - cam.rx, oy = t.y - cam.ry;
      ctx.fillStyle = t.color;
      if (t.type === 'line') {
        const c = Math.cos(t.ang), s = Math.sin(t.ang);
        for (let d = 10; d < t.len; d += 6) if (on || d % 12 === 0) ctx.fillRect(Math.round(ox + c * d), Math.round(oy + s * d), 2, 2);
      } else if (t.type === 'arc') {
        for (let k = 0; k <= 10; k++) {
          const ang = t.ang - t.arc / 2 + (t.arc * k) / 10, c = Math.cos(ang), s = Math.sin(ang);
          for (let d = 14; d < t.len; d += 10) if (on || k === 0 || k === 10) ctx.fillRect(Math.round(ox + c * d), Math.round(oy + s * d), 1, 1);
        }
      } else {
        const n = Math.max(12, (t.r * 1.6) | 0);
        for (let k = 0; k < n; k++) {
          if (!on && k % 2) continue;
          const ang = (k / n) * 6.283 + t.t * 2;
          ctx.fillRect(Math.round(ox + Math.cos(ang) * t.r), Math.round(oy + Math.sin(ang) * t.r * 0.9), 2, 2);
        }
        ctx.fillStyle = 'rgba(200,138,255,' + (0.1 + 0.25 * u) + ')';
        ctx.beginPath(); ctx.ellipse(ox, oy, t.r, t.r * 0.9, 0, 0, 6.283); ctx.fill();
      }
    }
  }
}
