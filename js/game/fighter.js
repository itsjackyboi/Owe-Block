import { FIGHTER, DASH, PIT, TILE, SLOT_COUNT } from '../config.js';
import { approach } from '../core/math.js';
import { T } from './map.js';
import { ItemInstance } from './items.js';
import { newStatusBag, updateStatuses } from './statuses.js';
import { item } from '../data/registry.js';
import { damage } from './combat.js';

let nextId = 1;
export const resetFighterIds = () => { nextId = 1; };

// One entity type for the player, AI fighters and dummies. A controller fills `intent`; update() acts on it.
export class Fighter {
  constructor(opts) {
    this.id = nextId++;
    this.name = opts.name || 'FIGHTER';
    this.outfit = opts.outfit || 'grey';
    this.appearance = opts.appearance;
    this.controller = opts.controller || null;
    this.isPlayer = !!opts.isPlayer;
    this.dummy = !!opts.dummy;

    this.x = opts.x || 0; this.y = opts.y || 0;
    this.px = this.x; this.py = this.y; // previous step, for render interpolation
    this.vx = 0; this.vy = 0;
    this.kx = 0; this.ky = 0;           // knockback velocity, decays with friction
    this.slamStun = 0;
    this.r = FIGHTER.radius;

    this.maxHp = opts.hp || FIGHTER.hp;
    this.hp = this.maxHp;
    this.speed = FIGHTER.speed;
    this.dead = false;
    this.killedBy = null; this.killedByItem = null; this.surviveTime = 0;

    // build stats (level-ups)
    this.level = 1; this.xp = 0; this.xpTotal = 0; this.pendingLevels = 0;
    this.moveBonus = 0; this.dmgMul = 1; this.cdMul = 1; this.dashCdMul = 1; this.pickupMul = 1; this.armor = 0; this.regen = 0;
    this.kills = 0; this.damageDealt = 0; this.damageTaken = 0;
    this.tier = opts.tier || null;      // AI skill tier id, null for the player and dummies
    this.exposure = 0;                  // seconds continuously outside the police sweep
    this.deathKind = null; this.lastKind = null;

    // items: SLOT_COUNT slots, one held; an empty (or silenced) hand uses bare knuckles
    this.slots = new Array(SLOT_COUNT).fill(null);
    this.held = 0;
    this.swapT = 0;
    this.fists = new ItemInstance(item('bare_knuckles'));
    this.prompt = null;
    this.lastPickupMsg = '';

    this.intent = { mx: 0, my: 0, aim: 0, tx: 0, ty: 0, dash: false, use: false, special: false, stance: false, swapTo: -1, swapDir: 0, pickup: false };
    this.prevDown = [false, false];
    this.aim = 0; this.tx = 0; this.ty = 0;
    this.faceLeft = false;
    this.stance = false;
    this.busy = null;              // channelled action in progress (bow draw ...)
    this.parryT = 0; this.parryArc = 0; this.parryCounter = 0; this.parryStun = 0; this.parryItem = null;
    this.shieldReady = false;

    this.dashT = 0; this.dashCd = 0; this.dashCdMax = DASH.cooldown; this.invuln = 0;
    this.pDash = 1; this.pDashCd = 1; this.shieldT = 0; // passives from any slot
    this.strike = null; this.lungeT = 0;               // dash-strike in progress / recent lunge (kill resets the dash)
    this.cvx = 0; this.cvy = 0;                        // conveyor push, set by hazards each step
    this.named = !!opts.named; this.prefers = opts.prefers || null; this.speedBonus = opts.speedBonus || 0;
    this.dashDx = 1; this.dashDy = 0;

    this.st = newStatusBag();
    this.lastAttacker = null; this.lastItem = null; this.lastHurtT = -99; this.hurtShownAt = -99;

    this.hitFlash = 0; this.squash = 0; this.recoil = 0;
    this.swing = { t: 0, dur: 0.1, dir: 1, arc: 1 };
    this.walkPhase = 0;
    this.lastSafeX = this.x; this.lastSafeY = this.y; this.safeTimer = 0;
    this.falls = 0;
  }

  get dashing() { return this.dashT > 0; }

  // the item in hand right now (fists when the slot is empty or you are silenced)
  get item() {
    if (this.st.silence > 0) return this.fists;
    return this.slots[this.held] || this.fists;
  }

