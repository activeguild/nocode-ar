// ローカル / Docker 用の常駐サーバ（Node）。Cloudflare では worker.ts が使われる。
import fs from 'node:fs'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { nowIso } from './db.js'
import { runCleanup } from './projects.js'
import { createNodeRuntime } from './runtime-node.js'

const { config, db, storage, app } = await createNodeRuntime()

// ビルド済み web/dist を配信（/v/:slug, /p/:token → viewer.html、その他 → index.html）
const root = new Hono()
root.route('/', app)
if (fs.existsSync(config.webDist)) {
  const relRoot = path.relative(process.cwd(), config.webDist) || '.'
  const viewerHtml = fs.readFileSync(path.join(config.webDist, 'viewer.html'), 'utf8')
  const indexHtml = fs.readFileSync(path.join(config.webDist, 'index.html'), 'utf8')
  root.get('/v/:slug', (c) => c.html(viewerHtml, 200, { 'Cache-Control': 'no-cache' }))
  root.get('/p/:token', (c) => c.html(viewerHtml, 200, { 'Cache-Control': 'no-cache' }))
  root.use(
    '/*',
    serveStatic({
      root: relRoot,
      onFound: (filePath, c) => {
        c.header('Cache-Control', filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable')
        c.header('X-Content-Type-Options', 'nosniff')
      },
    }),
  )
  root.get('/*', (c) => {
    if (!(c.req.header('accept') ?? '').includes('text/html')) return c.notFound()
    return c.html(indexHtml, 200, { 'Cache-Control': 'no-cache' })
  })
}

serve({ fetch: root.fetch, port: config.port }, () => {
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

// 常駐時は 15 分ごとに掃除（Cloudflare では Cron Trigger が scheduled() を呼ぶ）
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
