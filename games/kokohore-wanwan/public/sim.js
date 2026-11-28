// ここほれワンワン — ゲームルール本体（描画・通信に依存しない純粋なシミュレーション）
// ブラウザ（ひとり用）と Node サーバ（オンライン対戦）の両方から同じコードを使う。
// Roblox / Steam へ移植するときは、このファイルのルールと数値をそのまま写せばよい。

const W = 26;
const H = 16;
const MATCH = 120; // 1試合の秒数
const FINALE_AT = 30; // 残り何秒で千両箱が追加されるか
const SPEED = 4.2; // マス/秒
const MAX_DEPTH = 3; // 1マスを何層まで掘れるか
const LAYER_NEED = [0.8, 1.1, 1.5]; // 1層目・2層目・3層目を掘り切る秒数（深いほど固い）

const BREEDS = {
  shiba: { name: '柴犬', skill: 'ここほれレーダー', cd: 14, desc: '5秒間、近くに埋まっている物が見える' },
  bulldog: { name: 'ブルドッグ', skill: '大ほえ', cd: 15, desc: '近くの相手をおどろかせて1.6秒止める' },
  dachs: { name: 'ダックスフンド', skill: '高速ほり', cd: 14, desc: '5秒間、掘る速さが3倍になる' },
  collie: { name: 'ボーダーコリー', skill: 'よこどり', cd: 22, desc: '近くの相手から得点の10%をうばう' },
};

// depth: 埋まっている層の候補 [層, その層になる確率] 。深いほど高い物が出る
const KINDS = {
  coin: { v: 10, label: '小判', depth: [[1, 0.8], [2, 1]] },
  pot: { v: 30, label: 'つぼ', depth: [[2, 0.75], [3, 1]] },
  chest: { v: 100, label: '千両箱', depth: [[3, 1]] },
  bees: { v: 0, label: 'ハチの巣', depth: [[1, 0.5], [2, 1]] },
};

const RADAR_R = 5.5;
const BARK_R = 3.2;
const STEAL_R = 4.5;

const SPAWNS = [
  [3, 3], [W - 3, H - 3], [W - 3, 3], [3, H - 3],
  [W / 2, 2], [W / 2, H - 2], [2, H / 2], [W - 2, H / 2],
];

