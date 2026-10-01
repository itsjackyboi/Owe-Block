// One entry per mode. Engine code never mentions a mode id; it reads these fields.
// hazards: [{ type, ... }] handled by js/game/hazards.js. pit: what falling into a pit/gap costs. loot: density = items per floor tile.
import { generateMines } from './maps/mines.js';
import { generateRooftops } from './maps/rooftops.js';
import { generatePipePit } from './maps/pipepit.js';

export const MODES = {
  mines: {
    id: 'mines',
    name: 'Mines',
    blurb: ['DARK CAVES', 'CAVE-INS, VOID PITS', 'TIGHT TUNNELS'],
    tileset: 'mines',
    size: [150, 150],
    generate: generateMines,
    music: 'mines',
    palette: { floor: '#c88a54', wall: '#4a2a2e', pit: '#000000' },
    pit: { damage: 20, damagePct: 0, stun: 0 },
    zone: { scale: 1.3 },   // multiplies the police sweep timings (Mines is large and fights thin the field fast, so it runs longer)
    hazards: [
      { type: 'darkness', radius: 130 },
      { type: 'caveIn', every: [9, 16], warn: 1.2, radius: 22, damage: 25, stun: 0.6 },
    ],
    loot: {
      density: 0.0095, xpDensity: 0.05, xpValue: 6, vaultRelicBoost: 3,
      weights: { byRarity: { common: 10, uncommon: 6, rare: 2.5, relic: 2 }, byId: { mantrap: 2.5, amethyst_shard: 2.5 } },
    },
  },
  rooftops: {
    id: 'rooftops',
    name: 'Rooftops',
    blurb: ['ROOF GAPS: A FALL HURTS', 'SKYLIGHTS GIVE WAY', 'DASH OR HOOK ACROSS'],
    tileset: 'rooftops',
    size: [100, 100],
    generate: generateRooftops,
    music: 'rooftops',
    palette: { floor: '#b8744a', wall: '#9aa0b4', pit: '#2a1c14' },
    pit: { damage: 0, damagePct: 0.15, stun: 0.8 },
    zone: { scale: 1.5 },
    hazards: [{ type: 'skylights', crack: 1.0 }],
    loot: {
      density: 0.0085, xpDensity: 0.05, xpValue: 6, vaultRelicBoost: 3,
      weights: { byRarity: { common: 10, uncommon: 6, rare: 2.5, relic: 2 }, byId: { singing_bow: 2.5, beast_hook: 2.5, wind_pouch: 2.5 } },
    },
  },
  pipepit: {
    id: 'pipepit',
    name: 'Pipe Pit',
    blurb: ['OPEN PIT, PIPE MAZE', 'CONVEYORS PUSH YOU', 'STEAM VENTS BURST'],
    tileset: 'pipepit',
    size: [110, 110],
    generate: generatePipePit,
    music: 'pipepit',
    palette: { floor: '#c98a54', wall: '#3c3038', pit: '#2a1c1c' },
    pit: { damage: 20, damagePct: 0, stun: 0 },
    zone: { scale: 1.3 },
    hazards: [
      { type: 'conveyors', push: 55 },
      { type: 'steamVents', hiss: 1.0, burst: 0.6, radius: 24, damage: 20, kb: 220 },
    ],
    loot: {
      density: 0.012, xpDensity: 0.05, xpValue: 6, vaultRelicBoost: 3,
      weights: { byRarity: { common: 10, uncommon: 6, rare: 2.5, relic: 2 }, byId: { keg_flail: 2.5, ancient_pot: 2.5, whopper: 2.5 } },
    },
  },
};

export const MODE_LIST = ['mines', 'rooftops', 'pipepit'];
export const DEFAULT_MODE = 'mines';
