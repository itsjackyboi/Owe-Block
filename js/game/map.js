import { TILE, CHUNK_TILES } from '../config.js';
import { INTERNAL_W, INTERNAL_H } from '../config.js';

export const T = { FLOOR: 0, WALL: 1, PIT: 2, COVER: 3, CRYSTAL: 4 };
const CHUNK_PX = TILE * CHUNK_TILES;

// Tile grid + collision + chunk-cached rendering. Knows nothing about modes: it just draws roles from a tileset.
export class GameMap {
  constructor(gen, tilesetId, assets, seed) {
    this.w = gen.w; this.h = gen.h;
    this.tiles = gen.tiles;
    this.deco = gen.deco || new Uint8Array(gen.w * gen.h);
    this.pxW = gen.w * TILE; this.pxH = gen.h * TILE;
    this.assets = assets;
    this.ts = assets.tileset(tilesetId);
    this.seed = seed;
    this.chunkCols = Math.ceil(this.w / CHUNK_TILES);
    this.chunkRows = Math.ceil(this.h / CHUNK_TILES);
    this.chunks = new Array(this.chunkCols * this.chunkRows).fill(null);
    this.chunksBuilt = 0;
    this.hitWall = false; // set by resolveCircle when it pushes something out of a solid tile
  }

  tile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return T.WALL;
    return this.tiles[ty * this.w + tx];
  }

  tileAtPx(x, y) { return this.tile(Math.floor(x / TILE), Math.floor(y / TILE)); }
  isSolidTile(tx, ty) { const t = this.tile(tx, ty); return t === T.WALL || t === T.COVER || t === T.CRYSTAL; }
  isSolidPx(x, y) { return this.isSolidTile(Math.floor(x / TILE), Math.floor(y / TILE)); }

  // Pushes a circle (o.x, o.y, o.r) out of solid tiles. Returns true if it moved.
  resolveCircle(o) {
    let moved = false;
    const r = o.r;
    for (let iter = 0; iter < 2; iter++) {
      const tx0 = Math.floor((o.x - r) / TILE), tx1 = Math.floor((o.x + r) / TILE);
      const ty0 = Math.floor((o.y - r) / TILE), ty1 = Math.floor((o.y + r) / TILE);
      let any = false;
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          if (!this.isSolidTile(tx, ty)) continue;
          const rx0 = tx * TILE, ry0 = ty * TILE, rx1 = rx0 + TILE, ry1 = ry0 + TILE;
          const cx = o.x < rx0 ? rx0 : o.x > rx1 ? rx1 : o.x;
          const cy = o.y < ry0 ? ry0 : o.y > ry1 ? ry1 : o.y;
          const dx = o.x - cx, dy = o.y - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          if (d2 > 1e-6) {
            const d = Math.sqrt(d2), push = r - d;
            o.x += (dx / d) * push; o.y += (dy / d) * push;
          } else { // centre is inside the tile: leave through the nearest face
            const l = o.x - rx0, rr = rx1 - o.x, t = o.y - ry0, b = ry1 - o.y;
            const m = Math.min(l, rr, t, b);
            if (m === l) o.x = rx0 - r; else if (m === rr) o.x = rx1 + r; else if (m === t) o.y = ry0 - r; else o.y = ry1 + r;
          }
          any = true; moved = true;
        }
      }
      if (!any) break;
    }
    if (moved) this.hitWall = true;
    return moved;
  }

  // Walks from (x0,y0) toward (x1,y1) and returns the last point before a wall tile (cover is flown over).
  lastOpenPoint(x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(d / 4));
    let lx = x0, ly = y0;
    for (let i = 1; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      if (this.tileAtPx(x, y) === T.WALL) break;
      lx = x; ly = y;
    }
    return { x: lx, y: ly };
  }

  // Solid for walking purposes: walls, cover and pits (AI never steps into a pit on purpose).
  isBlockedPx(x, y) {
    const t = this.tileAtPx(x, y);
    return t === T.WALL || t === T.COVER || t === T.PIT || t === T.CRYSTAL;
  }

  // True if a body of radius r can walk the straight line without touching a blocked tile.
  walkClear(x0, y0, x1, y1, r = 4) {
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
    if (d < 1) return true;
    const nx = -dy / d * r, ny = dx / d * r;
    const n = Math.ceil(d / 4);
    for (let i = 1; i <= n; i++) {
      const x = x0 + (dx * i) / n, y = y0 + (dy * i) / n;
      if (this.isBlockedPx(x, y) || this.isBlockedPx(x + nx, y + ny) || this.isBlockedPx(x - nx, y - ny)) return false;
    }
    return true;
  }

  // True if no wall tile lies on the straight line (cover does not block sight).
  clearLine(x0, y0, x1, y1) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 6));
    for (let i = 1; i < n; i++) {
      if (this.tileAtPx(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n) === T.WALL) return false;
    }
    return true;
  }

  // ---- rendering ----

  draw(ctx, cam) {
    const cx0 = Math.max(0, Math.floor(cam.rx / CHUNK_PX)), cx1 = Math.min(this.chunkCols - 1, Math.floor((cam.rx + INTERNAL_W) / CHUNK_PX));
    const cy0 = Math.max(0, Math.floor(cam.ry / CHUNK_PX)), cy1 = Math.min(this.chunkRows - 1, Math.floor((cam.ry + INTERNAL_H) / CHUNK_PX));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        ctx.drawImage(this.chunk(cx, cy), cx * CHUNK_PX - cam.rx, cy * CHUNK_PX - cam.ry);
      }
    }
  }

  chunk(cx, cy) {
    const i = cy * this.chunkCols + cx;
    let c = this.chunks[i];
    if (c) return c;
    c = document.createElement('canvas');
    c.width = CHUNK_PX; c.height = CHUNK_PX;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const t0 = cx * CHUNK_TILES, u0 = cy * CHUNK_TILES;
    for (let ty = u0; ty < Math.min(this.h, u0 + CHUNK_TILES); ty++) {
      for (let tx = t0; tx < Math.min(this.w, t0 + CHUNK_TILES); tx++) {
        this.drawTile(g, tx, ty, (tx - t0) * TILE, (ty - u0) * TILE);
      }
    }
    this.chunks[i] = c;
    this.chunksBuilt++;
    return c;
  }

  drawTile(g, tx, ty, x, y) {
    const a = this.assets, ts = this.ts, seed = this.seed;
    const t = this.tiles[ty * this.w + tx];
    if (t === T.WALL) {
      const faceOpen = ty + 1 < this.h && this.tiles[(ty + 1) * this.w + tx] !== T.WALL;
      a.drawRole(g, ts, faceOpen ? 'wall' : 'wallTop', x, y, tx, ty, seed);
      return;
    }
    if (t === T.PIT) {
      a.drawRole(g, ts, 'pit', x, y, tx, ty, seed);
      if (ts.pitShade) { g.fillStyle = ts.pitShade; g.fillRect(x, y, TILE, TILE); }
      return;
    }
    a.drawRole(g, ts, 'floor', x, y, tx, ty, seed);
    if (this.deco[ty * this.w + tx]) a.drawRole(g, ts, 'deco', x, y, tx, ty, seed + 7);
    if (t === T.COVER) {
      // cover frames are transparent props; fall back to a crate-coloured square in placeholder mode
      const frames = ts.roles.cover;
      if (!(frames && frames.length && a.drawFrame(g, ts.sheet, a.pickFrame(frames, tx, ty, seed + 3), x, y))) {
        g.fillStyle = ts.placeholder.cover; g.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
      }
    }
    // soft shadow cast by a wall face directly north of this floor tile
    if (this.tile(tx, ty - 1) === T.WALL) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y, TILE, 3); }
  }
}
