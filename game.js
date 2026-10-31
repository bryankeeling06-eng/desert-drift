// Desert Drift — Canvas 2D, no build step.
(() => {
'use strict';
const SAVE_KEY = 'desertDrift.v1';
const WORLD = 2400, HP_MAX = 20, TRACK_SCALE = 0.5;
// Damage model (one health bar, no hit counter on screen):
//  - a truck hit drains TRUCK_DMG of the 20 segments (20 -> 13 -> 6); the 3rd truck hit always empties it = game over.
//    Hits 1 and 2 never take the bar below 1, so death is always exactly the 3rd truck hit.
//  - bumping obstacles/walls chips BUMP_DMG, rate-limited; bumps alone never kill (bar floors at 1 segment).
const TRUCK_DMG = 7, MAX_HITS = 3, CAR_IFRAMES = 1.5, BUMP_DMG = 1, BUMP_CD = 1.0, BUMP_GLOBAL_CD = 0.35, BUMP_MIN_SPEED = 40;
const cv = document.getElementById('game'), ctx = cv.getContext('2d');
const muteBtn = document.getElementById('mute');
let W = 0, H = 0, DPR = 1, ZOOM = 1;

// ---------- save ----------
function loadSave() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && typeof s === 'object') return { coins: s.coins|0, best: Math.max(1, s.best|0), level: Math.max(1, s.level|0), muted: !!s.muted, map: typeof s.map === 'string' ? s.map : 'desert',
      cars: Array.isArray(s.cars) ? [...new Set(['cyan', ...s.cars.filter(c => typeof c === 'string')])] : ['cyan'],
      car: typeof s.car === 'string' ? s.car : 'cyan',
      surv: { bestWaves: (s.surv && s.surv.bestWaves) | 0, bestTime: (s.surv && s.surv.bestTime) | 0 },
      up: { speed: Math.min(10, Math.max(0, (s.up && s.up.speed) | 0)), tough: Math.min(10, Math.max(0, (s.up && s.up.tough) | 0)) },
      lastSeen: typeof s.lastSeen === 'number' ? s.lastSeen : null }; } catch (e) {}
  return { coins: 0, best: 1, level: 1, muted: false, map: 'desert', cars: ['cyan'], car: 'cyan', surv: { bestWaves: 0, bestTime: 0 }, up: { speed: 0, tough: 0 }, lastSeen: null };
}
const save = loadSave();
if (!save.cars.includes(save.car)) save.car = 'cyan';
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }

// ---------- audio ----------
let ac = null, master = null;
function unlockAudio() {
  if (!ac) {
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain(); master.gain.value = save.muted ? 0 : 0.6; master.connect(ac.destination);

    } catch (e) { ac = null; }
  }
  if (ac && ac.state === 'suspended') ac.resume();
}
function beep(freq, dur = 0.12, type = 'square', vol = 0.15, slide = 0) {
  if (!ac || save.muted) return;
  audioStats.beeps++;
  const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function boom() {
  if (!ac || save.muted) return;
  const len = ac.sampleRate * 0.4, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const src = ac.createBufferSource(), g = ac.createGain(), f = ac.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 900; g.gain.value = 0.5;
  src.buffer = buf; src.connect(f); f.connect(g); g.connect(master); src.start();
}
function setMuted(m) { save.muted = m; persist(); muteBtn.textContent = m ? '🔇' : '🔊'; if (master) master.gain.value = m ? 0 : 0.6; }
muteBtn.addEventListener('pointerdown', e => { e.stopPropagation(); unlockAudio(); setMuted(!save.muted); });
setMuted(save.muted);

// ---------- input ----------
const keys = {};
// Half-screen tap zones with tap-vs-hold feel.
// Every press (touch pointer or steering key) is a source {side, t0}. Side is fixed at press time.
//  - pressed < HOLD_MS: gentle pre-turn (TAP_STEER)
//  - pressed >= HOLD_MS: strong continuous spin (HOLD_STEER)
//  - released before HOLD_MS: short nudge (NUDGE_STEER for NUDGE_S seconds)
const HOLD_MS = 180, TAP_STEER = 0.2, HOLD_STEER = 1.45, NUDGE_STEER = 0.3, NUDGE_S = 0.1;
const zones = new Map(); // id -> {side, t0}
let steerCur = 0, nudgeT = 0, nudgeSide = 0;
const now = () => performance.now();
function hudBottom() { return 14 + 124 * Math.max(1, Math.min(1.4, W / 380)); }
function press(id, side) { if (!zones.has(id)) zones.set(id, { side, t0: now() }); }
function release(id) {
  const z = zones.get(id); if (!z) return; zones.delete(id);
  if (now() - z.t0 < HOLD_MS && S.state === 'play') { nudgeT = NUDGE_S; nudgeSide = z.side; }
}
const KEYSIDE = { arrowleft: -1, a: -1, arrowright: 1, d: 1 };
addEventListener('keydown', e => {
  unlockAudio(); const k = e.key.toLowerCase(); keys[k] = true;
  if (['arrowleft','arrowright','arrowup','arrowdown',' '].includes(k)) e.preventDefault();
  if (KEYSIDE[k] && S.state === 'play') press('key:' + k, KEYSIDE[k]);
  if (e.key === ' ' || e.key === 'Enter') tap();
});
addEventListener('keyup', e => { const k = e.key.toLowerCase(); keys[k] = false; if (KEYSIDE[k]) release('key:' + k); });
cv.addEventListener('pointerdown', e => {
  unlockAudio(); e.preventDefault();
  if (S.state === 'collect') { collectOffline(); return; }
  if (S.state === 'upg') { upgClick(e.clientX, e.clientY); return; }
  if (S.state === 'shop') { shopClick(e.clientX, e.clientY); return; }
  if (S.state === 'home') { homeClick(e.clientX, e.clientY); return; }
  if (S.state === 'over' && S.mode === 'survival') { survOverClick(e.clientX, e.clientY); return; }
  if (S.state !== 'play') { tap(); return; }          // taps on menus only advance, never steer
  if (e.clientY < hudBottom()) return;                // HUD strip is not a steering zone
  press('p' + e.pointerId, e.clientX < W / 2 ? -1 : 1);
});
const endTouch = e => release('p' + e.pointerId);
cv.addEventListener('pointerup', endTouch); cv.addEventListener('pointercancel', endTouch); cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') endTouch(e); });
function releaseAll() { zones.clear(); nudgeT = 0; for (const k in keys) keys[k] = false; }
addEventListener('blur', releaseAll);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
// per side: 0 = idle, 1 = pressed (pre-threshold), 2 = held
function zoneState() {
  const t = now(); let l = 0, r = 0;
  for (const z of zones.values()) { const lv = t - z.t0 >= HOLD_MS ? 2 : 1; if (z.side < 0) l = Math.max(l, lv); else r = Math.max(r, lv); }
  return { l, r };
}
function steerInput(dt) {
  const z = zoneState();
  const mag = lv => lv === 2 ? HOLD_STEER : lv === 1 ? TAP_STEER : 0;
  let t = (z.l && z.r) ? 0 : mag(z.r) - mag(z.l);          // both pressed -> straight
  if (nudgeT > 0) { nudgeT -= dt; if (!z.l && !z.r) t = nudgeSide * NUDGE_STEER; }
  const rate = t === 0 ? 7 : 12;                          // quick ramp to full spin, gentle ease-out
  steerCur += (t - steerCur) * Math.min(1, rate * dt);
  if (Math.abs(steerCur) < 0.01 && t === 0) steerCur = 0;
  return steerCur;
}

// ---------- resize ----------
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  ZOOM = Math.max(0.75, Math.min(1.5, Math.min(W, H) / 370));
}
addEventListener('resize', resize); resize();

// ---------- world ----------
let rngSeed = 1;
const rnd = () => { rngSeed = (rngSeed * 16807) % 2147483647; return (rngSeed - 1) / 2147483646; };
const trackCv = document.createElement('canvas');
trackCv.width = trackCv.height = WORLD * TRACK_SCALE;
const tctx = trackCv.getContext('2d');

const S = {
  state: 'play', level: save.level, kills: 0, hits: 0, overT: 0, overWhy: '', bumpT: 0, wallCd: 0, goal: 10, hp: HP_MAX, coins: save.coins, levelCoins: 0,
  player: null, enemies: [], parts: [], debris: [], coinsOnGround: [], obstacles: [], plateaus: [], craters: [],
  spawnT: 0, iframes: 0, t: 0, flash: 0, clearT: 0, tally: 0, shake: 0, msg: '', msgT: 0,
  stats: { bumps: 0, trackSegs: 0, explosions: 0, coinsPicked: 0, hits: 0, spawns: 0 }
};

function makeCar(x, y, a, enemy) {
  return { x, y, a, vx: Math.cos(a) * 100, vy: Math.sin(a) * 100, enemy, r: enemy ? 24 : 15,
    speed: enemy ? 0 : 270, turn: enemy ? 1.7 : 3.4, grip: enemy ? 3.2 : 2.6, bump: 0, lastL: null, lastR: null };
}
function goalFor(l) { return Math.min(30, 10 + (l - 1) * 2); }

// ---------- MAPS (themes) ----------
// One global level counter; every level shuffles to a random unlocked map (no manual picking). Maps unlock by best level reached.
const MAPS = [
  { id: 'desert', name: 'Desert', unlock: 1, ground: '#d98a4b', outer: '#b8682e', edge: '#8f4f22', track: '110,55,20', player: 'cyan', speed: 1,
    enemies: [{ body: 'truck', c1: '#1e5aa8', c2: '#2f7fd6' }],
    obs: [['tires', 0.45], ['crate', 0.3], ['barrier', 0.25]] },
  { id: 'city', name: 'City', unlock: 3, ground: '#5d636b', outer: '#3d4249', edge: '#c9ccd1', track: '15,15,22', player: 'cop', speed: 1.03,
    enemies: [{ body: 'sedan', c1: '#e04b3a' }, { body: 'taxi', c1: '#ffcc00' }, { body: 'bus', c1: '#ff9d1c' }, { body: 'sedan', c1: '#4f7bd6' }],
    obs: [['cone', 0.4], ['roadblock', 0.3], ['parked', 0.3]] },
  { id: 'park', name: 'Park', unlock: 5, ground: '#7cc35a', outer: '#4f9a3a', edge: '#2f6e25', track: '45,85,25', player: 'icecream', speed: 0.97,
    enemies: [{ body: 'sedan', c1: '#2bb3a3' }, { body: 'sedan', c1: '#e86f9a' }, { body: 'sedan', c1: '#7a6be0' }],
    obs: [['tree', 0.4], ['bench', 0.2], ['picnic', 0.25], ['fountain', 0.15]] },
  { id: 'unicorn', name: 'Unicorn Fields', unlock: 7, ground: '#8fe06a', outer: '#c9b6ff', edge: '#ffffff', track: '60,125,45', player: 'unicorn', speed: 0.95,
    enemies: [{ body: 'bubble', c1: '#ff9ecb' }, { body: 'bubble', c1: '#8fd3ff' }, { body: 'bubble', c1: '#c7a6ff' }, { body: 'bubble', c1: '#ffd36b' }],
    obs: [['hay', 0.4], ['fence', 0.3], ['mushroom', 0.3]] },
  { id: 'winter', name: 'Winter Wonderland', unlock: 8, ground: '#eef6fb', outer: '#a9d3ee', edge: '#7fb3d9', track: '110,150,190', player: 'snowmobile', speed: 0.95, grip: 0.7,
    enemies: [{ body: 'plow', c1: '#ffb020' }, { body: 'scarf', c1: '#e8463c' }, { body: 'ginger', c1: '#b9773f' }],
    obs: [['iceblock', 0.25], ['snowman', 0.25], ['gift', 0.2], ['pine', 0.2], ['igloo', 0.1]] },
  { id: 'playground', name: 'Playground', unlock: 9, ground: '#cf6f57', outer: '#5d9bd6', edge: '#ffd23f', track: '90,30,20', player: 'kart', speed: 0.95,
    enemies: [{ body: 'bumper', c1: '#ff5d5d' }, { body: 'bumper', c1: '#4fb3ff' }, { body: 'bumper', c1: '#7ddc5a' }, { body: 'bumper', c1: '#ffb03b' }],
    obs: [['slide', 0.3], ['swings', 0.25], ['climber', 0.25], ['spring', 0.2]] },
  { id: 'farm', name: 'Farm', unlock: 6, ground: '#d9c27a', outer: '#7aa34a', edge: '#8b5a2b', track: '105,80,35', player: 'pony', speed: 0.96,
    enemies: [{ body: 'tractor', c1: '#2f9e44' }, { body: 'tractor', c1: '#e03131' }, { body: 'cow', c1: '#ffffff' }],
    obs: [['barn', 0.15], ['silo', 0.2], ['strawbale', 0.35], ['trough', 0.3]] },
  { id: 'candy', name: 'Candy Land', unlock: 13, ground: '#ffd6ec', outer: '#b9f0ff', edge: '#ff7ab8', track: '200,90,150', player: 'panda', speed: 1,
    enemies: [{ body: 'gummy', c1: '#ff5d8f' }, { body: 'gummy', c1: '#7ddc5a' }, { body: 'gummy', c1: '#ffb03b' }, { body: 'gummy', c1: '#6fc3ff' }],
    obs: [['lollipop', 0.3], ['gumdrop', 0.3], ['candycane', 0.2], ['cupcake', 0.2]] },
  { id: 'beach', name: 'Beach', unlock: 11, ground: '#f2d49b', outer: '#3fb8e0', edge: '#ffffff', track: '165,125,75', player: 'buggy', speed: 1,
    enemies: [{ body: 'buggy', c1: '#ff8c42' }, { body: 'buggy', c1: '#3ec1d3' }, { body: 'buggy', c1: '#a06cd5' }],
    obs: [['castle', 0.35], ['umbrella', 0.35], ['rock', 0.3]] },
];
const OBS = { // shape + size for each obstacle kind
  tires: () => ({ shape: 'c', r: 30 }), crate: () => ({ shape: 'r', w: 56, h: 56 }),
  barrier: () => rnd() < 0.5 ? { shape: 'r', w: 130, h: 34 } : { shape: 'r', w: 34, h: 130 },
  cone: () => ({ shape: 'c', r: 13 }), roadblock: () => rnd() < 0.5 ? { shape: 'r', w: 100, h: 22 } : { shape: 'r', w: 22, h: 100 },
  parked: () => rnd() < 0.5 ? { shape: 'r', w: 56, h: 28, col: ['#9b59b6', '#27ae60', '#e67e22', '#ecf0f1'][Math.floor(rnd() * 4)] } : { shape: 'r', w: 28, h: 56, col: ['#9b59b6', '#27ae60', '#e67e22', '#ecf0f1'][Math.floor(rnd() * 4)] },
  building: () => ({ shape: 'r', w: 170 + Math.floor(rnd() * 60), h: 170 + Math.floor(rnd() * 60), col: ['#e8b86b', '#d9776b', '#8fb3d9', '#b6a6d9', '#e0d6c8'][Math.floor(rnd() * 5)] }),
  tree: () => ({ shape: 'c', r: 32 }), bench: () => rnd() < 0.5 ? { shape: 'r', w: 66, h: 20 } : { shape: 'r', w: 20, h: 66 },
  picnic: () => ({ shape: 'r', w: 64, h: 48 }), fountain: () => ({ shape: 'c', r: 48 }), pond: () => ({ shape: 'c', r: 110 + Math.floor(rnd() * 40) }),
  hay: () => ({ shape: 'c', r: 26 }), fence: () => rnd() < 0.5 ? { shape: 'r', w: 150, h: 14 } : { shape: 'r', w: 14, h: 150 }, mushroom: () => ({ shape: 'c', r: 20 }),
  slide: () => rnd() < 0.5 ? { shape: 'r', w: 40, h: 110 } : { shape: 'r', w: 110, h: 40 }, swings: () => ({ shape: 'r', w: 140, h: 26 }),
  climber: () => ({ shape: 'r', w: 90, h: 90 }), spring: () => ({ shape: 'c', r: 18 }),
  iceblock: () => ({ shape: 'r', w: 50, h: 50 }), snowman: () => ({ shape: 'c', r: 22 }), gift: () => ({ shape: 'r', w: 40, h: 40, col: ['#e8463c', '#22a55e', '#3b82f6', '#a855f7'][Math.floor(rnd() * 4)] }),
  pine: () => ({ shape: 'c', r: 26 }), igloo: () => ({ shape: 'c', r: 42 }), icepond: () => ({ shape: 'c', r: 110 + Math.floor(rnd() * 40) }),
  barn: () => ({ shape: 'r', w: 150, h: 120 }), silo: () => ({ shape: 'c', r: 34 }), strawbale: () => rnd() < 0.5 ? { shape: 'r', w: 60, h: 32 } : { shape: 'r', w: 32, h: 60 },
  trough: () => rnd() < 0.5 ? { shape: 'r', w: 74, h: 24 } : { shape: 'r', w: 24, h: 74 },
  lollipop: () => ({ shape: 'c', r: 24, col: ['#ff5d8f', '#7c5cff', '#3ec1d3', '#ffb03b'][Math.floor(rnd() * 4)] }), gumdrop: () => ({ shape: 'c', r: 22, col: ['#ff5d5d', '#7ddc5a', '#ffd23f', '#b07cff'][Math.floor(rnd() * 4)] }),
  candycane: () => rnd() < 0.5 ? { shape: 'r', w: 100, h: 18 } : { shape: 'r', w: 18, h: 100 }, cupcake: () => ({ shape: 'c', r: 28 }),
  castle: () => ({ shape: 'c', r: 26 }), umbrella: () => ({ shape: 'c', r: 34 }), rock: () => ({ shape: 'c', r: 28 }), pool: () => ({ shape: 'c', r: 90 + Math.floor(rnd() * 30) }),
};
let MAP = MAPS[0];
function mapById(id) { return MAPS.find(m => m.id === id) || MAPS[0]; }
function isUnlocked(m) { return save.best >= m.unlock; }
function unlockedMaps() { return MAPS.filter(isUnlocked).map(m => m.id); }

