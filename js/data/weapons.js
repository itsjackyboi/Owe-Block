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
];
