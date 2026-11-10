import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { Buffer } from 'node:buffer'
import type { Context, MiddlewareHandler } from 'hono'
import type { Db } from './db.js'
import { nowIso, num, one } from './db.js'
import { newId, newSessionId } from './ids.js'

export const SESSION_COOKIE = 'sid'
const SESSION_DAYS = 30
const LOCK_MAX_FAILS = 10
const LOCK_MINUTES = 15
/** D-21: ロック中も 60 秒に 1 回だけ照合を許可する */
const LOCK_SLOW_INTERVAL_MS = 60_000

// パスワードは scrypt（node:crypto。Cloudflare Workers の nodejs_compat でも利用可）
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 })
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, saltB64, hashB64] = stored.split('$')
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 })
  return timingSafeEqual(expected, actual)
}

/** 定数時間の文字列比較 */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

export interface AuthUser {
  id: string
  email: string
}

export type AppVariables = { user?: AuthUser; sessionId?: string }
export type AppContext = Context<{ Variables: AppVariables }>

// ---- ログインロック（DB。サーバレスではプロセス内メモリに置けない）
interface LockRow {
  fail_count: number
  locked_until: string | number
  last_attempt: string | number
}

export async function isLocked(db: Db, email: string, now = Date.now()): Promise<boolean> {
  const row = await one<LockRow>(db, 'SELECT fail_count, locked_until, last_attempt FROM login_locks WHERE email = $1', [email])
  if (!row || num(row.locked_until) <= now) return false
  if (now - num(row.last_attempt) >= LOCK_SLOW_INTERVAL_MS) {
    await db.query('UPDATE login_locks SET last_attempt = $2 WHERE email = $1', [email, now])
    return false
  }
  return true
}

export async function recordFailure(db: Db, email: string, now = Date.now()) {
  const row = await one<LockRow>(db, 'SELECT fail_count, locked_until, last_attempt FROM login_locks WHERE email = $1', [email])
  let count = (row ? num(row.fail_count) : 0) + 1
  let lockedUntil = row ? num(row.locked_until) : 0
  if (count >= LOCK_MAX_FAILS) {
    lockedUntil = now + LOCK_MINUTES * 60_000
    count = 0
  }
  await db.query(
    `INSERT INTO login_locks (email, fail_count, locked_until, last_attempt) VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET fail_count = EXCLUDED.fail_count, locked_until = EXCLUDED.locked_until, last_attempt = EXCLUDED.last_attempt`,
    [email, count, lockedUntil, now],
  )
}

export async function clearFailures(db: Db, email: string) {
  await db.query('DELETE FROM login_locks WHERE email = $1', [email])
}

// ---- ユーザー / セッション
export async function createUser(db: Db, email: string, password: string): Promise<AuthUser> {
  const id = newId()
  await db.query('INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, $3, $4)', [id, email, hashPassword(password), nowIso()])
  return { id, email }
}

export async function findUserByEmail(db: Db, email: string): Promise<(AuthUser & { passwordHash: string }) | null> {
  const row = await one<{ id: string; email: string; password_hash: string }>(db, 'SELECT id, email, password_hash FROM users WHERE email = $1', [email])
  return row ? { id: row.id, email: row.email, passwordHash: row.password_hash } : null
}

export async function createSession(db: Db, userId: string): Promise<string> {
  const id = newSessionId()
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString()
  await db.query('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [id, userId, nowIso(), expires])
  return id
}

export async function deleteSession(db: Db, id: string) {
  await db.query('DELETE FROM sessions WHERE id = $1', [id])
}

export function sessionCookie(id: string, secure: boolean, clear = false): string {
  const parts = [`${SESSION_COOKIE}=${clear ? '' : id}`, 'Path=/', 'HttpOnly', 'SameSite=Lax']
  if (secure) parts.push('Secure')
  parts.push(clear ? 'Max-Age=0' : `Max-Age=${SESSION_DAYS * 86400}`)
  return parts.join('; ')
}

/** セッション Cookie からユーザーを解決する（認証必須ではない） */
export function attachUser(db: Db): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    const sid = parseCookies(c.req.header('cookie'))[SESSION_COOKIE]
    if (sid) {
      const row = await one<{ sid: string; id: string; email: string }>(
        db,
        'SELECT s.id AS sid, u.id AS id, u.email AS email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1 AND s.expires_at > $2',
        [sid, nowIso()],
      )
      if (row) {
        c.set('user', { id: row.id, email: row.email })
        c.set('sessionId', row.sid)
      }
    }
    await next()
  }
}

export const requireAuth: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'ログインが必要です' }, 401)
  await next()
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'])

/** 接続元がループバックか（@hono/node-server では c.env.incoming にソケットがある。Workers では判定不能 → false） */
export function isLoopbackPeer(c: Context): boolean {
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming
  const addr = incoming?.socket?.remoteAddress
  return !!addr && LOOPBACK.has(addr)
}

/** D-22: このリクエストで X-Forwarded-* を信頼してよいか */
export function trustForwarded(c: Context, trustProxy: boolean | 'loopback'): boolean {
  if (trustProxy === true) return true
  if (trustProxy === 'loopback') return isLoopbackPeer(c)
  return false
}

/** 状態変更リクエストの Origin 検査（NFR-9） */
export function checkOrigin(trustProxy: boolean | 'loopback'): MiddlewareHandler {
  return async (c, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next()
    const origin = c.req.header('origin')
    if (!origin) return next() // ブラウザ以外（テスト・curl）
    const hosts = [c.req.header('host'), trustForwarded(c, trustProxy) ? c.req.header('x-forwarded-host') : undefined].filter(Boolean).map((h) => String(h).split(',')[0].trim())
    try {
      if (hosts.includes(new URL(origin).host)) return next()
    } catch {
      /* fallthrough */
    }
    return c.json({ error: '不正なリクエスト元です' }, 403)
  }
}
