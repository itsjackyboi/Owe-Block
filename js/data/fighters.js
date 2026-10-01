// Fighter naming. Generic AI fighters get a short handle from this list; named fighters (Stage 5) are added here too.
export const HANDLES = [
  'BARNACLE', 'WHISKERS', 'TANKARD', 'SCURVY', 'MUDLARK', 'HOPS', 'STOUT', 'LAGER', 'MALT', 'BARLEY',
  'CORK', 'KEGGER', 'DREGS', 'FOAM', 'RUMMY', 'SKIPPER', 'GULL', 'BRINE', 'SALTY', 'DOCKRAT',
  'COPPER', 'BRASS', 'TIN', 'IRONS', 'COGS', 'SOOT', 'ASH', 'EMBER', 'FLINT', 'GRIT',
  'SHALE', 'SLATE', 'PEBBLE', 'MOLE', 'BADGER', 'FERRET', 'RAVEN', 'MAGPIE', 'WREN', 'HERON',
  'EEL', 'PIKE', 'CARP', 'TENCH', 'LAMPREY', 'NIPPER', 'GOBLET', 'SPIGOT', 'BUNG', 'TAPSTER',
];

// n distinct handles, drawn with the match RNG.
export function pickHandles(rng, n) {
  const pool = rng.shuffle(HANDLES.slice());
  const out = [];
  for (let i = 0; i < n; i++) out.push(pool[i % pool.length] + (i >= pool.length ? ' ' + (1 + Math.floor(i / pool.length)) : ''));
  return out;
}

// Named fighters: 3 to 5 are picked at random each match and take high-tier slots. They spawn holding their signature item,
// get HP x1.2 (unless hpMul says otherwise), a name tag and a fixed look. `prefers` biases their looting and level-ups.
// gang is cosmetic (outfit colour): the match is free-for-all. `title` is the full name for the kill feed and summary.
export const NAMED = [
  { id: 'krag',   name: 'KRAG',      title: 'KRAG',                gang: 'cutters', signature: 'krags_cleaver', prefers: ['whopper', 'mantrap'],              look: { body: 2, hair: 13, hat: false } },
  { id: 'fin',    name: 'FIN',       title: 'FIN',                 gang: 'cutters', signature: 'shiv',          prefers: ['wind_pouch', 'drifters_call'],     look: { body: 0, hair: 5,  hat: true  }, hpMul: 0.9, speedBonus: 0.25 },
  { id: 'digdug', name: 'DIG DUG',   title: 'DIG DUG',             gang: 'cutters', signature: 'mantrap',       prefers: ['amethyst_shard'],                  look: { body: 1, hair: 11, hat: true  } },
  { id: 'bucket', name: 'BUCKET',    title: 'BUCKET',              gang: 'cutters', signature: 'cutlass',       prefers: ['clockheart_tonic'],                look: { body: 1, hair: 2,  hat: true  } },
  { id: 'frleo',  name: 'FR LEO',    title: 'FRIAR LEO',           gang: 'cutters', signature: 'old_staff',     prefers: ['veilwalker_net'],                  look: { body: 0, hair: 15, hat: false } },
  { id: 'hark',   name: 'SGT HARK',  title: 'SERGEANT HARK',       gang: 'cutters', signature: 'arbalest',      prefers: ['mantrap'],                         look: { body: 2, hair: 10, hat: true  } },
  { id: 'zaar',   name: 'ZAAR',      title: 'ZAAR THE EDGEMASTER', gang: 'circus',  signature: 'zaars_edges',   prefers: ['ancient_pot', 'sad_sermon'],       look: { body: 1, hair: 7,  hat: false } },
  { id: 'wagwan', name: 'WAGWAN',    title: 'WAGWAN',              gang: 'circus',  signature: 'whopper',       prefers: ['clockheart_tonic'],                look: { body: 0, hair: 3,  hat: false } },
  { id: 'mickey', name: 'MICKEY',    title: 'MICKEY',              gang: 'circus',  signature: 'keg_flail',     prefers: ['beast_hook'],                      look: { body: 2, hair: 12, hat: true  } },
  { id: 'moby',   name: 'MOBY',      title: 'MOBY',                gang: 'circus',  signature: 'ancient_pot',   prefers: ['wind_pouch'],                      look: { body: 1, hair: 6,  hat: true  } },
  { id: 'baba',   name: 'BABA PAKU', title: 'BABA PAKU',           gang: 'circus',  signature: 'singing_bow',   prefers: ['sad_sermon'],                      look: { body: 2, hair: 9,  hat: false } },
];