function buildLevel() {
  MAP = mapById(save.map); if (!isUnlocked(MAP)) { MAP = MAPS[0]; save.map = 'desert'; }
  rngSeed = 1234 + S.level * 977 + MAPS.indexOf(MAP) * 31;
  S.obstacles = []; S.decor = [];
  const c = WORLD / 2, clear = 280;
  const free = (x, y, pad) => Math.hypot(x - c, y - c) > clear + pad && S.obstacles.every(o => Math.hypot(o.x - x, o.y - y) > (o.r || Math.max(o.w, o.h) / 2) + pad + 20);
  const add = (kind, x, y) => { const o = Object.assign({ kind, x, y }, OBS[kind]()); const pad = o.r || Math.max(o.w, o.h) / 2; if (free(x, y, pad)) S.obstacles.push(o); };
  const R = () => 120 + rnd() * (WORLD - 240);
  const D = (k, extra) => S.decor.push(Object.assign({ k, x: rnd() * WORLD, y: rnd() * WORLD }, extra || {}));
  // theme-specific big features + decor
  if (MAP.id === 'desert') {
    for (let i = 0; i < 7; i++) { const x = 150 + rnd() * (WORLD - 300), y = 150 + rnd() * (WORLD - 300), pts = [], r = 120 + rnd() * 140; for (let k = 0; k < 7; k++) { const an = k / 7 * Math.PI * 2, q = r * (0.7 + rnd() * 0.5); pts.push([x + Math.cos(an) * q, y + Math.sin(an) * q]); } S.decor.push({ k: 'plateau', x, y, rad: r * 1.3, pts }); }
    for (let i = 0; i < 14; i++) D('crater', { r: 25 + rnd() * 45 });
  } else if (MAP.id === 'city') {
    for (let gx = 0; gx < 6; gx++) for (let gy = 0; gy < 6; gy++) {
      const x = 200 + gx * 400, y = 200 + gy * 400;
      if (Math.hypot(x - c, y - c) < 420) { S.decor.push({ k: 'sidewalk', x, y, rad: 200 }); continue; }
      if (rnd() < 0.2) { S.decor.push({ k: 'plaza', x, y, rad: 200 }); continue; }
      S.decor.push({ k: 'sidewalk', x, y, rad: 200 });
      const o = Object.assign({ kind: 'building', x, y }, OBS.building()); S.obstacles.push(o);
    }
    for (let i = 0; i < 30; i++) S.decor.push({ k: rnd() < 0.5 ? 'manhole' : 'hydrant', x: 400 * (1 + Math.floor(rnd() * 5)) + (rnd() - 0.5) * 60, y: rnd() * WORLD, rad: 20 });
  } else if (MAP.id === 'park') {
    for (let i = 0; i < 9; i++) S.decor.push({ k: 'path', x: R(), y: R(), a: rnd() * Math.PI, len: 500 + rnd() * 500, rad: 600 });
    for (let i = 0; i < 2; i++) add('pond', R(), R());
    for (let i = 0; i < 140; i++) D('flowers', { rad: 20, c: ['#ff6fa5', '#fff36b', '#ffffff', '#b07cff'][i % 4] });
  } else if (MAP.id === 'unicorn') {
    for (let i = 0; i < 10; i++) D('hill', { r: 140 + rnd() * 140, rad: 300 });
    for (let i = 0; i < 4; i++) D('rainbow', { r: 120 + rnd() * 60, rad: 200 });
    for (let i = 0; i < 160; i++) D('flowers', { rad: 20, c: ['#ff6fa5', '#fff36b', '#ffffff', '#b07cff', '#6fd3ff'][i % 5] });
    for (let i = 0; i < 8; i++) D('cloud', { r: 50 + rnd() * 40, rad: 150 });
  } else if (MAP.id === 'playground') {
    for (let i = 0; i < 6; i++) D('sandbox', { r: 90 + rnd() * 40, rad: 140 });
    for (let i = 0; i < 4; i++) D('merry', { r: 60, rad: 70 });
    for (let i = 0; i < 8; i++) D('hopscotch', { rad: 120, a: rnd() * Math.PI });
    for (let i = 0; i < 6; i++) D('ring', { r: 80 + rnd() * 60, rad: 150, c: ['#ffffff', '#ffd23f', '#5d9bd6'][i % 3] });
  } else if (MAP.id === 'winter') {
    for (let i = 0; i < 2; i++) add('icepond', R(), R());
    for (let i = 0; i < 14; i++) D('snowbank', { r: 60 + rnd() * 80, rad: 160 });
    for (let i = 0; i < 60; i++) D('sparkle', { rad: 10 });
  } else if (MAP.id === 'farm') {
    for (let i = 0; i < 6; i++) D('crops', { w: 300 + rnd() * 200, h: 200 + rnd() * 150, rad: 300 });
    for (let i = 0; i < 10; i++) D('mud', { r: 30 + rnd() * 30, rad: 60 });
    for (let i = 0; i < 24; i++) D('chick', { rad: 10 });
  } else if (MAP.id === 'candy') {
    for (let i = 0; i < 8; i++) D('choc', { r: 40 + rnd() * 50, rad: 100 });
    for (let i = 0; i < 160; i++) D('sprinkle', { rad: 6, a: rnd() * Math.PI, c: ['#ff5d5d', '#7ddc5a', '#ffd23f', '#6fc3ff', '#ffffff'][i % 5] });
  } else if (MAP.id === 'beach') {
    for (let i = 0; i < 3; i++) add('pool', R(), R());
    for (let i = 0; i < 30; i++) D('towel', { rad: 50, a: rnd() * Math.PI, c: ['#ff6f91', '#4fc3f7', '#ffd23f', '#7ddc5a'][i % 4] });
    for (let i = 0; i < 90; i++) D(rnd() < 0.5 ? 'shell' : 'star', { rad: 12 });
  }
  const nObs = (MAP.id === 'city' ? 16 : MAP.id === 'desert' ? 16 : 34) + Math.min(10, S.level);
  const tot = MAP.obs.reduce((s, o) => s + o[1], 0);
  for (let i = 0; i < nObs * 2 && S.obstacles.filter(o => o.kind !== 'building' && o.kind !== 'pond' && o.kind !== 'pool' && o.kind !== 'icepond').length < nObs; i++) {
    let r = rnd() * tot, kind = MAP.obs[0][0]; for (const [k, w] of MAP.obs) { if ((r -= w) < 0) { kind = k; break; } }
    let x = R(), y = R();
    if (MAP.id === 'city' && kind !== 'parked') { if (rnd() < 0.5) x = 400 * (1 + Math.floor(rnd() * 5)) + (rnd() - 0.5) * 120; else y = 400 * (1 + Math.floor(rnd() * 5)) + (rnd() - 0.5) * 120; }
    add(kind, x, y);
  }
  S.mapId = MAP.id;
}

