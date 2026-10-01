// Procedural 16x16 pixel icons for items the Kenney packs have no art for (no boomerang, fists ...).
// Palette: . transparent, o outline, w wood, l light wood, s steel, d dark steel, k skin, K skin shade, r red, p purple, P light purple
const PAL = { o: '#2a1c1e', w: '#c8884a', l: '#f0c078', s: '#d8dce8', d: '#8088a0', k: '#e8b890', K: '#b88860', r: '#c8321e', p: '#8a4ac8', P: '#c8a0ff', y: '#ffd860', g: '#7a8090' };

const ART = {
  // curved wooden boomerang, a V opening to the upper right
  drifters_call: [
    '................',
    '.oo.............',
    '.olo............',
    '.owlo...........',
    '.owwo...........',
    '.owwo...........',
    '.owwwo..........',
    '.owwwo..........',
    '.owwwwo.........',
    '.owwwwwoo.......',
    '.owwwwwwwoooo...',
    '.owwwwwwwwwlo...',
    '..owwwwwwwwwo...',
    '...ooooooooooo..',
    '................',
    '................',
  ],
  // a pair of fists
  bare_knuckles: [
    '................',
    '................',
    '..oooo..oooo....',
    '.okkkko.okkkko..',
    '.okKkkko.okKkko.',
    '.okkkkko.okkkko.',
    '.okkkkko.okkkko.',
    '..okkkko..okkko.',
    '..oKKKKo..oKKKo.',
    '...oooo....ooo..',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  // crossbow: stock + bow limbs + loaded bolt
  arbalest: [
    '................',
    '................',
    '..oo........oo..',
    '.owwo......owwo.',
    '.owwwo....owwwo.',
    '..owwwoooowwwo..',
    '...owwwwwwwwo...',
    '....oossssoo....',
    '.....osssso.....',
    '.....owwwwo.....',
    '.....owwwwo.....',
    '.....owwwwo.....',
    '......owwo......',
    '......owwo......',
    '......oooo......',
    '................',
  ],
  // iron jaw trap
  mantrap: [
    '................',
    '................',
    '................',
    '..s.s.s.s.s.s...',
    '.sdsdsdsdsdsds..',
    '.odoododododod..',
    'oddddddddddddddo',
    'oddgggggggggggdo',
    'oddddddddddddddo',
    '.odododododoodo.',
    '.sdsdsdsdsdsdsd.',
    '..s.s.s.s.s.s...',
    '................',
    '................',
    '................',
    '................',
  ],
  // amethyst crystal
  amethyst_shard: [
    '................',
    '.......oo.......',
    '......oPPo......',
    '.....oPPpPo.....',
    '..oo.oPpppo.oo..',
    '.oPPooPpppooPPo.',
    '.oPpPoppppoPpPo.',
    '.oPppopppppPppo.',
    '..oppoppppopppo.',
    '..opppoppppppo..',
    '...oppppppppo...',
    '....oppppppo....',
    '.....opppppo....',
    '......oooooo....',
    '................',
    '................',
  ],
  // three throwing knives fanned out
  zaars_edges: [
    '................',
    '..........s.....',
    '.........sds....',
    '...s.....sd.....',
    '..sds...sds.....',
    '..sd....sd...s..',
    '..sd...sds..sds.',
    '..sds..oo...sd..',
    '...oo..ro...sds.',
    '...ro..ro....oo.',
    '...ro........ro.',
    '..............ro',
    '................',
    '................',
    '................',
    '................',
  ],
};

export function proceduralIcon(id) {
  const rows = ART[id];
  if (!rows) return null;
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const g = c.getContext('2d');
  rows.forEach((row, y) => {
    for (let x = 0; x < 16; x++) {
      const ch = row[x];
      if (ch !== '.' && PAL[ch]) { g.fillStyle = PAL[ch]; g.fillRect(x, y, 1, 1); }
    }
  });
  return c;
}

export const HAS_PROCEDURAL = (id) => id in ART;
