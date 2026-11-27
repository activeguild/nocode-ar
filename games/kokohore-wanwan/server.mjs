// ここほれワンワン — オンライン対戦サーバ（依存パッケージなし）
// 状態はサーバが持ち、各プレイヤーには viewFor() で絞った情報だけを SSE で配る。
//   node server.mjs            → http://localhost:8787
//   PORT=3000 node server.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as Sim from './public/sim.js';

const PORT = +(process.env.PORT || 8787);
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/client.js': ['client.js', 'text/javascript; charset=utf-8'],
  '/sim.js': ['sim.js', 'text/javascript; charset=utf-8'],
};
const TICK = 1 / 20;
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 4; // 足りない分は CPU で埋める
const BOT_NAMES = ['ポチ', 'ハナ', 'ゴン', 'シロ'];
const BOT_BREEDS = ['bulldog', 'dachs', 'collie', 'shiba'];

const rooms = new Map();

function getRoom(code) {
  let r = rooms.get(code);
  if (!r) {
    r = { code, phase: 'lobby', members: new Map(), game: null, timer: null, nextId: 1, emptySince: 0 };
    rooms.set(code, r);
  }
  return r;
}

function broadcast(room) {
  const lobby = [...room.members.values()].map((m) => ({ id: m.id, name: m.name, breed: m.breed }));
  for (const m of room.members.values()) {
    if (!m.res) continue;
    const msg = { phase: room.phase, lobby, you: m.id };
    if (room.game) msg.view = Sim.viewFor(room.game, m.id);
    m.res.write(`data: ${JSON.stringify(msg)}\n\n`);
  }
}

function startGame(room) {
  const roster = [...room.members.values()].map((m) => ({ id: m.id, name: m.name, breed: m.breed, bot: false }));
  for (let i = 0; roster.length < MIN_PLAYERS; i++) {
    roster.push({ id: `cpu${i}`, name: BOT_NAMES[i % 4], breed: BOT_BREEDS[i % 4], bot: true });
  }
  room.game = Sim.createGame(randomBytes(4).readInt32LE(0), roster);
  room.phase = 'play';
  clearInterval(room.timer);
  room.timer = setInterval(() => {
    const inputs = {};
    for (const m of room.members.values()) inputs[m.id] = m.input;
    Sim.step(room.game, inputs, TICK);
    if (room.game.phase === 'end') {
      room.phase = 'end';
      clearInterval(room.timer);
      room.timer = null;
    }
    broadcast(room);
  }, TICK * 1000);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 4096) {
        reject(new Error('too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const cleanCode = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
const clamp1 = (n) => Math.max(-1, Math.min(1, Number.isFinite(+n) ? +n : 0));

function auth(body) {
  const room = rooms.get(cleanCode(body.room));
  const member = room && room.members.get(String(body.token || ''));
  return member ? { room, member } : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
      return res.end(await readFile(path.join(PUBLIC, file)));
    }
    if (req.method === 'GET' && url.pathname === '/api/ping') return send(res, 200, { ok: true });

    if (req.method === 'POST' && url.pathname === '/api/join') {
      const body = await readJson(req);
      const code = cleanCode(body.room);
      if (!code) return send(res, 400, { error: '合言葉は半角英数字で入力してください' });
      const room = getRoom(code);
      if (room.phase === 'play') return send(res, 409, { error: 'この部屋は対戦中です。終わるまで待つか、別の合言葉を使ってください' });
      if (room.members.size >= MAX_PLAYERS) return send(res, 409, { error: `この部屋は満員です（${MAX_PLAYERS}人まで）` });
      const token = randomBytes(12).toString('hex');
      const name = String(body.name || '').replace(/[<>&"']/g, '').trim().slice(0, 10) || `ななし${room.nextId}`;
      const member = {
        id: `p${room.nextId++}`,
        name,
        breed: Sim.BREEDS[body.breed] ? body.breed : 'shiba',
        input: { mx: 0, my: 0, dig: false, skill: false },
        res: null,
      };
      room.members.set(token, member);
      return send(res, 200, { id: member.id, token, room: code });
    }

    if (req.method === 'GET' && url.pathname === '/api/stream') {
      const a = auth({ room: url.searchParams.get('room'), token: url.searchParams.get('token') });
      if (!a) return send(res, 403, { error: '部屋が見つかりません' });
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
      });
      a.member.res = res;
      broadcast(a.room);
      req.on('close', () => {
        if (a.member.res !== res) return;
        a.member.res = null;
        a.member.input = { mx: 0, my: 0, dig: false, skill: false };
        if (a.room.phase !== 'play') {
          // 待合室で抜けた人は名簿から外す。対戦中に抜けた人の犬はその場に残る
          for (const [t, m] of a.room.members) if (m === a.member) a.room.members.delete(t);
          broadcast(a.room);
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/input') {
      const body = await readJson(req);
      const a = auth(body);
      if (!a) return send(res, 403, { error: '部屋が見つかりません' });
      const i = a.member.input;
      i.mx = clamp1(body.mx);
      i.my = clamp1(body.my);
      i.dig = !!body.dig;
      if (body.skill) i.skill = true;
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/start') {
      const a = auth(await readJson(req));
      if (!a) return send(res, 403, { error: '部屋が見つかりません' });
      if (a.room.phase !== 'play') startGame(a.room);
      return send(res, 200, { ok: true });
    }

    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 400, { error: 'リクエストを読み取れませんでした' });
  }
});

// だれも接続していない部屋を片付ける
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const connected = [...room.members.values()].some((m) => m.res);
    if (connected) {
      room.emptySince = 0;
    } else if (!room.emptySince) {
      room.emptySince = now;
    } else if (now - room.emptySince > 60_000) {
      clearInterval(room.timer);
      rooms.delete(code);
    }
  }
}, 15_000).unref();

server.listen(PORT, () => console.log(`ここほれワンワン: http://localhost:${PORT}`));
