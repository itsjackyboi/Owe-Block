# Owe Block Brawl

A fast, 8-bit, top-down arena battle royale set in Owe Block (Pintland Isles). You against 40 AI fighters in three skill tiers, last one standing wins, matches run about 6 to 8 minutes while Gobbler's police sweep closes in. Static site: `index.html` plus plain ES modules, Canvas 2D, WebAudio chiptune generated in code, `localStorage` saves. No build step, no dependencies.

## Run it

ES modules and `fetch` do not work from `file://`, so serve the folder:

```
npx http-server -p 8080 -c-1 .
```

then open <http://localhost:8080/>. On GitHub Pages it works from the repo subpath because every path is relative (Settings > Pages > deploy from branch, folder `/ (root)`; `.nojekyll` is committed).

## How to play

**Controls:** `WASD` move, mouse aim, `Space` dash (brief invulnerability, crosses one-tile gaps and pits), `Left click` use the held item (hold to keep attacking or to draw a bow), `Q` the held item's special, `Right mouse` aim stance (camera leans to the cursor, tighter spread, +15% range, -35% move speed), `1/2/3` or the wheel swap the held item, `E` swap with the item on the ground, `Esc` pause, `F3` debug overlay.

**Items:** you hold one item at a time; an empty hand uses bare knuckles. Walking over loot picks it up (a duplicate upgrades what you own, max L5); with all slots full a prompt appears and `E` swaps. Magic is held too: relics and tonics are used with click and `Q` like any weapon, and passives work from any slot. Kills drop the victim's items and XP caps; XP levels you up and the world pauses while you pick one of three offers (1/2/3 or click): a new item, an upgrade, or a stat boost.

**Winning:** be the last one standing, then choose a gang. Crimson Cutters unlock Krag's Cleaver and red colours, Seaside Circus unlock Zaar's Edges and blue. Unlocked gear can be worn into later runs from the Unlocks / Stats screen.

## Modes

