import { Loop } from '../core/loop.js';
import { Input } from '../core/input.js';
import { Renderer } from '../core/renderer.js';
import { Sprites } from '../core/sprites.js';
import { Save } from '../core/save.js';
import { AudioEngine } from '../core/audio.js';
import { Match } from './match.js';
import { drawDebug } from '../ui/debug.js';
import { TitleScreen, ModeScreen, UnlocksScreen, OptionsScreen, SummaryScreen, WinScreen, PauseScreen, buildSummary } from '../ui/menus.js';

// Screen state machine: title / modes / unlocks / options / match / paused / win / summary.
export class Game {
  constructor(canvas, assets, params) {
    this.params = params;
    this.assets = assets;
    this.renderer = new Renderer(canvas);
    this.input = new Input(canvas);
    this.sprites = new Sprites(assets);
    this.save = new Save();
    this.settings = this.save.data.settings;
    this.audio = new AudioEngine(this.settings);
    this.state = 'title';
    this.screen = new TitleScreen();
    this.match = null;
    this.winT = 0;
    this.fromPause = false;
    this.showDebug = params.has('debug') || params.has('fps');
    this.loop = new Loop((dt) => this.update(dt), (a, f) => this.render(a, f));
  }

  applySettings() {
    this.audio.applyVolumes();
    if (this.match) this.match.camera.shakeEnabled = this.settings.shake;
  }

  start() {
    const mode = this.params.get('mode');
    const sim = this.params.has('sim');
    if ((mode || sim || this.params.has('debug')) && !this.params.has('menu')) this.startMatch(this.startOpts()); // ?menu=1 keeps the title screen (with ?debug=1 for the test hooks)
    else this.audio.music('title');
    if (sim) {
      const speed = Math.max(1, Number(this.params.get('speed')) || 1);
      this.loop.timeScale = speed;
      this.loop.maxSteps = Math.ceil(speed) + 2;
    }
    if (!this.params.has('manual')) this.loop.start(); // ?manual=1: the test runner steps the match itself
  }

  // Options for a new match, read from the URL: seed, dummies, ai (count), sim, named.
  startOpts() {
    const q = this.params;
    return { mode: q.get('mode'), seed: q.get('seed'), dummies: q.get('dummies'), ai: q.get('ai'), sim: q.has('sim'), named: q.get('named') };
  }

  startMatch(opts) {
    const seed = opts.seed != null && opts.seed !== '' ? Number(opts.seed) : undefined;
    const d = this.save.data;
    this.match = new Match(this, {
      mode: opts.mode, seed, dummies: Number(opts.dummies) || 0, ai: opts.ai != null && opts.ai !== '' ? Number(opts.ai) : null,
      sim: !!opts.sim, named: opts.named, color: d.color, startWeapon: d.startWeapon,
    });
    this.state = 'match'; this.screen = null; this.winT = 0; this.fromPause = false;
    this.audio.music(this.match.mode.music);
  }

  // Switch to a non-match screen.
  go(name, fromPause = false) {
    if (name === 'title' && this.fromPause) { this.fromPause = false; this.state = 'paused'; this.screen = new PauseScreen(); return; }
    this.fromPause = fromPause;
    if (name === 'title') { this.match = null; this.audio.music('title'); }
    this.state = name;
    this.screen = { title: () => new TitleScreen(), modes: () => new ModeScreen(this), unlocks: () => new UnlocksScreen(), options: () => new OptionsScreen() }[name]();
  }

  pause() { this.state = 'paused'; this.screen = new PauseScreen(); this.audio.sfx('ui'); }
  resume() { this.state = 'match'; this.screen = null; }

  // Match over (death or after the win choice): record it once, then show the summary.
  finishMatch() {
    const m = this.match;
    if (!m) return;
    const sum = buildSummary(m);
    if (!m.recorded && !m.sim) {
      m.recorded = true;
      this.save.recordMatch({ mode: sum.mode, placement: sum.placement, kills: sum.kills, damage: sum.damage, time: Math.round(sum.time), level: sum.level, date: Date.now(), seed: sum.seed });
    }
    this.state = 'summary'; this.screen = new SummaryScreen(sum);
  }

  // Win screen choice: unlock the gang's weapon and colour, start wearing them, then on to the summary.
  chooseGang(gang) {
    const d = this.save.data;
    this.save.unlock(gang);
    d.color = gang === 'cutters' ? 'red' : 'blue';
    d.startWeapon = gang === 'cutters' ? 'krags_cleaver' : 'zaars_edges';
    this.save.commit();
    this.audio.sfx('select');
    this.finishMatch();
  }

  update(dt) {
    const input = this.input;
    this.renderer.mapMouse(input);
    if (input.gesture) this.audio.unlock();
    if (input.keyPressed('F3')) this.showDebug = !this.showDebug;

    if (this.state === 'match') {
      const m = this.match;
      if (input.keyPressed('Escape') && !m.sim && !m.levelUp) { this.pause(); input.endStep(); return; }
      m.update(dt);
      if (!m.sim && this.match === m) {
        if (m.player.dead && m.deadT > 1 && (input.keyPressed('Enter') || input.keyPressed('Space'))) this.finishMatch();
        else if (m.won && !m.player.dead) {
          this.winT += dt;
          if (this.winT > 2) { this.state = 'win'; this.screen = new WinScreen(); this.audio.sfx('win'); }
        }
      }
    } else if (this.screen) {
      this.screen.update(this, input, dt);
    }
    input.endStep();
  }

  render(alpha, frameDt) {
    const ctx = this.renderer.ctx;
    this.renderer.mapMouse(this.input);
    if (this.state === 'match') this.match.render(alpha, frameDt);
    else if ((this.state === 'paused' || this.state === 'win') && this.match) { this.match.render(1, 0); this.screen.draw(ctx, this, this.input); }
    else if (this.screen) this.screen.draw(ctx, this, this.input);
    if (this.showDebug) drawDebug(ctx, this);
    if (this.state !== 'match') this.drawCursor(ctx);
  }

  drawCursor(ctx) {
    const x = Math.round(this.input.mx), y = Math.round(this.input.my);
    ctx.fillStyle = '#10101c'; ctx.fillRect(x - 1, y - 1, 7, 3); ctx.fillRect(x - 1, y - 1, 3, 9);
    ctx.fillStyle = '#f4f0e8'; ctx.fillRect(x, y, 5, 1); ctx.fillRect(x, y, 1, 7);
  }
}

