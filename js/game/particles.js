import { Pool } from '../core/pool.js';
import { drawText } from '../ui/font.js';

const FLAME = ['#ff5a1e', '#ff8a2a', '#ffc040', '#fff0a0'];

// Pooled pixel particles, floating damage numbers and swing trails. All cosmetic; nothing here affects the simulation.
export class Particles {
  constructor() {
    this.pool = new Pool(() => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, color: '#fff', size: 1, grav: 0, drag: 0 }), 2048);
    this.slashPool = new Pool(() => ({ owner: null, ang: 0, arc: 1, reach: 20, t: 0, dur: 0.12, color: '#fff', dir: 1 }), 64);
    this.popups = [];
    for (let i = 0; i < 40; i++) this.popups.push({ x: 0, y: 0, t: 0, text: '', color: '#fff', on: false });
    this.popIdx = 0;
  }

  get count() { return this.pool.active.length; }

  spark(x, y, vx, vy, life, color, size = 1, grav = 0, drag = 0) {
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

  popup(x, y, text, color = '#fff') {
    const p = this.popups[this.popIdx++ % this.popups.length];
    p.x = x; p.y = y; p.t = 0.7; p.text = text; p.color = color; p.on = true;
  }

  // Swing trail following `owner`. dir: +1 sweeps clockwise, -1 counter-clockwise.
  slash(owner, ang, arc, reach, dur, color = '#ffffff', dir = 1) {
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
    for (let i = 0; i < this.popups.length; i++) {
      const p = this.popups[i];
      if (p.on) drawText(ctx, p.text, Math.round(p.x - cam.rx), Math.round(p.y - cam.ry), { align: 'center', color: p.color });
    }
  }
}