// ---------- vehicle skins ----------
function wheels(list, w, h, col = '#1b1f2a') { ctx.fillStyle = col; for (const [x, y] of list) { rr(ctx, x, y, w, h, Math.min(w, h) / 2.5); ctx.fill(); } }
function drawPlayerSkin(kind) {
  const t = S.t;
  if (kind === 'cop') {
    wheels([[-11, -10], [5, -10], [-11, 7], [5, 7]], 8, 3);
    ctx.fillStyle = '#16181d'; rr(ctx, -15, -8, 30, 16, 4); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(-7, -8, 13, 16);
    ctx.fillStyle = '#bfe9ff'; rr(ctx, 6, -6, 4, 12, 1); ctx.fill();
    const on = Math.floor(t * 6) % 2;
    ctx.fillStyle = on ? '#ff3b3b' : '#7a1d1d'; ctx.fillRect(-3, -7, 4, 7);
    ctx.fillStyle = on ? '#1f4fa8' : '#3b8bff'; ctx.fillRect(-3, 0, 4, 7);
    ctx.fillStyle = '#fff6a0'; ctx.fillRect(13, -7, 2, 4); ctx.fillRect(13, 3, 2, 4);
  } else if (kind === 'icecream') {
    wheels([[-12, -11], [6, -11], [-12, 8], [6, 8]], 8, 3);
    ctx.fillStyle = '#ffffff'; rr(ctx, -16, -9, 32, 18, 4); ctx.fill();
    ctx.fillStyle = '#ff8fc0'; ctx.fillRect(-16, -9, 32, 3); ctx.fillRect(-16, 6, 32, 3);
    ctx.fillStyle = '#9fe3ff'; rr(ctx, 9, -7, 4, 14, 1); ctx.fill();
    ctx.fillStyle = '#e0a060'; ctx.beginPath(); ctx.moveTo(-1, 0); ctx.lineTo(-9, -4); ctx.lineTo(-9, 4); ctx.fill();
    ctx.fillStyle = '#ff8fc0'; ctx.beginPath(); ctx.arc(-1, 0, 5, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(1, -1, 2, 0, 7); ctx.fill();
  } else if (kind === 'unicorn') {
    wheels([[-11, -10], [5, -10], [-11, 7], [5, 7]], 8, 3, '#b07cff');
    ctx.fillStyle = '#fbf6ff'; rr(ctx, -15, -8, 30, 16, 7); ctx.fill();
    const mane = ['#ff6fa5', '#ffb03b', '#fff36b', '#6fdc8c', '#6fc3ff', '#b07cff'];
    mane.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(-14 + i * 3.5, -2.5, 3.5, 5); });
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.moveTo(14, -3); ctx.lineTo(24, 0); ctx.lineTo(14, 3); ctx.fill();
    ctx.fillStyle = '#ffb7d5'; ctx.beginPath(); ctx.arc(9, -6, 2.5, 0, 7); ctx.arc(9, 6, 2.5, 0, 7); ctx.fill();
  } else if (kind === 'kart') {
    wheels([[-13, -12], [5, -12], [-13, 7], [5, 7]], 9, 5);
    ctx.fillStyle = '#ff7a1a'; rr(ctx, -13, -7, 27, 14, 5); ctx.fill();
    ctx.fillStyle = '#2a8cff'; rr(ctx, -9, -5, 9, 10, 3); ctx.fill();
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(-4, 0, 5, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(12, -6, 3, 12);
  } else if (kind === 'panda') {
    wheels([[-11, -11], [4, -11], [-11, 8], [4, 8]], 8, 3);
    ctx.fillStyle = '#ffffff'; rr(ctx, -15, -9, 26, 18, 9); ctx.fill();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.ellipse(-4, 0, 6, 9, 0, 0, 7); ctx.fill();
    circ(13, 0, 7.5, '#ffffff'); circ(10, -6.5, 3, '#222'); circ(10, 6.5, 3, '#222');
    circ(15, -3, 2.2, '#222'); circ(15, 3, 2.2, '#222'); circ(19.5, 0, 1.5, '#222');
  } else if (kind === 'pony') {
    wheels([[-11, -11], [5, -11], [-11, 8], [5, 8]], 8, 3);
    ctx.fillStyle = '#b5703c'; ctx.beginPath(); ctx.ellipse(-1, 0, 14, 8, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#b5703c'; ctx.beginPath(); ctx.ellipse(16, 0, 6, 4.5, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#6b3d1e'; ctx.fillRect(2, -1.5, 14, 3); ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-22, -4); ctx.lineTo(-22, 4); ctx.fill();
    ctx.fillStyle = '#e8463c'; rr(ctx, -6, -6, 9, 12, 3); ctx.fill(); circ(-1.5, 0, 2, '#ffd23f');
    circ(19, -2.5, 1.2, '#222'); circ(19, 2.5, 1.2, '#222');
  } else if (kind === 'dolphin') {
    wheels([[-10, -10], [4, -10], [-10, 7], [4, 7]], 8, 3);
    ctx.fillStyle = '#5b9bd5'; ctx.beginPath(); ctx.moveTo(22, 0); ctx.quadraticCurveTo(10, -10, -12, -6); ctx.lineTo(-12, 6); ctx.quadraticCurveTo(10, 10, 22, 0); ctx.fill();
    ctx.fillStyle = '#5b9bd5'; ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(-20, -8); ctx.lineTo(-17, 0); ctx.lineTo(-20, 8); ctx.fill();
    ctx.fillStyle = '#cfe8ff'; ctx.beginPath(); ctx.ellipse(6, 0, 10, 2.5, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#3f7fbf'; ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(-4, -2); ctx.lineTo(-4, 2); ctx.fill();
    circ(14, -4, 1.4, '#222'); circ(14, 4, 1.4, '#222');
  } else if (kind === 'dino') {
    wheels([[-12, -12], [5, -12], [-12, 9], [5, 9]], 9, 3);
    ctx.fillStyle = '#4caf50'; ctx.beginPath(); ctx.moveTo(-24, 0); ctx.lineTo(-12, -7); ctx.lineTo(-12, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-2, 0, 13, 9, 0, 0, 7); ctx.fill(); circ(15, 0, 7, '#4caf50');
    ctx.fillStyle = '#ffd23f'; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-14 + i * 6, -2); ctx.lineTo(-11 + i * 6, -5.5); ctx.lineTo(-8 + i * 6, -2); ctx.fill(); }
    ctx.fillStyle = '#8b5a2b'; rr(ctx, -4, -4, 8, 8, 2); ctx.fill();
    circ(17, -3.5, 1.8, '#fff'); circ(17, 3.5, 1.8, '#fff'); circ(17.6, -3.5, 0.9, '#222'); circ(17.6, 3.5, 0.9, '#222');
  } else if (kind === 'monster') {
    wheels([[-17, -17], [5, -17], [-17, 9], [5, 9]], 14, 8, '#111');
    ctx.fillStyle = '#ffd23f'; for (const [x, y] of [[-10, -13], [12, -13], [-10, 13], [12, 13]]) { ctx.fillRect(x - 1, y - 1, 2, 2); }
    ctx.fillStyle = '#16a34a'; rr(ctx, -16, -9, 32, 18, 5); ctx.fill();
    ctx.fillStyle = '#22c55e'; rr(ctx, -9, -7, 15, 14, 3); ctx.fill();
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.moveTo(-14, -6); ctx.lineTo(-6, 0); ctx.lineTo(-14, 6); ctx.fill();
    ctx.fillStyle = '#bfe9ff'; rr(ctx, 7, -6, 4, 12, 1); ctx.fill();
    ctx.fillStyle = '#fff6a0'; ctx.fillRect(15, -8, 2, 4); ctx.fillRect(15, 4, 2, 4);
  } else if (kind === 'bat') {
    wheels([[-12, -10], [6, -10], [-12, 7], [6, 7]], 9, 3);
    ctx.fillStyle = '#1b1d24'; ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(8, -7); ctx.lineTo(-10, -8); ctx.lineTo(-17, -12); ctx.lineTo(-14, -4); ctx.lineTo(-14, 4); ctx.lineTo(-17, 12); ctx.lineTo(-10, 8); ctx.lineTo(8, 7); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3b4252'; rr(ctx, -6, -4, 10, 8, 3); ctx.fill();
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.ellipse(10, 0, 4, 3, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#1b1d24'; ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(11, -2); ctx.lineTo(12, 0); ctx.lineTo(11, 2); ctx.fill();
    ctx.fillStyle = '#6fc3ff'; ctx.fillRect(-16, -2, 2, 4);
  } else if (kind === 'snowmobile') {
    ctx.fillStyle = '#9aa3ad'; ctx.fillRect(4, -10, 16, 3); ctx.fillRect(4, 7, 16, 3); ctx.fillRect(18, -10, 3, 20);
    ctx.fillStyle = '#2b2f35'; rr(ctx, -16, -5, 14, 10, 2); ctx.fill();
    ctx.fillStyle = '#2563eb'; rr(ctx, -10, -7, 22, 14, 6); ctx.fill();
    ctx.fillStyle = '#93c5fd'; rr(ctx, 6, -5, 4, 10, 2); ctx.fill();
    ctx.fillStyle = '#e8463c'; ctx.beginPath(); ctx.arc(-3, 0, 4.5, 0, 7); ctx.fill();
  } else if (kind === 'buggy') {
    wheels([[-13, -12], [5, -12], [-13, 7], [5, 7]], 9, 5);
    ctx.fillStyle = '#e8312b'; rr(ctx, -14, -7, 28, 14, 4); ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.strokeRect(-7, -6, 10, 12);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(6, -1.5, 6, 3); ctx.fillRect(7.5, -3, 3, 6);
  } else {
    wheels([[-11, -10], [5, -10], [-11, 7], [5, 7]], 8, 3);
    ctx.fillStyle = '#22d3ee'; rr(ctx, -14, -8, 28, 16, 4); ctx.fill();
    ctx.fillStyle = '#e0fbff'; rr(ctx, -4, -6, 9, 12, 2); ctx.fill();
    ctx.fillStyle = '#0e9fbf'; ctx.fillRect(-12, -6, 5, 12);
    ctx.fillStyle = '#fff6a0'; ctx.fillRect(12, -7, 2, 4); ctx.fillRect(12, 3, 2, 4);
  }
}
function shade(hex, f) { const n = parseInt(hex.slice(1), 16); const ch = s => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f))); return `rgb(${ch(16)},${ch(8)},${ch(0)})`; }
function drawEnemySkin(sk) {
  const c1 = sk.c1;
  if (sk.body === 'truck') {
    wheels([[-14, -20], [10, -20], [-14, 13], [10, 13]], 14, 8);
    ctx.fillStyle = c1; rr(ctx, -22, -13, 44, 26, 6); ctx.fill();
    ctx.fillStyle = sk.c2 || shade(c1, 1.25); rr(ctx, -12, -10, 22, 20, 4); ctx.fill();
    ctx.fillStyle = '#9fe3ff'; rr(ctx, 4, -9, 6, 18, 2); ctx.fill();
    ctx.fillStyle = '#ffe28a'; ctx.fillRect(19, -11, 3, 5); ctx.fillRect(19, 6, 3, 5);
  } else if (sk.body === 'tractor') {
    wheels([[-20, -20], [-20, 12]], 18, 8); wheels([[10, -15], [10, 11]], 10, 4);
    ctx.fillStyle = c1; rr(ctx, -16, -11, 38, 22, 5); ctx.fill();
    ctx.fillStyle = '#bfe9ff'; rr(ctx, -14, -8, 12, 16, 2); ctx.fill();
    ctx.fillStyle = '#555'; ctx.beginPath(); ctx.arc(10, -5, 3, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffd23f'; ctx.fillRect(18, -8, 3, 4); ctx.fillRect(18, 4, 3, 4);
  } else if (sk.body === 'cow') {
    wheels([[-15, -15], [9, -15], [-15, 11], [9, 11]], 10, 4);
    ctx.fillStyle = '#ffffff'; rr(ctx, -22, -12, 44, 24, 9); ctx.fill();
    circ(-10, -4, 5, '#222'); circ(4, 5, 6, '#222'); circ(-2, -8, 3, '#222'); circ(-16, 6, 3.5, '#222');
    ctx.fillStyle = '#ffb3c7'; rr(ctx, 16, -7, 8, 14, 4); ctx.fill(); circ(21, -3, 1.4, '#c2185b'); circ(21, 3, 1.4, '#c2185b');
  } else if (sk.body === 'gummy') {
    ctx.globalAlpha = 0.9; ctx.fillStyle = c1; ctx.beginPath(); ctx.ellipse(0, 0, 21, 15, 0, 0, 7); ctx.fill();
    circ(15, -11, 6, c1); circ(15, 11, 6, c1); ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.beginPath(); ctx.ellipse(-4, -6, 8, 4, 0, 0, 7); ctx.fill();
    circ(12, -4, 2, '#222'); circ(12, 4, 2, '#222');
  } else if (sk.body === 'plow') {
    wheels([[-14, -18], [8, -18], [-14, 11], [8, 11]], 12, 7);
    ctx.fillStyle = c1; rr(ctx, -20, -12, 36, 24, 5); ctx.fill();
    ctx.fillStyle = shade(c1, 0.8); rr(ctx, -6, -10, 14, 20, 3); ctx.fill();
    ctx.fillStyle = '#bfe9ff'; rr(ctx, 4, -8, 4, 16, 1); ctx.fill();
    ctx.fillStyle = '#9aa3ad'; ctx.beginPath(); ctx.moveTo(18, -18); ctx.lineTo(26, -10); ctx.lineTo(26, 10); ctx.lineTo(18, 18); ctx.lineTo(20, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff7a1a'; ctx.fillRect(-4, -3, 6, 6);
  } else if (sk.body === 'scarf') {
    wheels([[-15, -15], [9, -15], [-15, 11], [9, 11]], 10, 4);
    ctx.fillStyle = c1; rr(ctx, -22, -12, 44, 24, 9); ctx.fill();
    ctx.fillStyle = '#ffffff'; rr(ctx, -9, -10, 18, 20, 5); ctx.fill();
    for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? '#ffffff' : '#22a55e'; ctx.fillRect(-12 + i * 3, -13, 3, 26); }
    ctx.fillStyle = '#22a55e'; ctx.fillRect(-26, 6, 10, 4); ctx.fillRect(-26, -10, 10, 4);
    ctx.fillStyle = '#bfe9ff'; rr(ctx, 10, -9, 6, 18, 2); ctx.fill();
  } else if (sk.body === 'ginger') {
    wheels([[-14, -16], [8, -16], [-14, 12], [8, 12]], 10, 5, '#5a3418');
    ctx.fillStyle = c1; rr(ctx, -22, -13, 44, 26, 10); ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5; ctx.beginPath(); for (let i = 0; i < 7; i++) ctx.lineTo(-18 + i * 6, i % 2 ? -9 : -12); ctx.stroke(); ctx.beginPath(); for (let i = 0; i < 7; i++) ctx.lineTo(-18 + i * 6, i % 2 ? 9 : 12); ctx.stroke();
    circ(-6, 0, 3, '#e8463c'); circ(4, 0, 3, '#22a55e'); circ(14, 0, 3, '#3b82f6');
  } else if (sk.body === 'bus') {
    wheels([[-20, -15], [12, -15], [-20, 11], [12, 11]], 10, 4);
    ctx.fillStyle = c1; rr(ctx, -28, -13, 56, 26, 5); ctx.fill();
    ctx.fillStyle = '#bfe9ff'; for (let i = 0; i < 5; i++) { ctx.fillRect(-22 + i * 9, -11, 6, 4); ctx.fillRect(-22 + i * 9, 7, 6, 4); }
    ctx.fillRect(22, -10, 4, 20);
    ctx.fillStyle = shade(c1, 0.85); ctx.fillRect(-24, -4, 44, 8);
  } else if (sk.body === 'bubble') {
    wheels([[-14, -16], [8, -16], [-14, 12], [8, 12]], 10, 5, '#ffffff');
    ctx.fillStyle = c1; ctx.beginPath(); ctx.ellipse(0, 0, 23, 14, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.beginPath(); ctx.ellipse(-2, 0, 10, 9, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(14, -6, 2.5, 0, 7); ctx.arc(14, 6, 2.5, 0, 7); ctx.fill();
    ctx.fillStyle = shade(c1, 0.8); ctx.beginPath(); ctx.arc(-16, 0, 3, 0, 7); ctx.fill();
  } else if (sk.body === 'bumper') {
    ctx.fillStyle = '#2a2a2e'; ctx.beginPath(); ctx.arc(0, 0, 23, 0, 7); ctx.fill();
    ctx.fillStyle = c1; ctx.beginPath(); ctx.arc(0, 0, 19, 0, 7); ctx.fill();
    ctx.fillStyle = shade(c1, 0.75); rr(ctx, -10, -9, 14, 18, 5); ctx.fill();
    ctx.fillStyle = '#ffd9b3'; ctx.beginPath(); ctx.arc(-3, 0, 5, 0, 7); ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-24, 0); ctx.stroke();
  } else if (sk.body === 'buggy') {
    wheels([[-16, -19], [8, -19], [-16, 12], [8, 12]], 14, 7);
    ctx.fillStyle = c1; rr(ctx, -20, -11, 40, 22, 6); ctx.fill();
    ctx.strokeStyle = shade(c1, 0.6); ctx.lineWidth = 3; ctx.strokeRect(-10, -9, 16, 18);
    ctx.fillStyle = '#9fe3ff'; rr(ctx, 8, -8, 4, 16, 1); ctx.fill();
  } else { // sedan / taxi
    wheels([[-15, -15], [9, -15], [-15, 11], [9, 11]], 10, 4);
    ctx.fillStyle = c1; rr(ctx, -22, -12, 44, 24, 8); ctx.fill();
    ctx.fillStyle = shade(c1, 0.8); rr(ctx, -9, -10, 18, 20, 4); ctx.fill();
    ctx.fillStyle = '#bfe9ff'; rr(ctx, 9, -9, 6, 18, 2); ctx.fill(); rr(ctx, -15, -8, 4, 16, 2); ctx.fill();
    if (sk.body === 'taxi') { ctx.fillStyle = '#222'; for (let i = 0; i < 6; i++) ctx.fillRect(-21 + i * 7, i % 2 ? -12 : 9, 4, 3); ctx.fillStyle = '#fff'; rr(ctx, -4, -4, 7, 8, 2); ctx.fill(); }
    ctx.fillStyle = '#ffe28a'; ctx.fillRect(19, -10, 3, 5); ctx.fillRect(19, 5, 3, 5);
  }
}
function drawCar(c, blink) {
  if (blink) return;
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a);
  ctx.fillStyle = 'rgba(0,0,0,.18)'; rr(ctx, -c.r + 3, -c.r * 0.8 + 4, c.r * 2, c.r * 1.6, 6); ctx.fill();
  if (c.enemy) drawEnemySkin(c.skin || MAP.enemies[0]); else drawPlayerSkin(save.car);
  ctx.restore();
}

// ---------- obstacles & decor ----------
function shadowRect(o) { ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(o.x - o.w / 2 + 5, o.y - o.h / 2 + 6, o.w, o.h); }
function circ(x, y, r, col) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
function drawObstacle(o) {
  const L = o.x - (o.w || 0) / 2, T = o.y - (o.h || 0) / 2;
  switch (o.kind) {
    case 'tires': for (const [dx, dy] of [[-12, -10], [12, -10], [0, 10]]) { circ(o.x + dx, o.y + dy, 13, '#2a2a2e'); circ(o.x + dx, o.y + dy, 5, '#7a5a40'); } break;
    case 'crate': shadowRect(o); ctx.fillStyle = '#b5773e'; ctx.fillRect(L, T, o.w, o.h); ctx.strokeStyle = '#7d4d22'; ctx.lineWidth = 4; ctx.strokeRect(L + 2, T + 2, o.w - 4, o.h - 4); ctx.beginPath(); ctx.moveTo(L + 4, T + 4); ctx.lineTo(L + o.w - 4, T + o.h - 4); ctx.stroke(); break;
    case 'barrier': case 'roadblock': {
      shadowRect(o); ctx.fillStyle = o.kind === 'barrier' ? '#c9c4bb' : '#ffffff'; ctx.fillRect(L, T, o.w, o.h);
      ctx.fillStyle = o.kind === 'barrier' ? '#e04b3a' : '#ff7a1a'; const hor = o.w > o.h, n = Math.floor(Math.max(o.w, o.h) / 42);
      for (let i = 0; i < n; i++) hor ? ctx.fillRect(L + 12 + i * 42, T + 4, 18, o.h - 8) : ctx.fillRect(L + 4, T + 12 + i * 42, o.w - 8, 18);
      break; }
    case 'cone': circ(o.x + 2, o.y + 3, o.r, 'rgba(0,0,0,.18)'); ctx.fillStyle = '#ff7a1a'; ctx.fillRect(o.x - o.r, o.y - o.r, o.r * 2, o.r * 2); circ(o.x, o.y, o.r * 0.7, '#ff9d4d'); circ(o.x, o.y, o.r * 0.45, '#ffffff'); circ(o.x, o.y, o.r * 0.25, '#ff7a1a'); break;
    case 'parked': shadowRect(o); ctx.fillStyle = o.col; rr(ctx, L, T, o.w, o.h, 7); ctx.fill(); ctx.fillStyle = 'rgba(0,0,0,.18)'; o.w > o.h ? rr(ctx, o.x - 9, T + 3, 18, o.h - 6, 3) : rr(ctx, L + 3, o.y - 9, o.w - 6, 18, 3); ctx.fill(); break;
    case 'building': {
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(L + 10, T + 12, o.w, o.h);
      ctx.fillStyle = o.col; ctx.fillRect(L, T, o.w, o.h); ctx.fillStyle = shade(o.col, 0.85); ctx.fillRect(L + 12, T + 12, o.w - 24, o.h - 24);
      ctx.fillStyle = shade(o.col, 0.7); ctx.fillRect(L + o.w * 0.2, T + o.h * 0.2, 26, 20); ctx.fillRect(L + o.w * 0.6, T + o.h * 0.55, 30, 30);
      ctx.fillStyle = '#7fd0ff'; ctx.beginPath(); ctx.arc(L + o.w * 0.7, T + o.h * 0.3, 10, 0, 7); ctx.fill(); break; }
    case 'tree': circ(o.x + 5, o.y + 7, o.r, 'rgba(0,0,0,.2)'); circ(o.x, o.y, o.r, '#2f8f3a'); circ(o.x - 8, o.y - 8, o.r * 0.6, '#47b04f'); circ(o.x + 9, o.y + 4, o.r * 0.4, '#3da046'); break;
    case 'bench': shadowRect(o); ctx.fillStyle = '#9a6233'; ctx.fillRect(L, T, o.w, o.h); ctx.fillStyle = '#c4874b'; o.w > o.h ? (ctx.fillRect(L, T + 3, o.w, 4), ctx.fillRect(L, T + 11, o.w, 4)) : (ctx.fillRect(L + 3, T, 4, o.h), ctx.fillRect(L + 11, T, 4, o.h)); break;
    case 'picnic': shadowRect(o); ctx.fillStyle = '#c4874b'; ctx.fillRect(L, T, o.w, 10); ctx.fillRect(L, T + o.h - 10, o.w, 10); ctx.fillStyle = '#e04b3a'; ctx.fillRect(L + 4, T + 14, o.w - 8, o.h - 28); ctx.fillStyle = '#ffffff'; for (let i = 0; i < 4; i++) ctx.fillRect(L + 4 + i * 15, T + 14, 7, o.h - 28); break;
    case 'fountain': circ(o.x, o.y, o.r, '#b8b8c0'); circ(o.x, o.y, o.r - 8, '#5cc8ff'); circ(o.x, o.y, 12, '#d9d9e0'); circ(o.x, o.y, 5 + Math.sin(S.t * 6) * 2, '#ffffff'); break;
    case 'pond': case 'pool': circ(o.x, o.y, o.r + 6, o.kind === 'pond' ? '#5a9e3f' : '#e8c27f'); circ(o.x, o.y, o.r, o.kind === 'pond' ? '#4aa8e0' : '#3fb8e0'); circ(o.x - o.r * 0.3, o.y - o.r * 0.3, o.r * 0.25, 'rgba(255,255,255,.35)');
      if (o.kind === 'pond') { circ(o.x + o.r * 0.3, o.y + o.r * 0.2, 12, '#3da046'); circ(o.x + o.r * 0.1, o.y + o.r * 0.45, 9, '#3da046'); } break;
    case 'hay': circ(o.x + 3, o.y + 4, o.r, 'rgba(0,0,0,.18)'); circ(o.x, o.y, o.r, '#e8c04a'); ctx.strokeStyle = '#c99a2a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(o.x, o.y, o.r * 0.6, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(o.x, o.y, o.r * 0.25, 0, 7); ctx.stroke(); break;
    case 'fence': ctx.fillStyle = '#ffffff'; ctx.fillRect(L, T + (o.w > o.h ? 4 : 0), o.w > o.h ? o.w : 0, 0);
      { const hor = o.w > o.h, n = 6; ctx.fillStyle = '#ffffff'; hor ? ctx.fillRect(L, o.y - 2, o.w, 4) : ctx.fillRect(o.x - 2, T, 4, o.h);
        ctx.fillStyle = '#e0c9ff'; for (let i = 0; i <= n; i++) hor ? ctx.fillRect(L + i * (o.w - 10) / n, T, 10, o.h) : ctx.fillRect(L, T + i * (o.h - 10) / n, o.w, 10); }
      break;
    case 'mushroom': circ(o.x + 2, o.y + 3, o.r, 'rgba(0,0,0,.18)'); circ(o.x, o.y, o.r, '#ff4f6b'); circ(o.x - 7, o.y - 5, 4, '#fff'); circ(o.x + 6, o.y - 2, 3.5, '#fff'); circ(o.x - 1, o.y + 8, 3, '#fff'); break;
    case 'slide': shadowRect(o); ctx.fillStyle = '#ffd23f'; rr(ctx, L, T, o.w, o.h, 8); ctx.fill(); ctx.fillStyle = '#ff5d5d'; o.h > o.w ? ctx.fillRect(L + 8, T, o.w - 16, o.h * 0.7) : ctx.fillRect(L, T + 8, o.w * 0.7, o.h - 16); ctx.fillStyle = '#5d9bd6'; o.h > o.w ? ctx.fillRect(L, T + o.h - 24, o.w, 24) : ctx.fillRect(L + o.w - 24, T, 24, o.h); break;
    case 'swings': ctx.fillStyle = '#5d9bd6'; ctx.fillRect(L, T, 10, o.h); ctx.fillRect(L + o.w - 10, T, 10, o.h); ctx.fillRect(L, o.y - 3, o.w, 6); ctx.fillStyle = '#ff5d5d'; ctx.fillRect(L + 30, o.y - 6, 22, 12); ctx.fillStyle = '#7ddc5a'; ctx.fillRect(L + 88, o.y - 6, 22, 12); break;
    case 'climber': shadowRect(o); ctx.strokeStyle = '#ff7a1a'; ctx.lineWidth = 6; ctx.strokeRect(L + 3, T + 3, o.w - 6, o.h - 6); ctx.lineWidth = 4; ctx.strokeStyle = '#ffd23f'; for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(L + i * o.w / 4, T + 3); ctx.lineTo(L + i * o.w / 4, T + o.h - 3); ctx.moveTo(L + 3, T + i * o.h / 4); ctx.lineTo(L + o.w - 3, T + i * o.h / 4); ctx.stroke(); } break;
    case 'spring': circ(o.x + 2, o.y + 3, o.r, 'rgba(0,0,0,.18)'); circ(o.x, o.y, o.r, '#7ddc5a'); circ(o.x, o.y, o.r * 0.55, '#ffffff'); circ(o.x + 4, o.y, 3, '#2a2a2e'); break;
    case 'iceblock': shadowRect(o); ctx.fillStyle = '#bfe8ff'; rr(ctx, L, T, o.w, o.h, 6); ctx.fill(); ctx.fillStyle = '#e6f7ff'; rr(ctx, L + 6, T + 6, o.w * 0.45, o.h * 0.3, 4); ctx.fill(); ctx.strokeStyle = '#8cc8ec'; ctx.lineWidth = 2; rr(ctx, L, T, o.w, o.h, 6); ctx.stroke(); break;
    case 'snowman': circ(o.x + 3, o.y + 4, o.r, 'rgba(60,90,130,.18)'); circ(o.x, o.y, o.r, '#ffffff'); circ(o.x, o.y, o.r * 0.6, '#f4f8fc'); circ(o.x - 4, o.y - 3, 2.2, '#222'); circ(o.x + 4, o.y - 3, 2.2, '#222'); ctx.fillStyle = '#ff8a1f'; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + 10, o.y + 2); ctx.lineTo(o.x, o.y + 4); ctx.fill(); ctx.fillStyle = '#e8463c'; ctx.fillRect(o.x - o.r * 0.7, o.y + o.r * 0.45, o.r * 1.4, 5); break;
    case 'gift': shadowRect(o); ctx.fillStyle = o.col; ctx.fillRect(L, T, o.w, o.h); ctx.fillStyle = '#ffd23f'; ctx.fillRect(o.x - 4, T, 8, o.h); ctx.fillRect(L, o.y - 4, o.w, 8); circ(o.x - 6, o.y - 6, 6, '#ffd23f'); circ(o.x + 6, o.y - 6, 6, '#ffd23f'); break;
    case 'pine': circ(o.x + 4, o.y + 6, o.r, 'rgba(60,90,130,.2)'); ctx.fillStyle = '#1f7a4a'; ctx.beginPath(); for (let i = 0; i < 16; i++) { const an = i / 16 * Math.PI * 2, rr2 = i % 2 ? o.r * 0.6 : o.r; ctx.lineTo(o.x + Math.cos(an) * rr2, o.y + Math.sin(an) * rr2); } ctx.fill(); circ(o.x, o.y, o.r * 0.45, '#2e9a5e'); circ(o.x - 5, o.y - 5, 4, '#ffffff'); circ(o.x + 6, o.y + 3, 3, '#ffffff'); break;
    case 'igloo': circ(o.x + 4, o.y + 5, o.r, 'rgba(60,90,130,.18)'); circ(o.x, o.y, o.r, '#ffffff'); ctx.strokeStyle = '#cfe4f3'; ctx.lineWidth = 2; for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.arc(o.x, o.y, o.r * i / 3, 0, 7); ctx.stroke(); } ctx.fillStyle = '#7fa8c9'; rr(ctx, o.x + o.r - 6, o.y - 9, 14, 18, 6); ctx.fill(); break;
    case 'icepond': circ(o.x, o.y, o.r + 6, '#ffffff'); circ(o.x, o.y, o.r, '#9fd6f5'); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(o.x - o.r * 0.5, o.y - o.r * 0.2); ctx.lineTo(o.x - o.r * 0.1, o.y - o.r * 0.4); ctx.moveTo(o.x + o.r * 0.1, o.y + o.r * 0.3); ctx.lineTo(o.x + o.r * 0.5, o.y + o.r * 0.1); ctx.stroke(); break;
    case 'barn': shadowRect(o); ctx.fillStyle = '#c0392b'; ctx.fillRect(L, T, o.w, o.h); ctx.fillStyle = '#8e2a20'; ctx.fillRect(L, o.y - 4, o.w, 8); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.strokeRect(L + 3, T + 3, o.w - 6, o.h - 6); ctx.beginPath(); ctx.moveTo(L + 3, T + 3); ctx.lineTo(L + o.w - 3, T + o.h - 3); ctx.moveTo(L + o.w - 3, T + 3); ctx.lineTo(L + 3, T + o.h - 3); ctx.stroke(); break;
    case 'silo': circ(o.x + 4, o.y + 6, o.r, 'rgba(0,0,0,.2)'); circ(o.x, o.y, o.r, '#b8c4cc'); circ(o.x, o.y, o.r * 0.7, '#d4dde3'); circ(o.x, o.y, o.r * 0.3, '#9aa7b0'); break;
    case 'strawbale': shadowRect(o); ctx.fillStyle = '#f2c94c'; rr(ctx, L, T, o.w, o.h, 6); ctx.fill(); ctx.fillStyle = '#c99a2a'; o.w > o.h ? (ctx.fillRect(L + o.w * 0.3, T, 3, o.h), ctx.fillRect(L + o.w * 0.7, T, 3, o.h)) : (ctx.fillRect(L, T + o.h * 0.3, o.w, 3), ctx.fillRect(L, T + o.h * 0.7, o.w, 3)); break;
    case 'trough': shadowRect(o); ctx.fillStyle = '#8b5a2b'; ctx.fillRect(L, T, o.w, o.h); ctx.fillStyle = '#5cc8ff'; ctx.fillRect(L + 5, T + 5, o.w - 10, o.h - 10); break;
    case 'lollipop': circ(o.x + 3, o.y + 4, o.r, 'rgba(0,0,0,.15)'); circ(o.x, o.y, o.r, o.col); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.beginPath(); for (let a = 0; a < 12; a += 0.3) ctx.lineTo(o.x + Math.cos(a) * a * 1.8, o.y + Math.sin(a) * a * 1.8); ctx.stroke(); break;
    case 'gumdrop': circ(o.x + 3, o.y + 4, o.r, 'rgba(0,0,0,.15)'); circ(o.x, o.y, o.r, o.col); circ(o.x - 6, o.y - 6, o.r * 0.35, 'rgba(255,255,255,.6)'); for (let i = 0; i < 6; i++) circ(o.x + Math.cos(i) * o.r * 0.6, o.y + Math.sin(i * 2) * o.r * 0.6, 1.8, '#ffffff'); break;
    case 'candycane': shadowRect(o); ctx.fillStyle = '#ffffff'; rr(ctx, L, T, o.w, o.h, 9); ctx.fill(); ctx.fillStyle = '#e8463c'; { const hor = o.w > o.h; for (let i = 0; i < 7; i++) hor ? ctx.fillRect(L + 6 + i * 14, T, 7, o.h) : ctx.fillRect(L, T + 6 + i * 14, o.w, 7); } break;
    case 'cupcake': circ(o.x + 3, o.y + 4, o.r, 'rgba(0,0,0,.15)'); circ(o.x, o.y, o.r, '#c98a4b'); circ(o.x, o.y, o.r * 0.8, '#ffb3d1'); circ(o.x, o.y, o.r * 0.45, '#ffd6ec'); circ(o.x, o.y, 6, '#e8463c'); break;
    case 'castle': circ(o.x + 3, o.y + 3, o.r, 'rgba(0,0,0,.15)'); ctx.fillStyle = '#e0b46a'; ctx.fillRect(o.x - o.r, o.y - o.r, o.r * 2, o.r * 2); ctx.fillStyle = '#c99a50'; for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.fillRect(o.x + dx * o.r * 0.7 - 6, o.y + dy * o.r * 0.7 - 6, 12, 12); } ctx.fillStyle = '#ff5d5d'; ctx.fillRect(o.x - 1, o.y - 10, 2, 10); ctx.beginPath(); ctx.moveTo(o.x + 1, o.y - 10); ctx.lineTo(o.x + 9, o.y - 7); ctx.lineTo(o.x + 1, o.y - 4); ctx.fill(); break;
    case 'umbrella': { circ(o.x + 6, o.y + 8, o.r, 'rgba(0,0,0,.15)'); const cols = ['#ff5d5d', '#ffffff']; for (let i = 0; i < 8; i++) { ctx.fillStyle = cols[i % 2]; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.arc(o.x, o.y, o.r, i * Math.PI / 4, (i + 1) * Math.PI / 4); ctx.fill(); } circ(o.x, o.y, 4, '#8a5a2b'); break; }
    case 'rock': circ(o.x + 3, o.y + 4, o.r, 'rgba(0,0,0,.18)'); circ(o.x, o.y, o.r, '#8d8f99'); circ(o.x - 6, o.y - 7, o.r * 0.5, '#a9abb5'); break;
  }
}
function drawDecor(d) {
  switch (d.k) {
    case 'plateau': ctx.fillStyle = '#c47538'; ctx.beginPath(); d.pts.forEach(([x, y], i) => i ? ctx.lineTo(x + 6, y + 8) : ctx.moveTo(x + 6, y + 8)); ctx.fill(); ctx.fillStyle = '#e8a868'; ctx.beginPath(); d.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.fill(); break;
    case 'crater': ctx.fillStyle = '#c97a3e'; ctx.beginPath(); ctx.ellipse(d.x, d.y, d.r, d.r * 0.8, 0, 0, 7); ctx.fill(); ctx.fillStyle = '#e39a5c'; ctx.beginPath(); ctx.ellipse(d.x + 3, d.y + 3, d.r * 0.75, d.r * 0.6, 0, 0, 7); ctx.fill(); break;
    case 'sidewalk': ctx.fillStyle = '#b9bcc2'; ctx.fillRect(d.x - 150, d.y - 150, 300, 300); ctx.fillStyle = '#a7aab0'; for (let i = 0; i < 6; i++) { ctx.fillRect(d.x - 150 + i * 50, d.y - 150, 2, 300); ctx.fillRect(d.x - 150, d.y - 150 + i * 50, 300, 2); } break;
    case 'plaza': ctx.fillStyle = '#b9bcc2'; ctx.fillRect(d.x - 150, d.y - 150, 300, 300); ctx.fillStyle = '#7cc35a'; ctx.fillRect(d.x - 130, d.y - 130, 260, 260); circ(d.x - 70, d.y - 70, 22, '#47b04f'); circ(d.x + 70, d.y + 60, 26, '#47b04f'); circ(d.x + 60, d.y - 80, 18, '#47b04f'); break;
    case 'manhole': circ(d.x, d.y, 11, '#3d4249'); ctx.strokeStyle = '#6b7079'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(d.x, d.y, 7, 0, 7); ctx.stroke(); break;
    case 'hydrant': circ(d.x, d.y, 7, '#e04b3a'); circ(d.x, d.y, 3, '#ffd23f'); break;
    case 'path': ctx.strokeStyle = '#e8d29a'; ctx.lineWidth = 46; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(d.x - Math.cos(d.a) * d.len / 2, d.y - Math.sin(d.a) * d.len / 2); ctx.quadraticCurveTo(d.x + 80, d.y - 80, d.x + Math.cos(d.a) * d.len / 2, d.y + Math.sin(d.a) * d.len / 2); ctx.stroke(); break;
    case 'flowers': for (let i = 0; i < 5; i++) circ(d.x + Math.cos(i * 1.3) * 10, d.y + Math.sin(i * 1.7) * 10, 3.5, d.c); circ(d.x, d.y, 2.5, '#ffd23f'); break;
    case 'hill': ctx.fillStyle = '#a6ea84'; ctx.beginPath(); ctx.ellipse(d.x, d.y, d.r, d.r * 0.6, 0, 0, 7); ctx.fill(); ctx.fillStyle = '#b6f096'; ctx.beginPath(); ctx.ellipse(d.x - d.r * 0.2, d.y - d.r * 0.15, d.r * 0.5, d.r * 0.3, 0, 0, 7); ctx.fill(); break;
    case 'rainbow': { const cols = ['#ff6f6f', '#ffb03b', '#fff36b', '#6fdc8c', '#6fc3ff', '#b07cff']; ctx.lineWidth = 9; ctx.globalAlpha = 0.55; cols.forEach((c, i) => { ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(d.x, d.y, d.r - i * 9, Math.PI, 0); ctx.stroke(); }); ctx.globalAlpha = 1; break; }
    case 'cloud': ctx.globalAlpha = 0.55; circ(d.x, d.y, d.r * 0.6, '#fff'); circ(d.x + d.r * 0.5, d.y + 5, d.r * 0.45, '#fff'); circ(d.x - d.r * 0.5, d.y + 8, d.r * 0.4, '#fff'); ctx.globalAlpha = 1; break;
    case 'sandbox': ctx.fillStyle = '#9a6233'; ctx.fillRect(d.x - d.r, d.y - d.r, d.r * 2, d.r * 2); ctx.fillStyle = '#f2d49b'; ctx.fillRect(d.x - d.r + 8, d.y - d.r + 8, d.r * 2 - 16, d.r * 2 - 16); circ(d.x + 10, d.y - 5, 8, '#ff5d5d'); break;
    case 'merry': circ(d.x, d.y, d.r, '#5d9bd6'); for (let i = 0; i < 4; i++) { ctx.fillStyle = ['#ff5d5d', '#ffd23f', '#7ddc5a', '#ffffff'][i]; ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.arc(d.x, d.y, d.r - 6, i * Math.PI / 2 + S.t, (i + 1) * Math.PI / 2 + S.t); ctx.fill(); } circ(d.x, d.y, 8, '#2a2a2e'); break;
    case 'hopscotch': ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.a); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; for (let i = 0; i < 5; i++) ctx.strokeRect(-90 + i * 36, -18, 36, 36); ctx.restore(); break;
    case 'ring': ctx.strokeStyle = d.c; ctx.lineWidth = 6; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; break;
    case 'towel': ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.a); ctx.fillStyle = d.c; ctx.fillRect(-40, -20, 80, 40); ctx.fillStyle = '#ffffff'; ctx.fillRect(-40, -6, 80, 6); ctx.restore(); break;
    case 'snowbank': ctx.fillStyle = '#d6e9f5'; ctx.beginPath(); ctx.ellipse(d.x + 6, d.y + 8, d.r, d.r * 0.55, 0, 0, 7); ctx.fill(); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(d.x, d.y, d.r, d.r * 0.55, 0, 0, 7); ctx.fill(); break;
    case 'sparkle': circ(d.x, d.y, 2.5, '#bfe3ff'); break;
    case 'crops': ctx.fillStyle = '#b9a35e'; ctx.fillRect(d.x - d.w / 2, d.y - d.h / 2, d.w, d.h); ctx.fillStyle = '#6aa84f'; for (let y = d.y - d.h / 2 + 10; y < d.y + d.h / 2; y += 22) ctx.fillRect(d.x - d.w / 2 + 8, y, d.w - 16, 8); break;
    case 'mud': ctx.fillStyle = '#8a6a3b'; ctx.beginPath(); ctx.ellipse(d.x, d.y, d.r, d.r * 0.6, 0, 0, 7); ctx.fill(); break;
    case 'chick': circ(d.x, d.y, 6, '#fff3a0'); circ(d.x + 5, d.y, 2, '#ff9d1c'); break;
    case 'choc': ctx.fillStyle = '#7b4a2a'; ctx.beginPath(); ctx.ellipse(d.x, d.y, d.r, d.r * 0.7, 0, 0, 7); ctx.fill(); circ(d.x - d.r * 0.3, d.y - d.r * 0.2, d.r * 0.2, '#9a6440'); break;
    case 'sprinkle': ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.a); ctx.fillStyle = d.c; ctx.fillRect(-5, -1.5, 10, 3); ctx.restore(); break;
    case 'shell': circ(d.x, d.y, 6, '#ffd1dc'); break;
    case 'star': ctx.save(); ctx.translate(d.x, d.y); star(0, 0, 9, '#ff8c42'); ctx.restore(); break;
  }
}
const FLAKES = Array.from({ length: 70 }, (_, i) => ({ x: (i * 137.5) % 1, y: (i * 61.8) % 1, r: 1.5 + (i % 4), s: 18 + (i % 5) * 9 }));
function drawSnow(dt) {
  if (MAP.id !== 'winter') return;
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  for (const f of FLAKES) {
    f.y += f.s * dt / Math.max(1, H); f.x += Math.sin(S.t + f.r) * 0.0004; if (f.y > 1) { f.y -= 1; } if (f.x > 1) f.x -= 1; if (f.x < 0) f.x += 1;
    ctx.beginPath(); ctx.arc(f.x * W, f.y * H, f.r, 0, 7); ctx.fill();
  }
}
function drawGround(p) {
  const vr = viewRadius() + 60;
  ctx.fillStyle = MAP.ground; ctx.fillRect(0, 0, WORLD, WORLD);
  if (MAP.id === 'city') { // street markings on the 400px grid
    ctx.fillStyle = '#f4e27a'; for (let k = 400; k < WORLD; k += 400) for (let s = 0; s < WORLD; s += 60) { if (Math.abs(s - p.y) < vr) ctx.fillRect(k - 2, s, 4, 30); if (Math.abs(s - p.x) < vr) ctx.fillRect(s, k - 2, 30, 4); }
    ctx.fillStyle = '#ffffff'; for (let i = 400; i < WORLD; i += 400) for (let j = 400; j < WORLD; j += 400) { if (Math.hypot(i - p.x, j - p.y) > vr + 100) continue; for (let s = 0; s < 6; s++) { ctx.fillRect(i - 60 + s * 22, j - 70, 12, 22); ctx.fillRect(i - 60 + s * 22, j + 48, 12, 22); ctx.fillRect(i - 70, j - 60 + s * 22, 22, 12); ctx.fillRect(i + 48, j - 60 + s * 22, 22, 12); } }
  }
  if (MAP.id === 'playground') { ctx.fillStyle = 'rgba(255,255,255,.08)'; for (let i = 0; i < 400; i++) { const x = (i * 977) % WORLD, y = (i * 571) % WORLD; if (Math.abs(x - p.x) < vr && Math.abs(y - p.y) < vr) ctx.fillRect(x, y, 6, 6); } }
  for (const d of S.decor) if (Math.abs(d.x - p.x) < vr + (d.rad || 60) && Math.abs(d.y - p.y) < vr + (d.rad || 60)) drawDecor(d);
}

