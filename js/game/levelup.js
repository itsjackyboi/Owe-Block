import { STATS } from '../data/stats.js';
import { ITEMS, LOOT_ITEMS } from '../data/registry.js';
import { MAX_LEVEL } from './items.js';

export const xpNeeded = (level) => Math.round(25 * Math.pow(level, 1.35));

// XP dropped by a dead fighter: 30 + 10 x level + 30% of everything they banked.
export const xpFromKill = (v) => Math.round(30 + 10 * v.level + 0.3 * v.xpTotal);

export function grantXp(match, f, n) {
  if (f.dead || n <= 0) return;
  f.xp += n; f.xpTotal += n;
  let gained = 0;
  while (f.xp >= xpNeeded(f.level)) { f.xp -= xpNeeded(f.level); f.level++; gained++; }
  if (gained) {
    f.pendingLevels += gained;
    match.fx.popup(f.x, f.y - 14, 'LEVEL ' + f.level, '#ffd860');
    match.fx.sparks(f.x, f.y - 4, 12, '#ffd860', 90, 0.5);
  }
}

const RARITY_W = { common: 1, uncommon: 0.8, rare: 0.5, relic: 0.12 };

// Three offers, shared by the player's picker and the AI. At least one is a non-stat option whenever one exists.
export function generateOffers(f, rng, n = 3) {
  const items = [];
  const freeSlot = f.slots.some((s) => s === null);
  if (freeSlot) {
    for (const d of LOOT_ITEMS) {
      if (f.slots.some((s) => s && s.id === d.id)) continue;
      items.push({ w: RARITY_W[d.rarity] || 1, offer: { type: 'item', id: d.id, name: d.name, effect: d.effect } });
    }
  }
  f.slots.forEach((s, i) => {
    if (s && s.level < MAX_LEVEL && ITEMS[s.id]) {
      items.push({ w: 1.3, offer: { type: 'upgrade', slot: i, id: s.id, name: s.def.name, from: s.level, to: s.level + 1, effect: s.def.effect } });
    }
  });
  const stats = STATS.map((s) => ({ w: 0.8, offer: { type: 'stat', id: s.id, name: s.name, effect: s.effect } }));

  const out = [];
  const take = (pool) => {
    let tot = 0;
    for (const c of pool) tot += c.w;
    if (tot <= 0) return null;
    let r = rng.next() * tot;
    for (let i = 0; i < pool.length; i++) { r -= pool[i].w; if (r <= 0) return pool.splice(i, 1)[0]; }
    return pool.pop();
  };
  if (items.length) out.push(take(items).offer);
  const rest = items.concat(stats);
  while (out.length < n && rest.length) out.push(take(rest).offer);
  return rng.shuffle(out);
}

export function applyOffer(match, f, o) {
  if (o.type === 'stat') STATS.find((s) => s.id === o.id).apply(f);
  else if (o.type === 'item') f.addItem(o.id, 1);
  else if (o.type === 'upgrade') { const s = f.slots[o.slot]; if (s) s.setLevel(s.level + 1); }
}

// Non-player policy by tier. Low tier picks at random; med prefers gear over stats; high scores each option.
const GOOD_STATS = { damage: 0.5, cd: 0.45, maxhp: 0.35, armor: 0.25, move: 0.2 };

export function pickOffer(f, offers, rng) {
  const tier = f.tier || 'med';
  if (tier === 'low') return offers[rng.int(0, offers.length)];
  let best = null, bs = -1;
  const held = f.slots[f.held];
  for (const o of offers) {
    let sc = rng.float(0, tier === 'high' ? 0.15 : 0.5);
    if (f.prefers && f.prefers.includes(o.id)) sc += 0.5; // named fighters chase their favourites
    if (o.type === 'item') sc += 0.7;
    else if (o.type === 'upgrade') sc += 0.8 + (tier === 'high' && held && held.id === o.id ? 0.7 : 0);
    else sc += tier === 'high' ? (GOOD_STATS[o.id] || 0.1) : 0.3;
    if (sc > bs) { bs = sc; best = o; }
  }
  return best;
}

export function autoPick(match, f) {
  const offers = generateOffers(f, match.rng);
  if (offers.length) applyOffer(match, f, pickOffer(f, offers, match.rng));
}
