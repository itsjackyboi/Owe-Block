import { GRID_CELL } from '../config.js';

// Uniform spatial hash. Objects need numeric x, y (and optionally r). Rebuilt every frame: clear() then insert().
export class SpatialHash {
  constructor(widthPx, heightPx, cell = GRID_CELL) {
    this.cell = cell;
    this.cols = Math.ceil(widthPx / cell);
    this.rows = Math.ceil(heightPx / cell);
    this.cells = new Array(this.cols * this.rows);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
    this.used = [];
    this.count = 0;
  }

  clear() {
    for (let i = 0; i < this.used.length; i++) this.used[i].length = 0;
    this.used.length = 0;
    this.count = 0;
  }

  insert(o) {
    const cx = Math.min(this.cols - 1, Math.max(0, (o.x / this.cell) | 0));
    const cy = Math.min(this.rows - 1, Math.max(0, (o.y / this.cell) | 0));
    const c = this.cells[cy * this.cols + cx];
    if (c.length === 0) this.used.push(c);
    c.push(o);
    this.count++;
  }

  // Fills `out` with objects whose circle overlaps the query circle. Returns `out`.
  query(x, y, r, out) {
    out.length = 0;
    const cell = this.cell;
    const maxR = 24; // largest object radius we allow when widening the search
    const x0 = Math.max(0, ((x - r - maxR) / cell) | 0), x1 = Math.min(this.cols - 1, ((x + r + maxR) / cell) | 0);
    const y0 = Math.max(0, ((y - r - maxR) / cell) | 0), y1 = Math.min(this.rows - 1, ((y + r + maxR) / cell) | 0);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = this.cells[cy * this.cols + cx];
        for (let i = 0; i < c.length; i++) {
          const o = c[i];
          const dx = o.x - x, dy = o.y - y, rr = r + (o.r || 0);
          if (dx * dx + dy * dy <= rr * rr) out.push(o);
        }
      }
    }
    return out;
  }
}