function startLevel() {
  S.state = 'play'; S.kills = 0; S.hits = 0; S.redFlash = 0; S.bumpT = 0; S.wallCd = 0; S.goal = S.mode === 'survival' ? Infinity : goalFor(S.level); S.hp = HP_MAX; S.levelCoins = 0;
  S.enemies = []; S.parts = []; S.debris = []; S.coinsOnGround = []; S.spawnT = 1.2; S.iframes = 1.5; S.flash = 0;
  zones.clear(); steerCur = 0; nudgeT = 0;
  S.player = makeCar(WORLD / 2, WORLD / 2, -Math.PI / 2, false);
  if (save.car === 'monster') { S.player.r = 18; S.player.speed = 258; }  // hulking: wider, a bit slower
  S.player.speed *= 1 + SPEED_PER_LV * save.up.speed;                           // Speed upgrade
  S.hpMax = HP_MAX + TOUGH_PER_LV * save.up.tough; S.hp = S.hpMax;              // Toughness upgrade: bigger bar
  S.maxHits = Math.ceil(S.hpMax / TRUCK_DMG);                                   // Lv0: 3 hits; each +7 health = one more hit
  tctx.clearRect(0, 0, trackCv.width, trackCv.height);
  buildLevel();
}

// ---------- spawning ----------
function viewRadius() { return Math.hypot(W, H) / 2 / ZOOM; }
function spawnEnemy(x, y) {
  const p = S.player;
  if (x === undefined) {
    // pick an off-screen point that is inside the arena (near walls, some directions are out of bounds)
    const d = viewRadius() + 80;
    for (let i = 0; i < 24; i++) {
      const an = Math.random() * Math.PI * 2;
      x = p.x + Math.cos(an) * d; y = p.y + Math.sin(an) * d;
      if (x > 40 && x < WORLD - 40 && y > 40 && y < WORLD - 40) break;
    }
    x = Math.max(40, Math.min(WORLD - 40, x)); y = Math.max(40, Math.min(WORLD - 40, y));
  }
  const e = makeCar(x, y, Math.atan2(p.y - y, p.x - x), true);
  const sp = survParams();
  e.speed = 270 * (S.mode === 'survival' ? sp.speed : Math.min(0.92, 0.78 + S.level * 0.015)) * MAP.speed;
  e.skin = MAP.enemies[Math.floor(Math.random() * MAP.enemies.length)];
  e.turn = S.mode === 'survival' ? sp.turn : Math.min(2.3, 1.6 + S.level * 0.05);
  e.vx = Math.cos(e.a) * e.speed * 0.6; e.vy = Math.sin(e.a) * e.speed * 0.6;
  S.enemies.push(e); S.stats.spawns++;
  return e;
}

