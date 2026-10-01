import { INTERNAL_W, INTERNAL_H, CAMERA, GRID_CELL, AI_COUNT, TIER_MIX } from '../config.js';
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
import { Zone, drawZone } from './zone.js';
import { Nav } from '../ai/nav.js';
import { AIController } from '../ai/ai.js';
import { pickHandles } from '../data/fighters.js';
import { generateOffers, applyOffer, autoPick } from './levelup.js';
import { drawHud } from '../ui/hud.js';
import { drawText } from '../ui/font.js';
import { buildMinimap } from '../ui/hud.js';
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
    this.nav = new Nav(this.map);
    this.hotspots = [];
    for (let i = 0; i < 24; i++) this.hotspots.push({ x: 0, y: 0, t: -99 });
    this.hotIdx = 0;
    this.sim = !!opts.sim;
    this.result = null;
    this.aliveLog = [];

    this.levelUp = null;       // { offers, t } while the picker is open (world paused)
    this.placement = 0;
    this.won = false;

    this.spawnFighters(opts);
    this.spawnLoot();
    this.zone = new Zone(this, this.rng.fork(4), (this.mode.zone && this.mode.zone.scale) || 1);
    this.minimap = buildMinimap(this.map);
    this.fx.cam = this.camera;
    this.camera.snapTo(this.player.x, this.player.y, this.map.pxW, this.map.pxH);
  }

  itemDef(id) { return ITEMS[id]; }

  spawnFighters(opts) {
    const dummies = opts.dummies | 0;
    const aiCount = opts.ai != null ? opts.ai | 0 : (dummies > 0 ? 0 : AI_COUNT);
    this.dummyCount = dummies; this.aiCount = aiCount;
    const a = this.game.assets, rng = this.rng.fork(2);
    const sp = this.spreadSpawns(this.spawns, (opts.ai != null ? opts.ai | 0 : (dummies > 0 ? 0 : AI_COUNT)) + 1, rng);
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

    // AI fighters: tier mix 15 low / 15 medium / 10 high (scaled when fewer are requested), everyone starts with bare knuckles
    if (aiCount > 0) {
      const tiers = [];
      for (const [id, n] of Object.entries(TIER_MIX)) for (let i = 0; i < n; i++) tiers.push(id);
      rng.shuffle(tiers);
      const spots = rng.shuffle(sp.slice(dummies));
      const names = pickHandles(rng, aiCount);
      for (let i = 0; i < aiCount && i < spots.length; i++) {
        const tier = tiers[i % tiers.length];
        const outfit = rng.chance(0.5) ? 'red' : 'blue';
        const f = new Fighter({ name: names[i], outfit, tier, x: spots[i].x, y: spots[i].y, appearance: randomAppearance(rng, outfit, a) });
        f.controller = new AIController(this, tier, f.id);
        f.aim = f.intent.aim = rng.float(0, 6.28);
        this.fighters.push(f);
      }
    }

    // sim mode: the "player" is a high-tier bot so whole matches can run unattended
    if (opts.sim) {
      const p = this.player;
      p.isPlayer = false; p.tier = 'high'; p.name = 'SIMBOT';
      p.controller = new AIController(this, 'high', p.id);
    }
  }

  // Farthest-point sampling: pick n spawn points that are as far from each other as possible.
  spreadSpawns(all, n, rng) {
    const rest = all.slice();
    const out = [rest.splice(rng.int(0, rest.length), 1)[0]];
    while (out.length < n && rest.length) {
      let bi = 0, bd = -1;
      for (let i = 0; i < rest.length; i++) {
        let d = Infinity;
        for (const o of out) d = Math.min(d, (o.x - rest[i].x) ** 2 + (o.y - rest[i].y) ** 2);
        if (d > bd) { bd = d; bi = i; }
      }
      out.push(rest.splice(bi, 1)[0]);
    }
    return out.concat(rest); // the leftovers stay available (dummies pick the nearest)
  }

  // Loot at match start, from the mode's candidate points and its loot table.
  spawnLoot() {
    const L = this.mode.loot;
    if (!L) return;
    const rng = this.rng.fork(3), gen = this.gen;
    let floor = 0;
    for (let i = 0; i < this.map.tiles.length; i++) if (this.map.tiles[i] === T.FLOOR) floor++;

    const pickItem = (vault) => this.rollLoot(L, rng, vault);
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

  // Goal tiles for AI flow fields: walkable tiles inside the k-th zone target.
  zoneGoals(k) {
    const z = this.zone, t = z.targets[k];
    if (k === z.targets.length - 1) return this.nav.goalsInRect(z.fx - 40, z.fy - 40, z.fx + 40, z.fy + 40);
    const g = this.nav.goalsInRect(t.x0 + 16, t.y0 + 16, t.x1 - 16, t.y1 - 16);
    return g.length ? g : this.nav.goalsInRect(z.fx - 40, z.fy - 40, z.fx + 40, z.fy + 40);
  }

  // A shrink just began: a light respawn wave of loot inside the new safe area.
  onZoneShrink(k) {
    this.feed.push({ t: this.time, text: 'THE SWEEP CLOSES IN', color: '#ff8a78' });
    if (this.feed.length > 6) this.feed.shift();
    const L = this.mode.loot;
    if (!L) return;
    const r = this.zone.targets[k], rng = this.rng.fork(100 + k);
    const inside = (p) => p.x > r.x0 + 16 && p.x < r.x1 - 16 && p.y > r.y0 + 16 && p.y < r.y1 - 16;
    const spots = rng.shuffle((this.gen.lootPoints || []).filter(inside));
    const area = Math.max(1, ((r.x1 - r.x0) * (r.y1 - r.y0)) / 256);
    const nItems = Math.min(spots.length, Math.round(area * L.density * 0.3 * 0.25));
    for (let i = 0; i < nItems; i++) this.pickups.dropItem(this.rollLoot(L, rng, false).id, 1, spots[i].x, spots[i].y, rng);
    const xs = rng.shuffle((this.gen.xpPoints || []).filter(inside));
    const nx = Math.min(xs.length, Math.round(area * L.xpDensity * 0.25 * 0.4));
    for (let i = 0; i < nx; i++) this.pickups.dropXp(L.xpValue, xs[i].x, xs[i].y, rng);
  }

  rollLoot(L, rng, vault) {
    let tot = 0;
    for (const d of LOOT_ITEMS) tot += this.lootWeight(L, d, vault);
    let r = rng.next() * tot;
    for (const d of LOOT_ITEMS) { r -= this.lootWeight(L, d, vault); if (r <= 0) return d; }
    return LOOT_ITEMS[LOOT_ITEMS.length - 1];
  }

  // Fights leave hotspots that third-partying AI can walk toward.
  noteFight(x, y) {
    const h = this.hotspots[this.hotIdx++ % this.hotspots.length];
    h.x = x; h.y = y; h.t = this.time;
  }

  onKill(v, k, itemId) {
    const name = (f) => f.name;
    const text = k ? name(k) + ' > ' + name(v) : name(v) + (v.deathKind === 'zone' ? ' WAS SWEPT' : ' FELL');
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
    if (!this.player.dead && alive === 1 && !this.sim) this.won = true;
    void itemId;
  }

  update(dt) {
    const input = this.game.input;

    if (this.levelUp) { this.updateLevelUp(input, dt); return; }

    this.time += dt;
    this.nav.budget = 4;
    if (input.keyPressed('KeyR') && (this.player.dead || this.won)) {
      this.game.startMatch({ mode: this.mode.id, dummies: this.dummyCount, ai: this.aiCount });
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
    this.zone.update(dt);
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
    this.checkEnd();
  }

  // Sim bookkeeping: alive count each minute, and the result once one fighter is left (or time runs out).
  checkEnd() {
    if (this.result) return;
    let alive = 0, last = null;
    for (const f of this.fighters) if (!f.dead) { alive++; last = f; }
    const minute = Math.floor(this.time / 60);
    if (this.aliveLog.length <= minute) this.aliveLog.push(alive);
    if (alive > 1 && this.time < 900) return;
    const byTier = {};
    for (const f of this.fighters) {
      if (f.dummy) continue;
      const k = f.tier || 'none', t = f.dead ? f.surviveTime : this.time;
      const e = byTier[k] || (byTier[k] = { n: 0, survive: 0, kills: 0, wins: 0 });
      e.n++; e.survive += t; e.kills += f.kills; if (!f.dead) e.wins++;
    }
    for (const k in byTier) { byTier[k].survive = Math.round(byTier[k].survive / byTier[k].n); }
    this.result = {
      seed: this.seed, duration: Math.round(this.time * 10) / 10, alive,
      winner: last ? { name: last.name, tier: last.tier, kills: last.kills, level: last.level } : null,
      aliveLog: this.aliveLog, byTier, requests: this.nav.requests,
    };
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
    drawZone(ctx, cam, this.zone, g.sprites, this.time);

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
