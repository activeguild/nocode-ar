// DB アダプタの共通インタフェース。実装は db-neon.ts（Workers → Neon HTTP）、db-pg.ts（Node → PostgreSQL）、db-pglite.ts（ローカル / テスト）。
import { MIGRATIONS } from './migrations.js'

export interface QueryResult<T> {
  rows: T[]
}
export interface Queryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>>
  /** 複数文の SQL（マイグレーション等）。パラメータなし */
  exec(sql: string): Promise<void>
}
export interface Db extends Queryable {
  kind: 'pg' | 'pglite' | 'neon'
  /**
   * トランザクション。コールバック内の各 query の結果は読まないこと
   * （Neon HTTP ではコールバック内の文を集めて 1 回のトランザクションとして送るため、結果は空で返る）。
   */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
  migrate(): Promise<string[]>
  close(): Promise<void>
}

export const nowIso = () => new Date().toISOString()

/** pg / neon は COUNT / SUM（bigint, numeric）を文字列で返すため数値化する */
export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

export async function one<T>(q: Queryable, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await q.query<T>(sql, params)
  return r.rows[0] ?? null
}
export async function all<T>(q: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await q.query<T>(sql, params)).rows
}

/** 埋め込みマイグレーション（server/src/migrations.ts = server/migrations/*.sql）を名前順に適用する（schema_migrations で管理） */
export async function runMigrations(db: Db): Promise<string[]> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  const applied = new Set((await all<{ name: string }>(db, 'SELECT name FROM schema_migrations')).map((r) => r.name))
  const done: string[] = []
  for (const m of [...MIGRATIONS].sort((a, b) => a.name.localeCompare(b.name))) {
    if (applied.has(m.name)) continue
    await db.tx(async (q) => {
      await q.exec(m.sql)
      await q.query('INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)', [m.name, nowIso()])
    })
    done.push(m.name)
  }
  return done
}

/** テスト用: 全テーブルを空にする */
export async function truncateAll(db: Db) {
  await db.exec('TRUNCATE TABLE analytics_events, publish_events, scene_versions, assets, projects, sessions, users, login_locks, rate_limits RESTART IDENTITY CASCADE')
}