// ---------- physics ----------
function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
function driveCar(c, steer, dt) {
  c.a += steer * c.turn * dt;
  const tx = Math.cos(c.a) * c.speed, ty = Math.sin(c.a) * c.speed, k = Math.min(1, c.grip * (MAP.grip || 1) * dt);
  c.vx += (tx - c.vx) * k; c.vy += (ty - c.vy) * k;
  c.x += c.vx * dt; c.y += c.vy * dt;
  // arena walls: bounce
  const m = c.r; let wallHit = 0;
  if (c.x < m) { wallHit = Math.max(wallHit, -c.vx); c.x = m; c.vx = Math.abs(c.vx) * 0.5; } if (c.x > WORLD - m) { wallHit = Math.max(wallHit, c.vx); c.x = WORLD - m; c.vx = -Math.abs(c.vx) * 0.5; }
  if (c.y < m) { wallHit = Math.max(wallHit, -c.vy); c.y = m; c.vy = Math.abs(c.vy) * 0.5; } if (c.y > WORLD - m) { wallHit = Math.max(wallHit, c.vy); c.y = WORLD - m; c.vy = -Math.abs(c.vy) * 0.5; }
  if (!c.enemy && wallHit > BUMP_MIN_SPEED) bump(S, 'wallCd');
  for (const o of S.obstacles) collideObstacle(c, o);
  drawTracks(c);
}
function collideObstacle(c, o) {
  let nx, ny, d;
  if (o.shape === 'c') {
    const dx = c.x - o.x, dy = c.y - o.y; d = Math.hypot(dx, dy); const min = c.r + o.r;
    if (d >= min || d === 0) return; nx = dx / d; ny = dy / d; c.x = o.x + nx * min; c.y = o.y + ny * min;
  } else {
    const qx = Math.max(o.x - o.w / 2, Math.min(c.x, o.x + o.w / 2)), qy = Math.max(o.y - o.h / 2, Math.min(c.y, o.y + o.h / 2));
    const dx = c.x - qx, dy = c.y - qy; d = Math.hypot(dx, dy);
    if (d >= c.r) return;
    if (d === 0) { nx = 0; ny = c.y < o.y ? -1 : 1; } else { nx = dx / d; ny = dy / d; }
    c.x = qx + nx * c.r; c.y = qy + ny * c.r;
  }
  const vn = c.vx * nx + c.vy * ny;
  if (vn < 0) {
    c.vx -= 1.6 * vn * nx; c.vy -= 1.6 * vn * ny;
    if (!c.enemy && vn < -BUMP_MIN_SPEED) { c.vx += nx * 60; c.vy += ny * 60; bump(o, 'cd'); }
  }
}
// Obstacle/wall bump: small wear on the bar, never a car hit. Rate-limited per obstacle and globally.
function bump(holder, key) {
  if (S.state !== 'play') return;
  if ((holder[key] || 0) > S.t || S.bumpT > S.t) return;
  holder[key] = S.t + BUMP_CD; S.bumpT = S.t + BUMP_GLOBAL_CD;
  S.hp = Math.max(1, S.hp - BUMP_DMG); S.stats.bumps++; S.shake = Math.max(S.shake, 4);
  beep(110, 0.08, 'triangle', 0.14);
  for (let i = 0; i < 4; i++) { const an = Math.random() * 6.28; S.parts.push({ x: S.player.x, y: S.player.y, vx: Math.cos(an) * 60, vy: Math.sin(an) * 60, r: 5, life: 0.35, max: 0.5, confetti: '#f4d9b0' }); }
}
function gameOver(why) {
  S.state = 'over'; S.overT = 0; S.overWhy = why; S.shake = 12;
  explode(S.player.x, S.player.y, false);
  if (S.mode === 'survival') { S.survNewBest = S.wave > save.surv.bestWaves || (S.wave === save.surv.bestWaves && Math.floor(S.survT) > save.surv.bestTime);
    save.surv.bestWaves = Math.max(save.surv.bestWaves, S.wave); save.surv.bestTime = Math.max(save.surv.bestTime, Math.floor(S.survT)); }
  save.coins = S.coins; persist();
  beep(392, 0.18, 'triangle', 0.18); setTimeout(() => beep(330, 0.18, 'triangle', 0.18), 170); setTimeout(() => beep(262, 0.35, 'triangle', 0.18), 340);
}
function drawTracks(c) {
  const ca = Math.cos(c.a), sa = Math.sin(c.a), back = c.r * 0.7, side = c.r * (c.enemy ? 0.75 : 0.6);
  const L = [c.x - ca * back - sa * side, c.y - sa * back + ca * side], R = [c.x - ca * back + sa * side, c.y - sa * back - ca * side];
  if (c.lastL && Math.hypot(L[0] - c.lastL[0], L[1] - c.lastL[1]) > 4) {
    const slip = Math.abs(angDiff(c.a, Math.atan2(c.vy, c.vx)));
    tctx.strokeStyle = `rgba(${MAP.track},${Math.min(0.34, 0.13 + slip * 0.35)})`;
    tctx.lineWidth = (c.enemy ? 7 : 4) * TRACK_SCALE; tctx.lineCap = 'round';
    tctx.beginPath();
    tctx.moveTo(c.lastL[0] * TRACK_SCALE, c.lastL[1] * TRACK_SCALE); tctx.lineTo(L[0] * TRACK_SCALE, L[1] * TRACK_SCALE);
    tctx.moveTo(c.lastR[0] * TRACK_SCALE, c.lastR[1] * TRACK_SCALE); tctx.lineTo(R[0] * TRACK_SCALE, R[1] * TRACK_SCALE);
    tctx.stroke(); S.stats.trackSegs++;
    c.lastL = L; c.lastR = R;
  } else if (!c.lastL) { c.lastL = L; c.lastR = R; }
}

function explode(x, y, big, col) {
  S.stats.explosions++; S.shake = Math.max(S.shake, 8); boom();
  for (let i = 0; i < (big ? 14 : 9); i++) {
    const an = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 90;
    S.parts.push({ x, y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, r: 14 + Math.random() * 18, life: 0.7 + Math.random() * 0.4, max: 1.1 });
  }
  for (let i = 0; i < 4; i++) {
    const an = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 160;
    S.debris.push({ x, y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, a: Math.random() * 6, va: (Math.random() - 0.5) * 14, kind: i < 3 ? 'tire' : 'chassis', col: col || '#1e5aa8', life: 2.5 });
  }
}
function dropCoin(x, y) { S.coinsOnGround.push({ x: x + (Math.random() - 0.5) * 30, y: y + (Math.random() - 0.5) * 30, t: 0 }); }

