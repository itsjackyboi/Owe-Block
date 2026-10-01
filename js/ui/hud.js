import { INTERNAL_W, INTERNAL_H, DASH } from '../config.js';
import { xpNeeded } from '../game/levelup.js';
import { drawText } from './font.js';
import { T } from '../game/map.js';

// In-match HUD. Later stages add the zone timer and the minimap here.
export function drawHud(ctx, match) {
  const p = match.player, assets = match.game.assets;

  // health bar, level + XP bar, dash pip: top-left
  ctx.fillStyle = '#10101c'; ctx.fillRect(6, 6, 86, 10);
  ctx.fillStyle = '#4a1418'; ctx.fillRect(8, 8, 82, 6);
  const hw = Math.round(82 * Math.max(0, p.hp) / p.maxHp);
  ctx.fillStyle = '#e0443a'; ctx.fillRect(8, 8, hw, 6);
  ctx.fillStyle = '#ff8a78'; ctx.fillRect(8, 8, hw, 2);
  drawText(ctx, Math.ceil(p.hp) + '/' + Math.round(p.maxHp), 96, 8);

  drawText(ctx, 'LV' + p.level, 6, 20, { color: '#ffd860' });
  const need = xpNeeded(p.level);
  ctx.fillStyle = '#10101c'; ctx.fillRect(34, 20, 58, 7);
  ctx.fillStyle = '#3a3010'; ctx.fillRect(35, 21, 56, 5);
  ctx.fillStyle = '#ffd860'; ctx.fillRect(35, 21, Math.round(56 * Math.min(1, p.xp / need)), 5);
  drawText(ctx, p.xp + '/' + need, 96, 20, { color: '#c8b060' });

  const cd = p.dashCd > 0 ? 1 - p.dashCd / (DASH.cooldown * p.dashCdMul) : 1;
  ctx.fillStyle = '#10101c'; ctx.fillRect(6, 30, 52, 6);
  ctx.fillStyle = cd >= 1 ? '#7ae0a0' : '#3a6a58'; ctx.fillRect(7, 31, Math.round(50 * cd), 4);
  drawText(ctx, 'DASH', 62, 29, { color: cd >= 1 ? '#7ae0a0' : '#8a8aa0' });

  // fighters left + kills + feed: top-right
  let alive = 0;
  for (let i = 0; i < match.fighters.length; i++) if (!match.fighters[i].dead) alive++;
  drawText(ctx, 'FIGHTERS ' + alive, INTERNAL_W - 6, 6, { align: 'right' });
  drawText(ctx, 'KILLS ' + p.kills, INTERNAL_W - 6, 16, { align: 'right', color: '#ffa030' });
  let fy = 30;
  for (let i = match.feed.length - 1; i >= 0; i--) {
    const e = match.feed[i], age = match.time - e.t;
    if (age > 6) continue;
    drawText(ctx, e.text, INTERNAL_W - 6, fy, { align: 'right', color: age > 5 ? '#6a6a80' : e.color });
    fy += 9;
  }

  drawSlots(ctx, match, p, assets);
  drawZoneHud(ctx, match, p);
  drawMinimap(ctx, match, p);

  // swap / pickup prompt
  if (p.prompt && p.prompt.kind === 'item') {
    const held = p.slots[p.held];
    const d = match.itemDef(p.prompt.id);
    drawText(ctx, 'E: SWAP ' + (held ? held.def.name : 'FISTS') + ' FOR ' + d.name + (p.prompt.level > 1 ? ' L' + p.prompt.level : ''), INTERNAL_W / 2, INTERNAL_H - 62, { align: 'center', color: '#ffffff' });
  }

  // aim line while in aim stance
  const it = match.game.input;
  const cx = Math.round(it.mx), cy = Math.round(it.my);
  if (p.stance && !p.dead) {
    const sx = Math.round(p.x - match.camera.rx), sy = Math.round(p.y - match.camera.ry - 3);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    const len = Math.min(140, Math.hypot(cx - sx, cy - sy));
    for (let d = 14; d < len; d += 5) ctx.fillRect(Math.round(sx + Math.cos(p.aim) * d), Math.round(sy + Math.sin(p.aim) * d), 1, 1);
  }

  // crosshair (tighter in aim stance)
  const o = p.stance ? 3 : 5, i = p.stance ? 1 : 2;
  ctx.fillStyle = '#10101c';
  ctx.fillRect(cx - o - 1, cy, o * 2 + 3, 1); ctx.fillRect(cx, cy - o - 1, 1, o * 2 + 3);
  ctx.fillStyle = p.stance ? '#ffd860' : '#f4f0e8';
  ctx.fillRect(cx - o, cy, o - i + 1, 1); ctx.fillRect(cx + i, cy, o - i + 1, 1);
  ctx.fillRect(cx, cy - o, 1, o - i + 1); ctx.fillRect(cx, cy + i, 1, o - i + 1);
}