  // Ends a channelled action (and lets it clean up, e.g. remove its telegraph).
  cancelBusy() {
    if (this.busy && this.busy.onCancel) this.busy.onCancel();
    this.busy = null;
  }

  hasItem(id) { return this.slots.some((s) => s && s.id === id); }

  // Can this pickup be taken without a swap? (free slot, or a duplicate below max level)
  canTake(id) {
    for (const s of this.slots) if (s && s.id === id) return s.level < 5;
    return this.slots.includes(null);
  }

  // Adds an item. A duplicate upgrades the one you own. Goes into the held slot if your hand is empty.
  addItem(id, level = 1) {
    for (const s of this.slots) {
      if (s && s.id === id) {
        if (s.level >= 5) return 'maxed';
        s.setLevel(Math.min(5, s.level + level));
        this.lastPickupMsg = s.def.name + ' L' + s.level;
        return 'upgraded';
      }
    }
    const idx = this.slots[this.held] === null ? this.held : this.slots.indexOf(null);
    if (idx < 0) return 'full';
    const inst = new ItemInstance(item(id), level);
    this.slots[idx] = inst;
    if (this.slots[this.held] === null || idx === this.held) this.held = idx;
    this.lastPickupMsg = inst.def.name;
    return 'added';
  }

  teleport(x, y) {
    this.x = this.px = x; this.y = this.py = y;
    this.vx = this.vy = this.kx = this.ky = 0;
  }

