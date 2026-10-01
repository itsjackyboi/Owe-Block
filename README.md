# Owe Block Brawl

A fast, 8-bit, top-down arena battle royale set in Owe Block (Pintland Isles). You against 40 AI fighters, last one standing wins, matches run 6 to 8 minutes. Static site: `index.html` plus plain ES modules, Canvas 2D, WebAudio chiptune, `localStorage` saves. No build step, no dependencies.

> Status: **Stage 1 (engine skeleton)**. The match is a Mines map with a movable, dashing player and optional idle test dummies. Combat, AI, the police sweep, the other maps and the win/save/audio layer arrive in Stages 2 to 6.

## Run it

ES modules and `fetch` do not work from `file://`, so serve the folder:

```
npx http-server -p 8080 -c-1 .
```

then open <http://localhost:8080/>. On GitHub Pages it works from the repo subpath because every path is relative.

**Controls:** `WASD` move, mouse aim, `Space` dash, `F3` debug overlay. (Left click, `Q`, right-mouse aim stance, `1/2/3`, `E` and `Esc` arrive with combat in Stage 2.)

**URL parameters** (all inert unless set):

| Param | Effect |
|---|---|
| `?mode=mines` | skip the title and start that mode |
| `?seed=N` | fixed seed: same map, spawns and loot |
| `?placeholders=1` | flat-colour art everywhere (game stays fully playable) |
| `?debug=1` | start a match, show the F3 overlay, expose `window.__oweblock` |
| `?dummies=N` | N idle test fighters next to the player (Stage 2 test aid) |
| `?sim=1&speed=10` | Stage 3: AI plays a fast match and writes `__oweblock.result` |

## Publish with GitHub Pages

Settings > Pages > Build and deployment > deploy from branch, pick the branch, folder `/ (root)`. The game is then at `https://<user>.github.io/Owe-Block/`. `.nojekyll` is already committed.

## Layout

```
index.html  assets/manifest.json  assets/kenney/...
js/main.js            boot: load manifest + images, create Game
js/config.js          every tunable (screen size, TILE, fighter and dash numbers, SLOT_COUNT, tier mix ...)
js/core/              loop, input, renderer + camera, assets, sprites (paper-doll compositor), grid, pool, rng, math, events
js/game/              game (screens), match, fighter, controllers/, map, mapgen
js/data/              modes.js and maps/*.js (content lives here; later also weapons, magic, tiers, fighters, gangs, sfx, music)
js/ui/                font (5x7 bitmap), hud, debug overlay
tools/                atlas.html (sheet viewer), smoke.mjs (Playwright smoke + sim runner)
```

Engine modules are mode-, item- and fighter-agnostic: nothing outside `js/data/` names a specific item, mode or fighter.

## Adding content

**A mode** is one entry in `js/data/modes.js`: `{ id, name, tileset, size, generate(rng, w, h) }` (later also loot, zone scale, hazards, music). `generate` returns `{ w, h, tiles, deco, chambers, spawns }` and is built from the shared tools in `js/game/mapgen.js` (Poisson-disc, carve blobs/tunnels, cellular smoothing, BFS, flood-fill connectivity). Copy `js/data/maps/mines.js` as a starting point and add its tileset to `assets/manifest.json`.

**A weapon or magic item** (from Stage 2): one entry in `js/data/weapons.js` or `js/data/magic.js` composed from the generic action primitives in `js/game/actions.js`; `js/data/registry.js` validates it at boot. The schema is described in the plan; any param can be a 5-length array indexed by item level.

## Art and the manifest

`assets/manifest.json` maps roles to frame indices in the Kenney sheets, and its first key `_doc` documents the format. JSON has no comments, so each tileset and the `characters` block carry a `_notes` object explaining every entry. Frame index = `row * columns + col`, from 0 at the top-left.

To (re)map a sheet: serve the repo and open `tools/atlas.html?sheet=dungeon|town|factory|chars` (add `&zoom=5&c0=0&c1=9` to view a column range). It draws every frame with its index overlaid.

Fighters are paper-dolls (body, legs, torso, hair, hat) composited once per look into cached 16x16 canvases. There are no animation frames in the packs, so movement is procedural (bob, lean, flip toward aim, squash on hit).

## Checks

```
node tools/smoke.mjs      # starts a server under /Owe-Block/, loads the game, fails on console errors, takes screenshots, checks movement/dash/pits/perf
npx eslint js tools
```

`smoke.mjs` uses the globally installed Playwright with the preinstalled Chromium; never run `playwright install`. Screenshots go to `tools/out/` (git-ignored) or `--out <dir>`.

## Credits

Art: [Kenney](https://kenney.nl) Tiny Dungeon, Tiny Town, Tiny Factory and Roguelike Characters, all CC0 (licenses are kept next to each sheet in `assets/kenney/`). Names and setting from the Pintland Isles lore documents. Sound is generated in code.
