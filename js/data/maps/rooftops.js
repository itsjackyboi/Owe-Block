// Rooftops (the final gang war): roof platforms separated by two-tile alley gaps, joined by planks.
// A few isolated roofs (the vaults) have no plank: reach them with a dash (the gap is dashable) or a Beast Hook.
import { T } from '../../game/map.js';
import { openAround } from '../../game/mapgen.js';
import { TILE } from '../../config.js';

export function generateRooftops(rng, w, h) {
  const tiles = new Uint8Array(w * h).fill(T.PIT); // everything that is not a roof is the alley far below
  const style = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) for (let y = 0; y < 2; y++) { tiles[y * w + x] = T.WALL; tiles[(h - 1 - y) * w + x] = T.WALL; }
  for (let y = 0; y < h; y++) for (let x = 0; x < 2; x++) { tiles[y * w + x] = T.WALL; tiles[y * w + w - 1 - x] = T.WALL; }

  // 1. one roof per cell of a 7x7 grid
  const N = 7, margin = 4, cw = (w - margin * 2) / N, ch = (h - margin * 2) / N;
  const roofs = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const ox = Math.round(margin + i * cw), oy = Math.round(margin + j * ch);
    const cellW = Math.round(margin + (i + 1) * cw) - ox, cellH = Math.round(margin + (j + 1) * ch) - oy;
    const rw = rng.int(Math.max(7, cellW - 6), cellW - 1), rh = rng.int(Math.max(7, cellH - 6), cellH - 1);
    const x0 = ox + 1 + rng.int(0, cellW - 2 - rw + 1), y0 = oy + 1 + rng.int(0, cellH - 2 - rh + 1);
    roofs.push({ i, j, x0, y0, x1: x0 + rw - 1, y1: y0 + rh - 1, vault: false, style: rng.int(0, 3), comp: -1 });
  }
  const R = (i, j) => roofs[j * N + i];
  const fill = (r, v = T.FLOOR) => { for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) { tiles[y * w + x] = v; style[y * w + x] = r.style; } };

  // 2. vault roofs: isolated, not next to each other, away from the border
  const cand = [];
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) cand.push(R(i, j));
  rng.shuffle(cand);
  const vaults = [];
  for (const c of cand) {
    if (vaults.length >= 3) break;
    if (vaults.every((v) => Math.max(Math.abs(v.i - c.i), Math.abs(v.j - c.j)) >= 2)) { c.vault = true; c.style = 2; vaults.push(c); }
  }
  roofs.forEach((r) => fill(r));

  // 3. planks between neighbouring non-vault roofs; union-find keeps the main set connected
  const par = roofs.map((_, k) => k);
  const find = (a) => (par[a] === a ? a : (par[a] = find(par[a])));
  const pairs = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (i + 1 < N) pairs.push([R(i, j), R(i + 1, j), 'h']);
    if (j + 1 < N) pairs.push([R(i, j), R(i, j + 1), 'v']);
  }
  rng.shuffle(pairs);
  const plank = (A, B, dir) => {
    if (dir === 'h') {
      const lo = Math.max(A.y0, B.y0) + 1, hi = Math.min(A.y1, B.y1) - 2;
      if (hi < lo) return false;
      const y = rng.int(lo, hi + 1);
      for (let x = A.x1 + 1; x < B.x0; x++) for (let k = 0; k < 2; k++) { tiles[(y + k) * w + x] = T.FLOOR; style[(y + k) * w + x] = 2; }
    } else {
      const lo = Math.max(A.x0, B.x0) + 1, hi = Math.min(A.x1, B.x1) - 2;
      if (hi < lo) return false;
      const x = rng.int(lo, hi + 1);
      for (let y = A.y1 + 1; y < B.y0; y++) for (let k = 0; k < 2; k++) { tiles[y * w + x + k] = T.FLOOR; style[y * w + x + k] = 2; }
    }
    return true;
  };
  const idx = (r) => roofs.indexOf(r);
  for (const [A, B, dir] of pairs) { // first pass: random planks
    if (A.vault || B.vault || !rng.chance(0.55)) continue;
    if (plank(A, B, dir)) par[find(idx(A))] = find(idx(B));
  }
  for (const [A, B, dir] of pairs) { // second pass: join whatever is still apart
    if (A.vault || B.vault || find(idx(A)) === find(idx(B))) continue;
    if (plank(A, B, dir)) par[find(idx(A))] = find(idx(B));
  }
  // largest connected set of non-vault roofs is the main area
  const sizes = new Map();
  for (const r of roofs) if (!r.vault) sizes.set(find(idx(r)), (sizes.get(find(idx(r))) || 0) + 1);
  let mainRoot = -1, best = -1;
  for (const [k, n] of sizes) if (n > best) { best = n; mainRoot = k; }
  for (const r of roofs) r.main = !r.vault && find(idx(r)) === mainRoot;

  // 4. vault ledges: shrink each gap to exactly two tiles so a dash (or a hook) can cross it
  for (const V of vaults) {
    const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of sides) {
      const Nb = roofs.find((r) => r.i === V.i + dx && r.j === V.j + dy);
      if (!Nb) continue;
      if (dx) {
        const gap = dx > 0 ? Nb.x0 - V.x1 - 1 : V.x0 - Nb.x1 - 1;
        const y = Math.max(V.y0 + 1, Math.min(V.y1 - 2, Math.round((V.y0 + V.y1) / 2)));
        for (let k = 0; k < gap - 2; k++) for (let t = 0; t < 2; t++) { const x = dx > 0 ? V.x1 + 1 + k : V.x0 - 1 - k; tiles[(y + t) * w + x] = T.FLOOR; style[(y + t) * w + x] = 2; }
      } else {
        const gap = dy > 0 ? Nb.y0 - V.y1 - 1 : V.y0 - Nb.y1 - 1;
        const x = Math.max(V.x0 + 1, Math.min(V.x1 - 2, Math.round((V.x0 + V.x1) / 2)));
        for (let k = 0; k < gap - 2; k++) for (let t = 0; t < 2; t++) { const y = dy > 0 ? V.y1 + 1 + k : V.y0 - 1 - k; tiles[y * w + x + t] = T.FLOOR; style[y * w + x + t] = 2; }
      }
    }
  }

  // 5. chimneys (cover) and skylights
  const skylights = [];
  const skyAt = new Set();
  for (const r of roofs) {
    const nc = rng.int(2, 6);
    for (let k = 0; k < nc; k++) {
      const tx = rng.int(r.x0 + 2, r.x1 - 1), ty = rng.int(r.y0 + 2, r.y1 - 1);
      if (openAround(tiles, w, tx, ty)) tiles[ty * w + tx] = T.COVER;
    }
    const ns = r.vault ? 0 : rng.int(1, 3);
    for (let k = 0; k < ns; k++) {
      const tx = rng.int(r.x0 + 2, r.x1 - 1), ty = rng.int(r.y0 + 2, r.y1 - 1);
      if (openAround(tiles, w, tx, ty) && !skyAt.has(ty * w + tx)) { skyAt.add(ty * w + tx); skylights.push({ tx, ty }); }
    }
  }

  // 6. points of interest
  const spot = (r, pad) => {
    for (let n = 0; n < 12; n++) {
      const tx = rng.int(r.x0 + pad, r.x1 - pad + 1), ty = rng.int(r.y0 + pad, r.y1 - pad + 1);
      if (tiles[ty * w + tx] === T.FLOOR && !skyAt.has(ty * w + tx)) return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, tx, ty };
    }
    return null;
  };
  const lootPoints = [], vaultPoints = [], xpPoints = [], spawns = [], chambers = [];
  const mid = R(Math.floor(N / 2), Math.floor(N / 2));
  for (const r of roofs) {
    if (r.vault) { for (let k = 0; k < 4; k++) { const p = spot(r, 2); if (p) vaultPoints.push(p); } continue; }
    if (!r.main) continue;
    for (let k = rng.int(2, 5); k > 0; k--) { const p = spot(r, 2); if (p) lootPoints.push(p); }
    const rw = r.x1 - r.x0 + 1, rh = r.y1 - r.y0 + 1;
    chambers.push({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2, r: Math.min(rw, rh) / 2, depth: Math.abs(r.i - mid.i) + Math.abs(r.j - mid.j) });
  }
  for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) {
    if (tiles[y * w + x] !== T.FLOOR || skyAt.has(y * w + x)) continue;
    const r = roofs.find((q) => x >= q.x0 - 2 && x <= q.x1 + 2 && y >= q.y0 - 2 && y <= q.y1 + 2);
    if (!r || !r.main) continue;
    if (openAround(tiles, w, x, y)) spawns.push({ tx: x, ty: y, x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
    if (rng.chance(0.06)) xpPoints.push({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
  }
  rng.shuffle(spawns);
  return { w, h, tiles, deco: new Uint8Array(w * h), style, chambers, spawns: spawns.slice(0, 140), lootPoints, vaultPoints, xpPoints: rng.shuffle(xpPoints), vault: vaults[0], skylights, roofs, vaults };
}
