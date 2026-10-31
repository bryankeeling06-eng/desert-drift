# Crash Maps 🗺️🚙 (repo: desert-drift)

A cartoony top-down drift game for kids. Your little car never stops driving — steer left and right so the big blue trucks chasing you crash into **each other**! Smash the goal number of trucks to clear the level.

**Play:** https://bryankeeling06-eng.github.io/desert-drift/

## Home screen
- **▶ Play** — the level game. **Maps are a surprise:** every level shuffles to a random unlocked map (never the same one twice in a row). There's no map picker — win levels to add more maps to the shuffle; Level Complete announces new unlocks.
- **⏱ Survival** — "How long can you last?" One random unlocked map per run, a new wave every 20 s (+3 coins each), more and faster chasers every wave. Your best is saved.
- **🚗 Car Shop** — two tabs, **Cars** and **🐾 Animals**. Every car drives on every map and has its own engine sound.
- **⚡ Upgrades** — spend coins on upgrades that work for every car.

Bottom buttons: 🚗 shop (left), 🏠 home and 🔊 mute (right).

## Cars
| Car | Price | Sound |
|---|---|---|
| Zippy | free | buzzy little engine |
| Police Car | 20 | low rumble + siren chirps |
| Ice Cream Truck | 60 | soft hum + jingle |
| Go-Kart | 120 | high whine |
| Snowmobile | 150 | buzzy two-stroke |
| Lifeguard Buggy | 200 | chunky dune-buggy chug |
| Monster Truck | 250 | huge growl with revs (bigger and a bit slower) |
| Unicorn Car | 300 | sparkly arpeggio |
| Bat Racer | 400 | jet whoosh + hero fanfare |
| 🐼 Panda Car | 80 | giggles |
| 🐴 Pony Racer | 110 | clip-clop |
| 🐬 Dolphin Dasher | 160 | squeaks |
| 🦖 Dino Buggy | 220 | stomps |

## Upgrades
- **Speed** — +5% top speed per level.
- **Toughness** — +4 health per level (bigger bar; every 7 extra health = one more truck hit before you crash out).
- Levels 0–10 each, cost 15, 20, 25, 35, 50, 65, 90, 120, 165, 220 coins. Works in levels and Survival.

## Coins while you're away
Your garage earns **5 coins per hour** while you're away (up to 24 h = 120 coins). Come back after 5+ minutes and tap **Collect!**.

## Maps
Maps join the shuffle when your best level reaches:

| Map | Unlock | Chasers | Obstacles |
|---|---|---|---|
| Desert | start | monster trucks | tire stacks, crates, barriers |
| City | Level 3 | cars, taxis, buses | buildings, cones, roadblocks |
| Park | Level 5 | park-goer cars | trees, benches, fountains, ponds |
| Farm | Level 6 | tractors, cow cars | barns, silos, straw bales, troughs |
| Unicorn Fields | Level 7 | pastel bubble cars | hay bales, fences, mushrooms |
| Winter | Level 8 | snowplows, scarf cars | ice blocks, snowmen, gifts, pines, igloos, icy pond — slippery! |
| Playground | Level 9 | bumper cars | slides, swings, climbing frames |
| Beach | Level 11 | beach buggies | sandcastles, umbrellas, rocks |
| Candy Land | Level 13 | gingerbread & gummy cars | lollipops, gumdrops, candy canes, cupcakes |

## Controls
- **Touch:** **tap** the left/right half of the screen for a small nudge; **hold** it to spin in a tight circle that way (holding both halves = straight). On the Level Complete screen, tap anywhere to continue — that tap never steers.
- **Keyboard:** ← → or A / D — quick press = nudge, hold = spin
- 🔊 button mutes sound

## Rules
- No weapons — trick the trucks into crashing together.
- Grab gold coins they drop.
- **Watch your health bar.** A truck bump takes a big bite out of it (the screen flashes red). Get bumped by trucks too often and you crash out.
- **Bumping crates, barriers, tire stacks or the arena edge** takes a tiny nibble (at most once a second per object). Bumps alone never knock you out.
- Game over shows the level you reached and the coins you got; **Tap to Retry** restarts that level and you keep all your coins.

Coins, cars, upgrades and best level save in your browser (`localStorage` key `desertDrift.v1`).

Plain HTML + Canvas 2D + WebAudio, no build step: `index.html`, `game.js`, `style.css`.
