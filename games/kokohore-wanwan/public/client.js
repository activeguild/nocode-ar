// ここほれワンワン — 画面と操作。ルールは sim.js、ここは「見せる・入力を渡す」だけ。
import * as Sim from './sim.js';

const $ = (id) => document.getElementById(id);
const T = 32; // 1マスの論理ピクセル
const CW = Sim.W * T;
const CH = Sim.H * T;
const COLORS = ['#e4572e', '#4ea5d9', '#f2c14e', '#b07fd6', '#59c9a5', '#ff8fab', '#d0d0d0', '#8bd450'];
const DOG = {
  shiba: { body: '#d98f3c', ear: '#b06a22', belly: '#fbe9c9' },
  bulldog: { body: '#e6dccb', ear: '#a08872', belly: '#ffffff' },
  dachs: { body: '#6b3f24', ear: '#4a2a16', belly: '#a8703f' },
  collie: { body: '#2b2b33', ear: '#17171c', belly: '#ffffff' },
};
const NOSE_TEXT = ['……', 'クンクン', 'ワン！', 'ワンワン！', 'ここほれ！'];
const BOT_NAMES = ['ポチ', 'ハナ', 'ゴン', 'シロ'];

const cv = $('cv');
const ctx = cv.getContext('2d');
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = CW * dpr;
  cv.height = CH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
window.addEventListener('resize', resize);

// ---- 状態 ----
let view = null; // いま描く内容（sim.viewFor の結果）
let driver = null; // { tick(dt), stop() }
let myBreed = 'shiba';
let seenEvent = 0;
const input = { mx: 0, my: 0, dig: false, skill: false };
const keys = new Set();
const smooth = {}; // id -> 補間した表示位置と犬の位置
const fx = []; // 画面効果
let bannerUntil = 0;

// ---- メニュー ----
const breedsEl = $('breeds');
for (const [key, b] of Object.entries(Sim.BREEDS)) {
  const btn = document.createElement('button');
  btn.className = 'breed';
  btn.type = 'button';
  btn.setAttribute('role', 'radio');
  btn.dataset.breed = key;
  btn.innerHTML = `<b><span class="dot" style="background:${DOG[key].body}"></span>${b.name}</b><span class="sk">${b.skill}</span><span class="ds">${b.desc}</span>`;
  btn.addEventListener('click', () => pickBreed(key));
  breedsEl.appendChild(btn);
}
function pickBreed(key) {
  myBreed = key;
  for (const el of breedsEl.children) el.setAttribute('aria-checked', String(el.dataset.breed === key));
  $('skillName').textContent = Sim.BREEDS[key].skill;
  try {
    localStorage.setItem('wanwan.breed', key);
  } catch {}
}
try {
  const saved = localStorage.getItem('wanwan.breed');
  const savedName = localStorage.getItem('wanwan.name');
  if (savedName) $('name').value = savedName;
  pickBreed(Sim.BREEDS[saved] ? saved : 'shiba');
} catch {
  pickBreed('shiba');
}
const myName = () => {
  const n = $('name').value.trim().slice(0, 10) || 'はなさか';
  try {
    localStorage.setItem('wanwan.name', n);
  } catch {}
  return n;
};

function show(id) {
  for (const o of ['menu', 'lobby', 'result']) $(o).hidden = o !== id;
}
function resetRound() {
  seenEvent = 0;
  fx.length = 0;
  for (const k of Object.keys(smooth)) delete smooth[k];
  $('banner').hidden = true;
}

// ---- ひとり用: ブラウザ内でシミュレーションを回す ----
function soloDriver(humanBreed, name) {
  const others = Object.keys(Sim.BREEDS).filter((b) => b !== humanBreed);
  const roster = humanBreed
    ? [{ id: 'me', name, breed: humanBreed, bot: false }, ...others.map((b, i) => ({ id: `cpu${i}`, name: BOT_NAMES[i], breed: b, bot: true }))]
    : Object.keys(Sim.BREEDS).map((b, i) => ({ id: `cpu${i}`, name: BOT_NAMES[i], breed: b, bot: true }));
  const g = Sim.createGame((Math.random() * 2 ** 31) | 0, roster);
  return {
    tick(dt) {
      Sim.step(g, { me: input }, dt);
      view = Sim.viewFor(g, humanBreed ? 'me' : null);
      if (!humanBreed && g.phase === 'end') startDemo();
    },
    again: () => startSolo(),
    stop() {},
  };
}
function startDemo() {
  resetRound();
  driver = soloDriver(null);
}
function startSolo() {
  if (driver) driver.stop();
  resetRound();
  driver = soloDriver(myBreed, myName());
  show(null);
}

