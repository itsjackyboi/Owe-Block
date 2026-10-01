// One entry per mode. Engine code never mentions a mode id; it reads these fields.
import { generateMines } from './maps/mines.js';

export const MODES = {
  mines: {
    id: 'mines',
    name: 'Mines',
    tileset: 'mines',
    size: [120, 120],
    generate: generateMines,
  },
};

export const DEFAULT_MODE = 'mines';
