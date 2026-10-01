// AI skill tiers. Every behaviour knob the AI reads is here; ai.js has no hard-coded skill numbers.
// react: seconds before a newly seen target is engaged (min, max). aimErr: aim error standard deviation in radians.
// lead: fraction of target movement predicted. dodge: chance to dodge a projectile it saw coming.
// dash: 'panic' | 'dodge' | 'full'. kite: 'none' | 'basic' | 'strafe'. focusWeak: bias toward low-HP targets.
// perceive: sight radius in px (a dark cave: roughly the light radius). third: 'none' | 'sometimes' | 'seek'. zone: 'late' | 'moderate' | 'early'. think: seconds between decisions.
export const TIERS = {
  low:  { id: 'low',  react: [0.45, 0.6],   aimErr: 0.20, lead: 0,    dodge: 0.05, dash: 'panic', kite: 'none',   focusWeak: 0,   third: 'none',      zone: 'late',     relic: 'random',     think: 0.3, aggression: 0.3,  perceive: 100, charge: 0.5 },
  med:  { id: 'med',  react: [0.25, 0.35],  aimErr: 0.10, lead: 0.5,  dodge: 0.35, dash: 'dodge', kite: 'basic',  focusWeak: 0.5, third: 'sometimes', zone: 'moderate', relic: 'inRange',    think: 0.2, aggression: 0.55, perceive: 130, charge: 0.8 },
  high: { id: 'high', react: [0.12, 0.18],  aimErr: 0.04, lead: 0.95, dodge: 0.75, dash: 'full',  kite: 'strafe', focusWeak: 1,   third: 'seek',      zone: 'early',    relic: 'predictive', think: 0.1, aggression: 0.85, perceive: 170, charge: 1.0 },
};

export const TIER_IDS = ['low', 'med', 'high'];
