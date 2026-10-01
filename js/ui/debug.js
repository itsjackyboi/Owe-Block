import { drawText } from './font.js';

// F3 overlay: FPS, update/render ms, entity counts, grid cells.
export function drawDebug(ctx, game) {
  const s = game.loop.stats();
  const m = game.match;
  const lines = [
    'FPS ' + game.loop.fps.toFixed(0),
    'UPD ' + s.upd.toFixed(2) + ' REN ' + s.ren.toFixed(2) + ' MS',
    'AVG ' + s.avg.toFixed(2) + ' P99 ' + s.p99.toFixed(2),
  ];
  if (m) {
    lines.push('FIGHTERS ' + m.fighters.length + ' DRAWN ' + m.drawList.length);
    lines.push('GRID CELLS ' + m.hash.used.length + ' OBJ ' + m.hash.count);
    lines.push('CHUNKS ' + m.map.chunksBuilt + '/' + m.map.chunks.length);
    lines.push('SEED ' + m.seed + ' T ' + m.time.toFixed(1));
  }
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(4, 40, 150, lines.length * 9 + 4);
  lines.forEach((l, i) => drawText(ctx, l, 8, 43 + i * 9, { color: '#a0ffa0', shadow: false }));
}
