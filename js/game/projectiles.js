import { Pool } from '../core/pool.js';
import { angleDiff } from '../core/math.js';
import { damage } from './combat.js';

const MODE = { FLY: 0, LOB: 1, ORBIT: 2 };
const STEP = 8; // max px per collision substep

function make() {
  return {
    mode: 0, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, r: 2, damage: 0, kb: 0, owner: null, inst: null, kind: 'arrow',
    speed: 0, travelled: 0, range: 0, pierce: 0, bounce: 0, returns: false, phase: 0, catchCut: 0, curve: 0, life: 0,
    status: null, reflected: false, hits: [], hitT: [], ang: 0, unblockable: false, itemId: null,
    sx: 0, sy: 0, tx: 0, ty: 0, t: 0, T: 1, area: null, oa: 0, oR: 0, blocks: false,
  };
}

// Pooled projectiles: flying (arrows, boomerangs), lobbed (thrown pots) and orbiting blades.
export class Projectiles {
  constructor(match) {
    this.match = match;
    this.pool = new Pool(make, 1024);
    this.orbits = 0;
    this.blocked = 0; // projectiles shot down by orbiting blades (telemetry for tests)
  }

  get count() { return this.pool.active.length; }

  base(o) {
    const p = this.pool.acquire();
    if (!p) return null;
    p.mode = MODE.FLY; p.x = p.px = o.x; p.y = p.py = o.y; p.vx = p.vy = 0;
    p.r = o.r || 2; p.damage = o.damage || 0; p.kb = o.kb || 0; p.owner = o.owner; p.inst = o.inst || null;
    p.kind = o.kind || 'arrow'; p.speed = o.speed || 0; p.travelled = 0; p.range = o.range || 200;
    p.pierce = o.pierce || 0; p.bounce = o.bounce || 0; p.returns = !!o.returns; p.phase = 0; p.catchCut = o.catchCut || 0;
    p.curve = o.curve || 0; p.life = o.life || (o.returns ? 6 : 4); p.reflected = false; p.status = o.status || null; p.hits.length = 0; p.hitT.length = 0;
    p.ang = o.ang || 0; p.unblockable = !!o.unblockable; p.itemId = o.itemId || null; p.area = null; p.blocks = false;
    return p;
  }

  fly(o) {
    const p = this.base(o);
    if (!p) return null;
    p.ang = o.angle;
    p.vx = Math.cos(o.angle) * p.speed; p.vy = Math.sin(o.angle) * p.speed;
    return p;
  }

  lob(o) {
    const p = this.base(o);
    if (!p) return null;
    p.mode = MODE.LOB;
    p.sx = o.x; p.sy = o.y; p.tx = o.tx; p.ty = o.ty;
    const d = Math.hypot(o.tx - o.x, o.ty - o.y);
    p.T = Math.max(0.3, d / (o.speed || 190)); p.t = 0; p.area = o.area; p.r = 3;
    return p;
  }

  orbit(o) {
    const p = this.base(o);
    if (!p) return null;
    p.mode = MODE.ORBIT; p.oa = o.angle || 0; p.oR = o.radius || 26; p.life = o.duration || 3; p.blocks = !!o.blocks; p.r = o.r || 6;
    this.orbits++;
    return p;
  }

  free(p) {
    if (p.mode === MODE.ORBIT) this.orbits--;
    if (p.returns && p.inst) p.inst.state.out = false;
    if (p.mode === MODE.ORBIT && p.inst && !this.pool.active.some((q) => q !== p && q.mode === MODE.ORBIT && q.inst === p.inst)) p.inst.state.orbit = false;
    p.owner = null; p.inst = null;
    this.pool.release(p);
  }

  update(dt) {
    const m = this.match, a = this.pool.active;
    for (let i = a.length - 1; i >= 0; i--) {
      const p = a[i];
      p.px = p.x; p.py = p.y;
      if (p.mode === MODE.LOB) { if (this.updateLob(p, dt)) this.free(p); continue; }
      if (p.mode === MODE.ORBIT) { if (this.updateOrbit(p, dt)) this.free(p); continue; }
      if (this.updateFly(p, dt, m)) this.free(p);
    }
    if (this.orbits > 0) this.blockProjectiles();
  }