function update(dt) {
  S.t += dt;
  if (S.msgT > 0) S.msgT -= dt;
  S.shake = Math.max(0, S.shake - dt * 30);
  for (const p of S.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; p.life -= dt; }
  S.parts = S.parts.filter(p => p.life > 0);
  for (const d of S.debris) { d.x += d.vx * dt; d.y += d.vy * dt; d.vx *= 0.93; d.vy *= 0.93; d.a += d.va * dt; d.va *= 0.95; d.life -= dt; }
  S.debris = S.debris.filter(d => d.life > 0);
  if (S.flash > 0) S.flash = Math.max(0, S.flash - dt * 1.6);
  if (S.redFlash > 0) S.redFlash = Math.max(0, S.redFlash - dt * 1.5);
  updateVoice(dt);

  if (S.state === 'celebrate') {
    driveCar(S.player, 0, dt);
    S.clearT += dt;
    if (S.clearT > 1.6) { S.state = 'clear'; S.clearT = 0; S.tally = 0; beep(523, 0.15, 'triangle', 0.2); setTimeout(() => beep(784, 0.25, 'triangle', 0.2), 150); }
    return;
  }
  if (S.state === 'shop' || S.state === 'home' || S.state === 'upg' || S.state === 'collect') { S.mapsT = (S.mapsT || 0) + dt; return; }
  if (S.state === 'over') { S.overT += dt; return; }
  if (S.state === 'clear') { S.clearT += dt; S.tally = Math.min(S.levelCoins + bonus(), S.tally + dt * 30); return; }
  if (S.state !== 'play') return;

  const p = S.player;
  driveCar(p, steerInput(dt), dt);
  if (S.iframes > 0) S.iframes -= dt;

  // spawn
  S.spawnT -= dt;
  const sp = survParams(), surv = S.mode === 'survival';
  const maxE = surv ? sp.maxE : Math.min(9, 3 + Math.floor(S.level / 2));
  if (S.spawnT <= 0) {
    if (S.enemies.length < maxE) spawnEnemy();
    S.spawnT = surv ? sp.interval : Math.max(0.9, 2.2 - S.level * 0.08);
  }
  // enemies: blindly chase
  for (const e of S.enemies) {
    const want = Math.atan2(p.y - e.y, p.x - e.x), d = angDiff(e.a, want);
    driveCar(e, Math.max(-1, Math.min(1, d * 2.5)), dt);
  }
  // enemy-enemy
  const dead = new Set();
  for (let i = 0; i < S.enemies.length; i++) for (let j = i + 1; j < S.enemies.length; j++) {
    const a = S.enemies[i], b = S.enemies[j];
    if (dead.has(a) || dead.has(b)) continue;
    if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r - 6) {
      dead.add(a); dead.add(b);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      explode(mx, my, true, (a.skin || MAP.enemies[0]).c1);
      if (Math.random() < 0.6) dropCoin(mx, my);
    }
  }
  if (dead.size) {
    S.enemies = S.enemies.filter(e => !dead.has(e));
    S.kills = S.mode === 'survival' ? S.kills + dead.size : Math.min(S.goal, S.kills + dead.size);
    beep(660, 0.1, 'square', 0.1); setTimeout(() => beep(880, 0.12, 'square', 0.1), 80);
  }
  // enemy-player
  for (const e of S.enemies) {
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
    if (d < p.r + e.r - 4) {
      const nx = dx / d, ny = dy / d;
      e.vx -= nx * 260; e.vy -= ny * 260; e.x -= nx * 6; e.y -= ny * 6;
      if (S.iframes <= 0) {
        S.hits++; S.iframes = CAR_IFRAMES; S.stats.hits++; S.shake = 14; S.redFlash = 0.7;
        S.hp = S.hits >= S.maxHits ? 0 : Math.max(1, S.hp - TRUCK_DMG);
        p.vx += nx * 220; p.vy += ny * 220;
        beep(200, 0.25, 'sawtooth', 0.15, -120);
        if (S.hits >= S.maxHits || S.hp <= 0) { gameOver('cars'); return; }
        S.msg = ['Bonk!', 'Whoa!', 'Oof!'][Math.floor(Math.random() * 3)]; S.msgT = 1.0;
        for (let i = 0; i < 6; i++) { const an = Math.random() * 6.28; S.parts.push({ x: p.x, y: p.y, vx: Math.cos(an) * 120, vy: Math.sin(an) * 120, r: 5, life: 0.5, max: 0.6, confetti: '#ffd23f' }); }
      }
    }
  }
  // coins
  for (const c of S.coinsOnGround) {
    c.t += dt;
    if (Math.hypot(c.x - p.x, c.y - p.y) < p.r + 22) { c.got = true; S.coins++; S.levelCoins++; S.stats.coinsPicked++; if (S.mode === 'survival') S.survCoins++; save.coins = S.coins; persist(); beep(1200, 0.08, 'square', 0.12); setTimeout(() => beep(1600, 0.1, 'square', 0.12), 60); }
  }
  S.coinsOnGround = S.coinsOnGround.filter(c => !c.got);

  if (S.mode === 'survival') {
    S.survT += dt;
    const w = 1 + Math.floor(S.survT / WAVE_S);
    if (w > S.wave) { const bonusC = (w - S.wave) * WAVE_COINS; S.wave = w; S.coins += bonusC; S.survCoins += bonusC; save.coins = S.coins; persist(); S.msg = 'Wave ' + w + '! +' + WAVE_COINS + ' coins'; S.msgT = 1.6; beep(784, 0.12, 'triangle', 0.15); setTimeout(() => beep(1046, 0.18, 'triangle', 0.15), 120); }
  } else if (S.kills >= S.goal) levelDone();
}
function bonus() { return 5 + S.level; }
function levelDone() {
  S.state = 'celebrate'; S.clearT = 0; S.flash = 1;
  for (const e of S.enemies) explode(e.x, e.y, false);
  S.enemies = []; S.coinsOnGround = [];
  S.parts = S.parts.map(p => ({ ...p, life: 0.3 }));
  S.coins += bonus(); save.coins = S.coins;
  const before = save.best;
  save.best = Math.max(save.best, S.level + 1); save.level = S.level + 1; persist();
  const nm = MAPS.find(m => m.unlock > before && m.unlock <= save.best); S.newMap = nm ? nm.name : '';
  S.nextMap = randomMap(MAP.id); save.map = S.nextMap; persist();   // shuffle: next level on a random unlocked map
  beep(523, 0.12, 'triangle', 0.2); setTimeout(() => beep(659, 0.12, 'triangle', 0.2), 110); setTimeout(() => beep(784, 0.3, 'triangle', 0.2), 220);
  // confetti
  for (let i = 0; i < 40; i++) { const an = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, sp = 150 + Math.random() * 250; S.parts.push({ x: S.player.x, y: S.player.y - 30, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, r: 4, life: 1.5, max: 1.5, confetti: ['#ff4f7b','#ffd23f','#3ee0ff','#7cff6b','#b06bff'][i % 5] }); }
}
function tap() {
  if (S.state === 'collect') { collectOffline(); return; }
  if (S.state === 'home') { startCampaign(); return; }
  if (S.state === 'over' && S.overT > 0.7) { if (S.mode === 'survival') { startSurvival(); return; } S.coins = save.coins; S.msgT = 0; startLevel(); beep(660, 0.08, 'square', 0.1); return; }
  if (S.state === 'clear' && S.clearT > 0.6) { S.level++; S.coins = save.coins; startLevel(); beep(880, 0.08, 'square', 0.1); }
}

// ---------- drawing ----------
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function drawCoin(x, y, s, t) {
  const sx = Math.abs(Math.cos(t * 3)) * 0.7 + 0.3;
  ctx.save(); ctx.translate(x, y); ctx.scale(sx, 1);
  ctx.fillStyle = '#e0a000'; ctx.beginPath(); ctx.arc(0, 0, s, 0, 7); ctx.fill();
  ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(0, 0, s * 0.8, 0, 7); ctx.fill();
  ctx.fillStyle = '#e0a000'; ctx.font = `bold ${s * 1.1}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', 0, 1);
  ctx.restore();
}
function drawWorld() {
  const p = S.player, sh = S.shake;
  ctx.fillStyle = MAP.outer; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2 + (Math.random() - 0.5) * sh, H / 2 + (Math.random() - 0.5) * sh); ctx.scale(ZOOM, ZOOM); ctx.translate(-p.x, -p.y);
  drawGround(p);
  ctx.drawImage(trackCv, 0, 0, WORLD, WORLD);
  ctx.strokeStyle = MAP.edge; ctx.lineWidth = 14; ctx.strokeRect(-7, -7, WORLD + 14, WORLD + 14);
  { const vr = viewRadius() + 40; for (const o of S.obstacles) { const ext = o.r || Math.max(o.w, o.h); if (Math.abs(o.x - p.x) < vr + ext && Math.abs(o.y - p.y) < vr + ext) drawObstacle(o); } }
  for (const c of S.coinsOnGround) drawCoin(c.x, c.y, 14, c.t + c.x);
  for (const d of S.debris) {
    ctx.save(); ctx.globalAlpha = Math.min(1, d.life); ctx.translate(d.x, d.y); ctx.rotate(d.a);
    if (d.kind === 'tire') { ctx.fillStyle = '#1b1f2a'; rr(ctx, -7, -4, 14, 8, 3); ctx.fill(); }
    else { ctx.fillStyle = d.col; rr(ctx, -12, -8, 24, 16, 4); ctx.fill(); ctx.fillStyle = '#3a3a3a'; ctx.fillRect(-6, -4, 10, 8); }
    ctx.restore();
  }
  for (const e of S.enemies) drawCar(e, false);
  drawCar(p, S.state === 'play' && S.iframes > 0 && Math.floor(S.t * 12) % 2 === 0);
  for (const q of S.parts) {
    if (q.confetti) { ctx.fillStyle = q.confetti; ctx.globalAlpha = Math.min(1, q.life); ctx.fillRect(q.x, q.y, 7, 7); ctx.globalAlpha = 1; q.vy += 300 / 60; continue; }
    const k = q.life / q.max; ctx.globalAlpha = Math.min(1, k * 1.5); ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(q.x, q.y, q.r * (1.4 - k * 0.6), 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  }
  if (S.state === 'celebrate') { // party popper flair over player
    const bob = Math.sin(S.clearT * 8) * 4, sc = Math.min(1, S.clearT * 4);
    ctx.save(); ctx.translate(p.x, p.y - 55 + bob); ctx.scale(sc, sc);
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); for (let i = 0; i < 16; i++) { const an = i / 16 * Math.PI * 2 + S.clearT, r = i % 2 ? 16 : 34; ctx.lineTo(Math.cos(an) * r, Math.sin(an) * r); } ctx.fill();
    ctx.font = '40px system-ui,"Apple Color Emoji","Segoe UI Emoji",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🎉', 0, 2);
    ctx.restore();
  }
  ctx.restore();
}
function pill(x, y, w, h, alpha = 0.22) { ctx.fillStyle = `rgba(80,30,0,${alpha})`; rr(ctx, x, y, w, h, h / 2); ctx.fill(); }
function txt(s, x, y, size, color = '#fff', align = 'center', weight = 900) {
  ctx.font = `${weight} ${size}px "Trebuchet MS",system-ui,sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineWidth = size / 5; ctx.strokeStyle = 'rgba(90,40,10,.55)'; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y);
  ctx.fillStyle = color; ctx.fillText(s, x, y);
}
function heart(x, y, s, col) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y + s * 0.35); ctx.bezierCurveTo(x - s, y - s * 0.4, x - s * 0.4, y - s, x, y - s * 0.4); ctx.bezierCurveTo(x + s * 0.4, y - s, x + s, y - s * 0.4, x, y + s * 0.35); ctx.fill(); }
function crashIcon(x, y) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#ffd23f'; ctx.beginPath(); for (let i = 0; i < 12; i++) { const an = i / 12 * Math.PI * 2, r = i % 2 ? 7 : 14; ctx.lineTo(Math.cos(an) * r, Math.sin(an) * r); } ctx.fill();
  ctx.rotate(-0.5); ctx.fillStyle = '#fff'; rr(ctx, -12, -6, 14, 12, 3); ctx.fill(); ctx.rotate(1); rr(ctx, -2, -6, 14, 12, 3); ctx.fill();
  ctx.restore();
}
function drawHUD() {
  const sx = Math.max(12, 0), top = 14, sc = Math.max(1, Math.min(1.4, W / 380));
  ctx.save(); ctx.scale(sc, sc); const w = W / sc;
  // health
  heart(26, top + 14, 16, '#ffffff'); heart(26, top + 14, 11, S.hp <= 6 ? '#ff4f7b' : '#ff7b8f');
  txt('HEALTH', 48, top + 12, 20, '#fff', 'left');
  const segW = 6, gap = 1.5;
  const n = S.hpMax || HP_MAX, sw = Math.min(segW + gap, 172 / n);
  pill(12, top + 28, n * sw + 8, 16, 0.35);
  for (let i = 0; i < n; i++) { ctx.fillStyle = i < S.hp ? (S.hp <= 6 ? '#ff6b6b' : '#ffffff') : 'rgba(255,255,255,.18)'; ctx.fillRect(17 + i * sw, top + 31, Math.max(1.5, sw - 1.5), 10); }
  // coins
  const ct = String(S.coins); ctx.font = '900 24px "Trebuchet MS",system-ui'; const tw = ctx.measureText(ct).width;
  drawCoin(w - 30 - tw - 22, top + 16, 15, 0); txt(ct, w - 18, top + 17, 24, '#fff', 'right');
  // level + objective
  if (S.mode === 'survival') {
    pill(w / 2 - 50, top + 50, 100, 24, 0.3); txt('Wave ' + S.wave, w / 2, top + 62, 16, '#ffd23f');
    pill(w / 2 - 80, top + 80, 160, 44, 0.3); txt('⏱ ' + fmtTime(S.survT), w / 2 - 22, top + 102, 22); crashIcon(w / 2 + 38, top + 102); txt(String(S.kills), w / 2 + 62, top + 102, 20, '#fff', 'left');
  } else {
    pill(w / 2 - 46, top + 50, 92, 24, 0.3); txt('Level ' + S.level, w / 2, top + 62, 15);
    pill(w / 2 - 70, top + 80, 140, 44, 0.3); crashIcon(w / 2 - 36, top + 102); txt(`${S.kills}/${S.goal}`, w / 2 + 22, top + 102, 26);
  }
  if (S.state === 'play') { const z = zoneState(), hh = H / sc;
    for (const [side, lv] of [[-1, z.l], [1, z.r]]) {
      ctx.globalAlpha = lv === 2 ? 0.7 + 0.25 * Math.sin(S.t * 14) : lv === 1 ? 0.4 : 0.16;
      const x = side < 0 ? 22 : w - 22, big = lv === 2 ? 38 : 30;
      txt(side < 0 ? '◀' : '▶', x, hh * 0.6, big); ctx.globalAlpha = 1; } }
  if (S.msgT > 0) txt(S.msg, w / 2, top + 150, 26, '#ffd23f');
  if (S.state === 'play' && S.t < 4 && S.level === save.best && S.kills === 0) { ctx.globalAlpha = Math.max(0, Math.min(1, 4 - S.t)); txt('Tap to nudge, hold LEFT / RIGHT to spin!', w / 2, H / sc - 110, Math.min(22, w / 19)); txt('Make the trucks crash into each other!', w / 2, H / sc - 78, Math.min(20, w / 20), '#ffd23f'); ctx.globalAlpha = 1; }
  ctx.restore();
}
function star(x, y, r, col) { ctx.fillStyle = col; ctx.beginPath(); for (let i = 0; i < 10; i++) { const an = -Math.PI / 2 + i * Math.PI / 5, rr2 = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(an) * rr2, y + Math.sin(an) * rr2); } ctx.fill(); }
function drawClear() {
  const t = S.clearT, cx = W / 2, cy = H * 0.42, R = Math.hypot(W, H);
  ctx.fillStyle = 'rgba(40,20,60,.55)'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.3);
  for (let i = 0; i < 16; i++) { ctx.fillStyle = i % 2 ? 'rgba(255,210,63,.25)' : 'rgba(255,160,40,.18)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, i / 16 * Math.PI * 2, (i + 1) / 16 * Math.PI * 2); ctx.fill(); }
  ctx.restore();
  const s = Math.min(1, W / 400, H / 640) * Math.min(1, 0.4 + t * 3);
  ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
  txt('Level Complete!', 0, -150, 40, '#ffd23f');
  for (let i = 0; i < 3; i++) { const show = t > 0.2 + i * 0.2; if (show) { star(-70 + i * 70, -85 - (i === 1 ? 14 : 0), i === 1 ? 34 : 28, '#ffd23f'); } else star(-70 + i * 70, -85 - (i === 1 ? 14 : 0), i === 1 ? 34 : 28, 'rgba(255,255,255,.25)'); }
  // gift progress: a gift every 5 levels
  const prog = ((S.level - 1) % 5 + 1) / 5;
  ctx.fillStyle = 'rgba(0,0,0,.3)'; rr(ctx, -120, -30, 200, 22, 11); ctx.fill();
  ctx.fillStyle = '#7cff6b'; rr(ctx, -120, -30, Math.max(22, 200 * Math.min(prog, t)), 22, 11); ctx.fill();
  ctx.font = '36px system-ui,"Apple Color Emoji",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🎁', 110, -20);
  txt(prog >= 1 ? 'Gift unlocked!' : `${Math.round(prog * 5)}/5 to a gift`, -20, 6, 15);
  drawCoin(-40, 50, 20, 0); txt('+' + Math.floor(S.tally), 20, 51, 36, '#fff');
  if (S.newMap) txt('New map unlocked: ' + S.newMap + '!', 0, -192, 20, '#7cff6b');
  txt('Next level: surprise map!', 0, 82, 18, '#9fe3ff');
  if (t > 0.6) { const pulse = 1 + Math.sin(t * 5) * 0.05; ctx.save(); ctx.translate(0, 130); ctx.scale(pulse, pulse); ctx.fillStyle = '#22c55e'; rr(ctx, -130, -32, 260, 64, 32); ctx.fill(); txt('Tap to Continue', 0, 0, 26); ctx.restore(); }
  ctx.restore();
}
function drawOver() {
  const t = S.overT, cx = W / 2, cy = H * 0.42;
  ctx.fillStyle = 'rgba(40,20,60,.6)'; ctx.fillRect(0, 0, W, H);
  const s = Math.min(1, W / 400, H / 640) * Math.min(1, 0.4 + t * 3);
  ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
  ctx.fillStyle = 'rgba(255,255,255,.12)'; rr(ctx, -170, -200, 340, 380, 30); ctx.fill();
  ctx.font = '64px system-ui,"Apple Color Emoji",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('💫', 0, -140);
  if (S.mode === 'survival') {
    txt('Crashed out!', 0, -80, 34, '#ffd23f');
    txt('You lasted ' + S.wave + (S.wave === 1 ? ' wave' : ' waves') + '!', 0, -42, 26);
    txt(fmtTime(S.survT) + ' • ' + S.kills + ' crashes', 0, -8, 20);
    drawCoin(-110, 30, 16, 0); txt('+' + S.survCoins + ' coins earned', 15, 31, 20);
    txt(S.survNewBest ? 'New best! ⭐' : 'Best: ' + save.surv.bestWaves + ' waves', 0, 64, 18, '#7cff6b');
    ctx.restore();
    if (t > 0.7) { const L = survOverLayout();
      ctx.fillStyle = '#22c55e'; rr(ctx, L.retry.x, L.retry.y, L.retry.w, L.retry.h, L.retry.h / 2); ctx.fill(); txt('Tap to Retry', L.retry.x + L.retry.w / 2, L.retry.y + L.retry.h / 2, 24);
      ctx.fillStyle = '#3b82f6'; rr(ctx, L.menu.x, L.menu.y, L.menu.w, L.menu.h, L.menu.h / 2); ctx.fill(); txt('🏠 Menu', L.menu.x + L.menu.w / 2, L.menu.y + L.menu.h / 2, 22); }
    return;
  }
  txt('Crashed out!', 0, -75, 38, '#ffd23f');
  txt('Good try! You reached', 0, -30, 18);
  txt('Level ' + S.level, 0, 4, 30);
  drawCoin(-135, 50, 18, 0); txt('+' + S.levelCoins + ' coins this run', 15, 51, 22, '#fff', 'center');
  if (t > 0.7) { const pulse = 1 + Math.sin(t * 5) * 0.05; ctx.save(); ctx.translate(0, 125); ctx.scale(pulse, pulse); ctx.fillStyle = '#22c55e'; rr(ctx, -120, -32, 240, 64, 32); ctx.fill(); txt('Tap to Retry', 0, 0, 26); ctx.restore(); }
  ctx.restore();
}
// ---------- shuffle ----------
function randomMap(exclude) {
  const ids = unlockedMaps(), pool = ids.length > 1 ? ids.filter(id => id !== exclude) : ids;
  return pool[Math.floor(Math.random() * pool.length)];
}
function fmtTime(t) { t = Math.floor(t); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }

