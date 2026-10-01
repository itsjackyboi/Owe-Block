// Shared map-generation tools. Generators in js/data/maps/ compose these; nothing here knows about a specific mode.
import { T } from './map.js';

// Poisson-disc sampling in a w x h area (tile units). Returns [{x, y}].
export function poissonDisc(rng, w, h, minDist, k = 24, x0 = 0, y0 = 0) {
  const cell = minDist / Math.SQRT2;
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const grid = new Int32Array(gw * gh).fill(-1);
  const pts = [], active = [];
  const add = (x, y) => {
    pts.push({ x: x0 + x, y: y0 + y });
    grid[((y / cell) | 0) * gw + ((x / cell) | 0)] = pts.length - 1;
    active.push(pts.length - 1);
  };
  add(rng.float(0, w), rng.float(0, h));
  while (active.length) {
    const ai = rng.int(0, active.length);
    const p = pts[active[ai]];
    let found = false;
    for (let n = 0; n < k && !found; n++) {
      const ang = rng.float(0, Math.PI * 2), d = rng.float(minDist, minDist * 2);
      const x = p.x - x0 + Math.cos(ang) * d, y = p.y - y0 + Math.sin(ang) * d;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const gx = (x / cell) | 0, gy = (y / cell) | 0;
      let ok = true;
      for (let yy = Math.max(0, gy - 2); yy <= Math.min(gh - 1, gy + 2) && ok; yy++) {
        for (let xx = Math.max(0, gx - 2); xx <= Math.min(gw - 1, gx + 2); xx++) {
          const q = grid[yy * gw + xx];
          if (q >= 0) {
            const dx = pts[q].x - x0 - x, dy = pts[q].y - y0 - y;
            if (dx * dx + dy * dy < minDist * minDist) { ok = false; break; }
          }
        }
      }
      if (ok) { add(x, y); found = true; }
    }
    if (!found) { active[ai] = active[active.length - 1]; active.pop(); }
  }
  return pts;
}

// Irregular blob: radius wobbles with a few random harmonics so chambers do not look like circles.
export function carveBlob(tiles, w, h, cx, cy, r, rng, value = T.FLOOR, margin = 2) {
  const ph1 = rng.float(0, 6.28), ph2 = rng.float(0, 6.28), ph3 = rng.float(0, 6.28);
  const a1 = rng.float(0.08, 0.2), a2 = rng.float(0.05, 0.15), a3 = rng.float(0.03, 0.1);
  const R = Math.ceil(r * 1.4) + 1;
  for (let y = Math.max(margin, Math.floor(cy) - R); y <= Math.min(h - 1 - margin, Math.floor(cy) + R); y++) {
    for (let x = Math.max(margin, Math.floor(cx) - R); x <= Math.min(w - 1 - margin, Math.floor(cx) + R); x++) {
      const dx = x - cx, dy = y - cy, ang = Math.atan2(dy, dx);
      const rr = r * (1 + a1 * Math.sin(2 * ang + ph1) + a2 * Math.sin(3 * ang + ph2) + a3 * Math.sin(5 * ang + ph3));
      if (dx * dx + dy * dy <= rr * rr) tiles[y * w + x] = value;
    }
  }
}

// Wandering corridor from (x0,y0) to (x1,y1), `width` tiles wide.
export function carveTunnel(tiles, w, h, x0, y0, x1, y1, width, rng, margin = 2) {
  let x = Math.round(x0), y = Math.round(y0);
  const tx = Math.round(x1), ty = Math.round(y1);
  let guard = w * h;
  while ((x !== tx || y !== ty) && guard-- > 0) {
    for (let oy = 0; oy < width; oy++) for (let ox = 0; ox < width; ox++) {
      const px = x + ox, py = y + oy;
      if (px >= margin && py >= margin && px < w - margin && py < h - margin) tiles[py * w + px] = T.FLOOR;
    }
    const dx = tx - x, dy = ty - y;
    const horiz = Math.abs(dx) > Math.abs(dy) ? rng.chance(0.8) : rng.chance(0.2);
    if (rng.chance(0.14)) { // sidestep for a bend
      if (horiz) y += rng.sign(); else x += rng.sign();
    } else if (horiz && dx !== 0) x += Math.sign(dx);
    else if (dy !== 0) y += Math.sign(dy);
    else x += Math.sign(dx);
  }
}

// One cellular-automata smoothing pass over walls/floors only (pits and cover are left alone).
export function smooth(tiles, w, h) {
  const out = tiles.slice();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const t = tiles[y * w + x];
      if (t !== T.WALL && t !== T.FLOOR) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && tiles[(y + dy) * w + x + dx] === T.WALL) n++;
      }
      if (t === T.FLOOR && n >= 6) out[y * w + x] = T.WALL;
      else if (t === T.WALL && n <= 3) out[y * w + x] = T.FLOOR;
    }
  }
  tiles.set(out);
}

// BFS over walkable tiles (everything except walls and cover). Pits count as walkable for connectivity,
// because a dash crosses them. Returns Int32Array of step counts, -1 where unreachable.
export function bfs(tiles, w, h, sx, sy) {
  const dist = new Int32Array(w * h).fill(-1);
  const q = new Int32Array(w * h);
  let qh = 0, qt = 0;
  const si = sy * w + sx;
  dist[si] = 0; q[qt++] = si;
  while (qh < qt) {
    const i = q[qh++], x = i % w, y = (i / w) | 0;
    const d = dist[i] + 1;
    if (x > 0 && dist[i - 1] < 0 && passable(tiles[i - 1])) { dist[i - 1] = d; q[qt++] = i - 1; }
    if (x < w - 1 && dist[i + 1] < 0 && passable(tiles[i + 1])) { dist[i + 1] = d; q[qt++] = i + 1; }
    if (y > 0 && dist[i - w] < 0 && passable(tiles[i - w])) { dist[i - w] = d; q[qt++] = i - w; }
    if (y < h - 1 && dist[i + w] < 0 && passable(tiles[i + w])) { dist[i + w] = d; q[qt++] = i + w; }
  }
  return dist;
}

const passable = (t) => t !== T.WALL && t !== T.COVER;

// Turns every walkable tile not reachable from (sx, sy) into wall, so there are no sealed pockets.
export function fillUnreachable(tiles, w, h, sx, sy) {
  const dist = bfs(tiles, w, h, sx, sy);
  for (let i = 0; i < tiles.length; i++) if (dist[i] < 0 && tiles[i] !== T.WALL) tiles[i] = T.WALL;
  return dist;
}

// True when tile (x, y) and all 8 neighbours are plain floor.
export function openAround(tiles, w, x, y) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (tiles[(y + dy) * w + x + dx] !== T.FLOOR) return false;
  }
  return true;
}