// ---- オンライン: サーバが進め、こちらは入力を送って絵を受け取る ----
function onlineDriver(room, token) {
  const es = new EventSource(`api/stream?room=${room}&token=${token}`);
  let phase = 'lobby';
  let lastSent = '';
  let lastAt = 0;
  const post = (path, body) =>
    fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ room, token, ...body }) });
  es.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.phase === 'lobby') {
      $('lobbyList').innerHTML = '';
      for (const m of msg.lobby) {
        const li = document.createElement('li');
        li.textContent = `${m.name}（${Sim.BREEDS[m.breed].name}）${m.id === msg.you ? ' ← あなた' : ''}`;
        $('lobbyList').appendChild(li);
      }
    }
    if (msg.phase === 'play' && phase !== 'play') {
      resetRound();
      show(null);
    }
    phase = msg.phase;
    if (msg.view) view = msg.view;
  };
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) backToMenu('サーバとの接続が切れました');
  };
  return {
    tick() {
      if (phase !== 'play') return;
      const now = performance.now();
      const body = { mx: +input.mx.toFixed(2), my: +input.my.toFixed(2), dig: input.dig, skill: input.skill };
      const s = JSON.stringify(body);
      if ((s !== lastSent && now - lastAt > 50) || input.skill) {
        lastSent = s;
        lastAt = now;
        input.skill = false;
        post('api/input', body).catch(() => {});
      }
    },
    again: () => post('api/start', {}),
    stop: () => es.close(),
  };
}
async function startOnline() {
  const room = $('room').value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  if (!room) return menuError('合言葉を半角英数字で入れてください');
  try {
    const r = await fetch('api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ room, name: myName(), breed: myBreed }),
    });
    const j = await r.json();
    if (!r.ok) return menuError(j.error || '部屋に入れませんでした');
    if (driver) driver.stop();
    resetRound();
    view = null;
    driver = onlineDriver(j.room, j.token);
    history.replaceState(null, '', `?room=${j.room}`);
    $('lobbyCode').textContent = `「${j.room}」`;
    show('lobby');
  } catch {
    menuError('サーバにつながりませんでした');
  }
}
function menuError(text) {
  $('menuErr').textContent = text;
  $('menuErr').hidden = !text;
}
function backToMenu(err) {
  if (driver) driver.stop();
  startDemo();
  show('menu');
  menuError(err || '');
}

$('btnSolo').addEventListener('click', startSolo);
$('btnOnline').addEventListener('click', startOnline);
$('btnStart').addEventListener('click', () => driver.again());
$('btnAgain').addEventListener('click', () => driver.again());
$('btnMenu').addEventListener('click', () => backToMenu());
$('btnCopy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    $('btnCopy').textContent = 'コピーしました';
  } catch {
    $('btnCopy').textContent = location.href;
  }
});

// オンライン対戦はサーバ（node server.mjs）から開いたときだけ出す
fetch('api/ping')
  .then((r) => r.ok && r.json())
  .then((j) => {
    if (!j || !j.ok) return;
    $('onlineRow').hidden = false;
    const q = new URLSearchParams(location.search).get('room');
    if (q) $('room').value = q;
  })
  .catch(() => {});

// ---- 入力 ----
const KEYMAP = { ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r' };
function playing() {
  return view && view.me && view.phase === 'play' && $('menu').hidden && $('lobby').hidden;
}
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || !playing()) return;
  if (KEYMAP[e.code]) keys.add(KEYMAP[e.code]);
  else if (e.code === 'Space') input.dig = true;
  else if ((e.code === 'KeyE' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) input.skill = true;
  else return;
  e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  if (KEYMAP[e.code]) keys.delete(KEYMAP[e.code]);
  if (e.code === 'Space') input.dig = false;
});
window.addEventListener('blur', () => {
  keys.clear();
  input.dig = false;
  stick = null;
});
let stick = null; // 畑をなぞって移動（タッチ）
cv.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' || !playing()) return;
  stick = { id: e.pointerId, x: e.clientX, y: e.clientY, mx: 0, my: 0 };
  cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', (e) => {
  if (!stick || e.pointerId !== stick.id) return;
  const dx = (e.clientX - stick.x) / 36;
  const dy = (e.clientY - stick.y) / 36;
  const m = Math.max(1, Math.hypot(dx, dy));
  stick.mx = dx / m;
  stick.my = dy / m;
});
const endStick = (e) => {
  if (stick && e.pointerId === stick.id) stick = null;
};
cv.addEventListener('pointerup', endStick);
cv.addEventListener('pointercancel', endStick);

