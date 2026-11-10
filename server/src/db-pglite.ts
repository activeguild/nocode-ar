// ローカル / テスト用: PGlite（WASM の Postgres）。Node でのみ使う（Worker バンドルには含めない）
import fs from 'node:fs'
import { runMigrations, type Db, type QueryResult } from './db.js'

export async function openPglite(dir: string | null): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite')
  const inMemory = !dir || dir === ':memory:'
  if (!inMemory) fs.mkdirSync(dir!, { recursive: true })
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
