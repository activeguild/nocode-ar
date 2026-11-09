// 設定から DB / ストレージ / Express アプリを組み立てる（index.ts と Vercel Function で共用）
import fs from 'node:fs'
import { createApp } from './app.js'
import { loadConfig, type Config } from './config.js'
import { openDb, type Db } from './db.js'
import { createBlobStorage, createLocalStorage, type Storage } from './storage.js'

export interface Runtime {
  config: Config
  db: Db
  storage: Storage
  app: ReturnType<typeof createApp>
}

export async function createRuntime(config: Config = loadConfig()): Promise<Runtime> {
  if (config.isVercel && !config.databaseUrl) {
    throw new Error('DATABASE_URL が設定されていません。Vercel では PostgreSQL（Neon）が必須です（README「Vercel へのデプロイ」参照）')
  }
  if (config.isVercel && !config.blobToken) {
    throw new Error('BLOB_READ_WRITE_TOKEN が設定されていません。Vercel では素材の保存先として Vercel Blob が必須です')
  }
  const db = await openDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir, attachPool: config.isVercel })
  if (config.autoMigrate) await db.migrate()
  let storage: Storage
  if (config.blobToken) storage = createBlobStorage(config.blobToken)
  else {
    fs.mkdirSync(config.dataDir, { recursive: true })
    storage = createLocalStorage(config.dataDir)
  }
  const app = createApp({ db, storage, config })
  return { config, db, storage, app }
}
