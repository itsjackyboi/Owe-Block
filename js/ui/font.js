// 5x7 bitmap pixel font. Glyphs are stored as 7 rows of 5 bits; a per-colour atlas is built lazily and cached.
const GLYPHS = {
  A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110', D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110', J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 11001 10101 10011 10001 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110', P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110', V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 11011 10001', X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
  0: '01110 10001 10011 10101 11001 10001 01110', 1: '00100 01100 00100 00100 00100 00100 01110',
  2: '01110 10001 00001 00010 00100 01000 11111', 3: '11110 00001 00001 01110 00001 00001 11110',
  4: '00010 00110 01010 10010 11111 00010 00010', 5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110', 7: '11111 00001 00010 00100 01000 01000 01000',
  8: '01110 10001 10001 01110 10001 10001 01110', 9: '01110 10001 10001 01111 00001 00010 01100',
  '.': '00000 00000 00000 00000 00000 01100 01100', ',': '00000 00000 00000 00000 01100 00100 01000',
  ':': '00000 01100 01100 00000 01100 01100 00000', '!': '00100 00100 00100 00100 00100 00000 00100',
  '?': '01110 10001 00001 00110 00100 00000 00100', '-': '00000 00000 00000 11111 00000 00000 00000',
  '+': '00000 00100 00100 11111 00100 00100 00000', '/': '00001 00001 00010 00100 01000 10000 10000',
  '%': '11001 11010 00010 00100 01000 01011 10011', '(': '00010 00100 01000 01000 01000 00100 00010',
  ')': '01000 00100 00010 00010 00010 00100 01000', "'": '00100 00100 01000 00000 00000 00000 00000',
  '=': '00000 00000 11111 00000 11111 00000 00000', '<': '00010 00100 01000 10000 01000 00100 00010',
  '>': '01000 00100 00010 00001 00010 00100 01000', '#': '01010 01010 11111 01010 11111 01010 01010',
  '*': '00000 10101 01110 11111 01110 10101 00000', _: '00000 00000 00000 00000 00000 00000 11111',
  '[': '01110 01000 01000 01000 01000 01000 01110', ']': '01110 00010 00010 00010 00010 00010 01110',
  ' ': '00000 00000 00000 00000 00000 00000 00000',
};

const CHARS = Object.keys(GLYPHS);
const INDEX = {};
CHARS.forEach((c, i) => { INDEX[c] = i; });
const QUESTION = INDEX['?'];

const atlases = new Map();
function atlasFor(color) {
  let a = atlases.get(color);
  if (a) return a;
  a = document.createElement('canvas');
  a.width = CHARS.length * 5; a.height = 7;
  const g = a.getContext('2d');
  g.fillStyle = color;
  CHARS.forEach((c, i) => {
    const rows = GLYPHS[c].split(' ');
    for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) if (rows[y][x] === '1') g.fillRect(i * 5 + x, y, 1, 1);
  });
  atlases.set(color, a);
  return a;
}

export function textWidth(text, scale = 1) { return Math.max(0, text.length * 6 - 1) * scale; }

// opts: { color, shadow (colour or false), scale, align: 'left'|'center'|'right' }
export function drawText(ctx, text, x, y, opts = {}) {
  const color = opts.color || '#f4f0e8';
  const scale = opts.scale || 1;
  const s = String(text).toUpperCase();
  if (opts.align === 'center') x -= textWidth(s, scale) / 2;
  else if (opts.align === 'right') x -= textWidth(s, scale);
  x = Math.round(x); y = Math.round(y);
  const shadow = opts.shadow === undefined ? '#10101c' : opts.shadow;
  if (shadow) blit(ctx, s, x + scale, y + scale, shadow, scale);
  blit(ctx, s, x, y, color, scale);
}

function blit(ctx, s, x, y, color, scale) {
  const a = atlasFor(color);
  for (let i = 0; i < s.length; i++) {
    const gi = INDEX[s[i]] ?? QUESTION;
    ctx.drawImage(a, gi * 5, 0, 5, 7, x + i * 6 * scale, y, 5 * scale, 7 * scale);
  }
}

// Splits text into lines of at most `maxChars` characters, breaking on spaces.
export function wrapText(text, maxChars) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > maxChars) { lines.push(line); line = w; }
    else line = line ? line + ' ' + w : w;
  }
  if (line) lines.push(line);
  return lines;
}
