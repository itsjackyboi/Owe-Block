import { INTERNAL_W, INTERNAL_H } from '../config.js';
import { RNG } from '../core/rng.js';
import { MODES, MODE_LIST } from '../data/modes.js';
import { GANGS } from '../data/gangs.js';
import { ITEMS } from '../data/registry.js';
import { drawText, textWidth, wrapText } from './font.js';
import { buildMinimap } from './hud.js';
import { fmtTime } from './screens.js';

// Every non-match screen: title, mode select, unlocks/stats, options, summary, win (gang choice), pause.
// A screen is { update(game, input, dt), draw(ctx, game, input) }. Mouse and keyboard both work everywhere.
const CX = INTERNAL_W / 2;
const GANG_WEAPON = { cutters: 'krags_cleaver', circus: 'zaars_edges' };
const OUTFIT_GANG = { red: 'cutters', blue: 'circus' };

const inRect = (input, x, y, w, h) => input.mx >= x && input.mx < x + w && input.my >= y && input.my < y + h;
const up = (i) => i.keyPressed('ArrowUp') || i.keyPressed('KeyW');
const down = (i) => i.keyPressed('ArrowDown') || i.keyPressed('KeyS');
const left = (i) => i.keyPressed('ArrowLeft') || i.keyPressed('KeyA');
const right = (i) => i.keyPressed('ArrowRight') || i.keyPressed('KeyD');
const confirm = (i) => i.keyPressed('Enter') || i.keyPressed('Space');
const back = (i) => i.keyPressed('Escape') || i.keyPressed('Backspace');

function panel(ctx, x, y, w, h, hot) {
  ctx.fillStyle = '#10101c'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = hot ? '#3a3858' : '#26243c'; ctx.fillRect(x, y, w, h);
  if (hot) { ctx.fillStyle = '#ffd860'; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h); }
}

function backdrop(ctx) {
  ctx.fillStyle = '#14101c'; ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
  ctx.fillStyle = '#1c1628';
  for (let y = 0; y < INTERNAL_H; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < INTERNAL_W; x += 16) ctx.fillRect(x, y, 8, 8);
}

function header(ctx, title, sub) {
  drawText(ctx, title, CX, 14, { align: 'center', scale: 3, color: '#ffd860' });
  if (sub) drawText(ctx, sub, CX, 42, { align: 'center', color: '#8a8aa0' });
}

// ---------------------------------------------------------------- title

export class TitleScreen {
  constructor() { this.sel = 0; this.t = 0; }

  items(g) {
    return [
      { label: 'START  ' + MODES[g.save.data.lastMode].name.toUpperCase(), go: () => g.startMatch({ mode: g.save.data.lastMode }) },
      { label: 'MODE SELECT', go: () => g.go('modes') },
      { label: 'UNLOCKS / STATS', go: () => g.go('unlocks') },
      { label: 'OPTIONS', go: () => g.go('options') },
    ];
  }

  update(g, input, dt) {
    this.t += dt;
    const items = this.items(g);
    if (up(input)) { this.sel = (this.sel + items.length - 1) % items.length; g.audio.sfx('ui'); }
    if (down(input)) { this.sel = (this.sel + 1) % items.length; g.audio.sfx('ui'); }
    items.forEach((it, i) => { if (inRect(input, CX - 80, 150 + i * 18 - 2, 160, 16) && (input.mx !== this.lx || input.my !== this.ly)) this.sel = i; });
    this.lx = input.mx; this.ly = input.my;
    let go = confirm(input);
    items.forEach((it, i) => { if (input.mousePressed[0] && inRect(input, CX - 80, 150 + i * 18 - 2, 160, 16)) { this.sel = i; go = true; } });
    if (go) { g.audio.sfx('select'); items[this.sel].go(); }
  }

