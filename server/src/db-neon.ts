// Cloudflare Workers から Neon へ HTTP で問い合わせる（@neondatabase/serverless の neon()）。
// WebSocket の Pool はリクエストをまたいで使えないため HTTP クエリを使う。
import type { Db, QueryResult } from './db.js'

/** neon() が返す関数のうち、ここで使う部分 */
export interface NeonSql {
  query(text: string, params?: unknown[]): PromiseLike<{ rows: unknown[] }>
  transaction(queries: PromiseLike<unknown>[]): Promise<unknown[]>
}

export function createNeonDb(sql: NeonSql): Db {
  const db: Db = {
    kind: 'neon',
    query: async <T>(text: string, params: unknown[] = []) => (await sql.query(text, params)) as QueryResult<T>,
    exec: async () => {
      throw new Error('複数文の SQL は Workers からは実行できません。マイグレーションは `npm run migrate`（Node）で適用してください')
    },
    /**
     * Neon HTTP のトランザクションは「文の配列を 1 回で送る」方式。
     * コールバック内の query は実行せずに記録し、最後に sql.transaction() でまとめて実行する（結果は読めない）。
     */
    async tx(fn) {
      const queued: PromiseLike<unknown>[] = []
      const r = await fn({
        query: async <T>(text: string, params: unknown[] = []) => {
          queued.push(sql.query(text, params)) // 未 await のまま貯める（await すると即時実行されてしまう）
          return { rows: [] } as QueryResult<T>
        },
        exec: async () => {
          throw new Error('exec はトランザクション内で使えません')
        },
      })
      if (queued.length) await sql.transaction(queued)
      return r
    },
    migrate: async () => {
      throw new Error('マイグレーションは `npm run migrate`（Node）で適用してください')
    },
    close: async () => {},
  }
  return db
}

export async function openNeon(databaseUrl: string): Promise<Db> {
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(databaseUrl, { fullResults: true }) as unknown as NeonSql
  return createNeonDb(sql)
}
