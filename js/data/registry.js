import weapons from './weapons.js';
import magic from './magic.js';
import { ACTIONS } from '../game/actions.js';

// Merges every item file, validates each entry at boot and logs a clear error for a bad one (the entry is skipped).
const KINDS = ['weapon', 'relic', 'everyday', 'default', 'exclusive'];
const RARITIES = ['common', 'uncommon', 'rare', 'relic'];

export const ITEMS = {};
export const LOOT_ITEMS = [];

function bad(entry, msg) { console.error(`[registry] item "${entry && entry.id}": ${msg}`); }

function checkSide(entry, side) {
  const s = entry[side];
  if (s == null) return true;
  if (!ACTIONS[s.action]) { bad(entry, `${side}.action "${s.action}" is not a known action (${Object.keys(ACTIONS).join(', ')})`); return false; }
  if (s.cooldown == null) { bad(entry, `${side}.cooldown is missing`); return false; }
  for (const k of ['cooldown', ...Object.keys(s.params || {})]) {
    const v = k === 'cooldown' ? s.cooldown : s.params[k];
    if (Array.isArray(v) && v.length !== 5) { bad(entry, `${side}.${k} is an array of ${v.length}; level arrays must have 5 entries`); return false; }
  }
  return true;
}

function register(entry) {
  if (!entry || typeof entry.id !== 'string') return bad(entry, 'missing string id');
  if (ITEMS[entry.id]) return bad(entry, 'duplicate id');
  if (!entry.name) return bad(entry, 'missing name');
  if (!KINDS.includes(entry.kind)) return bad(entry, `kind must be one of ${KINDS.join('/')}`);
  if (!RARITIES.includes(entry.rarity)) return bad(entry, `rarity must be one of ${RARITIES.join('/')}`);
  if (typeof entry.effect !== 'string') return bad(entry, 'missing one-line effect text');
  if (!entry.primary && !entry.special) return bad(entry, 'needs a primary or a special');
  if (entry.kind === 'relic' && !entry.telegraph) return bad(entry, 'relics must declare a telegraph (the readable warning the AI also sees)');
  if (entry.kind === 'exclusive' && entry.loot) return bad(entry, 'exclusive gang weapons never drop as loot');
  if (!checkSide(entry, 'primary') || !checkSide(entry, 'special')) return;
  ITEMS[entry.id] = entry;
  if (entry.loot) LOOT_ITEMS.push(entry);
}

[...weapons, ...magic].forEach(register);

export const item = (id) => ITEMS[id];
