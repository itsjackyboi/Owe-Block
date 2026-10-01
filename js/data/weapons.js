// Weapon entries. Adding a weapon = adding one entry here. See README for the schema.
// Any numeric param can be a 5-length array, indexed by item level (L1..L5).
export default [
  {
    id: 'bare_knuckles', name: 'BARE KNUCKLES', kind: 'default', loot: false, rarity: 'common', icon: 'bare_knuckles',
    effect: 'TWO JABS. Q: SHOVE',
    primary: { action: 'thrust', cooldown: 0.22, params: { damage: 6, reach: 12, arc: 60, knockback: 55, lunge: 60, combo: 2, comboCd: 0.45, color: '#ffe0c0' } },
    special: { action: 'meleeArc', cooldown: 3, params: { damage: 2, reach: 15, arc: 80, knockback: 240, slamStun: 0.5, lunge: 30, color: '#ffe0c0' } },
    passive: null,
    ai: { idealRange: 10, minRange: 0, aim: 'direct', useWhen: 'inRange', specialWhen: 'cornered' },
  },
  {
    id: 'cutlass', name: 'CUTLASS', kind: 'weapon', loot: true, rarity: 'common', icon: 'cutlass',
    effect: '100 DEG SLASH. Q: RIPOSTE PARRY',
    primary: {
      action: 'meleeArc', cooldown: [0.38, 0.36, 0.34, 0.32, 0.30],
      params: { damage: [14, 16, 18, 21, 25], arc: 100, reach: 22, knockback: 120, lunge: 80, color: '#ffffff' },
    },
    special: {
      action: 'parry', cooldown: [5, 4.6, 4.2, 3.8, 3.2],
      params: { duration: 0.3, arc: 150, counterDamage: [14, 16, 18, 21, 25], counterStun: 0.5 },
    },
    passive: null,
    ai: { idealRange: 18, minRange: 0, aim: 'direct', useWhen: 'inRange', specialWhen: 'underMelee' },
  },
  {
    id: 'singing_bow', name: 'SINGING BOW', kind: 'weapon', loot: true, rarity: 'common', icon: 'singing_bow',
    effect: 'HOLD TO DRAW, RELEASE TO LOOSE. Q: VOLLEY',
    primary: {
      action: 'chargeRelease', cooldown: [0.3, 0.28, 0.26, 0.24, 0.22],
      params: {
        minCharge: 0.1, maxCharge: [0.8, 0.76, 0.72, 0.68, 0.64], damage: [28, 31, 34, 38, 42], minDamageFrac: 0.35,
        speed: 420, minSpeed: 230, range: 280, pierceFull: [1, 1, 1, 2, 2], radius: 2, kind: 'arrow', knockback: 85, slow: 0.7, spread: 3,
      },
    },
    special: {
      action: 'projectile', cooldown: [8, 7.5, 7, 6.5, 6],
      params: { count: [5, 5, 5, 7, 7], fan: 40, damage: [10, 11, 12, 13, 14], speed: 330, range: 230, radius: 2, kind: 'arrow', knockback: 45, spread: 0 },
    },
    passive: null,
    ai: { idealRange: 140, minRange: 50, aim: 'lead', useWhen: 'inRange', specialWhen: 'clustered' },
  },
  {
    id: 'ancient_pot', name: 'ANCIENT POT', kind: 'weapon', loot: true, rarity: 'uncommon', icon: 'ancient_pot',
    effect: 'LOB A FIRE-POT. Q: OIL SLICK',
    primary: {
      action: 'throwArea', cooldown: [5, 4.7, 4.4, 4.1, 3.8],
      params: { range: 150, flightSpeed: 190, area: { kind: 'fire', r: [26, 28, 30, 32, 34], life: [3, 3.2, 3.4, 3.6, 4], dps: [8, 9, 10, 12, 14] } },
    },
    special: {
      action: 'throwArea', cooldown: [9, 8.5, 8, 7.5, 7],
      params: { range: 150, flightSpeed: 190, area: { kind: 'oil', r: [28, 30, 32, 34, 36], life: [9, 9, 10, 10, 11], dps: 0 } },
    },
    passive: null,
    ai: { idealRange: 110, minRange: 40, aim: 'lob', useWhen: 'inRange', specialWhen: 'targetFleeing' },
  },
  {
    id: 'drifters_call', name: "DRIFTER'S CALL", kind: 'weapon', loot: true, rarity: 'uncommon', icon: 'drifters_call',
    effect: 'BOOMERANG BLADE HITS TWICE. Q: ORBIT',
    primary: {
      action: 'projectile', cooldown: [1.6, 1.5, 1.4, 1.3, 1.2],
      params: { damage: [12, 14, 16, 18, 21], speed: 230, range: [150, 160, 170, 180, 190], radius: 5, kind: 'blade', returns: true, catchCut: 0.5, curve: 0.3, knockback: 90, spread: 0 },
    },
    special: {
      action: 'orbit', cooldown: [14, 13, 12, 11, 10],
      params: { duration: 3, radius: 26, count: [2, 2, 3, 3, 4], damage: [8, 9, 10, 11, 12], knockback: 80, blocks: true },
    },
    passive: null,
    ai: { idealRange: 100, minRange: 30, aim: 'lead', useWhen: 'inRange', specialWhen: 'incomingProjectile' },
  },
  {
    id: 'shiv', name: 'SHIV', kind: 'weapon', loot: true, rarity: 'common', icon: 'shiv',
    effect: 'QUICK STAB, x2.5 FROM BEHIND. Q: LUNGE',
    primary: { action: 'thrust', cooldown: [0.16, 0.15, 0.14, 0.13, 0.12], params: { damage: [7, 8, 9, 10, 12], reach: 14, arc: 40, backstab: 2.5, knockback: 25, lunge: 40, color: '#ffd0d0' } },
    special: {
      action: 'dashStrike', cooldown: [6, 5.6, 5.2, 4.8, 4.4],
      params: { dist: [60, 64, 68, 72, 76], damage: [8, 9, 10, 12, 14], reach: 18, arc: 70, knockback: 60, resetOnKill: true, status: { name: 'bleed', dur: 3, power: [4, 5, 6, 7, 8] }, color: '#ff8a78' },
    },
    passive: null,
    ai: { idealRange: 12, minRange: 0, aim: 'direct', useWhen: 'inRange', specialWhen: 'gapClose' },
  },
  {
    id: 'whopper', name: "WAGWAN'S WHOPPER", kind: 'weapon', loot: true, rarity: 'uncommon', icon: 'whopper',
    effect: 'HEAVY SMASH, WALL SLAM STUNS. Q: THUNDERCLAP',
    primary: { action: 'meleeArc', cooldown: [0.85, 0.8, 0.75, 0.7, 0.65], params: { damage: [26, 29, 32, 36, 40], arc: 160, reach: 24, knockback: 260, slamStun: 0.6, lunge: 50, color: '#ffe8c0' } },
    special: {
      action: 'shockwave', cooldown: [7, 6.5, 6, 5.5, 5],
      params: { minCharge: 0.2, maxCharge: 1.0, radiusMin: 40, radiusMax: 70, damage: [14, 16, 18, 20, 24], knockback: 280, slamStun: 0.3, slowDur: 1.5, slowPow: 0.4, slow: 0.5 },
    },
    passive: null,
    ai: { idealRange: 20, minRange: 0, aim: 'direct', useWhen: 'inRange', specialWhen: 'clustered' },
  },
  {
    id: 'keg_flail', name: 'KEG FLAIL', kind: 'weapon', loot: true, rarity: 'uncommon', icon: 'keg_flail',
    effect: 'WIDE SWEEP, x1.5 AT THE TIP. Q: WHIRL',
    primary: { action: 'meleeArc', cooldown: [0.7, 0.66, 0.62, 0.58, 0.54], params: { damage: [16, 18, 20, 23, 26], arc: 220, reach: 40, outerBonus: 1.5, outerWidth: 12, knockback: 150, lunge: 40, color: '#ffe0a0' } },
    special: { action: 'spin', cooldown: [9, 8.5, 8, 7.5, 7], params: { duration: 1.5, interval: 0.25, reach: 36, damage: [10, 11, 12, 14, 16], knockback: 35, slow: 0.7 } },
    passive: null,
    ai: { idealRange: 34, minRange: 0, aim: 'direct', useWhen: 'inRange', specialWhen: 'surrounded' },
  },
  {
    id: 'arbalest', name: 'GAOL ARBALEST', kind: 'weapon', loot: true, rarity: 'rare', icon: 'arbalest',
    effect: 'BOLT PIERCES EVERYONE IN LINE. Q: BRACE',
    primary: { action: 'projectile', cooldown: [1.0, 0.95, 0.9, 0.85, 0.8], params: { damage: [30, 34, 38, 42, 48], speed: 520, range: 340, radius: 3, pierce: 99, kind: 'bolt', knockback: 120, spread: 1 } },
    special: { action: 'sequence', cooldown: [10, 9.5, 9, 8.5, 8], params: { windup: 0.4, count: 3, interval: 0.12, damage: [22, 25, 28, 32, 36], speed: 520, range: 320, radius: 3, pierce: 99, kind: 'bolt', knockback: 80, spread: 1 } },
    passive: null,
    ai: { idealRange: 150, minRange: 60, aim: 'lead', useWhen: 'inRange', specialWhen: 'inRange' },
  },
  {
    id: 'beast_hook', name: 'BEAST HOOK', kind: 'weapon', loot: true, rarity: 'uncommon', icon: 'beast_hook',
    effect: 'HOOK YANKS A FIGHTER TO YOU. Q: REEL YOURSELF IN',
    primary: { action: 'projectile', cooldown: [3.5, 3.2, 2.9, 2.6, 2.3], params: { damage: [10, 12, 14, 16, 18], speed: 420, range: 180, radius: 3, hook: 'pull', pull: [60, 64, 68, 72, 76], kind: 'hook', knockback: 0 } },
    special: { action: 'projectile', cooldown: [6, 5.5, 5, 4.6, 4.2], params: { damage: 0, speed: 420, range: [180, 190, 200, 210, 220], radius: 3, hook: 'self', kind: 'hook', knockback: 0 } },
    passive: null,
    ai: { idealRange: 110, minRange: 40, aim: 'direct', useWhen: 'inRange', specialWhen: 'gapClose' },
  },
  {
    id: 'mantrap', name: 'BULLY HILL MANTRAP', kind: 'weapon', loot: true, rarity: 'uncommon', icon: 'mantrap',
    effect: 'PLACE A JAW TRAP (UP TO 3). Q: TOSS ONE',
    primary: { action: 'placeTrap', cooldown: [2.5, 2.3, 2.1, 1.9, 1.7], params: { range: 40, area: { damage: [20, 23, 26, 30, 34], root: [1.2, 1.3, 1.4, 1.5, 1.6] } } },
    special: { action: 'throwArea', cooldown: [8, 7.5, 7, 6.5, 6], params: { range: 120, flightSpeed: 200, kind: 'trap', area: { kind: 'trap', r: 9, life: 60, damage: [20, 23, 26, 30, 34], root: [1.2, 1.3, 1.4, 1.5, 1.6] } } },
    passive: null,
    ai: { idealRange: 60, minRange: 0, aim: 'direct', useWhen: 'inRange', specialWhen: 'inRange' },
  },
  {
    id: 'krags_cleaver', name: "KRAG'S CLEAVER", kind: 'exclusive', loot: false, rarity: 'rare', icon: 'krags_cleaver',
    effect: '3-HIT COMBO, FINISHER BLEEDS. Q: CUTTER\'S CHARGE',
    primary: {
      action: 'meleeArc', cooldown: [0.34, 0.32, 0.3, 0.28, 0.26],
      params: { damage: [18, 20, 23, 26, 30], arc: 90, reach: 24, knockback: 130, lunge: 70, combo: 3, comboCd: 0.6, finisherArc: 150, finisherMult: 1.6, finisherStatus: { name: 'bleed', dur: 3, power: [5, 6, 7, 8, 10] }, finisherColor: '#ff8a78', color: '#ffffff' },
    },
    special: { action: 'dashStrike', cooldown: [8, 7.5, 7, 6.5, 6], params: { dist: 70, damage: [30, 34, 38, 42, 48], reach: 22, arc: 100, knockback: 240, slamStun: 0.4, color: '#ffe0a0' } },
    passive: null,
    ai: { idealRange: 24, minRange: 0, aim: 'direct', useWhen: 'inRange', specialWhen: 'gapClose' },
  },
  {
    id: 'zaars_edges', name: "ZAAR'S EDGES", kind: 'exclusive', loot: false, rarity: 'rare', icon: 'zaars_edges',
    effect: '3 RICOCHETING KNIVES. Q: RING OF FIRE',
    primary: { action: 'sequence', cooldown: [1.1, 1.0, 0.95, 0.9, 0.85], params: { windup: 0, count: 3, interval: 0.09, jitter: 7, damage: [9, 10, 11, 12, 14], speed: 330, range: 230, radius: 3, bounce: 1, kind: 'knife', knockback: 40, spread: 2 } },
    special: { action: 'projectile', cooldown: [10, 9.5, 9, 8.5, 8], params: { damage: [16, 18, 20, 23, 26], speed: 130, range: 220, radius: 7, pierce: 99, kind: 'hoop', knockback: 100, trail: { every: 14, r: 14, life: 2.2, dps: [8, 9, 10, 11, 12] } } },
    passive: null,
    ai: { idealRange: 110, minRange: 30, aim: 'lead', useWhen: 'inRange', specialWhen: 'inRange' },
  },
];
