import { Pool } from '../core/pool.js';
import { drawText } from '../ui/font.js';

const FLAME = ['#ff5a1e', '#ff8a2a', '#ffc040', '#fff0a0'];

// Pooled pixel particles, floating damage numbers and swing trails. All cosmetic; nothing here affects the simulation.
export class Particles {
  constructor() {
    this.pool = new Pool(() => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, color: '#fff', size: 1, grav: 0, drag: 0 }), 2048);
    this.slashPool = new Pool(() => ({ owner: null, ang: 0, arc: 1, reach: 20, t: 0, dur: 0.12, color: '#fff', dir: 1 }), 64);
    this.beams = [];
    for (let i = 0; i < 16; i++) this.beams.push({ x0: 0, y0: 0, x1: 0, y1: 0, t: 0, dur: 1, on: false });
    this.rings = [];
    for (let i = 0; i < 16; i++) this.rings.push({ x: 0, y: 0, r: 0, t: 0, dur: 0.3, color: '#fff', on: false });
    this.popups = [];
    for (let i = 0; i < 40; i++) this.popups.push({ x: 0, y: 0, t: 0, text: '', color: '#fff', on: false });
    this.popIdx = 0;
    this.cam = null; // set by the match each frame; effects far outside the view are not created
  }

  off(x, y) {
    const c = this.cam;
    return c && (x < c.rx - 48 || x > c.rx + 528 || y < c.ry - 48 || y > c.ry + 318);
  }

  get count() { return this.pool.active.length; }

  spark(x, y, vx, vy, life, color, size = 1, grav = 0, drag = 0) {
    if (this.off(x, y)) return;
    const p = this.pool.acquire();
    if (!p) return;
    p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = p.max = life; p.color = color; p.size = size; p.grav = grav; p.drag = drag;
  }

  sparks(x, y, n, color, speed, life = 0.3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = speed * (0.3 + Math.random() * 0.7);
      this.spark(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + Math.random() * 0.6), color, 1, 0, 4);
    }
  }

  // Hit feedback: sparks thrown away from the attacker.
  hitSparks(x, y, ang, amount, big) {
    const n = Math.min(10, 3 + (amount / 6) | 0);
    for (let i = 0; i < n; i++) {
      const a = ang + (Math.random() - 0.5) * 1.6, s = 60 + Math.random() * 110;
      this.spark(x, y - 3, Math.cos(a) * s, Math.sin(a) * s, 0.22 + Math.random() * 0.2, big ? '#ff6a5a' : (i % 2 ? '#ffffff' : '#ffd890'), 1, 0, 5);
    }
  }

  deathBurst(x, y, outfit) {
    const c = outfit === 'red' ? ['#c8321e', '#ff6a5a'] : outfit === 'blue' ? ['#2a78d0', '#7ab0ff'] : outfit === 'police' ? ['#2a2e3c', '#6a7088'] : ['#9a9aa8', '#d8d8e0'];
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * 6.283, s = 40 + Math.random() * 120;
      this.spark(x, y - 3, Math.cos(a) * s, Math.sin(a) * s - 30, 0.5 + Math.random() * 0.4, c[i % 2], 2, 260, 2);
    }
  }

  flame(x, y, scale = 1) {
    this.spark(x, y, (Math.random() - 0.5) * 14, -(24 + Math.random() * 36) * scale, 0.3 + Math.random() * 0.35, FLAME[(Math.random() * 4) | 0], Math.random() < 0.5 ? 2 : 1, -20, 1);
  }

  dust(x, y, n = 6) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283;
      this.spark(x, y, Math.cos(a) * 40, Math.sin(a) * 25, 0.35, '#e8d0a8', 2, 0, 6);
    }
  }

  beam(x0, y0, x1, y1, dur) {
    if (this.off(x0, y0) && this.off(x1, y1)) return;
    const b = this.beams.find((q) => !q.on) || this.beams[0];
    b.x0 = x0; b.y0 = y0; b.x1 = x1; b.y1 = y1; b.t = 0; b.dur = dur; b.on = true;
  }

  ring(x, y, r, color = '#fff') {
    if (this.off(x, y)) return;
    const q = this.rings.find((w) => !w.on) || this.rings[0];
    q.x = x; q.y = y; q.r = r; q.t = 0; q.dur = 0.3; q.color = color; q.on = true;
  }

  // wind lines streaming through a cone
  gust(x, y, ang, reach, half) {
    for (let i = 0; i < 14; i++) {
      const a = ang + (Math.random() - 0.5) * half * 2, s = 140 + Math.random() * 120;
      this.spark(x + Math.cos(a) * 8, y + Math.sin(a) * 8, Math.cos(a) * s, Math.sin(a) * s, reach / s, i % 2 ? '#ffffff' : '#c8e8ff', 1, 0, 1.5);
    }
  }

  popup(x, y, text, color = '#fff') {
    if (this.off(x, y)) return;
    const p = this.popups[this.popIdx++ % this.popups.length];
    p.x = x; p.y = y; p.t = 0.7; p.text = text; p.color = color; p.on = true;
  }

  // Swing trail following `owner`. dir: +1 sweeps clockwise, -1 counter-clockwise.
  slash(owner, ang, arc, reach, dur, color = '#ffffff', dir = 1) {
    if (this.off(owner.x, owner.y)) return;
    const s = this.slashPool.acquire();
    if (!s) return;
    s.owner = owner; s.ang = ang; s.arc = arc; s.reach = reach; s.t = 0; s.dur = dur; s.color = color; s.dir = dir;
  }

  update(dt) {
    const a = this.pool.active;
    for (let i = a.length - 1; i >= 0; i--) {
      const p = a[i];
      p.life -= dt;
      if (p.life <= 0) { this.pool.release(p); continue; }
      p.vy += p.grav * dt;
      if (p.drag) { const d = Math.exp(-p.drag * dt); p.vx *= d; p.vy *= d; }
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    const s = this.slashPool.active;
    for (let i = s.length - 1; i >= 0; i--) {
      s[i].t += dt;
      if (s[i].t >= s[i].dur) this.slashPool.release(s[i]);
    }
    for (const b of this.beams) if (b.on) { b.t += dt; if (b.t >= b.dur) b.on = false; }
    for (const q of this.rings) if (q.on) { q.t += dt; if (q.t >= q.dur) q.on = false; }
    for (let i = 0; i < this.popups.length; i++) {
      const p = this.popups[i];
      if (p.on) { p.t -= dt; p.y -= 22 * dt; if (p.t <= 0) p.on = false; }
    }
  }

  draw(ctx, cam) {
    const a = this.pool.active;
    for (let i = 0; i < a.length; i++) {
      const p = a[i];
      ctx.fillStyle = p.color;
      const sz = p.life < p.max * 0.3 ? 1 : p.size;
      ctx.fillRect(Math.round(p.x - cam.rx), Math.round(p.y - cam.ry), sz, sz);
    }
    const s = this.slashPool.active;
    for (let i = 0; i < s.length; i++) {
      const w = s[i], u = w.t / w.dur;
      const ox = w.owner.x - cam.rx, oy = w.owner.y - cam.ry - 3;
      const head = w.ang - (w.arc / 2) * w.dir + w.arc * u * w.dir;
      const steps = 9;
      for (let k = 0; k < steps; k++) {
        const f = k / steps;
        const ang = head - f * w.arc * 0.55 * w.dir;
        const fade = 1 - f;
        for (let r = -1; r <= 1; r++) {
          const rr = w.reach + r * 2.2;
          ctx.fillStyle = fade > 0.55 ? w.color : (fade > 0.25 ? '#c8d4e8' : '#6a7898');
          ctx.fillRect(Math.round(ox + Math.cos(ang) * rr), Math.round(oy + Math.sin(ang) * rr), 2, 2);
        }
      }
    }
    for (const b of this.beams) {
      if (!b.on) continue;
      const u = b.t / b.dur, dx = b.x1 - b.x0, dy = b.y1 - b.y0, n = Math.ceil(Math.hypot(dx, dy) / 2);
      for (let i = 0; i < n; i++) {
        const f = i / n, x = Math.round(b.x0 + dx * f - cam.rx), y = Math.round(b.y0 + dy * f - cam.ry);
        ctx.fillStyle = '#7a3ab8'; ctx.fillRect(x - 2, y - 2, 5, 5);
        ctx.fillStyle = u < 0.6 ? '#c88aff' : '#9a5ad8'; ctx.fillRect(x - 1, y - 1, 3, 3);
        if (u < 0.5) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, 1, 1); }
      }
    }
    for (const q of this.rings) {
      if (!q.on) continue;
      const r = q.r * (0.5 + 0.5 * (q.t / q.dur)), n = Math.max(16, (r * 2) | 0);
      ctx.fillStyle = q.color;
      for (let i = 0; i < n; i++) { const a = (i / n) * 6.283; ctx.fillRect(Math.round(q.x - cam.rx + Math.cos(a) * r), Math.round(q.y - cam.ry + Math.sin(a) * r * 0.8), 2, 2); }
    }
    for (let i = 0; i < this.popups.length; i++) {
      const p = this.popups[i];
      if (p.on) drawText(ctx, p.text, Math.round(p.x - cam.rx), Math.round(p.y - cam.ry), { align: 'center', color: p.color });
    }
  }
}