| Mode | Map | Hazards | Loot leans toward |
|---|---|---|---|
| Mines (Dig Dug's mines) | 150x150 caves and tunnels, Tiny Dungeon art | darkness (130 px light), cave-ins (1.2 s shadow, then 25 damage and a stun), void pits | Mantrap, Amethyst Shard; relic vault in the deepest chamber |
| Rooftops (the final gang war) | 100x100 roofs split by two-tile alleys, joined by planks, Tiny Town art | gaps (15% max HP and a stun, back to the last safe roof), skylights that give way after 1 s | Bow, Beast Hook, Wind Pouch; vault roofs reachable only by dash or hook |
| Pipe Pit (Mickey's Pipe Club) | 110x110 open pit ringed by a pipe maze, Tiny Factory art | conveyors push you, steam vents hiss for 1 s then burst for 20 and a shove | Keg Flail, Ancient Pot, Whopper; the best loot is in the open pit |

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
| Wolendi Wind Pouch | everyday | Gust; passive from any slot: dash +35% distance, -20% cooldown | Tailwind: +50% move speed |
| ClockHeart Tonic | everyday | drink: heal, then slowed (2 charges) | Splash: slow enemies |
| Amethyst Shard | everyday | grow crystal cover; passive: every 8 s the next hit is -60% | Shatter into slivers |
| Krag's Cleaver / Zaar's Edges | gang exclusive | 3-hit combo / 3 ricochet knives | Cutter's Charge / Ring of Fire |

Relics are about 6% of loot (more at vaults) and every relic has a telegraph the AI can read. The gang weapons are never loot: Krag and Zaar spawn holding theirs.

## Named fighters

3 to 5 of 11 named fighters (Krag, Zaar the Edgemaster, Fin, Wagwan, Dig Dug, Mickey, Moby, Bucket, Fr Leo, Baba Paku, Sergeant Hark) join each match in high-tier slots with a name tag, their signature item, HP x1.2 (Fin: x0.9 and +25% speed), a fixed look and favourite items. Gobbler is not a fighter: he is the face of the police sweep.

## The AI

`js/ai/ai.js` produces exactly the intents the player produces. Skill is entirely data in `js/data/tiers.js` (15 low / 15 medium / 10 high per match).

- **Thinking** is staggered: each AI decides every 0.1 to 0.3 s depending on tier, offset by its id; between decisions it only steers.
- **States** (utility scores with hysteresis): LOOT, ENGAGE (kite or strafe by tier), RETREAT, ZONE, THIRD_PARTY, ROAM. Aggression is the chance to pick a fight with someone it notices; being attacked always starts one.
- **Navigation** (`js/ai/nav.js`): shared BFS flow fields toward the next safe rectangle, connected-component checks (no walks across gaps), budgeted grid A* (4 per frame, cached 1 s), whisker wall avoidance, separation, fire avoidance.
- **Items** are used from each item's `ai` hints; relics follow the tier's relic timing (random / in range and slow / predictive); tonics are drunk when hurt; telegraphs and incoming projectiles are dodged by tier chance (strafe or dash).

## The police sweep

`js/game/zone.js`: a rectangle closes in toward a seeded final point. Defaults (scaled per mode with `zone.scale`): 1:00 safe, shrinks to 70/45/25/10% taking 40/40/35/30 s with 50/40/30/25 s pauses, then a 45 s collapse. Damage outside is 2/4/7/11/16 per second by phase plus 1 per second of continuous exposure. Every shrink brings a light loot respawn inside the safe area. Hatched darkness and a marching police line mark the edge; the HUD shows the timer and a 64x64 minimap.

## Saves, options, audio

`oweblock.save.v1` in `localStorage` (versioned, every access in try/catch): unlocked gangs, colour and start weapon, last mode, last 20 matches, bests, totals, settings. With storage blocked the game still runs. Options: screen shake, master / music / SFX volume. Audio is generated in code: pulse (PeriodicWave duty), triangle and noise voices, a lookahead sequencer for one track per mode plus the title, sound effects from data (`js/data/sfx.js`, `js/data/music.js`), distance-attenuated and capped at 12 voices.

## URL parameters (all inert unless set)

| Param | Effect |
|---|---|
| `?mode=mines\|rooftops\|pipepit` | skip the title and start that mode |
| `?seed=N` | fixed seed: same map, spawns, loot, zone |
| `?placeholders=1` | flat-colour art everywhere (stays fully playable) |
| `?debug=1` | start a match, F3 overlay, `window.__oweblock` (state, perf, `give(id)`, `levelUp()`, `killAllAI()`, `fastForward(s)`) |
| `?menu=1` | with `?debug=1`, stay on the title screen |
| `?dummies=N` | N idle test fighters (and no AI unless `?ai=N`) |
| `?ai=N`, `?named=all` | AI count; force every named fighter in |
| `?sim=1&speed=10` | a high-tier bot replaces the player; runs at `speed`x and writes `__oweblock.result` |
| `?manual=1` | no render loop; the test runner steps the match |

## Adding content

**A mode** is one entry in `js/data/modes.js`: `{ id, name, tileset, size, generate(rng, w, h), loot, zone, hazards, pit, music, palette, blurb }`. `generate` returns `{ w, h, tiles, deco, chambers, spawns, lootPoints, vaultPoints, xpPoints, ... }` and is built from the shared tools in `js/game/mapgen.js`. Hazards are `{ type, ... }` handled in `js/game/hazards.js`. Add its tileset to `assets/manifest.json`.

**An item** is one entry in `js/data/weapons.js` or `js/data/magic.js`, composed from the primitives in `js/game/actions.js`. `js/data/registry.js` validates every entry at boot and logs a clear error for a bad one (the entry is skipped; relics must declare a `telegraph`).

```js
{ id, name, kind:'weapon'|'relic'|'everyday'|'exclusive', loot:true, rarity:'common'|'uncommon'|'rare'|'relic', icon, effect:'one line shown in UI',
  primary:{ action:'meleeArc', cooldown:[...5 levels], params:{ damage:[...5], arc:100, reach:22, knockback:120 } },
  special:{ action:'parry', cooldown:[...5], params:{...} },   // Q
  passive:{...} | null, charges:{ max, recharge }?, telegraph:{...}?, ai:{ idealRange, minRange, aim, useWhen, specialWhen } }
```

Any numeric param (and `cooldown`) can be a 5-length array indexed by item level. Primitives: `meleeArc`, `thrust`, `dashStrike`, `projectile` (fan, pierce, bounce, returns, hook, burst, trail), `chargeRelease`, `shockwave`, `spin`, `sequence`, `throwArea`, `placeTrap`, `channelBeam`, `sweepBeam`, `delayedArea`, `areaAura`, `decoy`, `gust`, `selfBuff`, `consume`, `spawnCover`, `shatter`, `orbit`, `parry`. Icons (and optional in-hand sprites) go under `icons` and `held` in `assets/manifest.json`; anything missing falls back to a placeholder.

## Art and the manifest

`assets/manifest.json` maps roles to frame indices in the Kenney sheets; its first key `_doc` documents the format and each tileset carries a `_notes` object explaining every entry. Frame index = `row * columns + col`. To (re)map a sheet: serve the repo and open `tools/atlas.html?sheet=dungeon|town|factory|chars` (add `&zoom=5&c0=0&c1=9` for a column range, `&roles=mines|rooftops|pipepit|characters` to outline the assigned frames). Fighters are paper-dolls composited once per look into cached 16x16 canvases; there are no animation frames in the packs, so movement is procedural.

## Checks

```
node tools/smoke.mjs                    # server under /Owe-Block/, console errors, screenshots, movement, combat, every item, AI, zone, hazards, menus, saves, audio, perf
node tools/sim.mjs --seeds 10 --mode mines --frames   # headless 41-fighter matches: length, population per minute, winners by tier, frame times
npx eslint js tools
```

Both use the globally installed Playwright with the preinstalled Chromium (never run `playwright install`). Screenshots go to `tools/out/` (git-ignored) or `--out <dir>`.

## Credits

Art: [Kenney](https://kenney.nl) Tiny Dungeon, Tiny Town, Tiny Factory and Roguelike Characters, all CC0 (licences sit next to each sheet in `assets/kenney/`). Names and setting from the Pintland Isles lore documents. Sound is generated in code.