  updateLob(p, dt) {
    p.t += dt;
    const u = Math.min(1, p.t / p.T);
    p.x = p.sx + (p.tx - p.sx) * u; p.y = p.sy + (p.ty - p.sy) * u;
    p.ang += dt * 9;
    if (u < 1) return false;
    const m = this.match;
    if (p.area) m.areas.spawn(p.area.kind, p.tx, p.ty, p.area.r, p.area.life, p.owner, p.area);
    m.fx.sparks(p.tx, p.ty, 12, '#c8884a', 110, 0.4);
    m.fx.dust(p.tx, p.ty, 5);
    return true;
  }

  updateOrbit(p, dt) {
    const o = p.owner;
    p.life -= dt;
    if (p.life <= 0 || !o || o.dead) return true;
    p.oa += 7 * dt; p.ang = p.oa * 2;
    p.x = o.x + Math.cos(p.oa) * p.oR; p.y = o.y - 2 + Math.sin(p.oa) * p.oR * 0.8;
    const m = this.match;
    const list = m.tmp;
    m.hash.query(p.x, p.y, p.r, list);
    for (let k = 0; k < list.length; k++) {
      const t = list[k];
      if (t === o || t.dead || t.invuln > 0) continue;
      let last = -1;
      for (let h = 0; h < p.hitT.length; h += 2) if (p.hitT[h] === t.id) { last = h; break; }
      if (last >= 0 && m.time - p.hitT[last + 1] < 0.45) continue;
      if (last >= 0) p.hitT[last + 1] = m.time; else p.hitT.push(t.id, m.time);
      damage(m, t, p.damage, { source: o, kind: 'projectile', kb: p.kb, ang: Math.atan2(t.y - o.y, t.x - o.x), itemId: p.itemId });
    }
    return false;
  }

