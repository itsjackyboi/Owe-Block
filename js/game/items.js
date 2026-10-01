// Runtime item instance (what a fighter actually holds) and level-array resolution.
// Item *definitions* live in js/data; this file knows nothing about specific items.

// Any numeric param may be a 5-length array indexed by item level (1..5). Plain sub-objects resolve recursively.
export function resolveParams(src, level) {
  const out = {};
  for (const k in src) {
    const v = src[k];
    if (Array.isArray(v)) out[k] = v[Math.min(level, v.length) - 1];
    else if (v && typeof v === 'object') out[k] = resolveParams(v, level);
    else out[k] = v;
  }
  return out;
}

export function resolveNumber(v, level) {
  return Array.isArray(v) ? v[Math.min(level, v.length) - 1] : v;
}

export const MAX_LEVEL = 5;

export class ItemInstance {
  constructor(def, level = 1) {
    this.def = def;
    this.id = def.id;
    this.level = level;
    this.cd = { primary: 0, special: 0 };     // seconds remaining
    this.cdMax = { primary: 1, special: 1 };  // for HUD sweeps
    this.state = {};                          // per-item scratch space for actions (combo counter, boomerang out ...)
    this.cache = { primary: null, special: null, level: 0 };
  }

  setLevel(l) {
    this.level = Math.max(1, Math.min(MAX_LEVEL, l));
    this.cache.primary = this.cache.special = null;
  }

  // Resolved params for the current level, cached so channelled actions do not allocate every frame.
  params(kind) {
    if (this.cache.level !== this.level) { this.cache.primary = this.cache.special = null; this.cache.level = this.level; }
    let p = this.cache[kind];
    if (!p) {
      const d = this.def[kind];
      p = this.cache[kind] = d ? resolveParams(d.params || {}, this.level) : {};
    }
    return p;
  }

  cooldown(kind, f) {
    const d = this.def[kind];
    return d ? resolveNumber(d.cooldown, this.level) * f.cdMul : 0;
  }

  tick(dt) {
    if (this.cd.primary > 0) this.cd.primary -= dt;
    if (this.cd.special > 0) this.cd.special -= dt;
  }
}
