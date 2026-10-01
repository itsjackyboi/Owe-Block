import { INTERNAL_W, INTERNAL_H, CAMERA } from '../config.js';
import { clamp, damp } from './math.js';

// Draws at 480x270 and lets CSS scale the canvas up with nearest-neighbour filtering.
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.canvas.width = INTERNAL_W;
    this.canvas.height = INTERNAL_H;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.ctx.imageSmoothingEnabled = false;
    this.scale = 1;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const sw = window.innerWidth, sh = window.innerHeight;
    let s = Math.min(sw / INTERNAL_W, sh / INTERNAL_H);
    if (s >= 1) s = Math.floor(s); // integer scale keeps pixels square when there is room
    this.scale = s;
    this.canvas.style.width = Math.floor(INTERNAL_W * s) + 'px';
    this.canvas.style.height = Math.floor(INTERNAL_H * s) + 'px';
  }

  // Window coordinates -> internal 480x270 coordinates.
  mapMouse(input) {
    const r = this.canvas.getBoundingClientRect();
    input.mx = clamp(((input.clientX - r.left) / r.width) * INTERNAL_W, 0, INTERNAL_W - 1);
    input.my = clamp(((input.clientY - r.top) / r.height) * INTERNAL_H, 0, INTERNAL_H - 1);
  }

  clear(color = '#0b0a10') {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
  }
}

// Camera: smooth follow, aim lean, clamp to the world, trauma-based shake.
export class Camera {
  constructor() {
    this.x = 0; this.y = 0;       // top-left of the view in world px (float)
    this.rx = 0; this.ry = 0;     // rounded, shake applied: what drawing uses
    this.w = INTERNAL_W; this.h = INTERNAL_H;
    this.trauma = 0;
    this.shakeEnabled = true;
    this.t = 0;
  }

  snapTo(wx, wy, worldW, worldH) {
    this.x = clamp(wx - this.w / 2, 0, Math.max(0, worldW - this.w));
    this.y = clamp(wy - this.h / 2, 0, Math.max(0, worldH - this.h));
    this.rx = Math.round(this.x); this.ry = Math.round(this.y);
  }

  // lean: extra offset toward the cursor, already scaled by the caller.
  update(dt, tx, ty, leanX, leanY, worldW, worldH) {
    const gx = clamp(tx + leanX - this.w / 2, 0, Math.max(0, worldW - this.w));
    const gy = clamp(ty + leanY - this.h / 2, 0, Math.max(0, worldH - this.h));
    const k = damp(CAMERA.follow, dt);
    this.x += (gx - this.x) * k;
    this.y += (gy - this.y) * k;
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - CAMERA.traumaDecay * dt);
    let sx = 0, sy = 0;
    if (this.shakeEnabled && this.trauma > 0) {
      const m = this.trauma * this.trauma * CAMERA.shakeMax;
      sx = Math.sin(this.t * 91.7) * m;
      sy = Math.sin(this.t * 77.3 + 1.7) * m;
    }
    this.rx = Math.round(this.x + sx);
    this.ry = Math.round(this.y + sy);
  }

  addTrauma(a) { this.trauma = Math.min(1, this.trauma + a); }
  screenToWorldX(sx) { return sx + this.rx; }
  screenToWorldY(sy) { return sy + this.ry; }
}
