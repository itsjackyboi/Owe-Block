import { INTERNAL_W, INTERNAL_H, CAMERA, GRID_CELL } from '../config.js';
import { RNG } from '../core/rng.js';
import { SpatialHash } from '../core/grid.js';
import { Camera } from '../core/renderer.js';
import { clamp } from '../core/math.js';
import { randomAppearance } from '../core/sprites.js';
import { MODES, DEFAULT_MODE } from '../data/modes.js';
import { LOOT_ITEMS, ITEMS } from '../data/registry.js';
import { GameMap, T } from './map.js';
import { Fighter, resetFighterIds } from './fighter.js';
import { PlayerController, IdleController } from './controllers/player.js';
import { updateItemUse } from './actions.js';
import { Projectiles } from './projectiles.js';
import { Areas } from './areas.js';
import { Particles } from './particles.js';
import { Pickups } from './pickups.js';
import { generateOffers, applyOffer, autoPick } from './levelup.js';
import { drawHud } from '../ui/hud.js';
import { drawText } from '../ui/font.js';
import { drawLevelUp, drawDeath, drawVictory, cardRect } from '../ui/screens.js';

// One match: builds the world from a mode entry and runs the update order. Mode-agnostic.
export class Match {
  constructor(game, opts = {}) {
    this.game = game;
    resetFighterIds();
    this.seed = (opts.seed ?? (Math.random() * 1e9)) >>> 0;
    this.mode = MODES[opts.mode] || MODES[DEFAULT_MODE];
    this.rng = new RNG(this.seed);
    this.time = 0;

    const [mw, mh] = this.mode.size;
    const gen = this.mode.generate(this.rng.fork(1), mw, mh);
    this.gen = gen;
    this.map = new GameMap(gen, this.mode.tileset, game.assets, this.seed);
    this.spawns = gen.spawns;
    this.chambers = gen.chambers;

    this.hash = new SpatialHash(this.map.pxW, this.map.pxH, GRID_CELL);
    this.tmp = []; this.tmp2 = []; // scratch result arrays for spatial queries (never allocate in hot loops)
    this.fighters = [];
    this.drawList = [];
    this.feed = [];
    this.camera = new Camera();
    this.camera.shakeEnabled = game.settings.shake;
    this.fx = new Particles();
    this.projectiles = new Projectiles(this);
    this.areas = new Areas(this);
    this.pickups = new Pickups(this);

    this.levelUp = null;       // { offers, t } while the picker is open (world paused)
    this.placement = 0;
    this.won = false;

    this.spawnFighters(opts.dummies | 0);
    this.spawnLoot();
    this.camera.snapTo(this.player.x, this.player.y, this.map.pxW, this.map.pxH);
  }

