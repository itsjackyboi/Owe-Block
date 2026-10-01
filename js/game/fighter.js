import { FIGHTER, DASH, PIT, TILE } from '../config.js';
import { approach } from '../core/math.js';
import { T } from './map.js';

let nextId = 1;

// One entity type for the player, AI fighters and dummies. A controller fills `intent`; update() acts on it.
export class Fighter {
  constructor(opts) {
    this.id = nextId++;
    this.name = opts.name || 'FIGHTER';
    this.outfit = opts.outfit || 'grey';
    this.appearance = opts.appearance;
    this.controller = opts.controller || null;
    this.isPlayer = !!opts.isPlayer;

    this.x = opts.x || 0; this.y = opts.y || 0;
    this.px = this.x; this.py = this.y; // previous step, for render interpolation
    this.vx = 0; this.vy = 0;
    this.r = FIGHTER.radius;

    this.maxHp = opts.hp || FIGHTER.hp;
    this.hp = this.maxHp;
    this.speed = FIGHTER.speed;
    this.speedMul = 1;
    this.dead = false;

    this.intent = { mx: 0, my: 0, aim: 0, dash: false };
    this.aim = 0;
    this.faceLeft = false;

    this.dashT = 0; this.dashCd = 0; this.invuln = 0;
    this.dashDx = 1; this.dashDy = 0;

    this.hitFlash = 0; this.squash = 0;
    this.walkPhase = 0;
    this.lastSafeX = this.x; this.lastSafeY = this.y; this.safeTimer = 0;
    this.falls = 0;
  }

  get dashing() { return this.dashT > 0; }

  teleport(x, y) {
    this.x = this.px = x; this.y = this.py = y;
    this.vx = this.vy = 0;
  }

  update(dt, map) {
    this.px = this.x; this.py = this.y;
    const it = this.intent;

    if (this.dashCd > 0) this.dashCd -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.squash > 0) this.squash = Math.max(0, this.squash - dt * 6);

    this.aim = it.aim;
    this.faceLeft = Math.cos(it.aim) < 0;

    // dash: starts toward movement input, or toward the aim when standing still
    if (it.dash && this.dashCd <= 0 && !this.dashing) {
      let dx = it.mx, dy = it.my;
      if (dx === 0 && dy === 0) { dx = Math.cos(it.aim); dy = Math.sin(it.aim); }
      const l = Math.hypot(dx, dy) || 1;
      this.dashDx = dx / l; this.dashDy = dy / l;
      this.dashT = DASH.time; this.dashCd = DASH.cooldown; this.invuln = DASH.invuln;
    }

    if (this.dashing) {
      this.vx = this.dashDx * DASH.speed; this.vy = this.dashDy * DASH.speed;
      this.dashT -= dt;
      if (this.dashT <= 0) { this.dashT = 0; this.vx *= 0.3; this.vy *= 0.3; }
    } else {
      const sp = this.speed * this.speedMul;
      const a = FIGHTER.accel * dt;
      this.vx = approach(this.vx, it.mx * sp, a);
      this.vy = approach(this.vy, it.my * sp, a);
    }

    const ox = this.x, oy = this.y;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    map.resolveCircle(this);
    this.walkPhase += Math.hypot(this.x - ox, this.y - oy) * 0.28;

    // pits: a dash crosses them, standing or walking into one does not
    if (!this.dashing) {
      const t = map.tileAtPx(this.x, this.y);
      if (t === T.PIT) this.fall();
      else if (t === T.FLOOR) {
        this.safeTimer -= dt;
        if (this.safeTimer <= 0) {
          this.safeTimer = PIT.safeInterval;
          const tx = Math.floor(this.x / TILE), ty = Math.floor(this.y / TILE);
          if (map.tile(tx + 1, ty) !== T.PIT && map.tile(tx - 1, ty) !== T.PIT && map.tile(tx, ty + 1) !== T.PIT && map.tile(tx, ty - 1) !== T.PIT) {
            this.lastSafeX = this.x; this.lastSafeY = this.y;
          }
        }
      }
    }
  }

  fall() {
    this.falls++;
    this.hp = Math.max(0, this.hp - PIT.fallDamage);
    if (this.hp <= 0) this.dead = true;
    this.hitFlash = 0.08; this.squash = 1;
    this.teleport(this.lastSafeX, this.lastSafeY);
  }

  // ---- drawing ----

  draw(ctx, cam, alpha, sprites) {
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

    ctx.save();
    ctx.translate(sx, sy + 5 - Math.round(bob)); // origin at the feet
    ctx.transform(1, 0, -lean, 1, 0, 0);          // shear = pixel-art lean
    ctx.scale(this.faceLeft ? -scx : scx, scy);
    ctx.drawImage(this.hitFlash > 0 ? spr.flash : spr.normal, -8, -16);
    ctx.restore();
  }
}
