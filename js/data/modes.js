// One entry per mode. Engine code never mentions a mode id; it reads these fields.
import { generateMines } from './maps/mines.js';

export const MODES = {
  mines: {
    id: 'mines',
    name: 'Mines',
    tileset: 'mines',
    size: [120, 120],
    generate: generateMines,
    // loot: density = items per floor tile at match start; xpDensity = XP caps per floor tile; weights pick the item
    loot: {
      density: 0.012, xpDensity: 0.05, xpValue: 6, vaultRelicBoost: 3,
      weights: { byRarity: { common: 10, uncommon: 6, rare: 2.5, relic: 0.6 }, byId: {} },
    },
  },
};

export const DEFAULT_MODE = 'mines';