  draw(ctx, g) {
    backdrop(ctx);
    drawText(ctx, 'OWE BLOCK', CX, 34, { align: 'center', scale: 5, color: '#e0443a' });
    drawText(ctx, 'BRAWL', CX, 76, { align: 'center', scale: 5, color: '#f4f0e8' });
    // a row of paper-dolls: you (in your colours), a Cutter, a Circus fighter and the police
    const outfits = [g.save.data.color, 'red', 'blue', 'police'];
    outfits.forEach((o, i) => {
      const spr = g.sprites.fighter({ body: i % 3, outfit: o, hair: i * 3 + 1, hat: o !== 'grey' });
      const bob = Math.round(Math.abs(Math.sin(this.t * 4 + i)) * 2);
      ctx.drawImage(spr.normal, 0, 0, 16, 16, CX - 84 + i * 44 - 16, 110 - bob, 32, 32);
    });
    const items = this.items(g);
    items.forEach((it, i) => {
      const hot = i === this.sel;
      drawText(ctx, (hot ? '> ' : '  ') + it.label + (hot ? ' <' : '  '), CX, 150 + i * 18, { align: 'center', color: hot ? '#ffd860' : '#c8c8d8' });
    });
    drawText(ctx, 'WASD MOVE  MOUSE AIM  CLICK USE  Q SPECIAL  SPACE DASH', CX, 238, { align: 'center', color: '#6a6a88' });
    drawText(ctx, '1/2/3 SWAP  E PICK UP  RIGHT MOUSE AIM  ESC PAUSE', CX, 249, { align: 'center', color: '#6a6a88' });
  }
}

// ---------------------------------------------------------------- mode select

const previews = new Map();
function preview(g, id) {
  let c = previews.get(id);
  if (c) return c;
  const M = MODES[id];
  const gen = M.generate(new RNG(11).fork(1), M.size[0], M.size[1]);
  c = buildMinimap({ tiles: gen.tiles, w: gen.w, h: gen.h }, M.palette);
  previews.set(id, c);
  return c;
}

export class ModeScreen {
  constructor(g) { this.sel = Math.max(0, MODE_LIST.indexOf(g.save.data.lastMode)); this.t = 0; }

  rect(i) { const w = 140, gap = 10, x0 = Math.round((INTERNAL_W - (3 * w + 2 * gap)) / 2); return { x: x0 + i * (w + gap), y: 58, w, h: 176 }; }

  update(g, input, dt) {
    this.t += dt;
    if (left(input)) { this.sel = (this.sel + 2) % 3; g.audio.sfx('ui'); }
    if (right(input)) { this.sel = (this.sel + 1) % 3; g.audio.sfx('ui'); }
    for (let k = 0; k < 3; k++) if (input.keyPressed('Digit' + (k + 1))) { this.sel = k; g.audio.sfx('ui'); }
    let go = confirm(input);
    for (let i = 0; i < 3; i++) {
      const r = this.rect(i);
      if (inRect(input, r.x, r.y, r.w, r.h)) { if (input.mx !== this.lx) this.sel = i; if (input.mousePressed[0]) { this.sel = i; go = true; } }
    }
    this.lx = input.mx;
    if (back(input)) { g.audio.sfx('back'); g.go('title'); return; }
    if (go) { const id = MODE_LIST[this.sel]; g.save.data.lastMode = id; g.save.commit(); g.audio.sfx('select'); g.startMatch({ mode: id }); }
  }

  draw(ctx, g) {
    backdrop(ctx);
    header(ctx, 'CHOOSE A MODE', '< > OR 1 2 3, ENTER OR CLICK TO PLAY, ESC BACK');
    MODE_LIST.forEach((id, i) => {
      const M = MODES[id], r = this.rect(i), hot = i === this.sel;
      panel(ctx, r.x, r.y, r.w, r.h, hot);
      drawText(ctx, M.name.toUpperCase(), r.x + r.w / 2, r.y + 8, { align: 'center', scale: 2, color: hot ? '#ffd860' : '#f4f0e8' });
      ctx.fillStyle = '#10101c'; ctx.fillRect(r.x + r.w / 2 - 49, r.y + 30, 98, 98);
      ctx.drawImage(preview(g, id), r.x + r.w / 2 - 48, r.y + 31, 96, 96);
      M.blurb.forEach((l, k) => drawText(ctx, l, r.x + r.w / 2, r.y + 136 + k * 10, { align: 'center', color: k === 0 ? '#e8e4d8' : '#a8a8c0' }));
      if (g.save.data.lastMode === id) drawText(ctx, 'LAST PLAYED', r.x + r.w / 2, r.y + 166, { align: 'center', color: '#6a8ad8' });
    });
  }
}

