# Owe Block Brawl

A fast, 8-bit, top-down arena battle royale set in Owe Block (Pintland Isles). You against 40 AI fighters, last one standing wins, matches run 6 to 8 minutes. Static site: `index.html` plus plain ES modules, Canvas 2D, WebAudio chiptune, `localStorage` saves. No build step, no dependencies.

> Status: **Stage 2 (player combat)**. You fight idle test dummies (`?dummies=N`) on a Mines map: held-item model, four starter weapons, XP caps and the level-up picker. AI fighters, the police sweep, the other maps, named fighters and the win/save/audio layer arrive in Stages 3 to 6.

## Run it

ES modules and `fetch` do not work from `file://`, so serve the folder:

```
npx http-server -p 8080 -c-1 .
```

then open <http://localhost:8080/>. On GitHub Pages it works from the repo subpath because every path is relative.

**Controls:** `WASD` move, mouse aim, `Space` dash (brief invulnerability), `Left click` use the held item (hold to keep attacking or to draw a bow), `Q` the held item's special, `Right mouse` aim stance (camera leans to the cursor, tighter spread, +15% range, -35% move speed), `1/2/3` or the mouse wheel swap the held item, `E` swap with the item on the ground, `F3` debug overlay. `Esc` pause arrives in Stage 6.

**Items:** you hold one item at a time; an empty hand uses bare knuckles. Walking over loot picks it up (a duplicate upgrades what you own, max L5); with all slots full a prompt appears and `E` swaps. Kills drop the victim's items and XP caps; XP levels you up and the world pauses while you pick one of three offers (1/2/3 or click).

**URL parameters** (all inert unless set):

| Param | Effect |
|---|---|
| `?mode=mines` | skip the title and start that mode |
| `?seed=N` | fixed seed: same map, spawns and loot |
| `?placeholders=1` | flat-colour art everywhere (game stays fully playable) |
| `?debug=1` | start a match, show the F3 overlay, expose `window.__oweblock` |
| `?dummies=N` | N idle test fighters next to the player; they carry items and XP and drop them when killed (test aid until the AI arrives) |
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

**A weapon or magic item**: one entry in `js/data/weapons.js` (or `magic.js`), composed from the generic action primitives in `js/game/actions.js`. `js/data/registry.js` validates every entry at boot and logs a clear error for a bad one (the entry is skipped).

```js
{ id, name, kind:'weapon'|'relic'|'everyday', loot:true, rarity:'common'|'uncommon'|'rare'|'relic', icon, effect:'one line shown in UI',
  primary:{ action:'meleeArc', cooldown:[...5 levels], params:{ damage:[...5], arc:100, reach:22, knockback:120 } },
  special:{ action:'parry', cooldown:[...5], params:{...} },   // Q
  passive:{...} | null, ai:{ idealRange, minRange, aim, useWhen, specialWhen } }
```

Any numeric param (and `cooldown`) can be a 5-length array indexed by item level. Primitives available now: `meleeArc`, `thrust` (combo + backstab), `projectile` (fan, pierce, bounce, returns), `chargeRelease` (hold to draw), `throwArea` (lob to the cursor, leaves a fire or oil area), `orbit`, `parry`. Add an icon under `icons` (and optionally `held`) in `assets/manifest.json`; anything missing falls back to a placeholder.

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
