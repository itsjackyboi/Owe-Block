import { INTERNAL_W, SAVE_KEY } from '../config.js';
import { Loop } from '../core/loop.js';
import { Input } from '../core/input.js';
import { Renderer } from '../core/renderer.js';
import { Sprites } from '../core/sprites.js';
import { Match } from './match.js';
import { drawText } from '../ui/font.js';
import { drawDebug } from '../ui/debug.js';

// Screen state machine: title -> match. Later stages add mode select, summary, win and options screens.
export class Game {
  constructor(canvas, assets, params) {
    this.params = params;
    this.assets = assets;
    this.renderer = new Renderer(canvas);
    this.input = new Input(canvas);
    this.sprites = new Sprites(assets);
    this.settings = this.loadSettings();
    this.state = 'title';
    this.match = null;
    this.showDebug = params.has('debug') || params.has('fps');
    this.loop = new Loop((dt) => this.update(dt), (a, f) => this.render(a, f));
    this.titleT = 0;
  }

  loadSettings() {
    const s = { shake: true };
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) Object.assign(s, JSON.parse(raw).settings || {});
    } catch { /* storage blocked or corrupt: defaults are fine */ }
    return s;
  }

  start() {
    const mode = this.params.get('mode');
    if (mode || this.params.has('debug')) this.startMatch({ mode, seed: this.params.get('seed'), dummies: this.params.get('dummies') });
    this.loop.start();
  }

  startMatch(opts) {
    const seed = opts.seed != null && opts.seed !== '' ? Number(opts.seed) : undefined;
    this.match = new Match(this, { mode: opts.mode, seed, dummies: Number(opts.dummies) || 0 });
    this.state = 'match';
  }

  update(dt) {
    const input = this.input;
    this.renderer.mapMouse(input);
    if (input.keyPressed('F3')) this.showDebug = !this.showDebug;
    this.titleT += dt;
    if (this.state === 'title') {
      if (input.keyPressed('Enter') || input.keyPressed('Space') || input.mousePressed[0]) {
        this.startMatch({ mode: this.params.get('mode'), seed: this.params.get('seed'), dummies: this.params.get('dummies') });
      }
    } else if (this.state === 'match') {
      this.match.update(dt);
    }
    input.endStep();
  }

  render(alpha, frameDt) {
    const ctx = this.renderer.ctx;
    this.renderer.mapMouse(this.input);
    if (this.state === 'match') this.match.render(alpha, frameDt);
    else this.drawTitle(ctx);
    if (this.showDebug) drawDebug(ctx, this);
  }

  drawTitle(ctx) {
    this.renderer.clear('#14101c');
    const cx = INTERNAL_W / 2;
    drawText(ctx, 'OWE BLOCK', cx, 70, { align: 'center', scale: 5, color: '#e0443a' });
    drawText(ctx, 'BRAWL', cx, 112, { align: 'center', scale: 5, color: '#f4f0e8' });

    // a row of paper-dolls: neutral newcomer, Cutter, Circus, police
    const outfits = ['grey', 'red', 'blue', 'police'];
    outfits.forEach((o, i) => {
      const spr = this.sprites.fighter({ body: i % 3, outfit: o, hair: i * 3 + 1, hat: o !== 'grey' });
      const bob = Math.round(Math.abs(Math.sin(this.titleT * 4 + i)) * 2);
      ctx.drawImage(spr.normal, 0, 0, 16, 16, cx - 80 + i * 40 - 16, 160 - bob, 32, 32);
    });
    if (Math.floor(this.titleT * 2) % 2 === 0) drawText(ctx, 'CLICK OR PRESS ENTER', cx, 218, { align: 'center' });
    drawText(ctx, 'WASD MOVE  MOUSE AIM  SPACE DASH  F3 DEBUG', cx, 250, { align: 'center', color: '#8a8aa0' });
  }
}