// ---------------------------------------------------------------- unlocks / stats

export class UnlocksScreen {
  constructor() { this.row = 0; }

  colors(g) { return ['grey', ...(g.save.data.unlocked.cutters ? ['red'] : []), ...(g.save.data.unlocked.circus ? ['blue'] : [])]; }
  weapons(g) { return [null, ...(g.save.data.unlocked.cutters ? ['krags_cleaver'] : []), ...(g.save.data.unlocked.circus ? ['zaars_edges'] : [])]; }

  cycle(g, row, dir) {
    const d = g.save.data;
    if (row === 0) { const l = this.colors(g); d.color = l[(l.indexOf(d.color) + dir + l.length) % l.length]; }
    else { const l = this.weapons(g); d.startWeapon = l[(l.indexOf(d.startWeapon) + dir + l.length) % l.length]; }
    g.save.commit(); g.audio.sfx('ui');
  }

  update(g, input) {
    if (up(input) || down(input)) { this.row = 1 - this.row; g.audio.sfx('ui'); }
    if (left(input)) this.cycle(g, this.row, -1);
    if (right(input) || confirm(input)) this.cycle(g, this.row, 1);
    for (let r = 0; r < 2; r++) if (input.mousePressed[0] && inRect(input, 16, 52 + r * 40, 220, 34)) { this.row = r; this.cycle(g, r, 1); }
    if (back(input)) { g.audio.sfx('back'); g.go('title'); }
  }

  draw(ctx, g) {
    const d = g.save.data;
    backdrop(ctx);
    header(ctx, 'UNLOCKS / STATS', 'WIN A MATCH TO JOIN A GANG. UP/DOWN, LEFT/RIGHT TO CHANGE. ESC BACK');
    // gang loadout
    const rows = [
      { label: 'START COLOUR', val: d.color.toUpperCase(), col: d.color === 'red' ? '#e0443a' : d.color === 'blue' ? '#4a8ae0' : '#a8a8b8' },
      { label: 'START WEAPON', val: d.startWeapon ? ITEMS[d.startWeapon].name : 'BARE KNUCKLES', col: '#e8e4d8' },
    ];
    rows.forEach((r, i) => {
      panel(ctx, 16, 52 + i * 40, 220, 34, this.row === i);
      drawText(ctx, r.label, 24, 58 + i * 40, { color: '#8a8aa0' });
      drawText(ctx, '< ' + r.val + ' >', 24, 70 + i * 40, { color: r.col });
      if (i === 1 && d.startWeapon) g.assets.drawIcon(ctx, d.startWeapon, 212, 60 + i * 40);
    });
    // gangs
    let y = 140;
    for (const gang of Object.values(GANGS)) {
      const key = gang.id, on = d.unlocked[key], w = GANG_WEAPON[key];
      panel(ctx, 16, y, 220, 40, false);
      drawText(ctx, gang.name, 24, y + 6, { color: on ? (gang.outfit === 'red' ? '#e0443a' : '#4a8ae0') : '#5a5a70' });
      drawText(ctx, on ? ITEMS[w].name : 'LOCKED: WIN AND JOIN', 24, y + 18, { color: on ? '#e8e4d8' : '#5a5a70' });
      drawText(ctx, 'LED BY ' + gang.leader, 24, y + 29, { color: '#6a6a88' });
      if (on) g.assets.drawIcon(ctx, w, 212, y + 4); else { ctx.fillStyle = '#5a5a70'; ctx.fillRect(214, y + 12, 12, 10); ctx.fillRect(217, y + 7, 6, 6); }
      y += 46;
    }
    // bests + totals
    panel(ctx, 250, 52, 214, 92, false);
    drawText(ctx, 'BEST', 258, 58, { color: '#ffd860' });
    const b = d.best, t = d.totals;
    const lines = [
      'PLACEMENT  ' + (b.placement ? '#' + b.placement : '-'), 'KILLS      ' + b.kills, 'DAMAGE     ' + Math.round(b.damage),
      'LONGEST    ' + (b.longestLife ? fmtTime(b.longestLife) : '-'), 'FASTEST WIN ' + (b.fastestWin ? fmtTime(b.fastestWin) : '-'),
    ];
    lines.forEach((l, i) => drawText(ctx, l, 258, 70 + i * 12));
    panel(ctx, 250, 150, 214, 38, false);
    drawText(ctx, 'MATCHES ' + t.matches + '  WINS ' + t.wins, 258, 156);
    drawText(ctx, 'KILLS ' + t.kills + '  TIME ' + fmtTime(t.time), 258, 168);
    drawText(ctx, 'DAMAGE ' + Math.round(t.damage), 258, 178, { color: '#8a8aa0' });
    // history
    panel(ctx, 16, 234 - 8, 448, 0, false);
    drawText(ctx, 'RECENT MATCHES', 250, 194, { color: '#ffd860' });
    d.history.slice(0, 4).forEach((h, i) => {
      drawText(ctx, (h.placement === 1 ? 'WIN ' : '#' + h.placement + ' ') + MODES[h.mode].name.toUpperCase() + ' K' + h.kills + ' ' + fmtTime(h.time), 250, 206 + i * 11, { color: h.placement === 1 ? '#ffd860' : '#c8c8d8' });
    });
    if (!d.history.length) drawText(ctx, 'NONE YET', 250, 206, { color: '#6a6a88' });
  }
}

