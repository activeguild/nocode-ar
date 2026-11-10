// マイグレーション適用:  npm run migrate   （DATABASE_URL があれば PostgreSQL（Neon）、無ければローカル PGlite）
import { loadNodeConfig } from '../config-node.js'
import { nowIso } from '../db.js'
import { openNodeDb } from '../runtime-node.js'

const config = loadNodeConfig()
const db = await openNodeDb(config)
try {
  const applied = await db.migrate()
  console.log(JSON.stringify({ level: 'info', time: nowIso(), message: 'migrations applied', target: config.databaseUrl ? 'postgres' : `pglite:${config.pgliteDir}`, applied }))
} finally {
  await db.close()
}
