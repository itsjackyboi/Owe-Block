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
