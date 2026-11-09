import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../src/app.js'
import type { Config } from '../src/config.js'
import { openDb, truncateAll, type Db } from '../src/db.js'
import { createLocalStorage, createMemoryStorage, type Storage } from '../src/storage.js'

// PGlite（WASM）の起動は 1〜2 秒かかるため、テストファイルごとに 1 インスタンスを共有し、テストごとに TRUNCATE する
let shared: Promise<Db> | null = null
function sharedDb(): Promise<Db> {
  shared ??= openDb({ pgliteDir: ':memory:' }).then(async (db) => {
    await db.migrate()
    return db
  })
  return shared
}

export type TestStorage = Storage & { objects?: Map<string, { body: Buffer; contentType: string }> }

/** storageKind: 'local' = ファイル保存（/a/ 配信のテスト）、'memory' = Blob 相当（登録・掃除のテスト） */
export async function makeTestApp(overrides: Partial<Config> = {}, storageKind: 'local' | 'memory' = 'local') {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nocode-ar-test-'))
  const config: Config = {
    port: 0,
    dataDir,
    webDist: path.join(dataDir, 'no-web'),
    publicOrigin: 'https://ar.example.test',
    supportEmail: null,
    serviceName: 'テスト',
    cookieSecure: false,
    trustProxy: 'loopback',
    accountQuotaBytes: 2 * 1024 * 1024 * 1024,
    databaseUrl: null,
    pgliteDir: ':memory:',
    autoMigrate: false,
    blobToken: null,
    cronSecret: 'test-cron-secret',
    isVercel: false,
    ...overrides,
  }
  const db = await sharedDb()
  await truncateAll(db)
  const storage: TestStorage = storageKind === 'memory' ? createMemoryStorage() : createLocalStorage(dataDir)
  const app = createApp({ db, storage, config })
  return {
    app,
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
