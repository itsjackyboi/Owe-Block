import { hash2 } from './rng.js';

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
    const col = ts.placeholder && ts.placeholder[role];
    if (col) { ctx.fillStyle = col; ctx.fillRect(x, y, 16, 16); }
  }

  icon(ctx, itemId, x, y) {
    const ic = this.manifest.icons[itemId];
    if (ic && this.drawFrame(ctx, ic.sheet, ic.frame, x, y)) return;
    ctx.fillStyle = '#8a8aa0'; ctx.fillRect(x + 2, y + 2, 12, 12);
    ctx.fillStyle = '#2a2a38'; ctx.fillRect(x + 4, y + 4, 8, 8);
  }
}