// ---------- modes ----------
// Survival: endless; a new wave every WAVE_S seconds (+WAVE_COINS coins). Same combat rules as levels.
const WAVE_S = 20, WAVE_COINS = 3;
function survParams() {
  const w = S.wave || 1;
  return { maxE: Math.min(12, 3 + w), interval: Math.max(0.6, 2.0 - w * 0.12), speed: Math.min(0.95, 0.8 + w * 0.02), turn: Math.min(2.4, 1.6 + w * 0.06) };
}
function startSurvival() {
  S.mode = 'survival'; S.wave = 1; S.survT = 0; S.survCoins = 0; S.survNewBest = false;
  save.map = randomMap(MAP.id); persist();
  S.coins = save.coins; S.msg = 'Survive! Wave 1'; S.msgT = 1.6; startLevel();
}
function startCampaign() { S.mode = 'level'; S.level = save.level; S.coins = save.coins; S.msgT = 0; startLevel(); beep(880, 0.08, 'square', 0.1); }
function goHome() { S.mode = 'level'; S.level = save.level; S.coins = save.coins; startLevel(); S.state = 'home'; S.mapsT = 0; }
function survOverLayout() {
  const w = Math.min(260, W - 60), y = Math.min(H - 150, H * 0.42 + 120 * Math.min(1, W / 400, H / 640));
  return { retry: { x: W / 2 - w / 2, y, w, h: 60 }, menu: { x: W / 2 - w / 2, y: y + 72, w, h: 54 } };
}
const inR = (r, x, y) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
function survOverClick(x, y) {
  if (S.overT <= 0.7) return;
  const L = survOverLayout();
  if (inR(L.menu, x, y)) { goHome(); return; }
  startSurvival();
}

// ---------- home ----------
const homeBtn = document.getElementById('home');
homeBtn.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); unlockAudio(); goHome(); });
function homeLayout() {
  const w = Math.min(340, W - 40), x = W / 2 - w / 2, top = Math.max(170, H * 0.28);
  const half = (w - 14) / 2;
  return { play: { x, y: top, w, h: 84 }, surv: { x, y: top + 100, w, h: 96 },
    shop: { x, y: top + 212, w: half, h: 64 }, upg: { x: x + half + 14, y: top + 212, w: half, h: 64 } };
}
function homeClick(x, y) {
  const L = homeLayout();
  if (inR(L.play, x, y)) startCampaign();
  else if (inR(L.surv, x, y)) startSurvival();
  else if (inR(L.shop, x, y)) openShop();
  else if (inR(L.upg, x, y)) openUpg();
}
function bigBtn(r, col, title, sub, tsz = 30) {
  ctx.fillStyle = 'rgba(0,0,0,.25)'; rr(ctx, r.x, r.y + 5, r.w, r.h, 22); ctx.fill();
  ctx.fillStyle = col; rr(ctx, r.x, r.y, r.w, r.h, 22); ctx.fill();
  txt(title, r.x + r.w / 2, r.y + (sub ? r.h * 0.36 : r.h / 2), tsz);
  if (sub) txt(sub, r.x + r.w / 2, r.y + r.h * 0.72, 15, '#fff6c9');
}
function drawHome() {
  ctx.fillStyle = 'rgba(30,20,50,.55)'; ctx.fillRect(0, 0, W, H);
  const L = homeLayout(), ty = Math.max(60, L.play.y - 90);
  txt('Crash Maps', W / 2, ty, Math.min(50, W / 8), '#ffd23f');
  txt('Tap to nudge, hold to spin.', W / 2, ty + 40, 16); txt('Make the chasers crash into each other!', W / 2, ty + 62, Math.min(16, W / 25));
  bigBtn(L.play, '#22c55e', '▶ Play', 'Level ' + save.level);
  bigBtn(L.surv, '#f97316', '⏱ Survival', 'How long can you last?' + (save.surv.bestWaves ? '  Best: ' + save.surv.bestWaves + ' waves' : ''), 32);
  bigBtn(L.shop, '#8b5cf6', '🚗 Car Shop', null, 21);
  bigBtn(L.upg, '#0ea5e9', '⚡ Upgrades', null, 21);
  drawCoin(W / 2 - 40, L.shop.y + 100, 16, 0); txt(String(save.coins), W / 2 - 16, L.shop.y + 101, 24, '#fff', 'left');
  if (S.pending > 0) txt('+' + S.pending + ' waiting!', W / 2 + 60, L.shop.y + 101, 18, '#7cff6b', 'left');
  txt('Maps change every level — win to unlock more!', W / 2, L.shop.y + 140, Math.min(15, W / 27), '#fff6c9');
}

// ---------- car shop ----------
const CARS = [
  { id: 'cyan', name: 'Zippy', price: 0 },
  { id: 'panda', name: 'Panda Car', price: 80, animal: true },
  { id: 'pony', name: 'Pony Racer', price: 110, animal: true },
  { id: 'dolphin', name: 'Dolphin Dasher', price: 160, animal: true },
  { id: 'dino', name: 'Dino Buggy', price: 220, animal: true },
  { id: 'cop', name: 'Police Car', price: 20 },
  { id: 'icecream', name: 'Ice Cream Truck', price: 60 },
  { id: 'kart', name: 'Go-Kart', price: 120 },
  { id: 'snowmobile', name: 'Snowmobile', price: 150 },
  { id: 'buggy', name: 'Lifeguard Buggy', price: 200 },
  { id: 'monster', name: 'Monster Truck', price: 250 },
  { id: 'unicorn', name: 'Unicorn Car', price: 300 },
  { id: 'bat', name: 'Bat Racer', price: 400 },
];
const shopBtn = document.getElementById('shop');
shopBtn.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); unlockAudio(); S.state === 'shop' ? closeShop() : openShop(); });
function openShop() { if (S.state === 'shop' || S.state === 'celebrate' || S.state === 'collect') return; S.shopTab = S.shopTab || 'cars'; S.shopFrom = S.state; S.state = 'shop'; S.shopMsg = ''; zones.clear(); }
function closeShop() { if (S.state === 'shop') S.state = S.shopFrom || 'play'; }
function buyCar(id) {
  const c = CARS.find(k => k.id === id); if (!c) return false;
  if (save.cars.includes(id)) return equipCar(id);
  if (save.coins < c.price) { S.shopMsg = 'Need ' + (c.price - save.coins) + ' more coins'; beep(180, 0.15, 'triangle', 0.12); return false; }
  save.coins -= c.price; S.coins = save.coins; save.cars.push(id); save.car = id; persist();
  S.shopMsg = 'You got the ' + c.name + '! 🎉'; beep(988, 0.1, 'square', 0.12); setTimeout(() => beep(1318, 0.16, 'square', 0.12), 100);
  return true;
}
function equipCar(id) { if (!save.cars.includes(id)) return false; save.car = id; persist(); S.shopMsg = ''; beep(660, 0.08, 'square', 0.1); return true; }
function shopList() { return CARS.filter(c => !!c.animal === (S.shopTab === 'animals')); }
function shopLayout() {
  const list = shopList(), tw = Math.min(170, (W - 40) / 2);
  const tabs = { cars: { x: W / 2 - tw - 5, y: 84, w: tw, h: 46 }, animals: { x: W / 2 + 5, y: 84, w: tw, h: 46 } };
  const cols = W > H ? 2 : 1, gap = 10, top = 140, foot = 84, rows = Math.ceil(list.length / cols);
  const w = Math.min(420, (W - gap * (cols + 1)) / cols), h = Math.max(56, Math.min(86, (H - top - foot - gap * (rows - 1)) / rows));
  const x0 = (W - (cols * w + (cols - 1) * gap)) / 2;
  const rowsL = list.map((c, i) => { const x = x0 + (i % cols) * (w + gap), y = top + Math.floor(i / cols) * (h + gap); return { id: c.id, x, y, w, h, btn: { x: x + w - 132, y: y + h / 2 - 24, w: 120, h: 48 } }; });
  const done = { x: W / 2 - 110, y: Math.min(H - 70, top + rows * (h + gap) + 10), w: 220, h: 56 };
  return { rows: rowsL, done, tabs };
}
function shopClick(x, y) {
  const L = shopLayout();
  if (inR(L.done, x, y)) { closeShop(); return; }
  for (const k of ['cars', 'animals']) if (inR(L.tabs[k], x, y)) { S.shopTab = k; S.shopMsg = ''; beep(660, 0.05, 'square', 0.08); return; }
  for (const r of L.rows) if (inR(r, x, y)) { buyCar(r.id); return; }   // whole row is the button: big target
}
function drawShop() {
  ctx.fillStyle = 'rgba(30,20,50,.86)'; ctx.fillRect(0, 0, W, H);
  txt('Car Shop', W / 2, 32, 30, '#ffd23f');
  drawCoin(W / 2 - 30, 66, 13, 0); txt(String(save.coins), W / 2 - 12, 67, 20, '#fff', 'left');
  const L = shopLayout();
  for (const k of ['cars', 'animals']) { const b = L.tabs[k], on = (S.shopTab || 'cars') === k; ctx.fillStyle = on ? '#f97316' : 'rgba(255,255,255,.15)'; rr(ctx, b.x, b.y, b.w, b.h, 23); ctx.fill(); txt(k === 'cars' ? '🚗 Cars' : '🐾 Animals', b.x + b.w / 2, b.y + b.h / 2, 19); }
  for (const r of L.rows) {
    const c = CARS.find(k => k.id === r.id), owned = save.cars.includes(c.id), eq = save.car === c.id, afford = save.coins >= c.price;
    ctx.fillStyle = eq ? 'rgba(255,210,63,.25)' : 'rgba(255,255,255,.1)'; rr(ctx, r.x, r.y, r.w, r.h, 16); ctx.fill();
    if (eq) { ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3; rr(ctx, r.x, r.y, r.w, r.h, 16); ctx.stroke(); }
    ctx.save(); ctx.translate(r.x + 46, r.y + r.h / 2); ctx.scale(2, 2); ctx.rotate(-0.3); if (!owned) ctx.globalAlpha = 0.85; drawPlayerSkin(c.id); ctx.restore();
    txt(c.name, r.x + 92, r.y + r.h / 2 - (owned ? 0 : 10), c.name.length > 12 ? Math.min(15, r.w / 26) : Math.min(19, r.w / 18), '#fff', 'left');
    if (!owned) { drawCoin(r.x + 102, r.y + r.h / 2 + 14, 9, 0); txt(String(c.price), r.x + 116, r.y + r.h / 2 + 15, 16, '#ffd23f', 'left'); }
    const b = r.btn;
    let col, label;
    if (eq) { col = '#64748b'; label = '✓ Driving'; }
    else if (owned) { col = '#3b82f6'; label = 'Equip'; }
    else if (afford) { col = '#22c55e'; label = 'Buy'; }
    else { col = 'rgba(120,120,140,.6)'; label = 'Need ' + (c.price - save.coins); }
    ctx.fillStyle = col; rr(ctx, b.x, b.y, b.w, b.h, 24); ctx.fill();
    txt(label, b.x + b.w / 2, b.y + b.h / 2, label.length > 8 ? 15 : 20, afford || owned ? '#fff' : '#ddd');
  }
  ctx.fillStyle = '#22c55e'; rr(ctx, L.done.x, L.done.y, L.done.w, L.done.h, 28); ctx.fill(); txt('Done ▶', W / 2, L.done.y + 28, 22);
  if (S.shopMsg) txt(S.shopMsg, W / 2, Math.max(84, L.done.y - 14), 16, '#7cff6b');
}