  itemDef(id) { return ITEMS[id]; }

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
      const d = new Fighter({
        name: 'DUMMY ' + (i + 1), outfit, x: sp[i].x, y: sp[i].y, hp: 70, dummy: true,
        appearance: randomAppearance(rng, outfit, a),
        controller: new IdleController(),
      });
      // dummies carry a couple of items and some banked XP so killing them drops loot and XP
      const n = rng.int(0, 3);
      for (let k = 0; k < n; k++) d.addItem(rng.pick(LOOT_ITEMS).id, rng.int(1, 3));
      d.xpTotal = rng.int(0, 60); d.level = rng.int(1, 3);
      d.aim = rng.float(0, 6.28); d.intent.aim = d.aim;
      this.fighters.push(d);
    }
  }

  // Loot at match start, from the mode's candidate points and its loot table.
  spawnLoot() {
    const L = this.mode.loot;
    if (!L) return;
    const rng = this.rng.fork(3), gen = this.gen;
    let floor = 0;
    for (let i = 0; i < this.map.tiles.length; i++) if (this.map.tiles[i] === T.FLOOR) floor++;

    const pickItem = (vault) => {
      let tot = 0;
      for (const d of LOOT_ITEMS) tot += this.lootWeight(L, d, vault);
      let r = rng.next() * tot;
      for (const d of LOOT_ITEMS) { r -= this.lootWeight(L, d, vault); if (r <= 0) return d; }
      return LOOT_ITEMS[LOOT_ITEMS.length - 1];
    };
    const spots = rng.shuffle((gen.lootPoints || []).slice());
    const want = Math.round(floor * L.density);
    for (let i = 0; i < want && spots.length; i++) {
      const s = spots[i % spots.length];
      this.pickups.dropItem(pickItem(false).id, 1, s.x, s.y, rng);
    }
    for (const s of gen.vaultPoints || []) this.pickups.dropItem(pickItem(true).id, rng.chance(0.3) ? 2 : 1, s.x, s.y, rng);

    const xs = rng.shuffle((gen.xpPoints || []).slice());
    const nx = Math.min(xs.length, Math.round(floor * L.xpDensity));
    for (let i = 0; i < nx; i++) this.pickups.dropXp(L.xpValue, xs[i].x, xs[i].y, rng);
  }

  lootWeight(L, d, vault) {
    let w = (L.weights.byRarity[d.rarity] || 1) * (L.weights.byId[d.id] || 1);
    if (vault && d.rarity === 'relic') w *= L.vaultRelicBoost;
    return w;
  }

  onKill(v, k, itemId) {
    const name = (f) => f.name;
    const text = k ? name(k) + ' > ' + name(v) : name(v) + ' FELL';
    this.feed.push({ t: this.time, text, color: v.isPlayer ? '#ff6a5a' : (k && k.isPlayer ? '#ffd860' : '#c8c8d8') });
    if (this.feed.length > 6) this.feed.shift();
    let alive = 0;
    for (const f of this.fighters) if (!f.dead) alive++;
    if (v.isPlayer) {
      this.placement = alive + 1;
      this.game.loop.stopFor(0.12);
      this.camera.addTrauma(0.6);
    } else if (k && k.isPlayer) {
      this.game.loop.stopFor(0.07);
      this.camera.addTrauma(0.25);
    }
    if (!this.player.dead && alive === 1) this.won = true;
    void itemId;
  }

  update(dt) {
    const input = this.game.input;

    if (this.levelUp) { this.updateLevelUp(input, dt); return; }

    this.time += dt;
    if (input.keyPressed('KeyR') && (this.player.dead || this.won)) {
      this.game.startMatch({ mode: this.mode.id, dummies: this.fighters.length - 1 });
      return;
    }

    const fs = this.fighters;
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      if (f.dead) continue;
      if (f.controller) f.controller.update(f, dt, this.camera);
      f.update(dt, this.map, this);
    }

    this.hash.clear();
    for (let i = 0; i < fs.length; i++) if (!fs[i].dead) this.hash.insert(fs[i]);

    for (let i = 0; i < fs.length; i++) updateItemUse(fs[i], this, dt);
    this.projectiles.update(dt);
    this.areas.update(dt);
    this.pickups.update(dt);
    this.fx.update(dt);

    // level-ups: the player's picker pauses the world; everyone else picks automatically
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      if (f.dead || f.pendingLevels <= 0) continue;
      if (f.isPlayer) this.openLevelUp();
      else while (f.pendingLevels > 0) { f.pendingLevels--; autoPick(this, f); }
    }
  }

  openLevelUp() {
    const p = this.player;
    const offers = generateOffers(p, this.rng);
    p.pendingLevels--;
    if (!offers.length) return;
    this.levelUp = { offers, t: 0 };
  }

  updateLevelUp(input, dt) {
    const lu = this.levelUp;
    lu.t += dt;
    if (lu.t < 0.25) return; // ignore the click that was meant for combat
    let pick = -1;
    for (let i = 0; i < lu.offers.length; i++) if (input.keyPressed('Digit' + (i + 1)) || input.keyPressed('Numpad' + (i + 1))) pick = i;
    if (input.mousePressed[0]) {
      for (let i = 0; i < lu.offers.length; i++) {
        const r = cardRect(i, lu.offers.length);
        if (input.mx >= r.x && input.mx < r.x + r.w && input.my >= r.y && input.my < r.y + r.h) pick = i;
      }
    }
    if (pick >= 0) {
      applyOffer(this, this.player, lu.offers[pick]);
      this.levelUp = null;
      if (this.player.pendingLevels > 0) this.openLevelUp();
    }
  }

  render(alpha, frameDt) {
    const g = this.game, r = g.renderer, ctx = r.ctx, cam = this.camera, p = this.player;
    const input = g.input;

    const pxp = p.px + (p.x - p.px) * alpha, pyp = p.py + (p.y - p.py) * alpha;
    const lead = p.stance ? 2.4 : 1, maxLead = p.stance ? 150 : CAMERA.maxLead;
    const leanX = clamp((input.mx - INTERNAL_W / 2) * CAMERA.aimLead * lead, -maxLead, maxLead);
    const leanY = clamp((input.my - INTERNAL_H / 2) * CAMERA.aimLead * lead, -maxLead, maxLead);
    cam.update(frameDt, pxp, pyp, leanX, leanY, this.map.pxW, this.map.pxH);

    r.clear();
    this.map.draw(ctx, cam);
    this.areas.draw(ctx, cam);
    this.pickups.draw(ctx, cam, g.assets);

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

    this.projectiles.draw(ctx, cam, g.assets);
    this.fx.draw(ctx, cam);

    // name tags over non-player fighters
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (f.isPlayer || !f.name) continue;
      drawText(ctx, f.name, Math.round(f.x - cam.rx), Math.round(f.y - cam.ry) - 20, { align: 'center', color: f.outfit === 'red' ? '#ff8a78' : '#8ab8ff' });
    }

    drawHud(ctx, this);
    if (this.levelUp) drawLevelUp(ctx, this, g.assets, input);
    else if (p.dead) drawDeath(ctx, this);
    else if (this.won) drawVictory(ctx, this);
  }
}
