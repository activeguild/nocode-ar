import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getRequestListener } from '@hono/node-server'
import { createApp } from '../src/app.js'
import type { Config } from '../src/config.js'
import { truncateAll, type Db } from '../src/db.js'
import { openPglite } from '../src/db-pglite.js'
import { createMemoryStorage, type Storage } from '../src/storage.js'
import { createLocalStorage } from '../src/storage-local.js'

// PGlite（WASM）の起動は 1〜2 秒かかるため、テストファイルごとに 1 インスタンスを共有し、テストごとに TRUNCATE する
let shared: Promise<Db> | null = null
function sharedDb(): Promise<Db> {
  shared ??= openPglite(':memory:').then(async (db) => {
    await db.migrate()
    return db
  })
  return shared
}

export type TestStorage = Storage & { objects?: Map<string, { body: Buffer; contentType: string; uploadedAt: Date }> }

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    publicOrigin: 'https://ar.example.test',
    supportEmail: null,
    serviceName: 'テスト',
    cookieSecure: false,
    trustProxy: true,
    accountQuotaBytes: 2 * 1024 * 1024 * 1024,
    cronSecret: 'test-cron-secret',
    compressResponses: true,
    autoMigrate: false,
    databaseUrl: null,
    ...overrides,
  }
}

/** storageKind: 'local' = ファイル保存、'memory' = R2 相当（掃除・一覧のテスト） */
export async function makeTestApp(overrides: Partial<Config> = {}, storageKind: 'local' | 'memory' = 'local') {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nocode-ar-test-'))
  const config = testConfig(overrides)
  const db = await sharedDb()
  await truncateAll(db)
  const storage: TestStorage = storageKind === 'memory' ? createMemoryStorage() : createLocalStorage(dataDir)
  const app = createApp({ db, storage, config })
  // supertest には Node の (req, res) ハンドラを渡す
  const listener = getRequestListener(app.fetch)
  return {
    app: listener,
    hono: app,
    db,
    storage,
    config,
    dataDir,
    cleanup: () => {
      fs.rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

export async function closeSharedDb() {
  if (shared) await (await shared).close()
  shared = null
}
