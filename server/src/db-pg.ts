// Node から PostgreSQL（Neon 等）へ TCP 接続する（CLI の migrate / reset-password、Docker 常駐用）
import { runMigrations, type Db, type QueryResult } from './db.js'

export async function openPg(connectionString: string): Promise<Db> {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 })
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
