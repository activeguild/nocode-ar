// Cloudflare Workers エントリ。API は Hono、静的ファイルは Workers Static Assets（ASSETS バインディング）、
// 素材は R2（ASSETS_BUCKET）、DB は Neon（HTTP）、掃除は Cron Trigger（scheduled）。
import { createApp, type App } from './app.js'
import { configFromEnv, type Config } from './config.js'
import { nowIso, type Db } from './db.js'
import { openNeon } from './db-neon.js'
import { runCleanup } from './projects.js'
import { createR2Storage, type R2BucketLike, type Storage } from './storage.js'

export interface WorkerEnv {
  ASSETS: { fetch(request: Request): Promise<Response> }
  ASSETS_BUCKET: R2BucketLike
  DATABASE_URL?: string
  CRON_SECRET?: string
  PUBLIC_ORIGIN?: string
  SERVICE_NAME?: string
  SUPPORT_EMAIL?: string
  ACCOUNT_QUOTA_BYTES?: string
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void
}

interface WorkerRuntime {
  config: Config
  db: Db
  storage: Storage
  app: App
}

let runtimePromise: Promise<WorkerRuntime> | null = null

async function createWorkerRuntime(env: WorkerEnv): Promise<WorkerRuntime> {
  const config = configFromEnv(env as unknown as Record<string, string | undefined>, { runtime: 'worker' })
  if (!config.databaseUrl) throw new Error('DATABASE_URL が設定されていません（wrangler secret put DATABASE_URL）')
  if (!env.ASSETS_BUCKET) throw new Error('R2 バインディング ASSETS_BUCKET がありません（wrangler.toml の [[r2_buckets]] を確認）')
  const db = await openNeon(config.databaseUrl)
  const storage = createR2Storage(env.ASSETS_BUCKET)
  return { config, db, storage, app: createApp({ db, storage, config }) }
}

function getRuntime(env: WorkerEnv): Promise<WorkerRuntime> {
  runtimePromise ??= createWorkerRuntime(env).catch((e) => {
    runtimePromise = null
    throw e
  })
  return runtimePromise
}

const isApiPath = (pathname: string) => pathname.startsWith('/api/') || pathname.startsWith('/a/') || pathname === '/healthz'

function withHeaders(res: Response, extra: Record<string, string>): Response {
  const out = new Response(res.body, res)
  for (const [k, v] of Object.entries(extra)) out.headers.set(k, v)
  return out
}

/** 静的ファイル: /v/:slug, /p/:token → viewer.html、見つからない HTML 要求 → index.html（SPA） */
export async function serveStaticAsset(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url)
  const common = { 'X-Content-Type-Options': 'nosniff' }
  if (/^\/(v|p)\/[^/]+\/?$/.test(url.pathname)) {
    const res = await env.ASSETS.fetch(new Request(new URL('/viewer.html', url.origin), { headers: request.headers }))
    return withHeaders(res, { ...common, 'Cache-Control': 'no-cache' })
  }
  let res = url.pathname === '/' ? new Response(null, { status: 404 }) : await env.ASSETS.fetch(request)
  if (res.status === 404 && (url.pathname === '/' || (request.headers.get('accept') ?? '').includes('text/html'))) {
    res = await env.ASSETS.fetch(new Request(new URL('/index.html', url.origin), { headers: request.headers }))
  }
  if (url.pathname.startsWith('/assets/')) return withHeaders(res, { ...common, 'Cache-Control': 'public, max-age=31536000, immutable' })
  if (res.headers.get('content-type')?.includes('text/html')) return withHeaders(res, { ...common, 'Cache-Control': 'no-cache' })
  return withHeaders(res, common)
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url)
    if (!isApiPath(url.pathname)) return serveStaticAsset(request, env)
    let runtime: WorkerRuntime
    try {
      runtime = await getRuntime(env)
    } catch (e) {
      console.error(JSON.stringify({ level: 'error', time: nowIso(), message: (e as Error).message }))
      return Response.json({ error: 'サーバーの設定が完了していません', detail: (e as Error).message }, { status: 503 })
    }
    return runtime.app.fetch(request, env, ctx as never)
  },

  async scheduled(_event: unknown, env: WorkerEnv, ctx: ExecutionContextLike): Promise<void> {
    const { db, storage } = await getRuntime(env)
    ctx.waitUntil(
      runCleanup(db, storage)
        .then((r) => console.log(JSON.stringify({ level: 'info', time: nowIso(), message: 'cleanup', ...r })))
        .catch((e) => console.error(JSON.stringify({ level: 'error', time: nowIso(), message: 'cleanup failed', error: String(e) }))),
    )
  },
}
