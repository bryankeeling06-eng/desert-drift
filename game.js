// Desert Drift — Canvas 2D, no build step.
(() => {
'use strict';
const SAVE_KEY = 'desertDrift.v1';
const WORLD = 2400, HP_MAX = 20, TRACK_SCALE = 0.5;
const cv = document.getElementById('game'), ctx = cv.getContext('2d');
const muteBtn = document.getElementById('mute');
let W = 0, H = 0, DPR = 1, ZOOM = 1;

// ---------- save ----------
function loadSave() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && typeof s === 'object') return { coins: s.coins|0, best: Math.max(1, s.best|0), level: Math.max(1, s.level|0), muted: !!s.muted }; } catch (e) {}
  return { coins: 0, best: 1, level: 1, muted: false };
}
const save = loadSave();
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }

// ---------- audio ----------
let ac = null, master = null, engOsc = null, engGain = null;
function unlockAudio() {
  if (!ac) {
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain(); master.gain.value = save.muted ? 0 : 0.6; master.connect(ac.destination);
      engOsc = ac.createOscillator(); engOsc.type = 'sawtooth'; engOsc.frequency.value = 70;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
      engGain = ac.createGain(); engGain.gain.value = 0.04;
      engOsc.connect(lp); lp.connect(engGain); engGain.connect(master); engOsc.start();
    } catch (e) { ac = null; }
  }
  if (ac && ac.state === 'suspended') ac.resume();
}
function beep(freq, dur = 0.12, type = 'square', vol = 0.15, slide = 0) {
  if (!ac) return;
  const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function boom() {
  if (!ac) return;
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
// Half-screen tap zones: each active pointer belongs to a side; pointers that started on UI (Tap to Continue, HUD) never steer.
const zones = new Map(); // pointerId -> -1 (left) | 1 (right)
let steerCur = 0;
function hudBottom() { return 14 + 124 * Math.max(1, Math.min(1.4, W / 380)); }
addEventListener('keydown', e => { unlockAudio(); keys[e.key.toLowerCase()] = true; if (['arrowleft','arrowright','arrowup','arrowdown',' '].includes(e.key.toLowerCase())) e.preventDefault(); if (e.key === ' ' || e.key === 'Enter') tap(); });
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
cv.addEventListener('pointerdown', e => {
  unlockAudio(); e.preventDefault();
  if (S.state !== 'play') { tap(); return; }          // taps on menus only advance, never steer
  if (e.clientY < hudBottom()) return;                // HUD strip is not a steering zone
  zones.set(e.pointerId, e.clientX < W / 2 ? -1 : 1);  // side is fixed at touch-down: no jitter while finger wiggles
});
const endTouch = e => zones.delete(e.pointerId);
cv.addEventListener('pointerup', endTouch); cv.addEventListener('pointercancel', endTouch); cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') endTouch(e); });
addEventListener('blur', () => { zones.clear(); for (const k in keys) keys[k] = false; });
document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
function zoneState() { let l = false, r = false; for (const v of zones.values()) v < 0 ? (l = true) : (r = true); return { l, r }; }
function steerInput(dt) {
  const z = zoneState();
  let t = 0;
  if (keys['arrowleft'] || keys['a'] || z.l) t -= 1;
  if (keys['arrowright'] || keys['d'] || z.r) t += 1;   // both held -> 0
  const rate = t === 0 ? 7 : 5;                          // ease in, settle back a bit quicker
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
  state: 'play', level: save.level, kills: 0, goal: 10, hp: HP_MAX, coins: save.coins, levelCoins: 0,
  player: null, enemies: [], parts: [], debris: [], coinsOnGround: [], obstacles: [], plateaus: [], craters: [],
  spawnT: 0, iframes: 0, t: 0, flash: 0, clearT: 0, tally: 0, shake: 0, msg: '', msgT: 0,
  stats: { trackSegs: 0, explosions: 0, coinsPicked: 0, hits: 0, spawns: 0 }
};

function makeCar(x, y, a, enemy) {
  return { x, y, a, vx: Math.cos(a) * 100, vy: Math.sin(a) * 100, enemy, r: enemy ? 24 : 15,
    speed: enemy ? 0 : 270, turn: enemy ? 1.7 : 3.4, grip: enemy ? 3.2 : 2.6, bump: 0, lastL: null, lastR: null };
}
function goalFor(l) { return Math.min(30, 10 + (l - 1) * 2); }

function buildLevel() {
  rngSeed = 1234 + S.level * 977;
  S.obstacles = []; S.plateaus = []; S.craters = [];
  const c = WORLD / 2, clear = 260;
  const far = (x, y) => Math.hypot(x - c, y - c) > clear;
  for (let i = 0; i < 7; i++) { // plateaus (decor)
    const x = 150 + rnd() * (WORLD - 300), y = 150 + rnd() * (WORLD - 300), pts = [], n = 7, r = 120 + rnd() * 140;
    for (let k = 0; k < n; k++) { const an = k / n * Math.PI * 2, rr = r * (0.7 + rnd() * 0.5); pts.push([x + Math.cos(an) * rr, y + Math.sin(an) * rr]); }
    S.plateaus.push(pts);
  }
  for (let i = 0; i < 14; i++) S.craters.push({ x: rnd() * WORLD, y: rnd() * WORLD, r: 25 + rnd() * 45 });
  const nObs = 10 + Math.min(10, S.level);
  for (let i = 0; i < nObs; i++) {
    const x = 120 + rnd() * (WORLD - 240), y = 120 + rnd() * (WORLD - 240);
    if (!far(x, y)) continue;
    const kind = rnd();
    if (kind < 0.45) S.obstacles.push({ type: 'tires', x, y, r: 30 });
    else if (kind < 0.75) S.obstacles.push({ type: 'crate', x, y, w: 56, h: 56 });
    else { const hor = rnd() < 0.5; S.obstacles.push({ type: 'barrier', x, y, w: hor ? 130 : 34, h: hor ? 34 : 130 }); }
  }
}
function startLevel() {
  S.state = 'play'; S.kills = 0; S.goal = goalFor(S.level); S.hp = HP_MAX; S.levelCoins = 0;
  S.enemies = []; S.parts = []; S.debris = []; S.coinsOnGround = []; S.spawnT = 1.2; S.iframes = 1.5; S.flash = 0;
  zones.clear(); steerCur = 0;
  S.player = makeCar(WORLD / 2, WORLD / 2, -Math.PI / 2, false);
  tctx.clearRect(0, 0, trackCv.width, trackCv.height);
  buildLevel();
}

// ---------- spawning ----------
function viewRadius() { return Math.hypot(W, H) / 2 / ZOOM; }
function spawnEnemy(x, y) {
  const p = S.player;
  if (x === undefined) {
    const an = Math.random() * Math.PI * 2, d = viewRadius() + 80;
    x = Math.max(40, Math.min(WORLD - 40, p.x + Math.cos(an) * d));
    y = Math.max(40, Math.min(WORLD - 40, p.y + Math.sin(an) * d));
  }
  const e = makeCar(x, y, Math.atan2(p.y - y, p.x - x), true);
  e.speed = 270 * Math.min(0.92, 0.78 + S.level * 0.015);
  e.turn = Math.min(2.3, 1.6 + S.level * 0.05);
  e.vx = Math.cos(e.a) * e.speed * 0.6; e.vy = Math.sin(e.a) * e.speed * 0.6;
  S.enemies.push(e); S.stats.spawns++;
  return e;
}

// ---------- physics ----------
function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
function driveCar(c, steer, dt) {
  c.a += steer * c.turn * dt;
  const tx = Math.cos(c.a) * c.speed, ty = Math.sin(c.a) * c.speed, k = Math.min(1, c.grip * dt);
  c.vx += (tx - c.vx) * k; c.vy += (ty - c.vy) * k;
  c.x += c.vx * dt; c.y += c.vy * dt;
  // arena walls: bounce
  const m = c.r;
  if (c.x < m) { c.x = m; c.vx = Math.abs(c.vx) * 0.5; } if (c.x > WORLD - m) { c.x = WORLD - m; c.vx = -Math.abs(c.vx) * 0.5; }
  if (c.y < m) { c.y = m; c.vy = Math.abs(c.vy) * 0.5; } if (c.y > WORLD - m) { c.y = WORLD - m; c.vy = -Math.abs(c.vy) * 0.5; }
  for (const o of S.obstacles) collideObstacle(c, o);
  drawTracks(c);
}
function collideObstacle(c, o) {
  let nx, ny, d;
  if (o.type === 'tires') {
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
  if (vn < 0) { c.vx -= 1.6 * vn * nx; c.vy -= 1.6 * vn * ny; if (!c.enemy && vn < -120) beep(110, 0.08, 'triangle', 0.12); }
}
function drawTracks(c) {
  const ca = Math.cos(c.a), sa = Math.sin(c.a), back = c.r * 0.7, side = c.r * (c.enemy ? 0.75 : 0.6);
  const L = [c.x - ca * back - sa * side, c.y - sa * back + ca * side], R = [c.x - ca * back + sa * side, c.y - sa * back - ca * side];
  if (c.lastL && Math.hypot(L[0] - c.lastL[0], L[1] - c.lastL[1]) > 4) {
    const slip = Math.abs(angDiff(c.a, Math.atan2(c.vy, c.vx)));
    tctx.strokeStyle = `rgba(110,55,20,${Math.min(0.32, 0.12 + slip * 0.35)})`;
    tctx.lineWidth = (c.enemy ? 7 : 4) * TRACK_SCALE; tctx.lineCap = 'round';
    tctx.beginPath();
    tctx.moveTo(c.lastL[0] * TRACK_SCALE, c.lastL[1] * TRACK_SCALE); tctx.lineTo(L[0] * TRACK_SCALE, L[1] * TRACK_SCALE);
    tctx.moveTo(c.lastR[0] * TRACK_SCALE, c.lastR[1] * TRACK_SCALE); tctx.lineTo(R[0] * TRACK_SCALE, R[1] * TRACK_SCALE);
    tctx.stroke(); S.stats.trackSegs++;
    c.lastL = L; c.lastR = R;
  } else if (!c.lastL) { c.lastL = L; c.lastR = R; }
}

function explode(x, y, big) {
  S.stats.explosions++; S.shake = Math.max(S.shake, 8); boom();
  for (let i = 0; i < (big ? 14 : 9); i++) {
    const an = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 90;
    S.parts.push({ x, y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, r: 14 + Math.random() * 18, life: 0.7 + Math.random() * 0.4, max: 1.1 });
  }
  for (let i = 0; i < 4; i++) {
    const an = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 160;
    S.debris.push({ x, y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, a: Math.random() * 6, va: (Math.random() - 0.5) * 14, kind: i < 3 ? 'tire' : 'chassis', life: 2.5 });
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
  if (engGain && ac) engGain.gain.value = S.state === 'play' ? 0.04 : 0.0;

  if (S.state === 'celebrate') {
    driveCar(S.player, 0, dt);
    S.clearT += dt;
    if (S.clearT > 1.6) { S.state = 'clear'; S.clearT = 0; S.tally = 0; beep(523, 0.15, 'triangle', 0.2); setTimeout(() => beep(784, 0.25, 'triangle', 0.2), 150); }
    return;
  }
  if (S.state === 'clear') { S.clearT += dt; S.tally = Math.min(S.levelCoins + bonus(), S.tally + dt * 30); return; }
  if (S.state !== 'play') return;

  const p = S.player;
  driveCar(p, steerInput(dt), dt);
  if (engOsc) engOsc.frequency.value = 70 + Math.hypot(p.vx, p.vy) * 0.12;
  if (S.iframes > 0) S.iframes -= dt;

  // spawn
  S.spawnT -= dt;
  const maxE = Math.min(9, 3 + Math.floor(S.level / 2));
  if (S.spawnT <= 0) {
    if (S.enemies.length < maxE) spawnEnemy();
    S.spawnT = Math.max(0.9, 2.2 - S.level * 0.08);
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
      explode(mx, my, true);
      if (Math.random() < 0.6) dropCoin(mx, my);
    }
  }
  if (dead.size) {
    S.enemies = S.enemies.filter(e => !dead.has(e));
    S.kills = Math.min(S.goal, S.kills + dead.size);
    beep(660, 0.1, 'square', 0.1); setTimeout(() => beep(880, 0.12, 'square', 0.1), 80);
  }
  // enemy-player
  for (const e of S.enemies) {
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
    if (d < p.r + e.r - 4) {
      const nx = dx / d, ny = dy / d;
      e.vx -= nx * 260; e.vy -= ny * 260; e.x -= nx * 6; e.y -= ny * 6;
      if (S.iframes <= 0) {
        S.hp = Math.max(0, S.hp - 3); S.iframes = 1.5; S.stats.hits++; S.shake = 10;
        p.vx += nx * 220; p.vy += ny * 220;
        beep(200, 0.25, 'sawtooth', 0.15, -120);
        if (S.hp <= 0) { S.msg = 'Oops! Try again!'; S.msgT = 2; startLevel(); return; }
      }
    }
  }
  // coins
  for (const c of S.coinsOnGround) {
    c.t += dt;
    if (Math.hypot(c.x - p.x, c.y - p.y) < p.r + 22) { c.got = true; S.coins++; S.levelCoins++; S.stats.coinsPicked++; save.coins = S.coins; persist(); beep(1200, 0.08, 'square', 0.12); setTimeout(() => beep(1600, 0.1, 'square', 0.12), 60); }
  }
  S.coinsOnGround = S.coinsOnGround.filter(c => !c.got);

  if (S.kills >= S.goal) levelDone();
}
function bonus() { return 5 + S.level; }
function levelDone() {
  S.state = 'celebrate'; S.clearT = 0; S.flash = 1;
  for (const e of S.enemies) explode(e.x, e.y, false);
  S.enemies = []; S.coinsOnGround = [];
  S.parts = S.parts.map(p => ({ ...p, life: 0.3 }));
  S.coins += bonus(); save.coins = S.coins;
  save.best = Math.max(save.best, S.level + 1); save.level = S.level + 1; persist();
  beep(523, 0.12, 'triangle', 0.2); setTimeout(() => beep(659, 0.12, 'triangle', 0.2), 110); setTimeout(() => beep(784, 0.3, 'triangle', 0.2), 220);
  // confetti
  for (let i = 0; i < 40; i++) { const an = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, sp = 150 + Math.random() * 250; S.parts.push({ x: S.player.x, y: S.player.y - 30, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, r: 4, life: 1.5, max: 1.5, confetti: ['#ff4f7b','#ffd23f','#3ee0ff','#7cff6b','#b06bff'][i % 5] }); }
}
function tap() {
  if (S.state === 'clear' && S.clearT > 0.6) { S.level++; S.coins = save.coins; startLevel(); beep(880, 0.08, 'square', 0.1); }
}

// ---------- drawing ----------
const COL = { sand: '#d98a4b', sand2: '#e39a5c', plateau: '#e8a868', plateauEdge: '#c47538', crater: '#c97a3e' };
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function drawCar(c, blink) {
  if (blink) return;
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a);
  ctx.fillStyle = 'rgba(0,0,0,.18)'; rr(ctx, -c.r + 3, -c.r * 0.8 + 4, c.r * 2, c.r * 1.6, 6); ctx.fill();
  if (c.enemy) {
    ctx.fillStyle = '#1b1f2a';
    for (const [tx, ty] of [[-14, -20], [10, -20], [-14, 13], [10, 13]]) { rr(ctx, tx, ty, 14, 8, 3); ctx.fill(); }
    ctx.fillStyle = '#1e5aa8'; rr(ctx, -22, -13, 44, 26, 6); ctx.fill();
    ctx.fillStyle = '#2f7fd6'; rr(ctx, -12, -10, 22, 20, 4); ctx.fill();
    ctx.fillStyle = '#9fe3ff'; rr(ctx, 4, -9, 6, 18, 2); ctx.fill();
    ctx.fillStyle = '#ffe28a'; ctx.fillRect(19, -11, 3, 5); ctx.fillRect(19, 6, 3, 5);
  } else {
    ctx.fillStyle = '#20242d';
    for (const [tx, ty] of [[-11, -10], [5, -10], [-11, 7], [5, 7]]) { ctx.fillRect(tx, ty, 8, 3); }
    ctx.fillStyle = '#22d3ee'; rr(ctx, -14, -8, 28, 16, 4); ctx.fill();
    ctx.fillStyle = '#e0fbff'; rr(ctx, -4, -6, 9, 12, 2); ctx.fill();
    ctx.fillStyle = '#0e9fbf'; ctx.fillRect(-12, -6, 5, 12);
    ctx.fillStyle = '#fff6a0'; ctx.fillRect(12, -7, 2, 4); ctx.fillRect(12, 3, 2, 4);
  }
  ctx.restore();
}
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
  ctx.fillStyle = '#b8682e'; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2 + (Math.random() - 0.5) * sh, H / 2 + (Math.random() - 0.5) * sh); ctx.scale(ZOOM, ZOOM); ctx.translate(-p.x, -p.y);
  ctx.fillStyle = COL.sand; ctx.fillRect(0, 0, WORLD, WORLD);
  for (const c of S.craters) {
    ctx.fillStyle = COL.crater; ctx.beginPath(); ctx.ellipse(c.x, c.y, c.r, c.r * 0.8, 0, 0, 7); ctx.fill();
    ctx.fillStyle = COL.sand2; ctx.beginPath(); ctx.ellipse(c.x + 3, c.y + 3, c.r * 0.75, c.r * 0.6, 0, 0, 7); ctx.fill();
  }
  for (const pts of S.plateaus) {
    ctx.fillStyle = COL.plateauEdge; ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x + 6, y + 8) : ctx.moveTo(x + 6, y + 8)); ctx.fill();
    ctx.fillStyle = COL.plateau; ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.fill();
  }
  ctx.drawImage(trackCv, 0, 0, WORLD, WORLD);
  ctx.strokeStyle = '#8f4f22'; ctx.lineWidth = 14; ctx.strokeRect(-7, -7, WORLD + 14, WORLD + 14);
  for (const o of S.obstacles) {
    if (o.type === 'tires') {
      for (const [dx, dy] of [[-12, -10], [12, -10], [0, 10]]) {
        ctx.fillStyle = '#2a2a2e'; ctx.beginPath(); ctx.arc(o.x + dx, o.y + dy, 13, 0, 7); ctx.fill();
        ctx.fillStyle = '#7a5a40'; ctx.beginPath(); ctx.arc(o.x + dx, o.y + dy, 5, 0, 7); ctx.fill();
      }
    } else if (o.type === 'crate') {
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(o.x - o.w / 2 + 5, o.y - o.h / 2 + 6, o.w, o.h);
      ctx.fillStyle = '#b5773e'; ctx.fillRect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
      ctx.strokeStyle = '#7d4d22'; ctx.lineWidth = 4; ctx.strokeRect(o.x - o.w / 2 + 2, o.y - o.h / 2 + 2, o.w - 4, o.h - 4);
      ctx.beginPath(); ctx.moveTo(o.x - o.w / 2 + 4, o.y - o.h / 2 + 4); ctx.lineTo(o.x + o.w / 2 - 4, o.y + o.h / 2 - 4); ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(o.x - o.w / 2 + 5, o.y - o.h / 2 + 6, o.w, o.h);
      ctx.fillStyle = '#c9c4bb'; ctx.fillRect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
      ctx.fillStyle = '#e04b3a'; const hor = o.w > o.h;
      for (let i = 0; i < 3; i++) hor ? ctx.fillRect(o.x - o.w / 2 + 12 + i * 42, o.y - o.h / 2 + 4, 18, o.h - 8) : ctx.fillRect(o.x - o.w / 2 + 4, o.y - o.h / 2 + 12 + i * 42, o.w - 8, 18);
    }
  }
  for (const c of S.coinsOnGround) drawCoin(c.x, c.y, 14, c.t + c.x);
  for (const d of S.debris) {
    ctx.save(); ctx.globalAlpha = Math.min(1, d.life); ctx.translate(d.x, d.y); ctx.rotate(d.a);
    if (d.kind === 'tire') { ctx.fillStyle = '#1b1f2a'; rr(ctx, -7, -4, 14, 8, 3); ctx.fill(); }
    else { ctx.fillStyle = '#1e5aa8'; rr(ctx, -12, -8, 24, 16, 4); ctx.fill(); ctx.fillStyle = '#3a3a3a'; ctx.fillRect(-6, -4, 10, 8); }
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
  pill(12, top + 28, HP_MAX * (segW + gap) + 8, 16, 0.35);
  for (let i = 0; i < HP_MAX; i++) { ctx.fillStyle = i < S.hp ? (S.hp <= 6 ? '#ff6b6b' : '#ffffff') : 'rgba(255,255,255,.18)'; ctx.fillRect(17 + i * (segW + gap), top + 31, segW, 10); }
  // coins
  const ct = String(S.coins); ctx.font = '900 24px "Trebuchet MS",system-ui'; const tw = ctx.measureText(ct).width;
  drawCoin(w - 30 - tw - 22, top + 16, 15, 0); txt(ct, w - 18, top + 17, 24, '#fff', 'right');
  // level + objective
  pill(w / 2 - 46, top + 50, 92, 24, 0.3); txt('Level ' + S.level, w / 2, top + 62, 15);
  pill(w / 2 - 70, top + 80, 140, 44, 0.3); crashIcon(w / 2 - 36, top + 102); txt(`${S.kills}/${S.goal}`, w / 2 + 22, top + 102, 26);
  if (S.state === 'play') { const z = zoneState(), hh = H / sc;
    for (const [side, on] of [[-1, z.l || keys['arrowleft'] || keys['a']], [1, z.r || keys['arrowright'] || keys['d']]]) {
      ctx.globalAlpha = on ? 0.55 : 0.16; const x = side < 0 ? 22 : w - 22;
      txt(side < 0 ? '◀' : '▶', x, hh * 0.6, 30); ctx.globalAlpha = 1; } }
  if (S.msgT > 0) txt(S.msg, w / 2, top + 150, 26, '#ffd23f');
  if (S.state === 'play' && S.t < 4 && S.level === save.best && S.kills === 0) { ctx.globalAlpha = Math.max(0, Math.min(1, 4 - S.t)); txt('Tap LEFT / RIGHT to steer!', w / 2, H / sc - 110, 24); txt('Make the trucks crash!', w / 2, H / sc - 78, 20, '#ffd23f'); ctx.globalAlpha = 1; }
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
  if (t > 0.6) { const pulse = 1 + Math.sin(t * 5) * 0.05; ctx.save(); ctx.translate(0, 130); ctx.scale(pulse, pulse); ctx.fillStyle = '#22c55e'; rr(ctx, -130, -32, 260, 64, 32); ctx.fill(); txt('Tap to Continue', 0, 0, 26); ctx.restore(); }
  ctx.restore();
}
function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawWorld();
  if (S.state !== 'clear') drawHUD();
  if (S.state === 'clear') drawClear();
  if (S.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(1, S.flash)})`; ctx.fillRect(0, 0, W, H); }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(1 / 30, (now - last) / 1000); last = now;
  update(dt); render();
  requestAnimationFrame(frame);
}
startLevel();
requestAnimationFrame(frame);

// test / debug hook
window.DD = { zones, get steer() { return steerCur; }, S, spawnEnemy, save, SAVE_KEY, levelDone, startLevel };
})();