function drawSlots(ctx, match, p, assets) {
  const n = p.slots.length, W = 22, G = 4;
  const x0 = Math.round((INTERNAL_W - (n * W + (n - 1) * G)) / 2), y0 = INTERNAL_H - 30;
  const heldInst = p.item;
  // held item name above the bar
  drawText(ctx, heldInst.def.name + (p.slots[p.held] ? ' L' + heldInst.level : ''), INTERNAL_W / 2, y0 - 12, { align: 'center', color: '#e8e4d8' });
  for (let i = 0; i < n; i++) {
    const inst = p.slots[i], held = i === p.held;
    const x = x0 + i * (W + G), y = y0 - (held ? 3 : 0);
    ctx.fillStyle = '#10101c'; ctx.fillRect(x - 1, y - 1, W + 2, W + 2);
    ctx.fillStyle = held ? '#4a4668' : '#26243c'; ctx.fillRect(x, y, W, W);
    if (held) { ctx.fillStyle = '#ffd860'; ctx.fillRect(x, y, W, 1); ctx.fillRect(x, y + W - 1, W, 1); ctx.fillRect(x, y, 1, W); ctx.fillRect(x + W - 1, y, 1, W); }
    drawText(ctx, String(i + 1), x + 2, y + 2, { color: held ? '#ffd860' : '#6a6a88', shadow: false });
    if (!inst) {
      if (held && p.slots.every((s) => !s)) drawText(ctx, 'FIST', x + W / 2, y + 8, { align: 'center', color: '#8a8aa0', shadow: false });
      continue;
    }
    assets.drawIcon(ctx, inst.id, x + 3, y + 3);
    // primary cooldown sweep over the icon
    if (inst.cd.primary > 0) {
      const f = Math.min(1, inst.cd.primary / inst.cdMax.primary);
      ctx.fillStyle = 'rgba(8,6,16,0.65)'; ctx.fillRect(x + 1, y + 1, W - 2, Math.round((W - 2) * f));
    }
    // level pips along the bottom
    ctx.fillStyle = '#ffd860';
    for (let l = 0; l < inst.level; l++) ctx.fillRect(x + 3 + l * 4, y + W - 3, 3, 2);
    // Q special chip, bottom-right, fills as it recharges
    if (inst.def.special) {
      const qx = x + W - 8, qy = y + 1;
      ctx.fillStyle = '#10101c'; ctx.fillRect(qx, qy, 7, 7);
      const rdy = inst.cd.special <= 0, fr = rdy ? 1 : 1 - inst.cd.special / inst.cdMax.special;
      ctx.fillStyle = rdy ? '#9ad0ff' : '#34506a'; ctx.fillRect(qx + 1, qy + 6 - Math.round(5 * fr), 5, Math.max(1, Math.round(5 * fr)));
      drawText(ctx, 'Q', qx + 1, qy, { color: rdy ? '#10101c' : '#9ab0c8', shadow: false });
    }
  }
}

const MM = 64;

