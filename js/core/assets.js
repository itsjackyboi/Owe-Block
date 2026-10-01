import { hash2 } from './rng.js';
import { proceduralIcon } from './icons.js';

// Loads the manifest and sheets. Every draw call has a flat-colour fallback, so a missing image never breaks the game.
export class Assets {
  constructor(manifest, forcePlaceholders) {
    this.manifest = manifest;
    this.placeholders = forcePlaceholders;
    this.sheets = {};
  }

  static async load(forcePlaceholders = false) {
    const res = await fetch('assets/manifest.json');
    const manifest = await res.json();
    const a = new Assets(manifest, forcePlaceholders);
    await Promise.all(Object.entries(manifest.sheets).map(([id, def]) => a.loadSheet(id, def)));
    return a;
  }

  loadSheet(id, def) {
    const entry = { def, img: null, ok: false };
    this.sheets[id] = entry;
    if (this.placeholders) return Promise.resolve();
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { entry.img = img; entry.ok = true; resolve(); };
      img.onerror = () => { console.warn('asset failed to load, using placeholders:', def.src); resolve(); };
      img.src = def.src;
    });
  }

  // Draws one frame. Returns false (and draws nothing) if the sheet is unavailable, so callers can fall back.
  drawFrame(ctx, sheetId, frame, dx, dy, dw, dh) {
    const s = this.sheets[sheetId];
    if (!s || !s.ok || frame == null || frame < 0) return false;
    const d = s.def;
    const col = frame % d.columns, row = (frame / d.columns) | 0;
    const fw = d.frame[0], fh = d.frame[1];
    const sx = (d.margin || 0) + col * (fw + (d.spacing || 0));
    const sy = (d.margin || 0) + row * (fh + (d.spacing || 0));
    ctx.drawImage(s.img, sx, sy, fw, fh, dx, dy, dw || fw, dh || fh);
    return true;
  }

  tileset(id) { return this.manifest.tilesets[id]; }

  // Deterministic pick from a role's frame list for tile (x, y).
  pickFrame(roleList, x, y, seed = 0) {
    if (!roleList || !roleList.length) return -1;
    return roleList[hash2(x, y, seed) % roleList.length];
  }

  // Draws a tile role: sheet frame if available, otherwise the placeholder colour.
  drawRole(ctx, ts, role, x, y, tx, ty, seed = 0) {
    const frames = ts.roles[role];
    if (frames && frames.length && this.drawFrame(ctx, ts.sheet, this.pickFrame(frames, tx, ty, seed), x, y)) return;
    const col = ts.placeholder && (ts.placeholder[role] || ts.placeholder[role.replace(/\d+$/, '')]);
    if (col) { ctx.fillStyle = col; ctx.fillRect(x, y, 16, 16); }
  }

  // Cached 16x16 canvas for an item icon: sheet frame, else procedural pixel art, else a grey placeholder square.
  iconCanvas(id) {
    if (!this.iconCache) this.iconCache = new Map();
    let c = this.iconCache.get(id);
    if (c) return c;
    c = document.createElement('canvas'); c.width = 16; c.height = 16;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const ic = this.manifest.icons[id];
    if (!(ic && this.drawFrame(g, ic.sheet, ic.frame, 0, 0))) {
      const proc = proceduralIcon(id);
      if (proc) g.drawImage(proc, 0, 0);
      else { g.fillStyle = '#8a8aa0'; g.fillRect(2, 2, 12, 12); g.fillStyle = '#2a2a38'; g.fillRect(4, 4, 8, 8); }
    }
    this.iconCache.set(id, c);
    return c;
  }

  // In-hand sprite: a dedicated 'held' frame if the manifest has one, otherwise the icon.
  heldCanvas(id) {
    if (!this.heldCache) this.heldCache = new Map();
    let c = this.heldCache.get(id);
    if (c) return c;
    const h = this.manifest.held && this.manifest.held[id];
    if (h) {
      c = document.createElement('canvas'); c.width = 16; c.height = 16;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      if (!this.drawFrame(g, h.sheet, h.frame, 0, 0)) c = null;
    }
    if (!c) c = this.iconCanvas(id);
    this.heldCache.set(id, c);
    return c;
  }

  heldScale(id) {
    const h = this.manifest.held && this.manifest.held[id];
    return (h && h.scale) || 1;
  }

  // Radians to add when the icon is drawn in hand so its business end points along the aim.
  iconRot(id) {
    const ic = (this.manifest.held && this.manifest.held[id]) || this.manifest.icons[id];
    return ic && ic.rot ? (ic.rot * Math.PI) / 180 : 0;
  }

  drawIcon(ctx, id, x, y, scale = 1) {
    ctx.drawImage(this.iconCanvas(id), x, y, 16 * scale, 16 * scale);
  }
}
