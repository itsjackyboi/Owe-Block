// Level-up stat boosts. One entry each; levelup.js offers them, apply() mutates the fighter.
export const STATS = [
  { id: 'maxhp',  tag: 'HP', color: '#e0443a', name: 'MAX HP',        effect: '+15 MAX HP',            apply: (f) => { f.maxHp += 15; f.hp += 15; } },
  { id: 'move',   tag: 'MV', color: '#7ae0a0', name: 'SWIFT FEET',    effect: '+6% MOVE SPEED',        apply: (f) => { f.moveBonus += 0.06; } },
  { id: 'damage', tag: 'DM', color: '#ffa030', name: 'HARD HITTER',   effect: '+8% DAMAGE',            apply: (f) => { f.dmgMul += 0.08; } },
  { id: 'cd',     tag: 'CD', color: '#9ad0ff', name: 'QUICK HANDS',   effect: '-7% ITEM COOLDOWNS',    apply: (f) => { f.cdMul *= 0.93; } },
  { id: 'dashcd', tag: 'DS', color: '#c8a0ff', name: 'LIGHT STEP',    effect: '-12% DASH COOLDOWN',    apply: (f) => { f.dashCdMul *= 0.88; } },
  { id: 'pickup', tag: 'PK', color: '#ffd860', name: 'MAGNET',        effect: '+25% PICKUP RADIUS',    apply: (f) => { f.pickupMul += 0.25; } },
  { id: 'armor',  tag: 'AR', color: '#b0b8c8', name: 'THICK SKIN',    effect: '+6% DAMAGE REDUCTION',  apply: (f) => { f.armor = Math.min(0.6, f.armor + 0.06); } },
  { id: 'regen',  tag: 'RG', color: '#ff8aa0', name: 'SECOND WIND',   effect: '+0.6 HP PER SECOND',    apply: (f) => { f.regen += 0.6; } },
];
