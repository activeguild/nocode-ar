// ローカル / Docker 用の常駐サーバ。Vercel では api/index.ts（server/src/vercel.ts）が使われる。
import fs from 'node:fs'
import { nowIso } from './db.js'
import { runCleanup } from './projects.js'
import { createRuntime } from './runtime.js'

const { config, db, storage, app } = await createRuntime()

app.listen(config.port, () => {
  console.log(
    JSON.stringify({
      level: 'info',
      time: nowIso(),
      message: `listening on http://localhost:${config.port}`,
      db: config.databaseUrl ? 'postgres' : `pglite:${config.pgliteDir}`,
      storage: storage.kind,
      webDist: fs.existsSync(config.webDist) ? config.webDist : '(not built: API only)',
    }),
  )
})

// 常駐時は 15 分ごとに掃除（Vercel では Cron が /api/cron/cleanup を呼ぶ）
setInterval(
  () => {
    runCleanup(db, storage)
      .then((r) => {
        if (r.assetsDeleted || r.orphanBlobsDeleted || r.sessionsDeleted) console.log(JSON.stringify({ level: 'info', time: nowIso(), message: 'cleanup', ...r }))
      })
      .catch((e) => console.error(JSON.stringify({ level: 'error', time: nowIso(), message: 'cleanup failed', error: String(e) })))
  },
  15 * 60_000,
).unref()
