// マイグレーション適用:  npm run migrate   （DATABASE_URL があれば PostgreSQL、無ければローカル PGlite）
import { loadConfig } from '../config.js'
import { nowIso, openDb } from '../db.js'

const config = loadConfig()
const db = await openDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir })
try {
  const applied = await db.migrate()
  console.log(JSON.stringify({ level: 'info', time: nowIso(), message: 'migrations applied', target: config.databaseUrl ? 'postgres' : `pglite:${config.pgliteDir}`, applied }))
} finally {
  await db.close()
}
