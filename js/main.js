import { Assets } from './core/assets.js';
import { Game } from './game/game.js';

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
      give: (id) => console.warn('give(' + id + '): items arrive in Stage 2'),
      levelUp: () => console.warn('levelUp: arrives in Stage 2'),
      killAllAI: () => console.warn('killAllAI: AI arrives in Stage 3'),
    };
  }
  game.start();
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', '<pre style="color:#f88;padding:1em">Failed to start: ' + e.message + '</pre>');
});
