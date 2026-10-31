# Crash Maps 🗺️🚙 (repo: desert-drift)

A cartoony top-down drift game for kids. Your little car never stops driving — steer left and right so the big blue trucks chasing you crash into **each other**! Smash the goal number of trucks to clear the level.

**Play:** https://bryankeeling06-eng.github.io/desert-drift/

## Home screen
- **▶ Play** — the level game (one level counter for everything).
- **⏱ Survival** — "How long can you last?" Endless waves: a new wave every 20 s (+3 coins each); every wave brings more, faster chasers. Same health rules: 3 truck hits and you crash out. Your best is saved.
- **🚗 Shop** — spend coins on cars: Zippy (free), Police Car 20, Ice Cream Truck 60, Go-Kart 120, Lifeguard Buggy 200, Unicorn Car 300. Your car drives on every map.
- **🗺️ Maps** — pick any unlocked map. Otherwise each new level picks a random unlocked map (never the same one twice in a row) and Level Complete tells you what's next.

The 🗺️ 🚗 buttons (bottom-left) and 🏠 🔊 buttons (bottom-right) work any time.

## Maps
Maps unlock by the best level you've reached:

| Map | Unlock | You drive | Chasers | Obstacles |
|---|---|---|---|---|
| Desert | start | cyan car | blue monster trucks | tire stacks, crates, barriers |
| City | Level 3 | police cruiser | cars, taxis, buses | buildings, cones, roadblocks, parked cars |
| Park | Level 5 | ice cream truck | park-goer cars | trees, benches, picnic tables, fountains, ponds |
| Unicorn Fields | Level 7 | unicorn car | pastel bubble cars | hay bales, fences, mushrooms |
| Playground | Level 9 | go-kart | bumper cars | slides, swings, climbing frames, spring riders |
| Beach | Level 11 | lifeguard buggy | beach buggies | sandcastles, umbrellas, rocks, tide pools |

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

Coins and best level save in your browser (`localStorage` key `desertDrift.v1`).

Plain HTML + Canvas 2D + WebAudio, no build step: `index.html`, `game.js`, `style.css`.
