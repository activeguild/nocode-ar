import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { Db } from './db.js'
import { nowIso, num, one } from './db.js'
import { newId, newSessionId } from './ids.js'

export const SESSION_COOKIE = 'sid'
const SESSION_DAYS = 30
const LOCK_MAX_FAILS = 10
const LOCK_MINUTES = 15
/** D-21: ロック中も 60 秒に 1 回だけ照合を許可する */
const LOCK_SLOW_INTERVAL_MS = 60_000

// パスワードは scrypt（Node 組み込み。ネイティブ依存なし）
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

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser
    sessionId?: string
  }
}

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
export function attachUser(db: Db) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE]
    if (!sid) return next()
    one<{ sid: string; id: string; email: string }>(
      db,
      'SELECT s.id AS sid, u.id AS id, u.email AS email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1 AND s.expires_at > $2',
      [sid, nowIso()],
    )
      .then((row) => {
        if (row) {
          req.user = { id: row.id, email: row.email }
          req.sessionId = row.sid
        }
        next()
      })
      .catch(next)
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'ログインが必要です' })
    return
  }
  next()
}

/** 状態変更リクエストの Origin 検査（NFR-9） */
export function checkOrigin(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const origin = req.headers.origin
  if (!origin) return next() // ブラウザ以外（テスト・curl）
  const hosts = [req.headers.host, req.headers['x-forwarded-host']].flat().filter(Boolean).map((h) => String(h).split(',')[0].trim())
  try {
    if (hosts.includes(new URL(origin).host)) return next()
  } catch {
    /* fallthrough */
  }
  res.status(403).json({ error: '不正なリクエスト元です' })
}