// ---------- per-car engine voices (WebAudio, one voice at a time) ----------
// Each voice: a few persistent nodes (osc/filter/gain/LFO) + optional scheduled musical chirps (short self-stopping beeps).
const audioStats = { live: 0, made: 0, beeps: 0, voice: null, sig: '' };
const VOICES = {
  cyan:     { sig: 'square110+lp600+am18',  osc: [['square', 110]], lp: 600, am: [18, 0.5], vol: 0.035, rise: 0.25 },
  cop:      { sig: 'saw70+lp350+siren',     osc: [['sawtooth', 70]], lp: 350, vol: 0.04, rise: 0.12, chirp: { every: 4, notes: [[960, 0.12], [720, 0.12], [960, 0.12], [720, 0.12]], type: 'sine', vol: 0.05 } },
  icecream: { sig: 'tri90+lp300+jingle',    osc: [['triangle', 90]], lp: 300, vol: 0.025, rise: 0.08, chirp: { every: 2.4, notes: [[784, 0.18], [988, 0.18], [1175, 0.18], [988, 0.18], [784, 0.18], [659, 0.3]], type: 'sine', vol: 0.05 } },
  kart:     { sig: 'saw220+hp300+whine',    osc: [['sawtooth', 220]], hp: 300, lp: 2400, vol: 0.025, rise: 1.2 },
  buggy:    { sig: 'saw55+sq82+lp250+am9',  osc: [['sawtooth', 55], ['square', 82]], lp: 250, am: [9, 0.6], vol: 0.045, rise: 0.15 },
  unicorn:  { sig: 'sine220+arp',           osc: [['sine', 220]], lp: 1200, vol: 0.015, rise: 0.2, chirp: { every: 1.2, notes: [[1047, 0.1], [1319, 0.1], [1568, 0.1], [2093, 0.16]], type: 'sine', vol: 0.04 } },
  monster:  { sig: 'saw40+sq60+lp200+rev',  osc: [['sawtooth', 40], ['square', 60]], lp: 200, am: [7, 0.5], vol: 0.06, rise: 0.12, rev: 3.5 },
  bat:      { sig: 'tri300+hp200+hero',     osc: [['triangle', 300], ['sine', 600]], hp: 200, lp: 3000, vol: 0.02, rise: 0.8, chirp: { every: 5, notes: [[523, 0.12], [659, 0.12], [784, 0.3]], type: 'triangle', vol: 0.045 } },
  snowmobile: { sig: 'sq160+bp1200+am30',   osc: [['square', 160]], bp: 1200, am: [30, 0.7], vol: 0.03, rise: 0.6 },
  panda:    { sig: 'tri120+lp500+giggle',   osc: [['triangle', 120]], lp: 500, vol: 0.025, rise: 0.15, chirp: { every: 2.6, notes: [[880, 0.07], [1046, 0.07], [880, 0.07], [1175, 0.1]], type: 'sine', vol: 0.04 } },
  pony:     { sig: 'sine80+clop',           osc: [['sine', 80]], lp: 300, vol: 0.02, rise: 0.1, chirp: { every: 0.55, notes: [[320, 0.05], [0, 0.08], [260, 0.05]], type: 'triangle', vol: 0.06 } },
  dolphin:  { sig: 'sine180+am5+squeak',    osc: [['sine', 180]], lp: 900, am: [5, 0.4], vol: 0.02, rise: 0.3, chirp: { every: 2, notes: [[1400, 0.09], [1800, 0.09], [1500, 0.12]], type: 'sine', vol: 0.04, slide: 600 } },
  dino:     { sig: 'saw50+lp180+am4+stomp', osc: [['sawtooth', 50]], lp: 180, am: [4, 0.6], vol: 0.06, rise: 0.15, chirp: { every: 1.6, notes: [[90, 0.15], [0, 0.25], [70, 0.2]], type: 'square', vol: 0.06 } },
};
let voice = null;
function mk(n) { audioStats.live++; audioStats.made++; return n; }
function startVoice(id) {
  stopVoice();
  const V = VOICES[id] || VOICES.cyan;
  const v = { id, V, nodes: [], oscs: [], chirpT: 1.0, revT: V.rev || 0 };
  const out = mk(ac.createGain()); out.gain.value = V.vol; out.connect(master); v.nodes.push(out); v.out = out;
  let head = out;
  if (V.lp) { const f = mk(ac.createBiquadFilter()); f.type = 'lowpass'; f.frequency.value = V.lp; f.connect(head); head = f; v.nodes.push(f); }
  if (V.hp) { const f = mk(ac.createBiquadFilter()); f.type = 'highpass'; f.frequency.value = V.hp; f.connect(head); head = f; v.nodes.push(f); }
  if (V.bp) { const f = mk(ac.createBiquadFilter()); f.type = 'bandpass'; f.frequency.value = V.bp; f.Q.value = 1.5; f.connect(head); head = f; v.nodes.push(f); }
  if (V.am) { // amplitude wobble (putter / rumble / buzz)
    const g = mk(ac.createGain()); g.gain.value = 1 - V.am[1] / 2; g.connect(head); head = g; v.nodes.push(g);
    const l = mk(ac.createOscillator()), lg = mk(ac.createGain()); l.frequency.value = V.am[0]; lg.gain.value = V.am[1] / 2; l.connect(lg); lg.connect(g.gain); l.start(); v.nodes.push(l, lg); v.lfo = l;
  }
  for (const [type, f] of V.osc) { const o = mk(ac.createOscillator()); o.type = type; o.frequency.value = f; o.base = f; o.connect(head); o.start(); v.nodes.push(o); v.oscs.push(o); }
  voice = v; audioStats.voice = id; audioStats.sig = V.sig;
}
function stopVoice() {
  if (!voice) return;
  for (const n of voice.nodes) { try { if (n.stop) n.stop(); } catch (e) {} try { n.disconnect(); } catch (e) {} audioStats.live--; }
  voice = null; audioStats.voice = null; audioStats.sig = '';
}
function updateVoice(dt) {
  const want = ac && S.state === 'play' ? save.car : null;
  if (!want) { stopVoice(); return; }
  if (!voice || voice.id !== want) startVoice(want);
  const V = voice.V, sp = Math.hypot(S.player.vx, S.player.vy) / 270;
  let rev = 1;
  if (V.rev) { voice.revT -= dt; if (voice.revT <= 0) voice.revT = V.rev; const k = V.rev - voice.revT; if (k < 0.8) rev = 1 + 1.2 * Math.sin(Math.PI * k / 0.8); }
  for (const o of voice.oscs) o.frequency.value = o.base * (1 + V.rise * sp) * rev;
  if (V.chirp && !save.muted) { voice.chirpT -= dt; if (voice.chirpT <= 0) { voice.chirpT = V.chirp.every; let d = 0; for (const [f, len] of V.chirp.notes) { const ff = f, ll = len; if (ff) setTimeout(() => { if (voice && voice.id === want && S.state === 'play') beep(ff, ll, V.chirp.type, V.chirp.vol, V.chirp.slide || (voice.id === 'bat' ? ff * 0.15 : 0)); }, d * 1000); d += len; } } }
}

// ---------- upgrades (global: apply to every car, levels and Survival) ----------
// Speed: +5% top speed per level. Toughness: +4 health segments per level; every 7 extra = one more truck hit.
const UP_MAX = 10, SPEED_PER_LV = 0.05, TOUGH_PER_LV = 4;
function upCost(lv) { const c = 15 * Math.pow(1.35, lv); return c < 100 ? Math.round(c / 5) * 5 : Math.round(c / 10) * 10; }
function buyUpgrade(kind) {
  const lv = save.up[kind]; if (lv >= UP_MAX) { S.upMsg = 'Already MAX!'; return false; }
  const c = upCost(lv);
  if (save.coins < c) { S.upMsg = 'Need ' + (c - save.coins) + ' more coins'; beep(180, 0.15, 'triangle', 0.12); return false; }
  save.coins -= c; S.coins = save.coins; save.up[kind] = lv + 1; persist();
  S.upMsg = (kind === 'speed' ? 'Faster! ' : 'Tougher! ') + 'Lv ' + (lv + 1) + ' ⭐';
  beep(784, 0.1, 'square', 0.12); setTimeout(() => beep(1175, 0.16, 'square', 0.12), 100);
  return true;
}
function openUpg() { if (S.state === 'upg' || S.state === 'celebrate') return; S.upgFrom = S.state; S.state = 'upg'; S.upMsg = ''; zones.clear(); }
function closeUpg() { if (S.state === 'upg') S.state = S.upgFrom || 'home'; }
function upgLayout() {
  const w = Math.min(380, W - 24), x = W / 2 - w / 2, h = Math.min(190, (H - 230) / 2);
  const card = (y) => ({ x, y, w, h, btn: { x: x + 14, y: y + h - 66, w: w - 28, h: 54 } });
  const a = card(96), b = card(96 + h + 14);
  return { speed: a, tough: b, done: { x: W / 2 - 110, y: Math.min(H - 70, b.y + h + 14), w: 220, h: 56 } };
}
function upgClick(x, y) {
  const L = upgLayout();
  if (inR(L.done, x, y)) { closeUpg(); return; }
  if (inR(L.speed, x, y)) buyUpgrade('speed'); else if (inR(L.tough, x, y)) buyUpgrade('tough');
}
function drawUpg() {
  ctx.fillStyle = 'rgba(30,20,50,.88)'; ctx.fillRect(0, 0, W, H);
  txt('⚡ Upgrades', W / 2, 32, 30, '#ffd23f'); txt('Work on every car!', W / 2, 58, 14, '#fff6c9');
  drawCoin(W / 2 - 30, 80, 12, 0); txt(String(save.coins), W / 2 - 12, 81, 18, '#fff', 'left');
  const L = upgLayout();
  for (const kind of ['speed', 'tough']) {
    const r = L[kind], lv = save.up[kind], max = lv >= UP_MAX, c = upCost(lv), afford = save.coins >= c;
    ctx.fillStyle = 'rgba(255,255,255,.1)'; rr(ctx, r.x, r.y, r.w, r.h, 18); ctx.fill();
    txt(kind === 'speed' ? '💨 Speed' : '🛡️ Toughness', r.x + 16, r.y + 24, 22, '#fff', 'left');
    txt(max ? 'MAX' : 'Lv ' + lv, r.x + r.w - 16, r.y + 24, 20, max ? '#ffd23f' : '#9fe3ff', 'right');
    for (let i = 0; i < UP_MAX; i++) star(r.x + 24 + i * Math.min(30, (r.w - 40) / 10), r.y + 54, 10, i < lv ? '#ffd23f' : 'rgba(255,255,255,.2)');
    const eff = kind === 'speed' ? 'Faster! (+' + Math.round(SPEED_PER_LV * 100) + '% speed)' : 'More health! (+' + TOUGH_PER_LV + ' bar)';
    txt(max ? 'Fully upgraded!' : 'Next: ' + eff, r.x + 16, r.y + 82, 15, '#fff6c9', 'left');
    const b = r.btn;
    ctx.fillStyle = max ? '#64748b' : afford ? '#22c55e' : 'rgba(120,120,140,.6)'; rr(ctx, b.x, b.y, b.w, b.h, 27); ctx.fill();
    if (max) txt('MAX', b.x + b.w / 2, b.y + b.h / 2, 22);
    else if (afford) { txt('Buy', b.x + b.w / 2 - 34, b.y + b.h / 2, 22); drawCoin(b.x + b.w / 2 + 14, b.y + b.h / 2, 11, 0); txt(String(c), b.x + b.w / 2 + 30, b.y + b.h / 2, 20, '#fff', 'left'); }
    else txt('Need ' + (c - save.coins) + ' more coins', b.x + b.w / 2, b.y + b.h / 2, 18, '#ddd');
  }
  ctx.fillStyle = '#22c55e'; rr(ctx, L.done.x, L.done.y, L.done.w, L.done.h, 28); ctx.fill(); txt('Done ▶', W / 2, L.done.y + 28, 22);
  if (S.upMsg) txt(S.upMsg, W / 2, Math.max(90, L.done.y - 12), 16, '#7cff6b');
}

// ---------- offline coins: 5 per hour away, banked up to 24 h (120 coins) ----------
const OFF_RATE = 5, OFF_CAP_H = 24, OFF_MIN_MS = 5 * 60 * 1000;
function offlinePending(now = Date.now()) {
  if (save.lastSeen == null) return 0;
  if (save.lastSeen > now + 60000) { save.lastSeen = now; persist(); return 0; }   // clock went backwards: reset, pay 0
  const gap = now - save.lastSeen; if (gap < OFF_MIN_MS) return 0;
  return Math.min(OFF_RATE * OFF_CAP_H, Math.floor(gap / 3600000 * OFF_RATE));
}
function offlineCheck() {
  const now = Date.now();
  if (save.lastSeen == null) { save.lastSeen = now; persist(); S.pending = 0; return 0; }  // first launch: start the clock, no panel
  S.pending = offlinePending(now);
  if (S.pending > 0 && S.state !== 'collect' && S.state !== 'celebrate') { S.collectFrom = S.state; S.state = 'collect'; S.collectT = 0; zones.clear(); }
  else if (S.pending === 0 && now - save.lastSeen >= OFF_MIN_MS) { save.lastSeen = now; persist(); }
  return S.pending;
}
function collectOffline() {
  if (S.state !== 'collect') return;
  save.coins += S.pending; S.coins = save.coins; S.collected = S.pending; S.pending = 0; save.lastSeen = Date.now(); persist();
  beep(988, 0.1, 'square', 0.12); setTimeout(() => beep(1318, 0.18, 'square', 0.12), 100);
  S.state = S.collectFrom || 'home';
}
function heartbeat() { if (!document.hidden && !(S.pending > 0)) { save.lastSeen = Date.now(); persist(); } }
setInterval(heartbeat, 30000);
document.addEventListener('visibilitychange', () => { if (document.hidden) heartbeat(); else offlineCheck(); });
function collectLayout() { return { btn: { x: W / 2 - 120, y: H * 0.42 + 80, w: 240, h: 66 } }; }
function drawCollect() {
  ctx.fillStyle = 'rgba(30,20,50,.7)'; ctx.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H * 0.42, L = collectLayout();
  ctx.fillStyle = 'rgba(255,255,255,.14)'; rr(ctx, cx - 170, cy - 150, 340, 320, 30); ctx.fill();
  for (let i = 0; i < 3; i++) drawCoin(cx - 50 + i * 50, cy - 95 + (i === 1 ? -10 : 0), 22, S.t + i);
  txt('Welcome back!', cx, cy - 40, 30, '#ffd23f');
  txt('You earned ' + S.pending + ' coins', cx, cy, 22); txt('while away!', cx, cy + 28, 22);
  ctx.fillStyle = '#22c55e'; rr(ctx, L.btn.x, L.btn.y, L.btn.w, L.btn.h, 33); ctx.fill(); txt('Collect!', cx, L.btn.y + 33, 28);
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawWorld();
  if (!['clear', 'over', 'shop', 'home', 'upg', 'collect'].includes(S.state)) drawHUD();
  drawSnow(1 / 60);
  if (S.state === 'clear') drawClear();
  if (S.state === 'over') drawOver();
  if (S.state === 'shop') drawShop();
  if (S.state === 'home' || (S.state === 'collect' && S.collectFrom === 'home')) drawHome();
  if (S.state === 'upg') drawUpg();
  if (S.state === 'collect') drawCollect();
  shopBtn.style.display = S.state === 'celebrate' ? 'none' : 'block';
  homeBtn.style.display = S.state === 'home' || S.state === 'celebrate' || S.state === 'collect' ? 'none' : 'block';
  if (S.redFlash > 0) { ctx.fillStyle = `rgba(255,60,60,${S.redFlash * 0.6})`; ctx.fillRect(0, 0, W, H); }
  if (S.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(1, S.flash)})`; ctx.fillRect(0, 0, W, H); }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(1 / 30, (now - last) / 1000); last = now;
  update(dt); render();
  requestAnimationFrame(frame);
}
S.mode = 'level';
startLevel();
if (!window.DD_SKIP_HOME) S.state = 'home';
offline: { offlineCheck(); }
requestAnimationFrame(frame);

// test / debug hook
window.DD = { buyUpgrade, upCost, upgLayout, openUpg, closeUpg, UP_MAX, SPEED_PER_LV, TOUGH_PER_LV, offlineCheck, offlinePending, collectOffline, collectLayout, OFF_RATE, OFF_CAP_H, shopList, audioStats, VOICES, get audioCtx() { return ac; }, get master() { return master; }, CARS, buyCar, equipCar, openShop, closeShop, shopLayout, homeLayout, survOverLayout, startSurvival, startCampaign, goHome, survParams, randomMap, WAVE_S, WAVE_COINS, MAPS, get MAP() { return MAP; }, unlockedMaps, COMBAT: { TRUCK_DMG, MAX_HITS, CAR_IFRAMES, BUMP_DMG, BUMP_CD, BUMP_GLOBAL_CD }, zones, TUNE: { HOLD_MS, TAP_STEER, HOLD_STEER, NUDGE_STEER, NUDGE_S }, get steer() { return steerCur; }, S, spawnEnemy, save, SAVE_KEY, levelDone, startLevel };
})();
