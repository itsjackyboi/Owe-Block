import { INTERNAL_W, INTERNAL_H } from '../config.js';
import { damage } from './combat.js';
import { clamp, lerp } from '../core/math.js';

// "Gobbler's Police Sweep": a rectangle that closes in from the map edges toward a seeded final point.
// Each target rectangle lies inside the previous one and always contains the final point.
// Default timeline (about 6:35): 1:00 safe, four shrinks to 70/45/25/10% of the map, then a 45 s collapse.
const SHRINK_FRACS = [0.7, 0.45, 0.25, 0.10];
const SHRINK_TIMES = [40, 40, 35, 30];
const PAUSE_TIMES = [50, 40, 30, 25];
const SAFE_TIME = 60;
const COLLAPSE_TIME = 45;
const DPS = [2, 4, 7, 11, 16];   // damage per second outside, by phase (the last is the collapse)
const EXPOSURE_RAMP = 1;         // +1 dps for every second of continuous exposure
const TICK = 0.25;

export class Zone {
  constructor(match, rng, scale = 1) {
    const map = match.map;
    this.match = match;
    this.W = map.pxW; this.H = map.pxH;
    const ch = match.chambers[rng.int(0, match.chambers.length)];
    this.fx = (ch.x + 0.5) * 16; this.fy = (ch.y + 0.5) * 16; // final point

    // target rectangles, each inside the last and containing the final point
    this.targets = [];
    let prev = { x0: 0, y0: 0, x1: this.W, y1: this.H };
    for (let k = 0; k < SHRINK_FRACS.length; k++) {
      const w = SHRINK_FRACS[k] * this.W, h = SHRINK_FRACS[k] * this.H;
      const cx = this.pickCentre(rng, prev.x0 + w / 2, prev.x1 - w / 2, this.fx - w / 2 + 24, this.fx + w / 2 - 24, this.fx);
      const cy = this.pickCentre(rng, prev.y0 + h / 2, prev.y1 - h / 2, this.fy - h / 2 + 24, this.fy + h / 2 - 24, this.fy);
      prev = { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
      this.targets.push(prev);
    }
    this.targets.push({ x0: this.fx, y0: this.fy, x1: this.fx, y1: this.fy }); // collapse to the point

    // timeline
    this.phases = [{ kind: 'wait', dur: SAFE_TIME * scale, next: 0 }];
    for (let k = 0; k < 4; k++) {
      this.phases.push({ kind: 'shrink', k, dur: SHRINK_TIMES[k] * scale });
      this.phases.push({ kind: 'wait', dur: PAUSE_TIMES[k] * scale, next: k + 1 });
    }
    this.phases.push({ kind: 'collapse', k: 4, dur: COLLAPSE_TIME * scale });
    this.total = this.phases.reduce((n, p) => n + p.dur, 0);

    this.rect = { x0: 0, y0: 0, x1: this.W, y1: this.H };
    this.from = { x0: 0, y0: 0, x1: this.W, y1: this.H };
    this.idx = 0; this.phaseT = 0; this.t = 0;
    this.dps = 0; this.tick = TICK;
    this.version = 0;
    this.hatch = null;
  }

  pickCentre(rng, lo, hi, flo, fhi, f) {
    const a = Math.max(lo, flo), b = Math.min(hi, fhi);
    if (a <= b) return rng.float(a, b);
    return clamp(f, Math.min(lo, hi), Math.max(lo, hi));
  }

  get phase() { return this.phases[Math.min(this.idx, this.phases.length - 1)]; }
  get done() { return this.idx >= this.phases.length; }

  // Index of the target rectangle that the next (or current) shrink closes in on.
  get upcoming() {
    for (let i = this.idx; i < this.phases.length; i++) { const p = this.phases[i]; if (p.kind !== 'wait') return p.k; }
    return this.targets.length - 1;
  }

  get target() { return this.targets[this.upcoming]; }

  get shrinking() { return !this.done && this.phase.kind !== 'wait'; }

  // Seconds until the closing starts (0 while closing).
  get untilShrink() {
    if (this.done || this.phase.kind !== 'wait') return 0;
    return this.phase.dur - this.phaseT;
  }

  label() {
    if (this.done) return { text: 'SWEEP COMPLETE', closing: true };
    const p = this.phase, left = Math.max(0, Math.ceil(p.dur - this.phaseT));
    const t = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
    if (p.kind === 'wait') return { text: 'SWEEP IN ' + t, closing: false };
    if (p.kind === 'collapse') return { text: 'SWEEP CLOSING ' + t, closing: true };
    return { text: 'SWEEPING ' + t, closing: true };
  }

  inside(x, y, margin = 0) {
    const r = this.rect;
    return x >= r.x0 + margin && x <= r.x1 - margin && y >= r.y0 + margin && y <= r.y1 - margin;
  }

  update(dt) {
    const m = this.match;
    this.t += dt;
    if (!this.done) {
      this.phaseT += dt;
      while (!this.done && this.phaseT >= this.phase.dur) {
        this.phaseT -= this.phase.dur;
        this.endPhase();
      }
    }
    if (!this.done && this.phase.kind !== 'wait') {
      const u = clamp(this.phaseT / this.phase.dur, 0, 1), a = this.from, b = this.targets[this.phase.k];
      this.rect.x0 = lerp(a.x0, b.x0, u); this.rect.y0 = lerp(a.y0, b.y0, u);
      this.rect.x1 = lerp(a.x1, b.x1, u); this.rect.y1 = lerp(a.y1, b.y1, u);
    }

    // damage outside the zone: phase rate plus a ramp for continuous exposure
    const fs = m.fighters;
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      if (f.dead) continue;
      if (this.dps > 0 && !this.inside(f.x, f.y)) f.exposure += dt; else f.exposure = 0;
    }
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick += TICK;
      if (this.dps > 0) {
        for (let i = 0; i < fs.length; i++) {
          const f = fs[i];
          if (f.dead || f.exposure <= 0) continue;
          damage(m, f, (this.dps + f.exposure * EXPOSURE_RAMP) * TICK, { kind: 'zone', quiet: true });
        }
      }
    }
  }

  // A phase just ended: snapshot the rectangle and start the next one.
  endPhase() {
    const ended = this.phase;
    if (ended.kind !== 'wait') { const b = this.targets[ended.k]; this.rect.x0 = b.x0; this.rect.y0 = b.y0; this.rect.x1 = b.x1; this.rect.y1 = b.y1; }
    this.idx++;
    if (this.done) return;
    const p = this.phase;
    if (p.kind !== 'wait') {
      Object.assign(this.from, this.rect);
      this.dps = DPS[p.k];
      this.version++;
      this.match.onZoneShrink(p.k);
    }
  }
}