  updateFly(p, dt, m) {
    const sp = p.speed * dt;
    const steps = Math.max(1, Math.ceil(sp / STEP));
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      if (p.returns) {
        if (p.phase === 0) {
          const h = Math.atan2(p.vy, p.vx) + p.curve * sdt;
          p.vx = Math.cos(h) * p.speed; p.vy = Math.sin(h) * p.speed;
        } else if (p.owner) {
          const want = Math.atan2(p.owner.y - 3 - p.y, p.owner.x - p.x);
          const cur = Math.atan2(p.vy, p.vx);
          const d = angleDiff(cur, want), turn = Math.max(-18 * sdt, Math.min(18 * sdt, d));
          p.vx = Math.cos(cur + turn) * p.speed * 1.15; p.vy = Math.sin(cur + turn) * p.speed * 1.15;
        }
      }
      const dx = p.vx * sdt, dy = p.vy * sdt;
      p.x += dx; p.y += dy;
      p.travelled += Math.hypot(dx, dy);
      p.ang += sdt * 14;

      // walls: bounce, turn a boomerang around, or die. A returning boomerang flies over everything.
      if (!(p.returns && p.phase === 1) && m.map.isSolidPx(p.x, p.y)) {
        p.x -= dx; p.y -= dy;
        if (p.bounce > 0) {
          p.bounce--;
          const blockX = m.map.isSolidPx(p.x + dx, p.y), blockY = m.map.isSolidPx(p.x, p.y + dy);
          if (blockX || !blockY) p.vx = -p.vx;
          if (blockY || !blockX) p.vy = -p.vy;
          p.hits.length = 0;
        } else if (p.returns) {
          this.turnBack(p); m.fx.sparks(p.x, p.y, 4, '#ffffff', 60, 0.2);
        } else { m.fx.sparks(p.x, p.y, 4, '#d0c8b0', 70, 0.2); return true; }
      }

      // fighters
      const list = m.tmp;
      m.hash.query(p.x, p.y, p.r, list);
      for (let k = 0; k < list.length; k++) {
        const t = list[k];
        if (t.dead || t === p.owner || t.invuln > 0) continue;
        if (p.hits.indexOf(t.id) >= 0) continue;
        // riposte stance reflects anything arriving from the front
        if (t.parryT > 0 && !p.unblockable) {
          const inc = Math.atan2(-p.vy, -p.vx);
          if (Math.abs(angleDiff(t.aim, inc)) <= t.parryArc / 2) {
            p.vx = -p.vx; p.vy = -p.vy; p.owner = t; p.reflected = true; p.hits.length = 0; p.travelled = 0;
            m.fx.sparks(p.x, p.y, 6, '#9ad0ff', 90, 0.25);
            m.fx.popup(t.x, t.y - 14, 'REFLECT', '#9ad0ff');
            continue;
          }
        }
        p.hits.push(t.id);
        const ang = Math.atan2(p.vy, p.vx);
        damage(m, t, p.damage, { source: p.owner, kind: 'projectile', kb: p.kb, ang, itemId: p.itemId, status: p.status });
        if (!p.returns) {
          if (p.pierce <= 0) { return true; }
          p.pierce--;
        }
      }

      if (p.returns && p.phase === 1 && p.owner && !p.owner.dead) {
        if (Math.hypot(p.owner.x - p.x, p.owner.y - 3 - p.y) < 9) { this.caught(p); return true; }
      } else if (p.returns && p.phase === 0 && p.travelled >= p.range) {
        this.turnBack(p);
      } else if (!p.returns && p.travelled >= p.range) return true;
    }
    p.life -= dt;
    return p.life <= 0;
  }

  // A boomerang snaps around at the end of its outward flight and heads straight back, so a target in line is hit twice.
  turnBack(p) {
    p.phase = 1; p.hits.length = 0;
    if (p.owner) {
      const a = Math.atan2(p.owner.y - 3 - p.y, p.owner.x - p.x);
      p.vx = Math.cos(a) * p.speed * 1.15; p.vy = Math.sin(a) * p.speed * 1.15;
    }
  }

  caught(p) {
    if (p.inst && p.catchCut > 0) p.inst.cd.primary *= 1 - p.catchCut;
    this.match.fx.sparks(p.x, p.y, 5, '#ffffff', 60, 0.2);
  }

  // Orbiting blades destroy enemy projectiles they touch.
  blockProjectiles() {
    const a = this.pool.active;
    for (let i = 0; i < a.length; i++) {
      const o = a[i];
      if (o.mode !== MODE.ORBIT || !o.blocks) continue;
      for (let j = a.length - 1; j >= 0; j--) {
        const p = a[j];
        if (p.mode !== MODE.FLY || p.owner === o.owner || p.unblockable) continue;
        const dx = p.x - o.x, dy = p.y - o.y, rr = o.r + p.r + 2;
        if (dx * dx + dy * dy < rr * rr) {
          this.match.fx.sparks(p.x, p.y, 6, '#ffffff', 90, 0.2);
          this.blocked++;
          this.free(p);
          break; // pool order changed; resume next frame for any remaining
        }
      }
    }
  }

  draw(ctx, cam, assets) {
    const a = this.pool.active;
    for (let i = 0; i < a.length; i++) {
      const p = a[i];
      const x = Math.round(p.x - cam.rx), y = Math.round(p.y - cam.ry);
      if (x < -20 || x > 500 || y < -20 || y > 290) continue;
      if (p.mode === MODE.LOB) {
        const u = Math.min(1, p.t / p.T), h = Math.sin(u * Math.PI) * 26;
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x - 2, y + 1, 5, 2);
        drawRot(ctx, assets.iconCanvas('ancient_pot'), x, y - Math.round(h), p.ang, 0.75);
      } else if (p.kind === 'arrow') {
        const c = Math.cos(Math.atan2(p.vy, p.vx)), s = Math.sin(Math.atan2(p.vy, p.vx));
        for (let k = -3; k <= 3; k++) { ctx.fillStyle = k === 3 ? '#e8ecf4' : (k === -3 ? '#f0f0f0' : '#d8b078'); ctx.fillRect(Math.round(x + c * k), Math.round(y + s * k), 1, 1); }
        ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(x + c * 4), Math.round(y + s * 4), 1, 1);
      } else {
        drawRot(ctx, assets.iconCanvas('drifters_call'), x, y, p.ang, 1);
      }
    }
  }
}

function drawRot(ctx, img, x, y, ang, sc) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.scale(sc, sc);
  ctx.drawImage(img, -8, -8);
  ctx.restore();
}

