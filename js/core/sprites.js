// Paper-doll compositor. Each fighter's layers are drawn once into a cached 16x16 canvas,
// plus a white silhouette used for the hit flash. Nothing here runs per frame.
const GANG_RGB = { red: '#c8321e', blue: '#2a78d0', grey: '#9a9aa8', police: '#2a2e3c' };

function makeCanvas() {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return [c, g];
}

export class Sprites {
  constructor(assets) {
    this.assets = assets;
    this.cache = new Map();
  }

  // appearance: { body, legs, torso, hair, hat } where legs/torso/hat are outfit keys (red|blue|grey|police)
  // and body/hair are indices into the manifest lists.
  fighter(app) {
    const key = `${app.body}|${app.outfit}|${app.hair}|${app.hat ? 1 : 0}`;
    let s = this.cache.get(key);
    if (s) return s;
    s = this.compose(app);
    this.cache.set(key, s);
    return s;
  }

  compose(app) {
    const ch = this.assets.manifest.characters;
    const [c, g] = makeCanvas();
    const a = this.assets;
    const o = app.outfit;
    let drawn = 0;
    drawn += a.drawFrame(g, 'chars', ch.body[app.body % ch.body.length], 0, 0) ? 1 : 0;
    drawn += a.drawFrame(g, 'chars', ch.legs[o], 0, 0) ? 1 : 0;
    drawn += a.drawFrame(g, 'chars', ch.torso[o], 0, 0) ? 1 : 0;
    if (ch.hair[app.hair % ch.hair.length] >= 0) a.drawFrame(g, 'chars', ch.hair[app.hair % ch.hair.length], 0, 0);
    if (app.hat && ch.hat[o] >= 0) a.drawFrame(g, 'chars', ch.hat[o], 0, 0);
    if (!drawn) this.placeholder(g, o);

    const [f, fg] = makeCanvas();
    fg.drawImage(c, 0, 0);
    fg.globalCompositeOperation = 'source-in';
    fg.fillStyle = '#ffffff';
    fg.fillRect(0, 0, 16, 16);
    return { normal: c, flash: f };
  }

  // Flat-colour stand-in used when the characters sheet is unavailable or ?placeholders=1.
  placeholder(g, outfit) {
    g.fillStyle = '#e0b890'; g.fillRect(5, 2, 6, 5);       // head
    g.fillStyle = GANG_RGB[outfit] || '#888'; g.fillRect(4, 7, 8, 5); // torso
    g.fillStyle = '#2a2a38'; g.fillRect(5, 12, 2, 3); g.fillRect(9, 12, 2, 3); // legs
  }
}

export function randomAppearance(rng, outfit, assets) {
  const ch = assets.manifest.characters;
  return {
    body: rng.int(0, ch.body.length),
    outfit,
    hair: rng.int(0, ch.hair.length),
    hat: outfit === 'police' || rng.chance(0.5),
  };
}