// Pre-render the map silhouette once (nearest-neighbour sample of the tile grid).
export function buildMinimap(map) {
  const c = document.createElement('canvas');
  c.width = MM; c.height = MM;
  const g = c.getContext('2d');
  const img = g.createImageData(MM, MM);
  for (let y = 0; y < MM; y++) for (let x = 0; x < MM; x++) {
    const t = map.tiles[Math.floor((y / MM) * map.h) * map.w + Math.floor((x / MM) * map.w)];
    const i = (y * MM + x) * 4;
    const col = t === T.WALL ? [34, 22, 28] : t === T.PIT ? [0, 0, 0] : t === T.COVER ? [150, 100, 60] : [200, 146, 92];
    img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// 64x64 minimap: map silhouette, current zone (white), next zone (yellow) and the player. No enemies.
function drawMinimap(ctx, match, p) {
  const x = 6, y = INTERNAL_H - MM - 6, z = match.zone;
  ctx.fillStyle = '#10101c'; ctx.fillRect(x - 1, y - 1, MM + 2, MM + 2);
  ctx.drawImage(match.minimap, x, y);
  const sx = MM / match.map.pxW, sy = MM / match.map.pxH;
  // darken outside the current zone
  const r = z.rect;
  ctx.fillStyle = 'rgba(14,8,26,0.55)';
  ctx.fillRect(x, y, MM, Math.max(0, r.y0 * sy));
  ctx.fillRect(x, y + r.y1 * sy, MM, Math.max(0, MM - r.y1 * sy));
  ctx.fillRect(x, y + r.y0 * sy, Math.max(0, r.x0 * sx), (r.y1 - r.y0) * sy);
  ctx.fillRect(x + r.x1 * sx, y + r.y0 * sy, Math.max(0, MM - r.x1 * sx), (r.y1 - r.y0) * sy);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(x + r.x0 * sx) + 0.5, Math.round(y + r.y0 * sy) + 0.5, Math.max(1, Math.round((r.x1 - r.x0) * sx)), Math.max(1, Math.round((r.y1 - r.y0) * sy)));
  if (!z.done) {
    const t = z.target;
    ctx.strokeStyle = '#ffd860';
    ctx.strokeRect(Math.round(x + t.x0 * sx) + 0.5, Math.round(y + t.y0 * sy) + 0.5, Math.max(1, Math.round((t.x1 - t.x0) * sx)), Math.max(1, Math.round((t.y1 - t.y0) * sy)));
  }
  if (!p.dead && (Math.floor(match.time * 3) % 2 === 0)) {
    ctx.fillStyle = '#10101c'; ctx.fillRect(Math.round(x + p.x * sx) - 2, Math.round(y + p.y * sy) - 2, 5, 5);
    ctx.fillStyle = '#7ae0ff'; ctx.fillRect(Math.round(x + p.x * sx) - 1, Math.round(y + p.y * sy) - 1, 3, 3);
  }
}

// "SWEEP IN 0:42" / "SWEEPING 0:18" at the top, and a red pulse while you stand outside the zone.
function drawZoneHud(ctx, match, p) {
  const z = match.zone, lab = z.label();
  const out = !p.dead && z.dps > 0 && !z.inside(p.x, p.y);
  drawText(ctx, lab.text, INTERNAL_W / 2, 6, { align: 'center', color: lab.closing ? '#ff8a78' : '#e8e4d8' });
  if (out) {
    const a = 0.25 + 0.15 * Math.sin(match.time * 8);
    ctx.fillStyle = 'rgba(200,30,20,' + a + ')';
    ctx.fillRect(0, 0, INTERNAL_W, 6); ctx.fillRect(0, INTERNAL_H - 6, INTERNAL_W, 6); ctx.fillRect(0, 0, 6, INTERNAL_H); ctx.fillRect(INTERNAL_W - 6, 0, 6, INTERNAL_H);
    drawText(ctx, 'GET INSIDE THE ZONE! ' + (z.dps + p.exposure).toFixed(0) + '/S', INTERNAL_W / 2, 18, { align: 'center', color: '#ff6a5a' });
  }
}
