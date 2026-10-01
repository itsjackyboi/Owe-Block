import { SFX } from '../data/sfx.js';
import { MUSIC } from '../data/music.js';

// WebAudio chiptune engine, no audio files: two pulse channels (PeriodicWave duty), a triangle, and a noise buffer.
// Music is a lookahead step sequencer (25 ms timer, 100 ms ahead). Sound effects are attenuated by distance from the camera,
// culled off screen, and capped at 12 voices. The context is created on the first user gesture.
const MAX_VOICES = 12;
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

function freq(name) {
  const m = /^([A-G]#?)(\d)$/.exec(name);
  if (!m) return 0;
  return 440 * Math.pow(2, (NOTE[m[1]] + (+m[2] + 1) * 12 - 69) / 12);
}

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;     // { volumes: { master, music, sfx } }
    this.ctx = null;
    this.voices = 0;
    this.waves = new Map();
    this.noise = null;
    this.track = null; this.step = 0; this.nextTime = 0; this.timer = null; this.trackId = null;
  }

  get ready() { return !!this.ctx; }

  // Call on the first gesture (browsers refuse audio before that).
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain(); this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain(); this.sfxGain.connect(this.master);
      const n = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, n, n);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this.applyVolumes();
      if (this.trackId) { const id = this.trackId; this.trackId = null; this.music(id); }
    } catch { this.ctx = null; }
  }

  applyVolumes() {
    if (!this.ctx) return;
    const v = this.settings.volumes;
    this.master.gain.value = v.master;
    this.musicGain.gain.value = v.music * 0.5;
    this.sfxGain.gain.value = v.sfx;
  }

  pulse(duty) {
    let w = this.waves.get(duty);
    if (w) return w;
    const N = 48, re = new Float32Array(N), im = new Float32Array(N);
    for (let n = 1; n < N; n++) { re[n] = (2 / (n * Math.PI)) * Math.sin(2 * Math.PI * n * duty); im[n] = (2 / (n * Math.PI)) * (1 - Math.cos(2 * Math.PI * n * duty)); }
    w = this.ctx.createPeriodicWave(re, im);
    this.waves.set(duty, w);
    return w;
  }

  // One tone (or noise burst) with a short envelope. dest = which bus.
  tone(layer, t0, gain, dest) {
    const ctx = this.ctx, dur = layer.dur, vol = layer.vol * gain;
    if (vol <= 0.001) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let src;
    if (layer.wave === 'noise') {
      src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      let node = src;
      if (layer.hp) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = layer.hp; node.connect(f); node = f; }
      if (layer.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = layer.lp; node.connect(f); node = f; }
      node.connect(g);
    } else {
      src = ctx.createOscillator();
      if (layer.wave === 'pulse') src.setPeriodicWave(this.pulse(layer.duty || 0.5)); else src.type = layer.wave === 'tri' ? 'triangle' : 'sawtooth';
      src.frequency.setValueAtTime(layer.f0, t0);
      if (layer.f1 && layer.f1 !== layer.f0) src.frequency.exponentialRampToValueAtTime(Math.max(20, layer.f1), t0 + dur);
      src.connect(g);
    }
    g.connect(dest);
    src.start(t0); src.stop(t0 + dur + 0.02);
    return src;
  }

  // Positional sound effect. cam = the camera (for distance), x/y in world px; omit x for a UI sound.
  sfx(name, x, y, cam) {
    const def = SFX[name];
    if (!def || !this.ctx || this.voices >= MAX_VOICES) return;
    let gain = 1;
    if (x != null && cam) {
      const dx = x - (cam.rx + 240), dy = y - (cam.ry + 135), d = Math.hypot(dx, dy);
      if (d > 420) return;                                   // culled: far off screen
      gain = Math.pow(1 - d / 420, 1.4) * (d > 300 ? 0.6 : 1);
    }
    const t0 = this.ctx.currentTime + 0.005;
    this.voices++;
    let last = null;
    for (const layer of def) last = this.tone(layer, t0 + (layer.delay || 0), gain, this.sfxGain) || last;
    const total = Math.max(...def.map((l) => (l.delay || 0) + l.dur)) + 0.05;
    setTimeout(() => { this.voices = Math.max(0, this.voices - 1); }, total * 1000);
    void last;
  }

  ui(name) { this.sfx(name); }

  // ---- music ----

  music(id) {
    if (id === this.trackId) return;
    this.trackId = id;
    clearInterval(this.timer); this.timer = null;
    if (!id || !this.ctx) return;
    const t = MUSIC[id];
    if (!t) return;
    const parse = (s) => s.split(/\s+/);
    this.track = { bpm: t.bpm, duty1: t.duty1, duty2: t.duty2, lead: parse(t.lead), harm: parse(t.harm), bass: parse(t.bass), drums: parse(t.drums) };
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stopMusic() { this.music(null); }

  // Lookahead: schedule every step that falls inside the next 100 ms.
  schedule() {
    const ctx = this.ctx, tr = this.track;
    if (!ctx || !tr) return;
    const stepDur = 60 / tr.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.1) {
      const i = this.step, t0 = this.nextTime;
      this.note(tr.lead, i, t0, stepDur, { wave: 'pulse', duty: tr.duty1 }, 0.16);
      this.note(tr.harm, i, t0, stepDur, { wave: 'pulse', duty: tr.duty2 }, 0.09);
      this.note(tr.bass, i, t0, stepDur, { wave: 'tri' }, 0.3);
      const d = tr.drums[i % tr.drums.length];
      if (d === 'K') { this.tone({ wave: 'tri', f0: 150, f1: 45, dur: 0.12, vol: 0.5 }, t0, 1, this.musicGain); }
      else if (d === 'S') { this.tone({ wave: 'noise', dur: 0.1, vol: 0.28, hp: 1200, lp: 7000 }, t0, 1, this.musicGain); }
      else if (d === 'h') { this.tone({ wave: 'noise', dur: 0.03, vol: 0.12, hp: 6000 }, t0, 1, this.musicGain); }
      this.nextTime += stepDur;
      this.step = (this.step + 1) % Math.max(tr.lead.length, tr.harm.length, tr.bass.length);
    }
  }

  note(line, i, t0, stepDur, voice, vol) {
    const tok = line[i % line.length];
    if (!tok || tok === '.' || tok === '-') return;
    const f = freq(tok);
    if (!f) return;
    // a note lasts until the next non-hold token
    let n = 1;
    while (n < 16 && line[(i + n) % line.length] === '-') n++;
    this.tone(Object.assign({ f0: f, f1: f, dur: Math.min(stepDur * n * 0.95, 0.6), vol }, voice), t0, 1, this.musicGain);
  }
}