// ---------------------------------------------------------------- options

export class OptionsScreen {
  constructor() { this.row = 0; }

  rows(g) {
    const s = g.save.data.settings, v = s.volumes;
    return [
      { label: 'SCREEN SHAKE', text: s.shake ? 'ON' : 'OFF', step: () => { s.shake = !s.shake; } },
      { label: 'MASTER VOLUME', bar: v.master, step: (d) => { v.master = clampStep(v.master + d); } },
      { label: 'MUSIC VOLUME', bar: v.music, step: (d) => { v.music = clampStep(v.music + d); } },
      { label: 'SFX VOLUME', bar: v.sfx, step: (d) => { v.sfx = clampStep(v.sfx + d); } },
      { label: 'BACK', text: '', step: () => 'back' },
    ];
  }

  change(g, row, d) {
    const r = this.rows(g)[row];
    if (r.step(d) === 'back') { g.save.commit(); g.go('title'); return; }
    g.applySettings();
    g.save.commit();
    g.audio.sfx('ui');
  }

  update(g, input) {
    const n = 5;
    if (up(input)) { this.row = (this.row + n - 1) % n; g.audio.sfx('ui'); }
    if (down(input)) { this.row = (this.row + 1) % n; g.audio.sfx('ui'); }
    if (left(input)) this.change(g, this.row, -0.1);
    if (right(input) || confirm(input)) this.change(g, this.row, 0.1);
    for (let i = 0; i < n; i++) if (input.mousePressed[0] && inRect(input, 90, 62 + i * 30, 300, 24)) { this.row = i; this.change(g, i, input.mx > 300 && i > 0 && i < 4 ? 0.1 : (i > 0 && i < 4 ? -0.1 : 0.1)); }
    if (back(input)) { g.save.commit(); g.audio.sfx('back'); g.go('title'); }
  }

  draw(ctx, g) {
    backdrop(ctx);
    header(ctx, 'OPTIONS', 'UP/DOWN, LEFT/RIGHT TO CHANGE. ESC BACK');
    this.rows(g).forEach((r, i) => {
      const y = 62 + i * 30, hot = i === this.row;
      panel(ctx, 90, y, 300, 24, hot);
      drawText(ctx, r.label, 100, y + 8, { color: hot ? '#ffd860' : '#e8e4d8' });
      if (r.bar !== undefined) {
        for (let k = 0; k < 10; k++) { ctx.fillStyle = k < Math.round(r.bar * 10) ? '#7ae0a0' : '#34503c'; ctx.fillRect(250 + k * 12, y + 6, 9, 12); }
      } else if (r.text) drawText(ctx, '< ' + r.text + ' >', 300, y + 8, { color: '#e8e4d8' });
    });
  }
}
const clampStep = (v) => Math.max(0, Math.min(1, Math.round(v * 10) / 10));

