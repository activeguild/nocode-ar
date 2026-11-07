import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { Db } from './db.ts'
import { nowIso } from './db.ts'
import { newId, newSessionId } from './ids.ts'

export const SESSION_COOKIE = 'sid'
const SESSION_DAYS = 30
const LOCK_MAX_FAILS = 10
const LOCK_MINUTES = 15

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

/** FR-1-2: 連続失敗 10 回で 15 分ロック（プロセス内メモリ） */
const failures = new Map<string, { count: number; lockedUntil: number }>()

export function isLocked(email: string): boolean {
  const f = failures.get(email)
  return !!f && f.lockedUntil > Date.now()
}
export function recordFailure(email: string) {
  const f = failures.get(email) ?? { count: 0, lockedUntil: 0 }
  f.count += 1
  if (f.count >= LOCK_MAX_FAILS) {
    f.lockedUntil = Date.now() + LOCK_MINUTES * 60_000
    f.count = 0
  }
  failures.set(email, f)
}
export function clearFailures(email: string) {
  failures.delete(email)
}
export function resetLockState() {
  failures.clear()
}

export function createUser(db: Db, email: string, password: string): AuthUser {
  const id = newId()
  db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(id, email, hashPassword(password), nowIso())
  return { id, email }
}

export function findUserByEmail(db: Db, email: string): (AuthUser & { passwordHash: string }) | null {
  const row = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').get(email) as
    | { id: string; email: string; password_hash: string }
    | undefined
  return row ? { id: row.id, email: row.email, passwordHash: row.password_hash } : null
}

export function createSession(db: Db, userId: string): string {
  const id = newSessionId()
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString()
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(id, userId, nowIso(), expires)
  return id
}

export function deleteSession(db: Db, id: string) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

export function sessionCookie(id: string, secure: boolean, clear = false): string {
  const parts = [`${SESSION_COOKIE}=${clear ? '' : id}`, 'Path=/', 'HttpOnly', 'SameSite=Lax']
  if (secure) parts.push('Secure')
  parts.push(clear ? 'Max-Age=0' : `Max-Age=${SESSION_DAYS * 86400}`)
  return parts.join('; ')
}

/** セッション Cookie からユーザーを解決する（認証必須ではない） */
export function attachUser(db: Db) {
  const stmt = db.prepare(
    'SELECT s.id AS sid, u.id AS id, u.email AS email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?',
  )
  return (req: Request, _res: Response, next: NextFunction) => {
    const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE]
    if (sid) {
      const row = stmt.get(sid, nowIso()) as { sid: string; id: string; email: string } | undefined
      if (row) {
        req.user = { id: row.id, email: row.email }
        req.sessionId = row.sid
      }
    }
    next()
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
  const host = req.headers.host
  try {
    if (new URL(origin).host === host) return next()
  } catch {
    /* fallthrough */
  }
  res.status(403).json({ error: '不正なリクエスト元です' })
}