const digBtn = $('btnDig');
digBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  input.dig = true;
  digBtn.classList.add('down');
});
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
  digBtn.addEventListener(ev, () => {
    input.dig = false;
    digBtn.classList.remove('down');
  });
}
digBtn.addEventListener('contextmenu', (e) => e.preventDefault());
$('btnSkill').addEventListener('click', () => {
  if (playing()) input.skill = true;
});

function readMove() {
  if (stick) {
    input.mx = stick.mx;
    input.my = stick.my;
    return;
  }
  input.mx = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0);
  input.my = (keys.has('d') ? 1 : 0) - (keys.has('u') ? 1 : 0);
}

// ---- 効果 ----
function addText(x, y, text, color, big) {
  fx.push({ kind: 'text', x: (x + 0.5) * T, y: (y + 0.2) * T, text, color, big, t: 0, life: 1.3 });
}
function handleEvents() {
  for (const e of view.events) {
    if (e.id <= seenEvent) continue;
    seenEvent = e.id;
    const mine = view.me && e.pid === view.me.id;
    if (e.type === 'find') addText(e.x, e.y, `${Sim.KINDS[e.kind].label} +${e.value}`, '#ffe08a', mine || e.kind === 'chest');
    else if (e.type === 'empty' && mine) addText(e.x, e.y, 'からっぽ', '#e8e2d0', false);
    else if (e.type === 'bees') addText(e.x, e.y, 'ハチだ！', '#ff6b4a', true);
    else if (e.type === 'steal') {
      fx.push({ kind: 'line', x: e.fx * T, y: e.fy * T, x2: e.x * T, y2: e.y * T, t: 0, life: 0.5 });
      addText(e.fx - 0.5, e.fy - 1, `-${e.value}`, '#ff6b4a', true);
      addText(e.x - 0.5, e.y - 1, `よこどり +${e.value}`, '#ffe08a', true);
    } else if (e.type === 'skill') {
      if (e.breed === 'bulldog') fx.push({ kind: 'ring', x: e.x * T, y: e.y * T, r: Sim.BARK_R * T, t: 0, life: 0.45 });
      if (e.breed === 'shiba' && mine) fx.push({ kind: 'ring', x: e.x * T, y: e.y * T, r: Sim.RADAR_R * T, t: 0, life: 0.6 });
      addText(e.x - 0.5, e.y - 1.2, Sim.BREEDS[e.breed].skill, '#ffffff', false);
    } else if (e.type === 'finale') {
      $('banner').textContent = '千両箱がうまった！ のこり30秒';
      $('banner').hidden = false;
      bannerUntil = performance.now() + 3500;
    }
  }
}

