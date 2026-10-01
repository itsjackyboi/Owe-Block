// Mines (Dig Dug's mines, Bully Hill): cave chambers joined by narrow tunnels. One generator per mode, composed from mapgen tools.
import { T } from '../../game/map.js';
import { poissonDisc, carveBlob, carveTunnel, smooth, fillUnreachable, bfs, openAround } from '../../game/mapgen.js';
import { TILE } from '../../config.js';

export function generateMines(rng, w, h) {
  const tiles = new Uint8Array(w * h).fill(T.WALL);

  // 1. chamber centres, spread with Poisson-disc sampling
  const margin = 12;
  let centres = poissonDisc(rng, w - margin * 2, h - margin * 2, 21, 24, margin, margin);
  centres = rng.shuffle(centres).slice(0, Math.round((w * h) / 600));
  const chambers = centres.map((c) => ({ x: c.x, y: c.y, r: rng.float(5, 10.5), depth: 0 }));
  for (const c of chambers) carveBlob(tiles, w, h, c.x, c.y, c.r, rng);

  // 2. join them: minimum spanning tree for guaranteed connectivity, plus a few extra loops
  const linked = new Set();
  const edges = [];
  const inTree = [0];
  const rest = new Set(chambers.map((_, i) => i).filter((i) => i > 0));
  while (rest.size) {
    let best = null;
    for (const a of inTree) for (const b of rest) {
      const d = Math.hypot(chambers[a].x - chambers[b].x, chambers[a].y - chambers[b].y);
      if (!best || d < best.d) best = { a, b, d };
    }
    edges.push(best); inTree.push(best.b); rest.delete(best.b); linked.add(best.a + ',' + best.b);
  }
  for (let n = 0; n < 5; n++) {
    const a = rng.int(0, chambers.length);
    let b = -1, bd = Infinity;
    for (let j = 0; j < chambers.length; j++) {
      if (j === a || linked.has(a + ',' + j) || linked.has(j + ',' + a)) continue;
      const d = Math.hypot(chambers[a].x - chambers[j].x, chambers[a].y - chambers[j].y) + rng.float(0, 14);
      if (d < bd) { bd = d; b = j; }
    }
    if (b >= 0) { edges.push({ a, b }); linked.add(a + ',' + b); }
  }
  for (const e of edges) {
    const A = chambers[e.a], B = chambers[e.b];
    carveTunnel(tiles, w, h, A.x, A.y, B.x, B.y, rng.chance(0.25) ? 3 : 2, rng);
  }

  // 3. organic edges, then drop anything not connected to the first chamber
  smooth(tiles, w, h);
  smooth(tiles, w, h);
  for (let x = 0; x < w; x++) for (let y = 0; y < 2; y++) { tiles[y * w + x] = T.WALL; tiles[(h - 1 - y) * w + x] = T.WALL; }
  for (let y = 0; y < h; y++) for (let x = 0; x < 2; x++) { tiles[y * w + x] = T.WALL; tiles[y * w + w - 1 - x] = T.WALL; }
  const rx = Math.round(chambers[0].x), ry = Math.round(chambers[0].y);
  if (tiles[ry * w + rx] !== T.FLOOR) tiles[ry * w + rx] = T.FLOOR;
  fillUnreachable(tiles, w, h, rx, ry);
  const live = chambers.filter((c) => tiles[Math.round(c.y) * w + Math.round(c.x)] === T.FLOOR);

  // 4. depth = BFS distance from the middle of the map; the deepest chamber becomes the vault later
  let hub = live[0], hd = Infinity;
  for (const c of live) { const d = Math.hypot(c.x - w / 2, c.y - h / 2); if (d < hd) { hd = d; hub = c; } }
  const hubDist = bfs(tiles, w, h, Math.round(hub.x), Math.round(hub.y));
  for (const c of live) c.depth = hubDist[Math.round(c.y) * w + Math.round(c.x)];

  // 5. props: void pits inside big chambers, cover scattered where it cannot block a path
  for (const c of live) {
    if (c.r >= 7.5 && rng.chance(0.4)) {
      const ang = rng.float(0, 6.28), off = c.r * rng.float(0.35, 0.5);
      const px = c.x + Math.cos(ang) * off, py = c.y + Math.sin(ang) * off;
      carveBlob(tiles, w, h, px, py, rng.float(1.2, 2.2), rng, T.PIT, 4);
    }
  }
  const deco = new Uint8Array(w * h);
  for (const c of live) {
    const n = rng.int(2, 6);
    for (let k = 0; k < n; k++) {
      const a = rng.float(0, 6.28), d = rng.float(0, c.r * 0.7);
      const tx = Math.round(c.x + Math.cos(a) * d), ty = Math.round(c.y + Math.sin(a) * d);
      if (tx > 2 && ty > 2 && tx < w - 3 && ty < h - 3 && openAround(tiles, w, tx, ty)) tiles[ty * w + tx] = T.COVER;
    }
  }
  for (let i = 0; i < tiles.length; i++) if (tiles[i] === T.FLOOR && rng.chance(0.035)) deco[i] = 1;

  // 6. spawn points: open floor tiles, at least 6 tiles apart
  const open = [];
  for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) if (openAround(tiles, w, x, y)) open.push({ x, y });
  rng.shuffle(open);
  const spawns = [];
  for (const p of open) {
    let ok = true;
    for (const s of spawns) if ((s.tx - p.x) ** 2 + (s.ty - p.y) ** 2 < 36) { ok = false; break; }
    if (ok) spawns.push({ tx: p.x, ty: p.y, x: (p.x + 0.5) * TILE, y: (p.y + 0.5) * TILE });
    if (spawns.length >= 110) break;
  }

  // 7. loot candidates: clusters inside chambers, a vault in the deepest chamber, scattered XP spots
  const lootPoints = [], vaultPoints = [], xpPoints = [];
  const spot = (cx, cy, rad) => {
    for (let tries = 0; tries < 12; tries++) {
      const a = rng.float(0, 6.28), d = rng.float(0, rad);
      const tx = Math.round(cx + Math.cos(a) * d), ty = Math.round(cy + Math.sin(a) * d);
      if (tx > 2 && ty > 2 && tx < w - 3 && ty < h - 3 && tiles[ty * w + tx] === T.FLOOR) return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
    }
    return null;
  };
  let deepest = live[0];
  for (const c of live) if (c.depth > deepest.depth) deepest = c;
  for (const c of live) {
    const n = rng.int(2, 6);
    for (let k = 0; k < n; k++) { const pt = spot(c.x, c.y, c.r * 0.8); if (pt) { pt.chamber = c === deepest ? 'vault' : 'chamber'; (c === deepest ? vaultPoints : lootPoints).push(pt); } }
  }
  for (const f of open.slice(0, 1400)) xpPoints.push({ x: (f.x + 0.5) * TILE, y: (f.y + 0.5) * TILE });

  return { w, h, tiles, deco, chambers: live, spawns, lootPoints, vaultPoints, xpPoints, vault: deepest };
}
