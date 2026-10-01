import { INTERNAL_W, INTERNAL_H, CAMERA, GRID_CELL } from '../config.js';
import { RNG } from '../core/rng.js';
import { SpatialHash } from '../core/grid.js';
import { Camera } from '../core/renderer.js';
import { clamp } from '../core/math.js';
import { randomAppearance } from '../core/sprites.js';
import { MODES, DEFAULT_MODE } from '../data/modes.js';
import { GameMap } from './map.js';
import { Fighter } from './fighter.js';
import { PlayerController, IdleController } from './controllers/player.js';
import { drawHud } from '../ui/hud.js';
import { drawText } from '../ui/font.js';

// One match: builds the world from a mode entry and runs the update order. Mode-agnostic.
export class Match {
  constructor(game, opts = {}) {
    this.game = game;
    this.seed = (opts.seed ?? (Math.random() * 1e9)) >>> 0;
    this.mode = MODES[opts.mode] || MODES[DEFAULT_MODE];
    this.rng = new RNG(this.seed);
    this.time = 0;

    const [mw, mh] = this.mode.size;
    const gen = this.mode.generate(this.rng.fork(1), mw, mh);
    this.map = new GameMap(gen, this.mode.tileset, game.assets, this.seed);
    this.spawns = gen.spawns;
    this.chambers = gen.chambers;

    this.hash = new SpatialHash(this.map.pxW, this.map.pxH, GRID_CELL);
    this.fighters = [];
    this.drawList = [];
    this.camera = new Camera();
    this.camera.shakeEnabled = game.settings.shake;

    this.spawnFighters(opts.dummies | 0);
    this.camera.snapTo(this.player.x, this.player.y, this.map.pxW, this.map.pxH);
  }

  spawnFighters(dummies) {
    const a = this.game.assets, rng = this.rng.fork(2);
    const sp = this.spawns.slice();
    const first = sp.shift();
    this.player = new Fighter({
      name: 'NEWCOMER', outfit: 'grey', isPlayer: true, x: first.x, y: first.y,
      appearance: { body: 0, outfit: 'grey', hair: 1, hat: false },
      controller: new PlayerController(this.game.input),
    });
    this.fighters.push(this.player);

    // test dummies stand on the spawn points nearest the player so they are visible straight away
    sp.sort((p, q) => Math.hypot(p.x - first.x, p.y - first.y) - Math.hypot(q.x - first.x, q.y - first.y));
    for (let i = 0; i < dummies && i < sp.length; i++) {
      const outfit = i % 2 ? 'blue' : 'red';
      this.fighters.push(new Fighter({
        name: 'DUMMY ' + (i + 1), outfit, x: sp[i].x, y: sp[i].y,
        appearance: randomAppearance(rng, outfit, a),
        controller: new IdleController(),
      }));
    }
  }

  update(dt) {
    const input = this.game.input;
    this.time += dt;
    if (input.keyPressed('KeyR') && this.player.dead) { this.game.startMatch({ mode: this.mode.id, dummies: this.fighters.length - 1 }); return; }

    for (let i = 0; i < this.fighters.length; i++) {
      const f = this.fighters[i];
      if (f.dead) continue;
      if (f.controller) f.controller.update(f, dt, this.camera);
      f.update(dt, this.map);
    }

    this.hash.clear();
    for (let i = 0; i < this.fighters.length; i++) if (!this.fighters[i].dead) this.hash.insert(this.fighters[i]);
  }

  render(alpha, frameDt) {
    const g = this.game, r = g.renderer, ctx = r.ctx, cam = this.camera, p = this.player;
    const input = g.input;

    const pxp = p.px + (p.x - p.px) * alpha, pyp = p.py + (p.y - p.py) * alpha;
    const leanX = clamp((input.mx - INTERNAL_W / 2) * CAMERA.aimLead, -CAMERA.maxLead, CAMERA.maxLead);
    const leanY = clamp((input.my - INTERNAL_H / 2) * CAMERA.aimLead, -CAMERA.maxLead, CAMERA.maxLead);
    cam.update(frameDt, pxp, pyp, leanX, leanY, this.map.pxW, this.map.pxH);

    r.clear();
    this.map.draw(ctx, cam);

    const list = this.drawList;
    list.length = 0;
    for (let i = 0; i < this.fighters.length; i++) {
      const f = this.fighters[i];
      if (f.dead) continue;
      if (f.x < cam.rx - 24 || f.x > cam.rx + INTERNAL_W + 24 || f.y < cam.ry - 24 || f.y > cam.ry + INTERNAL_H + 24) continue;
      list.push(f);
    }
    list.sort((a, b) => a.y - b.y);
    for (let i = 0; i < list.length; i++) list[i].draw(ctx, cam, alpha, g.sprites);

    // name tags over non-player fighters
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (f.isPlayer || !f.name) continue;
      drawText(ctx, f.name, Math.round(f.x - cam.rx), Math.round(f.y - cam.ry) - 20, { align: 'center', color: f.outfit === 'red' ? '#ff8a78' : '#8ab8ff' });
    }

    drawHud(ctx, this);
  }
}