// ---------------------------------------------------------------- summary + win

export function buildSummary(match) {
  const p = match.player;
  return {
    mode: match.mode.id, seed: match.seed, won: !p.dead && match.won,
    placement: p.dead ? match.placement : 1, total: match.fighters.length,
    kills: p.kills, damage: Math.round(p.damageDealt), level: p.level,
    time: p.dead ? p.surviveTime : match.time,
    killedBy: p.dead ? { name: p.killedBy ? (p.killedBy.title || p.killedBy.name) : null, item: p.killedByItem, kind: p.deathKind } : null,
    build: p.slots.filter(Boolean).map((s) => ({ id: s.id, level: s.level })),
    buildAtDeath: p.finalBuild || null,
  };
}

export class SummaryScreen {
  constructor(sum) { this.sum = sum; this.t = 0; }

  update(g, input, dt) {
    this.t += dt;
    if (this.t > 0.3 && (confirm(input) || input.mousePressed[0])) { g.audio.sfx('select'); g.go('title'); }
    if (input.keyPressed('KeyR')) g.startMatch({ mode: this.sum.mode });
  }

  draw(ctx, g) {
    const s = this.sum;
    backdrop(ctx);
    drawText(ctx, s.won ? 'LAST ONE STANDING' : 'MATCH OVER', CX, 16, { align: 'center', scale: 3, color: s.won ? '#ffd860' : '#e0443a' });
    panel(ctx, 80, 50, 320, 150, false);
    drawText(ctx, 'PLACE', 96, 60, { color: '#8a8aa0' });
    drawText(ctx, '#' + s.placement + ' OF ' + s.total, 96, 72, { scale: 2, color: s.placement === 1 ? '#ffd860' : '#f4f0e8' });
    const rows = [['KILLS', s.kills], ['DAMAGE', s.damage], ['LEVEL', s.level], ['SURVIVED', fmtTime(s.time)], ['MODE', MODES[s.mode].name.toUpperCase()]];
    rows.forEach(([k, v], i) => { drawText(ctx, k, 96, 98 + i * 12, { color: '#8a8aa0' }); drawText(ctx, String(v), 180, 98 + i * 12); });
    drawText(ctx, s.won ? 'RESULT' : 'KILLED BY', 250, 60, { color: '#8a8aa0' });
    let kb = 'OWE BLOCK IS YOURS';
    if (s.killedBy) kb = s.killedBy.name ? s.killedBy.name + (s.killedBy.item && ITEMS[s.killedBy.item] ? '\n' + ITEMS[s.killedBy.item].name : '') : s.killedBy.kind === 'zone' ? "GOBBLER'S POLICE\nSWEEP" : s.killedBy.kind === 'fall' ? 'A LONG FALL' : 'THE DARK';
    kb.split('\n').forEach((l, i) => drawText(ctx, l, 250, 72 + i * 10, { color: '#ff8a78' }));
    drawText(ctx, 'BUILD', 250, 104, { color: '#8a8aa0' });
    const build = s.buildAtDeath || s.build;
    build.forEach((b, i) => {
      const x = 250 + i * 50;
      ctx.fillStyle = '#10101c'; ctx.fillRect(x - 1, 117, 20, 20); ctx.fillStyle = '#34324e'; ctx.fillRect(x, 118, 18, 18);
      g.assets.drawIcon(ctx, b.id, x + 1, 119);
      drawText(ctx, 'L' + b.level, x + 22, 123, { color: '#ffd860' });
    });
    if (!build.length) drawText(ctx, 'BARE KNUCKLES', 250, 122, { color: '#c8c8d8' });
    drawText(ctx, 'ENTER: TITLE    R: PLAY AGAIN', CX, 214, { align: 'center', color: '#ffd860' });
  }
}

// Win: choose a gang. The choice unlocks that gang's weapon and colour.
export class WinScreen {
  constructor() { this.t = 0; this.sel = 0; }

  rect(i) { return { x: 40 + i * 210, y: 120, w: 190, h: 80 }; }

