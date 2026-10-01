import { T } from '../game/map.js';
import { TILE } from '../config.js';

// Navigation for AI: walkable mask, shared BFS flow fields, and budgeted A*.
// "Walkable" means plain floor: cover, walls and pits are avoided (a dash can still cross a pit).
export class Nav {
  constructor(map) {
    this.map = map;
    this.w = map.w; this.h = map.h;
    const n = this.w * this.h;
    this.walk = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.walk[i] = map.tiles[i] === T.FLOOR ? 1 : 0;
    this.budget = 0;            // A* requests left this frame (reset by the match)
    this.requests = 0;          // total, for telemetry
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.stamp = 0;
    this.heap = new Int32Array(n * 2);
    this.flows = new Map();
    // connected walkable components, so the AI never plans a walk across a gap it cannot cross
    this.comp = new Int32Array(n).fill(-1);
    let c = 0;
    const q = new Int32Array(n);
    for (let s = 0; s < n; s++) {
      if (!this.walk[s] || this.comp[s] >= 0) continue;
      let qh = 0, qt = 0; q[qt++] = s; this.comp[s] = c;
      while (qh < qt) {
        const i = q[qh++], x = i % this.w, y = (i / this.w) | 0;
        if (x > 0 && this.walk[i - 1] && this.comp[i - 1] < 0) { this.comp[i - 1] = c; q[qt++] = i - 1; }
        if (x < this.w - 1 && this.walk[i + 1] && this.comp[i + 1] < 0) { this.comp[i + 1] = c; q[qt++] = i + 1; }
        if (y > 0 && this.walk[i - this.w] && this.comp[i - this.w] < 0) { this.comp[i - this.w] = c; q[qt++] = i - this.w; }
        if (y < this.h - 1 && this.walk[i + this.w] && this.comp[i + this.w] < 0) { this.comp[i + this.w] = c; q[qt++] = i + this.w; }
      }
      c++;
    }
  }

  // Can a fighter standing at (x1, y1) walk to (x2, y2)? Positions on odd tiles snap to the nearest walkable one.
  sameComp(x1, y1, x2, y2) {
    const a = this.nearestWalk(Math.floor(x1 / TILE), Math.floor(y1 / TILE)), b = this.nearestWalk(Math.floor(x2 / TILE), Math.floor(y2 / TILE));
    return a >= 0 && b >= 0 && this.comp[a] === this.comp[b];
  }

  tile(x, y) { return (Math.floor(y / TILE)) * this.w + Math.floor(x / TILE); }
  inB(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }

