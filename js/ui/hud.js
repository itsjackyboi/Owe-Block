import { INTERNAL_W, INTERNAL_H, DASH } from '../config.js';
import { drawText } from './font.js';

// In-match HUD. Later stages add XP, slots, zone timer and the minimap here.
export function drawHud(ctx, match) {
  const p = match.player;

  // health bar, top-left
  ctx.fillStyle = '#10101c'; ctx.fillRect(6, 6, 82, 10);
  ctx.fillStyle = '#4a1418'; ctx.fillRect(8, 8, 78, 6);
  ctx.fillStyle = '#e0443a'; ctx.fillRect(8, 8, Math.round(78 * Math.max(0, p.hp) / p.maxHp), 6);
  ctx.fillStyle = '#ff8a78'; ctx.fillRect(8, 8, Math.round(78 * Math.max(0, p.hp) / p.maxHp), 2);
  drawText(ctx, Math.ceil(p.hp) + '/' + p.maxHp, 92, 8, { color: '#f4f0e8' });

  // dash cooldown pip under the bar
  const cd = p.dashCd > 0 ? 1 - p.dashCd / DASH.cooldown : 1;
  ctx.fillStyle = '#10101c'; ctx.fillRect(6, 18, 52, 6);
  ctx.fillStyle = cd >= 1 ? '#7ae0a0' : '#3a6a58'; ctx.fillRect(7, 19, Math.round(50 * cd), 4);
  drawText(ctx, 'DASH', 62, 17, { color: cd >= 1 ? '#7ae0a0' : '#8a8aa0' });

  // fighters left, top-right
  const alive = match.fighters.reduce((n, f) => n + (f.dead ? 0 : 1), 0);
  drawText(ctx, 'FIGHTERS ' + alive, INTERNAL_W - 6, 8, { align: 'right' });

  // crosshair at the cursor
  const g = match.game.input;
  const cx = Math.round(g.mx), cy = Math.round(g.my);
  ctx.fillStyle = '#10101c';
  ctx.fillRect(cx - 5, cy, 11, 1); ctx.fillRect(cx, cy - 5, 1, 11);
  ctx.fillStyle = '#f4f0e8';
  ctx.fillRect(cx - 4, cy, 3, 1); ctx.fillRect(cx + 2, cy, 3, 1);
  ctx.fillRect(cx, cy - 4, 1, 3); ctx.fillRect(cx, cy + 2, 1, 3);

  if (p.dead) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
    drawText(ctx, 'YOU DIED', INTERNAL_W / 2, INTERNAL_H / 2 - 14, { align: 'center', scale: 3, color: '#e0443a' });
    drawText(ctx, 'R: TRY AGAIN', INTERNAL_W / 2, INTERNAL_H / 2 + 16, { align: 'center' });
  }
}
