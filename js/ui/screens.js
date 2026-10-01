import { INTERNAL_W, INTERNAL_H } from '../config.js';
import { STATS } from '../data/stats.js';
import { ITEMS } from '../data/registry.js';
import { drawText, wrapText } from './font.js';

const CARD_W = 130, CARD_H = 156, GAP = 12;
const TYPE = { item: { label: 'NEW ITEM', color: '#7ae0a0' }, upgrade: { label: 'UPGRADE', color: '#ffd860' }, stat: { label: 'BOOST', color: '#9ad0ff' } };

export function cardRect(i, n) {
  const total = n * CARD_W + (n - 1) * GAP;
  return { x: Math.round((INTERNAL_W - total) / 2) + i * (CARD_W + GAP), y: 62, w: CARD_W, h: CARD_H };
}

// Level-up picker: world is paused while this is open. Choose with 1/2/3 or a click.
export function drawLevelUp(ctx, match, assets, input) {
  const lu = match.levelUp;
  ctx.fillStyle = 'rgba(8,6,16,0.72)'; ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
  drawText(ctx, 'LEVEL ' + match.player.level + '!', INTERNAL_W / 2, 28, { align: 'center', scale: 3, color: '#ffd860' });
  drawText(ctx, 'CHOOSE ONE  (1 2 3 OR CLICK)', INTERNAL_W / 2, 52, { align: 'center', color: '#8a8aa0' });
  lu.offers.forEach((o, i) => {
    const r = cardRect(i, lu.offers.length);
    const hover = input.mx >= r.x && input.mx < r.x + r.w && input.my >= r.y && input.my < r.y + r.h;
    const t = TYPE[o.type];
    ctx.fillStyle = '#10101c'; ctx.fillRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
    ctx.fillStyle = hover ? '#3a3858' : '#26243c'; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = hover ? '#f4f0e8' : t.color; ctx.fillRect(r.x, r.y, r.w, 2); ctx.fillRect(r.x, r.y + r.h - 2, r.w, 2);
    drawText(ctx, t.label, r.x + r.w / 2, r.y + 8, { align: 'center', color: t.color });
    // icon
    const cx = r.x + r.w / 2;
    if (o.type === 'stat') {
      const s = STATS.find((q) => q.id === o.id);
      ctx.fillStyle = '#10101c'; ctx.fillRect(cx - 18, r.y + 22, 36, 36);
      ctx.fillStyle = s.color; ctx.fillRect(cx - 16, r.y + 24, 32, 32);
      drawText(ctx, s.tag, cx, r.y + 34, { align: 'center', scale: 2, color: '#10101c', shadow: false });
    } else {
      ctx.fillStyle = '#10101c'; ctx.fillRect(cx - 18, r.y + 22, 36, 36);
      ctx.fillStyle = '#34324e'; ctx.fillRect(cx - 16, r.y + 24, 32, 32);
      assets.drawIcon(ctx, o.id, cx - 16, r.y + 24, 2);
    }
    // name + detail
    let y = r.y + 66;
    for (const line of wrapText(o.name, 20)) { drawText(ctx, line, cx, y, { align: 'center' }); y += 9; }
    if (o.type === 'upgrade') { drawText(ctx, 'L' + o.from + ' > L' + o.to, cx, y + 2, { align: 'center', color: '#ffd860' }); y += 13; }
    y += 3;
    for (const line of wrapText(o.effect, 20).slice(0, 4)) { drawText(ctx, line, cx, y, { align: 'center', color: '#a8a8c0' }); y += 9; }
    drawText(ctx, '[' + (i + 1) + ']', cx, r.y + r.h - 14, { align: 'center', color: hover ? '#ffffff' : '#6a6a88' });
  });
}

export function drawDeath(ctx, match) {
  const p = match.player;
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
  const cx = INTERNAL_W / 2;
  drawText(ctx, 'YOU DIED', cx, 52, { align: 'center', scale: 4, color: '#e0443a' });
  const total = match.fighters.length;
  const lines = [
    'PLACE #' + match.placement + ' OF ' + total,
    'KILLS ' + p.kills + '   DAMAGE ' + Math.round(p.damageDealt),
    'LEVEL ' + p.level + '   TIME ' + fmtTime(p.surviveTime),
  ];
  const k = p.killedBy;
  lines.push(k ? 'KILLED BY ' + k.name + (p.killedByItem ? ' (' + itemName(p.killedByItem) + ')' : '') : 'KILLED BY THE CAVE');
  lines.forEach((l, i) => drawText(ctx, l, cx, 104 + i * 14, { align: 'center' }));
  drawText(ctx, 'R: TRY AGAIN', cx, 200, { align: 'center', color: '#ffd860' });
}

export function drawVictory(ctx, match) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
  const cx = INTERNAL_W / 2;
  drawText(ctx, 'LAST ONE STANDING', cx, 70, { align: 'center', scale: 3, color: '#ffd860' });
  drawText(ctx, 'KILLS ' + match.player.kills + '   TIME ' + fmtTime(match.time), cx, 110, { align: 'center' });
  drawText(ctx, '(GANG CHOICE AND SUMMARY ARRIVE IN STAGE 6)', cx, 134, { align: 'center', color: '#8a8aa0' });
  drawText(ctx, 'R: NEW MATCH', cx, 170, { align: 'center', color: '#ffd860' });
}

export const fmtTime = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

function itemName(id) { return ITEMS[id] ? ITEMS[id].name : id.toUpperCase(); }
