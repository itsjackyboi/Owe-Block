// All tunables live here. Engine code imports these; nothing is hard-coded elsewhere.
export const SLOT_COUNT = 3;
export const INTERNAL_W = 480;
export const INTERNAL_H = 270;
export const TILE = 16;
export const AI_COUNT = 40;
export const TIER_MIX = { low: 15, med: 15, high: 10 };
export const NAMED_PER_MATCH = [3, 5];

export const FIXED_DT = 1 / 60;
export const MAX_STEPS = 5;
export const GRID_CELL = 32;
export const CHUNK_TILES = 16; // 16 tiles * 16 px = 256 px chunk canvases

export const FIGHTER = {
  radius: 5,
  hp: 150,
  idleRegenAfter: 5,   // seconds without taking damage before out-of-combat regen starts
  idleRegen: 2,        // hp per second
  speed: 110,
  accel: 1400,
};

export const DASH = {
  speed: 330,
  time: 0.14,
  invuln: 0.18,
  cooldown: 1.6,
};

export const CAMERA = {
  follow: 9,          // exponential follow rate (1/s)
  aimLead: 0.18,      // fraction of cursor offset the camera leans toward
  maxLead: 70,        // px
  shakeMax: 8,        // px at trauma 1
  traumaDecay: 1.6,   // per second
};

export const PIT = {
  fallDamage: 20,
  safeInterval: 0.15, // how often the last-safe tile is refreshed
};

export const SAVE_KEY = 'oweblock.save.v1';
