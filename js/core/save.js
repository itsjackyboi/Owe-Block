import { SAVE_KEY } from '../config.js';

// Versioned localStorage save. Every access is wrapped in try/catch: with storage blocked the game still runs, it just forgets.
const VERSION = 1;

export function defaults() {
  return {
    v: VERSION,
    unlocked: { cutters: false, circus: false },
    color: 'grey',            // 'grey' | 'red' | 'blue': the colour you start a run in
    startWeapon: null,        // id of an unlocked gang weapon, or null for bare knuckles
    lastMode: 'mines',
    history: [],              // last 20 matches, newest first
    best: { kills: 0, damage: 0, placement: 0, longestLife: 0, fastestWin: 0 }, // placement 0 = none yet; 1 is a win
    totals: { matches: 0, kills: 0, wins: 0, time: 0, damage: 0 },
    settings: { shake: true, volumes: { master: 0.8, music: 0.6, sfx: 0.8 } },
  };
}

// Version-migration hook: bring an older save forward. Unknown or broken data falls back to defaults.
function migrate(d) {
  if (!d || typeof d !== 'object') return defaults();
  const base = defaults();
  const out = Object.assign(base, d);
  out.unlocked = Object.assign(base.unlocked, d.unlocked);
  out.best = Object.assign(base.best, d.best);
  out.totals = Object.assign(base.totals, d.totals);
  out.settings = Object.assign(base.settings, d.settings);
  out.settings.volumes = Object.assign(base.settings.volumes, d.settings && d.settings.volumes);
  if (!Array.isArray(out.history)) out.history = [];
  out.v = VERSION;
  return out;
}

export class Save {
  constructor() {
    this.data = defaults();
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) this.data = migrate(JSON.parse(raw));
    } catch { /* storage blocked or corrupt: defaults */ }
  }

  commit() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch { /* storage blocked: nothing to do */ }
  }

  // Record one finished match: history (last 20), bests, totals.
  recordMatch(e) {
    const d = this.data;
    d.history.unshift(e);
    d.history.length = Math.min(20, d.history.length);
    const b = d.best;
    b.kills = Math.max(b.kills, e.kills);
    b.damage = Math.max(b.damage, e.damage);
    b.placement = b.placement ? Math.min(b.placement, e.placement) : e.placement;
    b.longestLife = Math.max(b.longestLife, e.time);
    if (e.placement === 1) b.fastestWin = b.fastestWin ? Math.min(b.fastestWin, e.time) : e.time;
    const t = d.totals;
    t.matches++; t.kills += e.kills; t.damage += e.damage; t.time += e.time; if (e.placement === 1) t.wins++;
    this.commit();
  }

  unlock(gang) { this.data.unlocked[gang] = true; this.commit(); }
}
