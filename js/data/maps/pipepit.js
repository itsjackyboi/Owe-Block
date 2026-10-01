// Pipe Pit (Mickey's Pipe Club fight pit): a big open pit ringed by a pipe maze with long corridors.
// Hazards come from the data it returns: conveyor strips (push fighters) and steam vents (hiss, then burst).
import { T } from '../../game/map.js';
import { carveBlob, fillUnreachable, bfs, openAround } from '../../game/mapgen.js';
import { TILE } from '../../config.js';

export function generatePipePit(rng, w, h) {
  const tiles = new Uint8Array(w * h).fill(T.WALL);
  const cx = w / 2, cy = h / 2, RP = 20;
  carveBlob(tiles, w, h, cx, cy, RP, rng, T.FLOOR, 3);

  // pipe maze: 4-tile cells (2x2 floor interior, 2 tiles of pipe between), carved with a randomised depth-first walk
  const P = 4, ox = 4, nc = Math.floor((w - ox * 2) / P), nr = Math.floor((h - ox * 2) / P);
  const ccx = (i) => ox + i * P + 1.5, ccy = (j) => ox + j * P + 1.5; // centre of cell interior
  const inRing = (i, j) => { const d = Math.hypot(ccx(i) - cx, ccy(j) - cy); return d > RP + 3 && d < Math.min(w, h) / 2 - 5; };
  const cells = [];
  for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) if (inRing(i, j)) cells.push([i, j]);
  const carveCell = (i, j) => { const x = ox + i * P + 1, y = oy(j); for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) tiles[(y + b) * w + x + a] = T.FLOOR; };
  const oy = (j) => ox + j * P + 1;
  const link = (i, j, i2, j2) => {
    const x = ox + Math.min(i, i2) * P + 1, y = oy(Math.min(j, j2));
    if (i !== i2) for (let a = 2; a < 4 + 2; a++) for (let b = 0; b < 2; b++) tiles[(y + b) * w + x + a] = T.FLOOR;
    else for (let a = 2; a < 4 + 2; a++) for (let b = 0; b < 2; b++) tiles[(y + a) * w + x + b] = T.FLOOR;
  };
  const key = (i, j) => j * nc + i;
  const ring = new Set(cells.map(([i, j]) => key(i, j)));
  const linked = new Set(), degree = new Map();
  const addLink = (i, j, i2, j2) => { linked.add(key(i, j) + ':' + key(i2, j2)); linked.add(key(i2, j2) + ':' + key(i, j)); degree.set(key(i, j), (degree.get(key(i, j)) || 0) + 1); degree.set(key(i2, j2), (degree.get(key(i2, j2)) || 0) + 1); link(i, j, i2, j2); };
  const visited = new Set();
  const start = cells.reduce((a, c) => (Math.hypot(ccx(c[0]) - cx, ccy(c[1]) - cy) < Math.hypot(ccx(a[0]) - cx, ccy(a[1]) - cy) ? c : a), cells[0]);
  const stack = [start];
  visited.add(key(start[0], start[1])); carveCell(start[0], start[1]);
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const nb = rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]]).map(([dx, dy]) => [i + dx, j + dy]).filter(([a, b]) => ring.has(key(a, b)) && !visited.has(key(a, b)));
    if (!nb.length) { stack.pop(); continue; }
    const [a, b] = nb[0];
    visited.add(key(a, b)); carveCell(a, b); addLink(i, j, a, b); stack.push([a, b]);
  }
  for (const [i, j] of cells) { // loops, so the maze is not a tree
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const a = i + dx, b = j + dy;
      if (ring.has(key(a, b)) && visited.has(key(i, j)) && visited.has(key(a, b)) && !linked.has(key(i, j) + ':' + key(a, b)) && rng.chance(0.14)) addLink(i, j, a, b);
    }
  }
  // gates: straight corridors from the maze into the pit, spread around the ring
  for (let g = 0; g < 6; g++) {
    const ang = (g / 6) * Math.PI * 2 + rng.float(-0.3, 0.3);
    let best = null, bd = 1e9;
    for (const [i, j] of cells) {
      if (!visited.has(key(i, j))) continue;
      const a = Math.atan2(ccy(j) - cy, ccx(i) - cx), d = Math.hypot(ccx(i) - cx, ccy(j) - cy);
      const da = Math.abs(Math.atan2(Math.sin(a - ang), Math.cos(a - ang)));
      if (da < 0.45 && d < bd) { bd = d; best = [i, j]; }
    }
    if (!best) continue;
    let x = Math.round(ccx(best[0])), y = Math.round(ccy(best[1]));
    const sx = Math.sign(cx - x) || 1, sy = Math.sign(cy - y) || 1, horiz = Math.abs(cx - x) > Math.abs(cy - y);
    for (let n = 0; n < 40; n++) {
      for (let k = 0; k < 2; k++) tiles[(horiz ? y + k : y) * w + (horiz ? x : x + k)] = T.FLOOR;
      if (Math.hypot(x - cx, y - cy) < RP - 1) break;
      if (horiz) x += sx; else y += sy;
    }
  }
  fillUnreachable(tiles, w, h, Math.round(cx), Math.round(cy));
  for (let x = 0; x < w; x++) for (let y = 0; y < 2; y++) { tiles[y * w + x] = T.WALL; tiles[(h - 1 - y) * w + x] = T.WALL; }
  for (let y = 0; y < h; y++) for (let x = 0; x < 2; x++) { tiles[y * w + x] = T.WALL; tiles[y * w + w - 1 - x] = T.WALL; }

  // conveyor strips: two across the pit, and straight stretches of corridor
  const conv = new Uint8Array(w * h);
  const strip = (x0, y0, x1, y1, code) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (tiles[y * w + x] === T.FLOOR) conv[y * w + x] = code; };
  strip(Math.round(cx - 10), Math.round(cy - 11), Math.round(cx + 10), Math.round(cy - 9), 1);
  strip(Math.round(cx - 10), Math.round(cy + 9), Math.round(cx + 10), Math.round(cy + 11), 2);
  const used = new Uint8Array(w * h);
  const runs = [];
  for (let y = 4; y < h - 5; y++) for (let x = 4; x < w - 5; x++) { // horizontal two-wide corridors
    if (Math.hypot(x - cx, y - cy) < RP + 2) continue;
    let n = 0;
    while (x + n < w - 4 && tiles[y * w + x + n] === T.FLOOR && tiles[(y + 1) * w + x + n] === T.FLOOR && tiles[(y - 1) * w + x + n] === T.WALL && tiles[(y + 2) * w + x + n] === T.WALL) n++;
    if (n >= 8) { runs.push({ x, y, n, h: true }); x += n; }
  }
  for (let x = 4; x < w - 5; x++) for (let y = 4; y < h - 5; y++) { // vertical
    if (Math.hypot(x - cx, y - cy) < RP + 2) continue;
    let n = 0;
    while (y + n < h - 4 && tiles[(y + n) * w + x] === T.FLOOR && tiles[(y + n) * w + x + 1] === T.FLOOR && tiles[(y + n) * w + x - 1] === T.WALL && tiles[(y + n) * w + x + 2] === T.WALL) n++;
    if (n >= 8) { runs.push({ x, y, n, h: false }); y += n; }
  }
  rng.shuffle(runs);
  let placed = 0;
  const lootPoints = [];
  for (const r of runs) {
    if (placed >= 8) break;
    const pad = 2, a = r.h ? r.x + pad : r.x, b = r.h ? r.x + r.n - pad : r.x;
    const code = r.h ? rng.int(1, 3) : rng.int(3, 5);
    let clash = false;
    for (let k = 0; k < r.n && !clash; k++) if (used[(r.h ? r.y : r.y + k) * w + (r.h ? r.x + k : r.x)]) clash = true;
    if (clash) continue;
    for (let k = pad; k < r.n - pad; k++) for (let t = 0; t < 2; t++) {
      const tx = r.h ? r.x + k : r.x + t, ty = r.h ? r.y + t : r.y + k;
      conv[ty * w + tx] = code; used[ty * w + tx] = 1;
    }
    lootPoints.push({ x: ((r.h ? r.x + r.n / 2 : r.x + 1) ) * TILE, y: ((r.h ? r.y + 1 : r.y + r.n / 2)) * TILE }); // crates ride the belts
    placed++;
    void a; void b;
  }

  // crate clusters and pillars in the pit
  const spots = [];
  for (let n = 0; n < 40; n++) {
    const ang = rng.float(0, 6.283), d = rng.float(4, RP - 4);
    const x = Math.round(cx + Math.cos(ang) * d), y = Math.round(cy + Math.sin(ang) * d);
    if (openAround(tiles, w, x, y) && !conv[y * w + x] && conv[(y - 1) * w + x] === 0 && conv[(y + 1) * w + x] === 0) { tiles[y * w + x] = T.COVER; if (rng.chance(0.5) && openAround(tiles, w, x + 1, y)) tiles[y * w + x + 1] = T.COVER; spots.push({ x, y }); }
    if (spots.length >= 10) break;
  }

  // steam vents: 2x2 floor blocks, spread out
  const block2 = (x, y) => tiles[y * w + x] === T.FLOOR && tiles[y * w + x + 1] === T.FLOOR && tiles[(y + 1) * w + x] === T.FLOOR && tiles[(y + 1) * w + x + 1] === T.FLOOR && !conv[y * w + x] && !conv[y * w + x + 1] && !conv[(y + 1) * w + x];
  const vents = [];
  for (let n = 0; n < 600 && vents.length < 14; n++) {
    const x = rng.int(5, w - 6), y = rng.int(5, h - 6);
    if (!block2(x, y)) continue;
    if (vents.every((v) => (v.tx - x) ** 2 + (v.ty - y) ** 2 > 64)) vents.push({ tx: x, ty: y, x: (x + 1) * TILE, y: (y + 1) * TILE, phase: rng.float(0, 8), period: rng.float(6, 9) });
  }

  // spawns, loot, xp
  const spawns = [], xpPoints = [], vaultPoints = [];
  for (let y = 4; y < h - 5; y++) for (let x = 4; x < w - 5; x++) {
    if (!block2(x, y)) continue;
    if (vents.some((v) => Math.abs(v.tx - x) < 3 && Math.abs(v.ty - y) < 3)) continue;
    if (Math.hypot(x - cx, y - cy) > 6) spawns.push({ tx: x, ty: y, x: (x + 1) * TILE, y: (y + 1) * TILE });
    if (rng.chance(0.05)) xpPoints.push({ x: (x + 1) * TILE, y: (y + 1) * TILE });
  }
  rng.shuffle(spawns);
  for (let k = 0; k < 6; k++) { const a = (k / 6) * 6.283 + 0.3, d = rng.float(2, 7); vaultPoints.push({ x: (cx + Math.cos(a) * d) * TILE, y: (cy + Math.sin(a) * d) * TILE }); }
  for (const [i, j] of cells) if (visited.has(key(i, j)) && rng.chance(0.4)) lootPoints.push({ x: (ccx(i) + 0.5) * TILE, y: (ccy(j) + 0.5) * TILE });

  // chambers: the pit, plus maze junctions (three or more ways out), for AI roaming and the zone's final point
  const dist = bfs(tiles, w, h, Math.round(cx), Math.round(cy));
  const chambers = [{ x: cx, y: cy, r: RP, depth: 0 }];
  for (const [i, j] of cells) if ((degree.get(key(i, j)) || 0) >= 3 && visited.has(key(i, j))) {
    const d = dist[Math.round(ccy(j)) * w + Math.round(ccx(i))];
    if (d >= 0) chambers.push({ x: ccx(i) + 0.5, y: ccy(j) + 0.5, r: 2, depth: d });
  }
  const ok = (p) => { const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE); return tiles[ty * w + tx] === T.FLOOR && dist[ty * w + tx] >= 0; };
  const keep = [chambers[0], ...rng.shuffle(chambers.slice(1)).slice(0, 30)];
  return { w, h, tiles, deco: new Uint8Array(w * h), conv, vents, chambers: keep, spawns: spawns.slice(0, 140), lootPoints: lootPoints.filter(ok), vaultPoints: vaultPoints.filter(ok), xpPoints: rng.shuffle(xpPoints), vault: chambers[0] };
}
