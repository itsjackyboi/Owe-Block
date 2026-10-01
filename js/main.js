import { Assets } from './core/assets.js';
import { Game } from './game/game.js';
import { grantXp, xpNeeded } from './game/levelup.js';
import { kill, damage } from './game/combat.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game');

async function boot() {
  const assets = await Assets.load(params.has('placeholders'));
  const game = new Game(canvas, assets, params);
  if (params.has('debug')) {
    window.__oweblock = {
      game,
      get state() { return game.state; },
      get match() { return game.match; },
      get player() { return game.match && game.match.player; },
      perf: () => game.loop.stats(),
      // add an item to the player (upgrades a duplicate); returns 'added' | 'upgraded' | 'full' | 'maxed'
      give: (id, level = 1) => game.match.player.addItem(id, level),
      // grant the player enough XP for one level-up (opens the picker on the next step)
      levelUp: () => grantXp(game.match, game.match.player, xpNeeded(game.match.player.level) - game.match.player.xp),
      killAllAI: () => { for (const f of game.match.fighters) if (!f.isPlayer && !f.dead) kill(game.match, f, game.match.player, null); },
      // apply melee damage from one fighter to another through the normal combat path (tests)
      damageFrom: (src, dst, n) => damage(game.match, dst, n, { source: src, kind: 'melee', kb: 0 }),
      // screen position (window px) of a world point, for scripted aiming in tests
      screenOf: (wx, wy) => {
        const m = game.match, r = game.renderer.canvas.getBoundingClientRect();
        return { x: r.left + ((wx - m.camera.rx) / 480) * r.width, y: r.top + ((wy - m.camera.ry) / 270) * r.height };
      },
    };
  }
  game.start();
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', '<pre style="color:#f88;padding:1em">Failed to start: ' + e.message + '</pre>');
});