// ---- drawing ----

function hatchPattern(ctx) {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 8;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(14,8,26,0.5)'; g.fillRect(0, 0, 8, 8);
  g.fillStyle = 'rgba(0,0,0,0.55)';
  for (let i = 0; i < 8; i++) { g.fillRect(i, 7 - i, 1, 1); g.fillRect((i + 4) % 8, (11 - i) % 8, 1, 1); }
  return ctx.createPattern(c, 'repeat');
}

// Darkened, hatched area outside the zone, plus a marching line of dark-uniformed police along the edge.
export function drawZone(ctx, cam, zone, sprites, time) {
  if (!zone.hatch) zone.hatch = hatchPattern(ctx);
  const r = zone.rect;
  const x0 = Math.round(r.x0 - cam.rx), y0 = Math.round(r.y0 - cam.ry), x1 = Math.round(r.x1 - cam.rx), y1 = Math.round(r.y1 - cam.ry);
  const W = INTERNAL_W, H = INTERNAL_H;
  ctx.save();
  ctx.translate(-(cam.rx % 8), -(cam.ry % 8)); // pattern follows the world, not the screen
  ctx.fillStyle = zone.hatch;
  const ox = cam.rx % 8, oy = cam.ry % 8;
  const a = (x, y, w, h) => { if (w > 0 && h > 0) ctx.fillRect(x + ox, y + oy, w, h); };
  a(0, 0, W, Math.min(H, y0));                                         // above
  a(0, Math.max(0, y1), W, H - Math.max(0, y1));                       // below
  a(0, Math.max(0, y0), Math.min(W, x0), Math.min(H, y1) - Math.max(0, y0));                   // left
  a(Math.max(0, x1), Math.max(0, y0), W - Math.max(0, x1), Math.min(H, y1) - Math.max(0, y0)); // right
  ctx.restore();
  if (x1 - x0 < 2) return;

  // the edge itself
  ctx.fillStyle = '#c8321e';
  if (y0 >= 0 && y0 < H) ctx.fillRect(Math.max(0, x0), y0, Math.min(W, x1) - Math.max(0, x0), 1);
  if (y1 >= 0 && y1 < H) ctx.fillRect(Math.max(0, x0), y1, Math.min(W, x1) - Math.max(0, x0), 1);
  if (x0 >= 0 && x0 < W) ctx.fillRect(x0, Math.max(0, y0), 1, Math.min(H, y1) - Math.max(0, y0));
  if (x1 >= 0 && x1 < W) ctx.fillRect(x1, Math.max(0, y0), 1, Math.min(H, y1) - Math.max(0, y0));

  // police, one every 44 px, facing inward
  const SP = 44, drawCop = (wx, wy, i) => {
    const sx = Math.round(wx - cam.rx), sy = Math.round(wy - cam.ry);
    if (sx < -16 || sx > W + 16 || sy < -16 || sy > H + 16) return;
    const spr = sprites.fighter({ body: i % 3, outfit: 'police', hair: (i * 5) % 17, hat: true });
    const bob = Math.abs(Math.sin(time * 5 + i)) * 1.5;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(sx - 4, sy + 4, 8, 2);
    ctx.drawImage(spr.normal, sx - 8, sy - 11 - Math.round(bob));
  };
  const along = (from, to, fixed, horiz, off) => {
    const start = Math.max(from, (horiz ? cam.rx : cam.ry) - SP), end = Math.min(to, (horiz ? cam.rx + W : cam.ry + H) + SP);
    for (let p = Math.ceil(start / SP) * SP; p < end; p += SP) {
      if (p < from || p > to) continue;
      const i = Math.floor(p / SP);
      if (horiz) drawCop(p + Math.sin(time * 1.5 + i) * 3, fixed + off, i); else drawCop(fixed + off, p + Math.sin(time * 1.5 + i) * 3, i);
    }
  };
  along(r.x0, r.x1, r.y0, true, -8); along(r.x0, r.x1, r.y1, true, 12);
  along(r.y0, r.y1, r.x0, false, -9); along(r.y0, r.y1, r.x1, false, 9);
}