// ---- 描画 ----
function drawField() {
  ctx.fillStyle = '#6f9d55';
  ctx.fillRect(0, 0, CW, CH);
  ctx.fillStyle = '#69964f';
  for (let y = 0; y < Sim.H; y++) for (let x = (y & 1); x < Sim.W; x += 2) ctx.fillRect(x * T, y * T, T, T);
  // 掘りかけ
  for (const [k, sec] of view.prog) {
    const x = (k % Sim.W) * T + T / 2;
    const y = Math.floor(k / Sim.W) * T + T / 2;
    const r = 5 + Math.min(1, sec / 2.6) * 8;
    ctx.fillStyle = '#8a6a44';
    ctx.beginPath();
    ctx.ellipse(x, y + 2, r, r * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 掘った穴
  for (let k = 0; k < view.dug.length; k++) {
    if (view.dug[k] !== '1') continue;
    const x = (k % Sim.W) * T + T / 2;
    const y = Math.floor(k / Sim.W) * T + T / 2;
    ctx.fillStyle = '#8a6a44';
    ctx.beginPath();
    ctx.ellipse(x, y + 1, 14, 11.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3d2a1a';
    ctx.beginPath();
    ctx.ellipse(x, y + 3, 10.5, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
function drawRevealed(now) {
  for (const it of view.revealed) {
    const x = it.x * T + T / 2;
    const y = it.y * T + T / 2;
    const bees = it.kind === 'bees';
    const pulse = 1 + Math.sin(now / 130) * 0.12;
    ctx.strokeStyle = bees ? '#ff5a3c' : '#ffe08a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 11 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    label(Sim.KINDS[it.kind].label, x, y - 16, 11, bees ? '#ffb4a3' : '#fff3c4');
  }
}
function label(text, x, y, size, color) {
  ctx.font = `700 ${size}px "Zen Maru Gothic", "Hiragino Maru Gothic ProN", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(24,32,58,.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
function drawDog(x, y, breed, faceLeft, hop, digging, now) {
  const c = DOG[breed];
  const long = breed === 'dachs' ? 1.35 : 1;
  const dir = faceLeft ? -1 : 1;
  ctx.save();
  ctx.translate(x, y - hop);
  ctx.scale(dir, 1);
  if (digging) ctx.rotate(0.25 + Math.sin(now / 50) * 0.08);
  // しっぽ
  ctx.strokeStyle = c.body;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-8 * long, -2);
  ctx.quadraticCurveTo(-13 * long, -8 + Math.sin(now / 90) * 3, -10 * long, -11);
  ctx.stroke();
  // 体
  ctx.fillStyle = c.body;
  ctx.beginPath();
  ctx.ellipse(0, 0, 9 * long, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = c.belly;
  ctx.beginPath();
  ctx.ellipse(2 * long, 3, 5 * long, 2.6, 0, 0, Math.PI * 2);
  ctx.fill();
  // 頭
  ctx.fillStyle = c.body;
  ctx.beginPath();
  ctx.arc(8 * long, -5, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = c.ear;
  ctx.beginPath();
  ctx.moveTo(5 * long, -9);
  ctx.lineTo(7 * long, -14);
  ctx.lineTo(9.5 * long, -9.5);
  ctx.fill();
  ctx.fillStyle = c.belly;
  ctx.beginPath();
  ctx.arc(11.5 * long, -3.5, 2.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1b1b1b';
  ctx.beginPath();
  ctx.arc(13.5 * long, -4, 1.3, 0, Math.PI * 2);
  ctx.arc(8.5 * long, -6.5, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
function drawPlayer(p, s, now, dt) {
  const px = s.x * T;
  const py = s.y * T;
  const col = COLORS[p.color % COLORS.length];
  const me = view.me && p.id === view.me.id;
  const lvl = me ? view.me.sniff : 0;
  // 犬は少し後ろをついてくる。真上に来たら飼い主の足もとで跳ねる
  const tx = lvl === 4 ? s.x + 0.35 : s.x - p.fx * 0.75 + 0.1;
  const ty = lvl === 4 ? s.y + 0.3 : s.y - p.fy * 0.75 + 0.25;
  const k = Math.min(1, dt * 7);
  s.dx += (tx - s.dx) * k;
  s.dy += (ty - s.dy) * k;
  const hop = lvl >= 3 ? Math.abs(Math.sin(now / (lvl === 4 ? 90 : 160))) * (lvl === 4 ? 7 : 4) : 0;
  const dogX = s.dx * T;
  const dogY = s.dy * T;

  // 影
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.beginPath();
  ctx.ellipse(px, py + 9, 9, 4, 0, 0, Math.PI * 2);
  ctx.ellipse(dogX, dogY + 7, 9, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  drawDog(dogX, dogY, p.breed, s.dx > s.x, hop, p.digging, now);

  // 飼い主（はんてん姿）
  const bob = p.digging ? Math.sin(now / 60) * 2 : 0;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.roundRect(px - 7, py - 6 + bob, 14, 15, 5);
  ctx.fill();
  ctx.fillStyle = '#f3d2b0';
  ctx.beginPath();
  ctx.arc(px, py - 11 + bob, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2a2320';
  ctx.beginPath();
  ctx.arc(px, py - 13 + bob, 6, Math.PI, 0);
  ctx.fill();
  if (me) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(px, py + 9, 12, 5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (p.buff) {
    ctx.strokeStyle = '#ffe08a';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -now / 30;
    ctx.beginPath();
    ctx.arc(dogX, dogY - 2, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (p.digging) {
    // 土しぶき
    ctx.fillStyle = '#8a6a44';
    for (let i = 0; i < 4; i++) {
      const a = now / 70 + i * 1.7;
      ctx.beginPath();
      ctx.arc(px + Math.cos(a) * 13, py + 6 - Math.abs(Math.sin(a * 1.3)) * 12, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (p.stun) {
    for (let i = 0; i < 3; i++) {
      const a = now / 150 + (i * Math.PI * 2) / 3;
      label('★', px + Math.cos(a) * 10, py - 24 + Math.sin(a) * 3, 10, '#ffe08a');
    }
  }
  label(p.name, px, py - 27 - (p.stun ? 8 : 0), 11, me ? '#ffffff' : '#e8ecff');
  // 吹き出しが自分の名前に重ならないよう、犬が近いときは名前の上に出す
  if (me && lvl > 0) bubble(NOSE_TEXT[lvl], dogX, Math.abs(dogX - px) < 34 ? Math.min(dogY - 22 - hop, py - 44) : dogY - 22 - hop, lvl);
}
function bubble(text, x, y, lvl) {
  ctx.font = `700 ${lvl === 4 ? 14 : 11}px "Zen Maru Gothic", sans-serif`;
  const w = ctx.measureText(text).width + 12;
  const h = lvl === 4 ? 22 : 18;
  x = Math.max(w / 2 + 2, Math.min(CW - w / 2 - 2, x));
  y = Math.max(h / 2 + 2, y);
  ctx.fillStyle = lvl === 4 ? '#e4572e' : '#ffffff';
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 8);
  ctx.fill();
  ctx.fillStyle = lvl === 4 ? '#ffffff' : '#18203a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 1);
}
function drawFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.t += dt;
    const a = 1 - f.t / f.life;
    if (a <= 0) {
      fx.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = Math.min(1, a * 2);
    if (f.kind === 'text') label(f.text, Math.max(40, Math.min(CW - 40, f.x)), Math.max(12, f.y - f.t * 26), f.big ? 16 : 12, f.color);
    else if (f.kind === 'ring') {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * (f.t / f.life), 0, Math.PI * 2);
      ctx.stroke();
    } else if (f.kind === 'line') {
      ctx.strokeStyle = '#ffe08a';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(f.x, f.y);
      ctx.lineTo(f.x2, f.y2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }
}

// ---- HUD ----
let hudKey = '';
function updateHud() {
  const t = Math.ceil(view.time);
  $('timer').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  $('timer').classList.toggle('hurry', view.time <= 30 && view.phase === 'play');
  const lvl = view.me ? view.me.sniff : 0;
  $('nose').dataset.level = lvl;
  $('noseText').textContent = NOSE_TEXT[lvl];
  const ranked = [...view.players].sort((a, b) => b.score - a.score);
  const key = ranked.map((p) => `${p.id}:${p.score}`).join(',');
  if (key !== hudKey) {
    hudKey = key;
    $('scores').innerHTML = '';
    for (const p of ranked) {
      const li = document.createElement('li');
      if (view.me && p.id === view.me.id) li.className = 'me';
      li.innerHTML = `<span class="chip" style="background:${COLORS[p.color % COLORS.length]}"></span><span></span><span class="pt">${p.score}</span>`;
      li.children[1].textContent = p.name;
      $('scores').appendChild(li);
    }
  }
  const sk = $('btnSkill');
  if (view.me) {
    const cooling = view.me.cd > 0;
    sk.classList.toggle('cooling', cooling);
    $('skillName').textContent = cooling ? `あと${Math.ceil(view.me.cd)}秒` : Sim.BREEDS[myBreed].skill;
  }
  if (bannerUntil && performance.now() > bannerUntil) {
    $('banner').hidden = true;
    bannerUntil = 0;
  }
  if (view.phase === 'end' && view.me && $('result').hidden && $('menu').hidden && $('lobby').hidden) showResult(ranked);
}
function showResult(ranked) {
  const meRank = ranked.findIndex((p) => p.id === view.me.id) + 1;
  $('resultTitle').textContent = meRank === 1 ? '大判小判がざっくざく！ あなたの勝ち' : `${meRank}位でした`;
  $('resultList').innerHTML = '';
  ranked.forEach((p, i) => {
    const li = document.createElement('li');
    if (p.id === view.me.id) li.className = 'me';
    li.innerHTML = `<span class="rank">${i + 1}位</span><span class="nm"></span><span class="pt">${p.score}両</span>`;
    li.children[1].textContent = `${p.name}（${Sim.BREEDS[p.breed].name}・${p.found}個）`;
    $('resultList').appendChild(li);
  });
  show('result');
  input.dig = false;
  keys.clear();
}

// ---- メインループ ----
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  readMove();
  if (!playing()) {
    input.mx = 0;
    input.my = 0;
  }
  if (driver) driver.tick(dt);
  if (view) {
    handleEvents();
    drawField();
    drawRevealed(now);
    const k = Math.min(1, dt * 18);
    const order = [...view.players].sort((a, b) => a.y - b.y);
    for (const p of order) {
      const s = smooth[p.id] || (smooth[p.id] = { x: p.x, y: p.y, dx: p.x, dy: p.y });
      s.x += (p.x - s.x) * k;
      s.y += (p.y - s.y) * k;
      drawPlayer(p, s, now, dt);
    }
    drawFx(dt);
    updateHud();
  }
  requestAnimationFrame(frame);
}

startDemo();
requestAnimationFrame(frame);
