// Node 用: 設定から DB（PGlite / PostgreSQL）、ストレージ（ローカルファイル）、Hono アプリを組み立てる
import fs from 'node:fs'
import { createApp, type App } from './app.js'
import { loadNodeConfig, type NodeConfig } from './config-node.js'
import type { Db } from './db.js'
import { openPg } from './db-pg.js'
import { openPglite } from './db-pglite.js'
import type { Storage } from './storage.js'
import { createLocalStorage } from './storage-local.js'

export interface NodeRuntime {
  config: NodeConfig
  db: Db
  storage: Storage
  app: App
}

export async function openNodeDb(config: Pick<NodeConfig, 'databaseUrl' | 'pgliteDir'>): Promise<Db> {
  return config.databaseUrl ? openPg(config.databaseUrl) : openPglite(config.pgliteDir)
}

export async function createNodeRuntime(config: NodeConfig = loadNodeConfig()): Promise<NodeRuntime> {
  const db = await openNodeDb(config)
  if (config.autoMigrate) await db.migrate()
  fs.mkdirSync(config.dataDir, { recursive: true })
  const storage = createLocalStorage(config.dataDir)
  const app = createApp({ db, storage, config })
  return { config, db, storage, app }
}
