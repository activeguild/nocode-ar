// DB アダプタ: 本番は PostgreSQL（pg）、ローカル / テストは PGlite（WASM の Postgres）。
// どちらも $1 形式のプレースホルダと同じ SQL 方言で動くため、ここで薄く揃える。
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
  kind: 'pg' | 'pglite'
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
  migrate(): Promise<string[]>
  close(): Promise<void>
}

export const nowIso = () => new Date().toISOString()

/** pg は COUNT / SUM（bigint, numeric）を文字列で返すため数値化する */
export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

export async function one<T>(q: Queryable, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await q.query<T>(sql, params)
  return r.rows[0] ?? null
}
export async function all<T>(q: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await q.query<T>(sql, params)).rows
}

export interface OpenDbOptions {
  databaseUrl?: string | null
  /** PGlite のデータディレクトリ。':memory:' または未指定でインメモリ */
  pgliteDir?: string | null
  /** Vercel Fluid compute で Pool を再利用するためのフック */
  attachPool?: boolean
}

export async function openDb(opts: OpenDbOptions): Promise<Db> {
  const db = opts.databaseUrl ? await openPg(opts.databaseUrl, opts.attachPool ?? false) : await openPglite(opts.pgliteDir ?? null)
  return db
}

async function openPg(connectionString: string, attach: boolean): Promise<Db> {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 })
  if (attach) {
    try {
      const { attachDatabasePool } = await import('@vercel/functions')
      attachDatabasePool(pool)
    } catch {
      /* @vercel/functions が無い環境では無視 */
    }
  }
  const db: Db = {
    kind: 'pg',
    query: <T>(sql: string, params: unknown[] = []) => pool.query(sql, params as never[]) as unknown as Promise<QueryResult<T>>,
    exec: async (sql) => {
      await pool.query(sql)
    },
    async tx(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const r = await fn({
          query: <T>(sql: string, params: unknown[] = []) => client.query(sql, params as never[]) as unknown as Promise<QueryResult<T>>,
          exec: async (sql) => {
            await client.query(sql)
          },
        })
        await client.query('COMMIT')
        return r
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {})
        throw e
      } finally {
        client.release()
      }
    },
    migrate: () => runMigrations(db),
    close: () => pool.end(),
  }
  return db
}

async function openPglite(dir: string | null): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite')
  const inMemory = !dir || dir === ':memory:'
  if (!inMemory) (await import('node:fs')).mkdirSync(dir!, { recursive: true })
  const pg = inMemory ? await PGlite.create() : await PGlite.create({ dataDir: dir! })
  const db: Db = {
    kind: 'pglite',
    query: <T>(sql: string, params: unknown[] = []) => pg.query(sql, params as never[]) as unknown as Promise<QueryResult<T>>,
    exec: async (sql) => {
      await pg.exec(sql)
    },
    tx: (fn) =>
      pg.transaction((t) =>
        fn({
          query: <T>(sql: string, params: unknown[] = []) => t.query(sql, params as never[]) as unknown as Promise<QueryResult<T>>,
          exec: async (sql) => {
            await t.exec(sql)
          },
        }),
      ),
    migrate: () => runMigrations(db),
    close: () => pg.close(),
  }
  return db
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
