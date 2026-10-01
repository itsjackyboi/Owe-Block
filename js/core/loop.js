import { FIXED_DT, MAX_STEPS } from '../config.js';

// Fixed 60 Hz update with an accumulator, rAF render, time scale and hit-stop.
export class Loop {
  constructor(update, render) {
    this.update = update;
    this.render = render;
    this.timeScale = 1;
    this.hitStop = 0; // seconds of frozen simulation remaining
    this.acc = 0;
    this.last = 0;
    this.running = false;
    this.fixedDt = FIXED_DT;
    this.maxSteps = MAX_STEPS;
    // perf: ring buffers of the last 600 frames
    this.updMs = new Float32Array(600);
    this.renMs = new Float32Array(600);
    this.frames = 0;
    this.fps = 60;
    this.fpsAcc = 0; this.fpsFrames = 0;
    this._tick = (t) => this.tick(t);
  }

  start() {
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this._tick);
  }

  stop() { this.running = false; }

  // Only call for hits and kills that involve the player.
  stopFor(seconds) { this.hitStop = Math.max(this.hitStop, seconds); }

  tick(now) {
    if (!this.running) return;
    requestAnimationFrame(this._tick);
    let frame = (now - this.last) / 1000;
    this.last = now;
    if (frame > 0.25) frame = 0.25;
    this.fpsAcc += frame; this.fpsFrames++;
    if (this.fpsAcc >= 0.5) { this.fps = this.fpsFrames / this.fpsAcc; this.fpsAcc = 0; this.fpsFrames = 0; }

    if (this.hitStop > 0) {
      this.hitStop -= frame;
      frame = 0;
    }
    this.acc += frame * this.timeScale;

    const t0 = performance.now();
    let steps = 0;
    while (this.acc >= this.fixedDt && steps < this.maxSteps) {
      this.update(this.fixedDt);
      this.acc -= this.fixedDt;
      steps++;
    }
    if (steps === this.maxSteps) this.acc = 0; // drop the backlog rather than spiral
    const t1 = performance.now();
    this.render(this.acc / this.fixedDt, frame || 1 / 60);
    const t2 = performance.now();

    const i = this.frames++ % 600;
    this.updMs[i] = t1 - t0;
    this.renMs[i] = t2 - t1;
  }

  stats() {
    const n = Math.min(this.frames, 600);
    if (!n) return { avg: 0, p99: 0, upd: 0, ren: 0 };
    const tot = new Float32Array(n);
    let su = 0, sr = 0;
    for (let i = 0; i < n; i++) { tot[i] = this.updMs[i] + this.renMs[i]; su += this.updMs[i]; sr += this.renMs[i]; }
    const sorted = Array.from(tot).sort((a, b) => a - b);
    const avg = (su + sr) / n;
    return { avg, p99: sorted[Math.min(n - 1, Math.floor(n * 0.99))], upd: su / n, ren: sr / n };
  }
}
