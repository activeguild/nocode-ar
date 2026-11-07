import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { zlib } from './fixtures.ts'
import { createApp } from '../src/app.ts'
import { resetLockState } from '../src/auth.ts'
import { openDb } from '../src/db.ts'
import type { Config } from '../src/config.ts'

export function makeTestApp(overrides: Partial<Config> = {}) {
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
    ...overrides,
  }
  const db = openDb(':memory:')
  resetLockState()
  const app = createApp({ db, config })
  return {
    app,
    db,
    dataDir,
    cleanup: () => {
      db.close()
      fs.rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

export { zlib }