  update(g, input, dt) {
    this.t += dt;
    if (left(input) || right(input)) { this.sel = 1 - this.sel; g.audio.sfx('ui'); }
    let pick = -1;
    if (input.keyPressed('Digit1')) pick = 0;
    if (input.keyPressed('Digit2')) pick = 1;
    if (confirm(input) && this.t > 0.4) pick = this.sel;
    for (let i = 0; i < 2; i++) { const r = this.rect(i); if (inRect(input, r.x, r.y, r.w, r.h)) { if (input.mx !== this.lx) this.sel = i; if (input.mousePressed[0] && this.t > 0.4) pick = i; } }
    this.lx = input.mx;
    if (pick >= 0) g.chooseGang(pick === 0 ? 'cutters' : 'circus');
  }

  draw(ctx, g) {
    ctx.fillStyle = 'rgba(8,6,16,0.8)'; ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
    drawText(ctx, 'LAST ONE STANDING', CX, 30, { align: 'center', scale: 3, color: '#ffd860' });
    drawText(ctx, 'OWE BLOCK IS YOURS. WHICH GANG DO YOU JOIN?', CX, 66, { align: 'center' });
    drawText(ctx, 'IT UNLOCKS THEIR WEAPON AND COLOURS', CX, 78, { align: 'center', color: '#8a8aa0' });
    [GANGS.cutters, GANGS.circus].forEach((gang, i) => {
      const r = this.rect(i), hot = i === this.sel, red = gang.outfit === 'red';
      ctx.fillStyle = '#10101c'; ctx.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
      ctx.fillStyle = red ? (hot ? '#e0443a' : '#9a2c24') : (hot ? '#4a8ae0' : '#2c5a9a'); ctx.fillRect(r.x, r.y, r.w, r.h);
      if (hot) { ctx.fillStyle = '#ffffff'; ctx.fillRect(r.x, r.y, r.w, 2); ctx.fillRect(r.x, r.y + r.h - 2, r.w, 2); }
      drawText(ctx, gang.name, r.x + r.w / 2, r.y + 10, { align: 'center', scale: 2 });
      g.assets.drawIcon(ctx, GANG_WEAPON[gang.id], r.x + 12, r.y + 36, 2);
      drawText(ctx, ITEMS[GANG_WEAPON[gang.id]].name, r.x + 50, r.y + 40);
      drawText(ctx, 'LED BY ' + gang.leader, r.x + 50, r.y + 52, { color: '#f4e0e0' });
      drawText(ctx, '[' + (i + 1) + ']', r.x + r.w / 2, r.y + r.h - 12, { align: 'center' });
    });
    void wrapText; void textWidth; void OUTFIT_GANG;
  }
}

// ---------------------------------------------------------------- pause

export class PauseScreen {
  constructor() { this.sel = 0; }

  items(g) { return [{ label: 'RESUME', go: () => g.resume() }, { label: 'OPTIONS', go: () => g.go('options', true) }, { label: 'QUIT TO TITLE', go: () => g.go('title') }]; }

  update(g, input) {
    const items = this.items(g);
    if (up(input)) { this.sel = (this.sel + items.length - 1) % items.length; g.audio.sfx('ui'); }
    if (down(input)) { this.sel = (this.sel + 1) % items.length; g.audio.sfx('ui'); }
    let go = confirm(input);
    items.forEach((it, i) => { if (inRect(input, CX - 70, 110 + i * 20 - 2, 140, 16)) { if (input.mx !== this.lx) this.sel = i; if (input.mousePressed[0]) { this.sel = i; go = true; } } });
    this.lx = input.mx;
    if (input.keyPressed('Escape')) { g.resume(); return; }
    if (go) { g.audio.sfx('select'); items[this.sel].go(); }
  }

  draw(ctx, g) {
    ctx.fillStyle = 'rgba(8,6,16,0.7)'; ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
    drawText(ctx, 'PAUSED', CX, 70, { align: 'center', scale: 4, color: '#f4f0e8' });
    this.items(g).forEach((it, i) => { const hot = i === this.sel; drawText(ctx, (hot ? '> ' : '  ') + it.label + (hot ? ' <' : '  '), CX, 110 + i * 20, { align: 'center', color: hot ? '#ffd860' : '#c8c8d8' }); });
  }
}