  update(dt, map, match) {
    this.px = this.x; this.py = this.y;
    const it = this.intent;

    updateStatuses(this, dt, match);
    if (this.dead) return;
    let rg = this.regen;
    if (match.time - this.lastHurtT > FIGHTER.idleRegenAfter) rg += FIGHTER.idleRegen;
    if (rg > 0 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + rg * dt);
    if (this.dashCd > 0) this.dashCd -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.squash > 0) this.squash = Math.max(0, this.squash - dt * 6);
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 8);
    if (this.swing.t > 0) this.swing.t -= dt;
    if (this.swapT > 0) this.swapT -= dt;
    if (this.parryT > 0) this.parryT -= dt;
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i]) this.slots[i].tick(dt);
    this.fists.tick(dt);

    // passives work from any slot
    let pd = 1, pc = 1, sh = 0;
    for (let i = 0; i < this.slots.length; i++) {
      const ps = this.slots[i] && this.slots[i].def.passive;
      if (ps) { if (ps.dashDist) pd *= ps.dashDist; if (ps.dashCd) pc *= ps.dashCd; if (ps.shield) sh = ps.shield; }
    }
    this.pDash = pd; this.pDashCd = pc;
    if (sh) {
      if (!this.shieldReady) { this.shieldT += dt; if (this.shieldT >= sh) { this.shieldReady = true; this.shieldT = 0; } }
    } else { this.shieldReady = false; this.shieldT = 0; }
    if (this.lungeT > 0) this.lungeT -= dt;

    const stunned = this.st.stun > 0, rooted = stunned || this.st.root > 0;

    this.aim = it.aim; this.tx = it.tx; this.ty = it.ty;
    this.faceLeft = Math.cos(it.aim) < 0;
    this.stance = it.stance && !this.dashing && !stunned;

    // swapping the held item
    if (!stunned && this.swapT <= 0) {
      let to = -1;
      if (it.swapTo >= 0 && it.swapTo < this.slots.length && it.swapTo !== this.held) to = it.swapTo;
      else if (it.swapDir) to = (this.held + it.swapDir + this.slots.length) % this.slots.length;
      if (to >= 0) { this.held = to; this.swapT = 0.15; this.cancelBusy(); }
    }

    // dash: starts toward movement input, or toward the aim when standing still
    if (it.dash && this.dashCd <= 0 && !this.dashing && !rooted) {
      let dx = it.mx, dy = it.my;
      if (dx === 0 && dy === 0) { dx = Math.cos(it.aim); dy = Math.sin(it.aim); }
      const l = Math.hypot(dx, dy) || 1;
      this.dashDx = dx / l; this.dashDy = dy / l;
      this.dashT = DASH.time * this.pDash; this.dashCdMax = DASH.cooldown * this.dashCdMul * this.pDashCd; this.dashCd = this.dashCdMax; this.invuln = DASH.invuln;
      this.cancelBusy();
      match.fx.dust(this.x, this.y + 4, 4);
      match.sfx('dash', this.x, this.y);
    }

    if (this.dashing) {
      this.vx = this.dashDx * DASH.speed; this.vy = this.dashDy * DASH.speed;
      this.dashT -= dt;
      if (this.dashT <= 0) { this.dashT = 0; this.vx *= 0.3; this.vy *= 0.3; }
    } else {
      let sp = this.speed * (1 + this.moveBonus + this.speedBonus);
      if (this.st.haste > 0) sp *= 1.5;
      if (this.stance) sp *= 0.65;
      if (this.busy) sp *= this.busy.slow;
      if (this.st.slow > 0) sp *= 1 - this.st.slowPow;
      const accel = FIGHTER.accel * (this.st.slippery > 0 ? 0.1 : 1) * dt;
      const wx = rooted ? 0 : it.mx * sp, wy = rooted ? 0 : it.my * sp;
      this.vx = approach(this.vx, wx, accel);
      this.vy = approach(this.vy, wy, accel);
    }

    // knockback decays with friction
    const kd = Math.exp(-8 * dt);
    this.kx *= kd; this.ky *= kd;
    if (Math.abs(this.kx) + Math.abs(this.ky) < 3) this.kx = this.ky = 0;

    const ox = this.x, oy = this.y;
    this.x += (this.vx + this.kx + this.cvx) * dt;
    this.y += (this.vy + this.ky + this.cvy) * dt;
    map.hitWall = false;
    map.resolveCircle(this);
    if (map.hitWall && this.slamStun > 0 && Math.hypot(this.kx, this.ky) > 70) {
      this.st.stun = Math.max(this.st.stun, this.slamStun);
      this.kx = this.ky = 0;
      match.fx.sparks(this.x, this.y, 8, '#ffd890', 100, 0.3);
      match.fx.popup(this.x, this.y - 14, 'SLAM', '#ffd890');
      match.camera.addTrauma(this.isPlayer ? 0.3 : 0.1);
    }
    if (this.slamStun > 0 && Math.hypot(this.kx, this.ky) < 20) this.slamStun = 0;
    this.walkPhase += Math.hypot(this.x - ox, this.y - oy) * 0.28;

    // pits: a dash crosses them, standing or walking into one does not
    if (!this.dashing) {
      const t = map.tileAtPx(this.x, this.y);
      if (t === T.PIT) this.fall(match);
      else if (t === T.FLOOR) {
        this.safeTimer -= dt;
        if (this.safeTimer <= 0) {
          this.safeTimer = PIT.safeInterval;
          const tx = Math.floor(this.x / TILE), ty = Math.floor(this.y / TILE);
          if (map.tile(tx + 1, ty) !== T.PIT && map.tile(tx - 1, ty) !== T.PIT && map.tile(tx, ty + 1) !== T.PIT && map.tile(tx, ty - 1) !== T.PIT && !match.hazards.unsafe(tx, ty)) {
            this.lastSafeX = this.x; this.lastSafeY = this.y;
          }
        }
      }
    }
  }

  fall(match) {
    this.falls++;
    const x = this.lastSafeX, y = this.lastSafeY;
    const rule = match.mode.pit || PIT;
    this.hitFlash = 0.08; this.squash = 1;
    damage(match, this, (rule.damage || 0) + (rule.damagePct || 0) * this.maxHp, { kind: 'fall', quiet: true });
    if (!this.dead) { this.teleport(x, y); if (rule.stun) this.st.stun = Math.max(this.st.stun, rule.stun); }
    match.sfx('fall', this.x, this.y);
  }

  // ---- drawing ----

  draw(ctx, cam, alpha, sprites) {
    const assets = sprites.assets;
    const x = this.px + (this.x - this.px) * alpha;
    const y = this.py + (this.y - this.py) * alpha;
    const sx = Math.round(x - cam.rx), sy = Math.round(y - cam.ry);

    // ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(sx - 4, sy + 4, 8, 2);
    ctx.fillRect(sx - 3, sy + 6, 6, 1);

    const spr = sprites.fighter(this.appearance);
    const moving = Math.abs(this.vx) + Math.abs(this.vy) > 8;
    const bob = moving && !this.dashing ? Math.abs(Math.sin(this.walkPhase)) * 1.6 : 0;
    const lean = Math.max(-1, Math.min(1, this.vx / 110)) * 0.18;
    let scx = 1, scy = 1;
    if (this.squash > 0) { scx += 0.25 * this.squash; scy -= 0.25 * this.squash; }
    if (this.dashing) { scx += 0.2; scy -= 0.15; }
    const stunned = this.st.stun > 0;

    const behind = Math.sin(this.aim) < -0.35;       // weapon pointing away: draw it behind the body
    if (behind) this.drawHeld(ctx, assets, sx, sy - Math.round(bob));
    ctx.save();
    ctx.translate(sx, sy + 5 - Math.round(bob)); // origin at the feet
    ctx.transform(1, 0, -lean, 1, 0, 0);          // shear = pixel-art lean
    ctx.scale(this.faceLeft ? -scx : scx, scy);
    ctx.drawImage(this.hitFlash > 0 ? spr.flash : spr.normal, -8, -16);
    ctx.restore();

    if (!behind) this.drawHeld(ctx, assets, sx, sy - Math.round(bob));

    if (this.parryT > 0) { // riposte shimmer
      for (let i = -3; i <= 3; i++) {
        const a = this.aim + (i / 3) * (this.parryArc / 2);
        ctx.fillStyle = i % 2 ? '#ffffff' : '#9ad0ff';
        ctx.fillRect(Math.round(sx + Math.cos(a) * 14), Math.round(sy - 3 + Math.sin(a) * 14), 2, 2);
      }
    }
    if (this.busy && this.busy.ready !== undefined) { // bow draw meter
      const b = this.busy, w = 14;
      ctx.fillStyle = '#10101c'; ctx.fillRect(sx - 8, sy + 9, w + 2, 4);
      ctx.fillStyle = b.full ? '#ffffff' : (b.ready ? '#ffd860' : '#6a6a80'); ctx.fillRect(sx - 7, sy + 10, Math.round(w * (b.ready ? b.frac : 0.08)), 2);
    }
    if (this.shieldReady) { // amethyst shimmer: the next hit is cut by 60%
      const t = performance.now() / 160;
      for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? '#c8a0ff' : '#ffffff'; ctx.fillRect(Math.round(sx + Math.cos(t + i * 1.57) * 8), Math.round(sy - 5 + Math.sin(t + i * 1.57) * 7), 1, 1); }
    }
    if (this.st.root > 0 && !stunned) { ctx.fillStyle = '#c8e8ff'; for (let i = -6; i <= 6; i += 3) ctx.fillRect(sx + i, sy + 6, 2, 1); }
    if (this.st.silence > 0) { ctx.fillStyle = '#8aa0c8'; ctx.fillRect(sx - 2, sy - 19, 5, 1); ctx.fillRect(sx - 2, sy - 17, 5, 1); }
    if (stunned) {
      const t = performance.now() / 120;
      ctx.fillStyle = '#ffe060';
      for (let i = 0; i < 3; i++) ctx.fillRect(Math.round(sx + Math.cos(t + i * 2.09) * 6), Math.round(sy - 17 + Math.sin(t + i * 2.09) * 2), 2, 2);
    }
    if (!this.isPlayer && this.hp < this.maxHp && performance.now() / 1000 - this.hurtShownAt < 3) this.drawBar(ctx, sx, sy);
  }

  drawBar(ctx, sx, sy) {
    ctx.fillStyle = '#10101c'; ctx.fillRect(sx - 7, sy - 22, 14, 3);
    ctx.fillStyle = '#e0443a'; ctx.fillRect(sx - 6, sy - 21, Math.round(12 * this.hp / this.maxHp), 1);
  }

  drawHeld(ctx, assets, sx, sy) {
    const inst = this.item;
    if (inst === this.fists) return;
    const ic = assets.heldCanvas(inst.id);
    const rot = assets.iconRot(inst.id);
    const a = this.aim;
    let off = 0;
    if (this.swing.t > 0) off = (1 - this.swing.t / this.swing.dur - 0.5) * this.swing.arc * this.swing.dir;
    const back = this.recoil * 2.5;
    const hx = sx + Math.cos(this.aim) * (8 - back), hy = sy - 1 + Math.sin(this.aim) * (6 - back * 0.6);
    ctx.save();
    ctx.translate(Math.round(hx), Math.round(hy));
    ctx.rotate(a + off + Math.PI / 2 + rot);
    const sc = assets.heldScale(inst.id);
    ctx.scale(sc, sc);
    ctx.drawImage(ic, -8, -13);
    ctx.restore();
  }
}