  // Nearest walkable tile index to (tx, ty), searching outward a few rings; -1 if none.
  nearestWalk(tx, ty) {
    for (let r = 0; r <= 5; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tx + dx, y = ty + dy;
        if (this.inB(x, y) && this.walk[y * this.w + x]) return y * this.w + x;
      }
    }
    return -1;
  }

  // ---- flow fields: BFS distance from a set of goal tiles ----

  buildFlow(goals) {
    const n = this.w * this.h, w = this.w, h = this.h;
    const dist = new Int16Array(n).fill(-1);
    const q = new Int32Array(n);
    let qh = 0, qt = 0;
    for (const g of goals) if (g >= 0 && dist[g] < 0) { dist[g] = 0; q[qt++] = g; }
    while (qh < qt) {
      const i = q[qh++], x = i % w, y = (i / w) | 0, d = dist[i] + 1;
      if (x > 0 && this.walk[i - 1] && dist[i - 1] < 0) { dist[i - 1] = d; q[qt++] = i - 1; }
      if (x < w - 1 && this.walk[i + 1] && dist[i + 1] < 0) { dist[i + 1] = d; q[qt++] = i + 1; }
      if (y > 0 && this.walk[i - w] && dist[i - w] < 0) { dist[i - w] = d; q[qt++] = i - w; }
      if (y < h - 1 && this.walk[i + w] && dist[i + w] < 0) { dist[i + w] = d; q[qt++] = i + w; }
    }
    return dist;
  }

  // Goal tiles = every walkable tile inside a pixel rectangle.
  goalsInRect(x0, y0, x1, y1) {
    const out = [];
    const tx0 = Math.max(0, Math.floor(x0 / TILE)), tx1 = Math.min(this.w - 1, Math.floor(x1 / TILE));
    const ty0 = Math.max(0, Math.floor(y0 / TILE)), ty1 = Math.min(this.h - 1, Math.floor(y1 / TILE));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (this.walk[ty * this.w + tx]) out.push(ty * this.w + tx);
    return out;
  }

  flowFor(key, makeGoals) {
    let f = this.flows.get(key);
    if (!f) { f = this.buildFlow(makeGoals()); this.flows.set(key, f); }
    return f;
  }

  // Unit step direction (written to out) that descends the flow field from (x, y). False if no way.
  flowDir(flow, x, y, out) {
    const w = this.w;
    let tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (!this.inB(tx, ty)) return false;
    let cur = flow[ty * w + tx];
    if (cur < 0 || !this.walk[ty * w + tx]) { // standing on something odd: snap to the nearest walkable tile
      const nw = this.nearestWalk(tx, ty);
      if (nw < 0) return false;
      tx = nw % w; ty = (nw / w) | 0; cur = flow[nw];
      if (cur < 0) return false;
    }
    let best = cur, bx = 0, by = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = tx + dx, ny = ty + dy;
      if (!this.inB(nx, ny)) continue;
      const i = ny * w + nx, d = flow[i];
      if (d < 0 || d >= best || !this.walk[i]) continue;
      if (dx && dy && (!this.walk[ty * w + nx] || !this.walk[ny * w + tx])) continue; // no corner cutting
      best = d; bx = dx; by = dy;
    }
    if (!bx && !by) return false;
    const gx = (tx + bx + 0.5) * TILE - x, gy = (ty + by + 0.5) * TILE - y;
    const l = Math.hypot(gx, gy) || 1;
    out.x = gx / l; out.y = gy / l;
    return true;
  }

  // ---- A* ----

  heapPush(size, id) {
    const h = this.heap, f = this.f;
    let i = size;
    h[i] = id;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (f[h[p]] <= f[h[i]]) break;
      const t = h[p]; h[p] = h[i]; h[i] = t; i = p;
    }
  }

  heapPop(size) { // size = count before pop; returns popped id
    const h = this.heap, f = this.f, top = h[0];
    h[0] = h[size - 1];
    const n = size - 1;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < n && f[h[l]] < f[h[m]]) m = l;
      if (r < n && f[h[r]] < f[h[m]]) m = r;
      if (m === i) break;
      const t = h[m]; h[m] = h[i]; h[i] = t; i = m;
    }
    return top;
  }

  // Returns an array of {x, y} waypoints (pixel centres, smoothed), null if there is no path,
  // or undefined if this frame's A* budget is spent (the caller keeps its old path).
  findPath(sx, sy, gx, gy, maxNodes = 6000) {
    if (this.budget <= 0) return undefined;
    this.budget--; this.requests++;
    const w = this.w;
    const s = this.nearestWalk(Math.floor(sx / TILE), Math.floor(sy / TILE));
    const g = this.nearestWalk(Math.floor(gx / TILE), Math.floor(gy / TILE));
    if (s < 0 || g < 0) return null;
    if (s === g) return [{ x: gx, y: gy }];
    const stamp = ++this.stamp;
    const gs = this.g, f = this.f, par = this.parent, seen = this.seen, closed = this.closed;
    const gtx = g % w, gty = (g / w) | 0;
    let size = 0;
    gs[s] = 0; par[s] = -1; seen[s] = stamp;
    f[s] = 0;
    this.heapPush(size++, s);
    let expanded = 0, found = false;
    const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    while (size > 0 && expanded < maxNodes) {
      const cur = this.heapPop(size--);
      if (closed[cur] === stamp) continue;
      closed[cur] = stamp;
      if (cur === g) { found = true; break; }
      expanded++;
      const cx = cur % w, cy = (cur / w) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = cx + D[k][0], ny = cy + D[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= this.h) continue;
        const ni = ny * w + nx;
        if (!this.walk[ni] || closed[ni] === stamp) continue;
        if (D[k][0] && D[k][1] && (!this.walk[cy * w + nx] || !this.walk[ny * w + cx])) continue;
        const ng = gs[cur] + D[k][2];
        if (seen[ni] !== stamp || ng < gs[ni]) {
          seen[ni] = stamp; gs[ni] = ng; par[ni] = cur;
          const dx = Math.abs(nx - gtx), dy = Math.abs(ny - gty);
          f[ni] = ng + (dx + dy) + (1.414 - 2) * Math.min(dx, dy);
          this.heapPush(size++, ni);
        }
      }
    }
    if (!found) return null;
    const raw = [];
    for (let i = g; i !== -1; i = par[i]) raw.push({ x: (i % w + 0.5) * TILE, y: ((i / w) | 0) * TILE + TILE / 2 });
    raw.reverse();
    return this.smooth(sx, sy, raw);
  }

  // String-pulling: drop waypoints that can be skipped without touching a wall.
  smooth(sx, sy, raw) {
    const out = [];
    let ax = sx, ay = sy, i = 0;
    while (i < raw.length) {
      let j = raw.length - 1;
      while (j > i && !this.map.walkClear(ax, ay, raw[j].x, raw[j].y, 4)) j--;
      out.push(raw[j]);
      ax = raw[j].x; ay = raw[j].y; i = j + 1;
    }
    return out;
  }
}