function rnd(g) {
  g.s = (g.s + 0x6d2b79f5) | 0;
  let t = g.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function pushEvent(g, type, data) {
  g.events.push({ id: ++g.eid, type, ...data });
  if (g.events.length > 40) g.events.shift();
}

function placeItem(g, kind) {
  for (let i = 0; i < 300; i++) {
    const x = Math.floor(rnd(g) * W);
    const y = Math.floor(rnd(g) * H);
    const k = y * W + x;
    if (g.dug[k] >= MAX_DEPTH || g.itemAt[k] >= 0) continue;
    if (g.players.some((p) => Math.floor(p.x) === x && Math.floor(p.y) === y)) continue;
    const r = rnd(g);
    const pick = KINDS[kind].depth.find((d) => r < d[1])[0];
    // すでに掘られた穴の、さらに下に湧くこともある
    const depth = Math.max(pick, g.dug[k] + 1);
    g.itemAt[k] = g.items.length;
    g.items.push({ x, y, kind, depth, found: false });
    return true;
  }
  return false;
}

// roster: [{ id, name, breed, bot }]
function createGame(seed, roster) {
  const g = {
    s: seed | 0,
    time: MATCH,
    phase: 'play',
    finale: false,
    spawnT: 6,
    eid: 0,
    events: [],
    dug: new Array(W * H).fill(0),
    prog: {},
    itemAt: new Array(W * H).fill(-1),
    items: [],
    players: [],
  };
  roster.forEach((r, i) => {
    const sp = SPAWNS[i % SPAWNS.length];
    g.players.push({
      id: r.id,
      name: r.name,
      breed: BREEDS[r.breed] ? r.breed : 'shiba',
      bot: !!r.bot,
      color: i,
      x: Math.floor(sp[0]) + 0.5,
      y: Math.floor(sp[1]) + 0.5,
      fx: 0,
      fy: 1,
      score: 0,
      found: 0,
      stun: 0,
      cd: 3,
      buff: 0,
      reveal: 0,
      digging: false,
      ai: { tx: -1, ty: -1, until: 0, known: false, wait: rnd(g), smart: 0.3 + rnd(g) * 0.25 },
    });
  });
  for (let i = 0; i < 26; i++) placeItem(g, 'coin');
  for (let i = 0; i < 12; i++) placeItem(g, 'pot');
  for (let i = 0; i < 3; i++) placeItem(g, 'chest');
  for (let i = 0; i < 6; i++) placeItem(g, 'bees');
  return g;
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function useSkill(g, p) {
  const b = BREEDS[p.breed];
  if (p.breed === 'shiba') {
    p.reveal = 5;
  } else if (p.breed === 'dachs') {
    p.buff = 5;
  } else if (p.breed === 'bulldog') {
    for (const o of g.players) {
      if (o === p || dist(o.x, o.y, p.x, p.y) > BARK_R) continue;
      o.stun = Math.max(o.stun, 1.6);
      o.digging = false;
    }
  } else if (p.breed === 'collie') {
    let best = null;
    let bd = STEAL_R;
    for (const o of g.players) {
      if (o === p || o.score <= 0) continue;
      const d = dist(o.x, o.y, p.x, p.y);
      if (d <= bd) {
        bd = d;
        best = o;
      }
    }
    if (!best) return; // 相手がいなければ空振りにせず温存
    const amt = Math.min(best.score, Math.max(10, Math.round(best.score * 0.1)));
    best.score -= amt;
    p.score += amt;
    p.cd = b.cd;
    pushEvent(g, 'steal', { pid: p.id, from: best.id, value: amt, x: p.x, y: p.y, fx: best.x, fy: best.y });
    return;
  }
  p.cd = b.cd;
  pushEvent(g, 'skill', { pid: p.id, breed: p.breed, x: p.x, y: p.y });
}

// 1層掘り終えたとき。その層に物があれば掘り当て、もっと下にあれば「まだ下」
function finishLayer(g, p, k, tx, ty) {
  g.dug[k]++;
  delete g.prog[k];
  p.digging = false;
  const ii = g.itemAt[k];
  if (ii < 0) {
    pushEvent(g, 'empty', { pid: p.id, x: tx, y: ty });
    return;
  }
  const it = g.items[ii];
  if (it.depth > g.dug[k]) {
    pushEvent(g, 'deeper', { pid: p.id, x: tx, y: ty });
    return;
  }
  it.found = true;
  g.itemAt[k] = -1;
  if (it.kind === 'bees') {
    p.stun = 2.5;
    pushEvent(g, 'bees', { pid: p.id, x: tx, y: ty });
  } else {
    p.score += KINDS[it.kind].v;
    p.found++;
    pushEvent(g, 'find', { pid: p.id, x: tx, y: ty, kind: it.kind, value: KINDS[it.kind].v });
  }
}

function botInput(g, p, dt) {
  const a = p.ai;
  const inp = { mx: 0, my: 0, dig: false, skill: false };
  if (a.wait > 0) {
    a.wait -= dt;
    return inp;
  }
  const tk = a.ty * W + a.tx;
  // 狙った財宝が出るまで掘り下げる。当てずっぽうのときは1層だけ掘って次へ
  if (a.tx < 0 || g.dug[tk] >= a.until || (a.known && g.itemAt[tk] < 0)) {
    a.known = false;
    // 次に掘る場所を決める。鼻が利く範囲の財宝を smart の確率で当て、外れは近場を適当に掘る
    let best = null;
    let bd = 4.5;
    for (const it of g.items) {
      if (it.found || it.kind === 'bees') continue;
      const d = dist(it.x + 0.5, it.y + 0.5, p.x, p.y);
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    if (best && rnd(g) < a.smart) {
      a.tx = best.x;
      a.ty = best.y;
      a.known = true;
      a.until = MAX_DEPTH;
    } else {
      const far = !best;
      for (let i = 0; i < 30; i++) {
        const r = far ? 9 : 3;
        const x = Math.floor(p.x + (rnd(g) * 2 - 1) * r);
        const y = Math.floor(p.y + (rnd(g) * 2 - 1) * r);
        if (x < 0 || y < 0 || x >= W || y >= H || g.dug[y * W + x] >= MAX_DEPTH) continue;
        a.tx = x;
        a.ty = y;
        a.until = g.dug[y * W + x] + 1;
        break;
      }
    }
    a.wait = 0.5 + rnd(g) * 1.0;
    return inp;
  }
  const dx = a.tx + 0.5 - p.x;
  const dy = a.ty + 0.5 - p.y;
  const d = Math.hypot(dx, dy);
  if (d > 0.05) {
    const m = Math.min(1, d / (SPEED * dt)) / d;
    inp.mx = dx * m;
    inp.my = dy * m;
  } else {
    inp.dig = true;
  }
  if (p.cd <= 0) {
    if (p.breed === 'dachs') inp.skill = inp.dig && rnd(g) < 0.05;
    else if (p.breed === 'shiba') inp.skill = rnd(g) < 0.01;
    else {
      for (const o of g.players) {
        if (o === p) continue;
        const od = dist(o.x, o.y, p.x, p.y);
        if (p.breed === 'bulldog' && od < BARK_R - 0.4 && o.digging && rnd(g) < 0.08) inp.skill = true;
        if (p.breed === 'collie' && od < STEAL_R - 0.5 && o.score >= 60 && rnd(g) < 0.08) inp.skill = true;
      }
    }
  }
  return inp;
}

// inputs: { [playerId]: { mx, my, dig, skill } }。skill は1回使うと step が false に戻す
function step(g, inputs, dt) {
  if (g.phase !== 'play') return;
  g.time -= dt;
  if (!g.finale && g.time <= FINALE_AT) {
    g.finale = true;
    for (let i = 0; i < 3; i++) placeItem(g, 'chest');
    pushEvent(g, 'finale', {});
  }
  // 財宝は少しずつ湧く。掘り尽くされて終盤が退屈にならないように
  g.spawnT -= dt;
  if (g.spawnT <= 0) {
    g.spawnT = 6;
    placeItem(g, rnd(g) < 0.7 ? 'coin' : 'pot');
  }
  for (const p of g.players) {
    p.cd = Math.max(0, p.cd - dt);
    p.buff = Math.max(0, p.buff - dt);
    p.reveal = Math.max(0, p.reveal - dt);
    if (p.stun > 0) {
      p.stun = Math.max(0, p.stun - dt);
      p.digging = false;
      continue;
    }
    const inp = p.bot ? botInput(g, p, dt) : inputs[p.id] || {};
    if (inp.skill) {
      inp.skill = false;
      if (p.cd <= 0) useSkill(g, p);
    }
    let mx = +inp.mx || 0;
    let my = +inp.my || 0;
    const mag = Math.hypot(mx, my);
    if (mag > 1) {
      mx /= mag;
      my /= mag;
    }
    if (mag > 0.02) {
      p.digging = false;
      p.x = Math.min(W - 0.3, Math.max(0.3, p.x + mx * SPEED * dt));
      p.y = Math.min(H - 0.3, Math.max(0.3, p.y + my * SPEED * dt));
      p.fx = mx / Math.min(1, mag);
      p.fy = my / Math.min(1, mag);
    } else if (inp.dig) {
      const tx = Math.floor(p.x);
      const ty = Math.floor(p.y);
      const k = ty * W + tx;
      if (g.dug[k] >= MAX_DEPTH) {
        p.digging = false;
      } else {
        // 掘った量はマスに残る。途中でやめると、あとから来た人に横取りされる
        p.digging = true;
        g.prog[k] = (g.prog[k] || 0) + dt * (p.buff > 0 ? 3 : 1);
        if (g.prog[k] >= LAYER_NEED[g.dug[k]]) finishLayer(g, p, k, tx, ty);
      }
    } else {
      p.digging = false;
    }
  }
  if (g.time <= 0) {
    g.time = 0;
    g.phase = 'end';
    for (const p of g.players) p.digging = false;
  }
}

// 犬の鼻: 0=無反応 1=遠い 2=近い 3=すぐそば 4=この真下
function sniff(g, p) {
  let best = 99;
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  for (const it of g.items) {
    if (it.found || it.kind === 'bees') continue;
    if (it.x === tx && it.y === ty) return 4;
    const d = dist(it.x + 0.5, it.y + 0.5, p.x, p.y);
    if (d < best) best = d;
  }
  return best <= 1.6 ? 3 : best <= 3.2 ? 2 : best <= 5.5 ? 1 : 0;
}

// 足もとの財宝まであと何層か（0=足もとには無い）。ハチの巣には犬は反応しない
function layersBelow(g, p) {
  const k = Math.floor(p.y) * W + Math.floor(p.x);
  const it = g.items[g.itemAt[k]];
  return it && it.kind !== 'bees' ? it.depth - g.dug[k] : 0;
}

// プレイヤーごとに見せてよい情報だけを取り出す（埋まっている場所はサーバから出さない）
function viewFor(g, pid) {
  const me = g.players.find((p) => p.id === pid);
  const r2 = (n) => Math.round(n * 100) / 100;
  return {
    time: g.time,
    phase: g.phase,
    finale: g.finale,
    dug: g.dug.join(''),
    prog: Object.keys(g.prog).map((k) => [+k, r2(g.prog[k])]),
    players: g.players.map((p) => ({
      id: p.id,
      name: p.name,
      breed: p.breed,
      bot: p.bot,
      color: p.color,
      x: r2(p.x),
      y: r2(p.y),
      fx: r2(p.fx),
      fy: r2(p.fy),
      score: p.score,
      found: p.found,
      stun: p.stun > 0,
      digging: p.digging,
      buff: p.buff > 0,
    })),
    me: me
      ? { id: me.id, cd: r2(me.cd), cdMax: BREEDS[me.breed].cd, reveal: me.reveal > 0, sniff: sniff(g, me), layers: layersBelow(g, me) }
      : null,
    revealed:
      me && me.reveal > 0
        ? g.items
            .filter((it) => !it.found && dist(it.x + 0.5, it.y + 0.5, me.x, me.y) <= RADAR_R)
            .map((it) => ({ x: it.x, y: it.y, kind: it.kind, depth: it.depth }))
        : [],
    events: g.events,
  };
}

export { W, H, MATCH, MAX_DEPTH, LAYER_NEED, BREEDS, KINDS, BARK_R, RADAR_R, createGame, step, viewFor };
