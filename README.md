# Owe Block Brawl

A fast, 8-bit, top-down arena battle royale set in Owe Block (Pintland Isles). You against 40 AI fighters, last one standing wins, matches run 6 to 8 minutes. Static site: `index.html` plus plain ES modules, Canvas 2D, WebAudio chiptune, `localStorage` saves. No build step, no dependencies.

> Status: **Stage 4 (full roster)**. 16 items plus the two gang weapons, relic telegraphs and everyday passives, on top of the AI and the police sweep. The other maps, named fighters and the win/save/audio layer arrive in Stages 5 and 6.

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
| `?ai=N` | number of AI fighters (default 40; `?dummies=N` alone means 0 AI) |
| `?sim=1&speed=10` | a high-tier bot replaces the player; the match runs at `speed`x and writes `__oweblock.result` when one fighter is left |
| `?manual=1` | do not start the render loop; the test runner steps the match with `__oweblock.fastForward(seconds)` |

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

## Items

| Item | Kind | Left click | Q |
|---|---|---|---|
| Cutlass | weapon | 100 deg slash | Riposte: parry, reflect, counter + stun |
| Shiv | weapon | quick stab, x2.5 from behind | Lunge: dash-stab, bleed, a kill resets the dash |
| Wagwan's Whopper | weapon | heavy smash, wall slam stuns | Thunderclap: hold to charge a knockback shockwave |
| Keg Flail | weapon | 220 deg sweep, x1.5 at the tip | Whirl: 1.5 s spin |
| Singing Bow | weapon | hold to draw | Volley: 5 arrows |
| Gaol Arbalest | weapon | bolt pierces everyone in line | Brace: kneel, then 3 bolts |
| Drifter's Call | weapon | boomerang, hits both ways | Orbit blades |
| Beast Hook | weapon | hook yanks a fighter to you | Reel yourself in (crosses gaps) |
| Bully Hill Mantrap | weapon | place a trap (max 3) | Toss one |
| Ancient Pot | weapon | lob a fire pool | Oil slick (fire ignites it) |
| Old Staff | relic | channelled beam through walls | Sweep a 60 deg wedge |
| Veilwalker Net | relic | thrown net roots everyone it bursts on | Lure: decoy, then a net |
| Sad Sermon | relic | ring telegraph, then a silencing dirge | Last Rites: the dirge follows you |
| Wolendi Wind Pouch | everyday | Gust (cone shove, deflects projectiles); passive from any slot: dash +35% distance, -20% cooldown | Tailwind: +50% move speed |
| ClockHeart Tonic | everyday | drink: heal, then slowed (2 charges) | Splash: slow enemies |
| Amethyst Shard | everyday | grow crystal cover; passive: every 8 s the next hit is -60% | Shatter into slivers |
| Krag's Cleaver / Zaar's Edges | gang exclusive | 3-hit combo / 3 ricochet knives | Cutter's Charge / Ring of Fire |

Relics are about 6% of loot (more at vaults). Every relic declares a `telegraph` in its entry (beam line, wedge, ring) that both the player and the AI can see. Exclusives are never loot.

## AI

`js/ai/ai.js` (AIController) produces the same intents as the player. Skill is entirely data: `js/data/tiers.js` (low 15 / medium 15 / high 10 fighters per match, from `TIER_MIX` in `config.js`).

- **Thinking** is staggered: each AI decides every 0.1 to 0.3 s depending on tier, offset by its id. Between decisions it only steers.
- **States** (utility scores with hysteresis): LOOT, ENGAGE (with KITE and strafe by tier), RETREAT, ZONE, THIRD_PARTY (walks toward recent fights), ROAM. Aggression is the chance to pick a fight with someone it notices; being attacked always starts one.
- **Navigation** (`js/ai/nav.js`): shared BFS flow fields toward the next safe-zone rectangle (cached per target), budgeted grid A* (4 requests per frame, paths cached 1 s) when the straight line is blocked, then whisker wall avoidance, separation and fire avoidance.
- **Items** are used from each item's `ai` hints (`idealRange`, `minRange`, `aim`: direct/lead/lob, `useWhen`, `specialWhen`). Level-ups use the same offer generator as the player's picker, with a tier policy.
- **Danger:** incoming projectiles are predicted; the tier's dodge chance decides whether to strafe or dash.

## The police sweep

`js/game/zone.js`: a rectangle closes in from the map edges toward a seeded final point. Defaults (scaled per mode with `zone.scale` in `modes.js`; Mines uses 1.4): 1:00 safe, shrinks to 70/45/25/10% of the map taking 40/40/35/30 s with 50/40/30/25 s pauses, then a 45 s collapse. Damage outside is 2/4/7/11/16 per second by phase plus 1 per second of continuous exposure. Each shrink brings a light loot respawn inside the safe area. Hatched darkness and a marching police line mark the edge; the HUD shows the timer and a 64x64 minimap with the current and next zone.

## Checks

```
node tools/smoke.mjs                  # server under /Owe-Block/, console errors, screenshots, movement, combat, items, AI, zone, nav, determinism, perf
node tools/sim.mjs --seeds 10 --frames  # 10 headless 41-fighter matches: length, population per minute, winners by tier, frame times
npx eslint js tools
```

`smoke.mjs` uses the globally installed Playwright with the preinstalled Chromium; never run `playwright install`. Screenshots go to `tools/out/` (git-ignored) or `--out <dir>`.

## Credits

Art: [Kenney](https://kenney.nl) Tiny Dungeon, Tiny Town, Tiny Factory and Roguelike Characters, all CC0 (licenses are kept next to each sheet in `assets/kenney/`). Names and setting from the Pintland Isles lore documents. Sound is generated in code.
