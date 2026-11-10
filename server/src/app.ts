// Hono アプリ（Cloudflare Workers と Node の両方で動く）。API・素材配信・計測・掃除エンドポイントを提供する。
import { Buffer } from 'node:buffer'
import { Hono } from 'hono'
import { compress } from 'hono/compress'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import QRCode from 'qrcode'
import { z } from 'zod'
import { ASSET_KINDS, analyticsEventSchema, publishBlockers, sceneSchema, toDayJst, type AssetKind } from '../../shared/src/index.js'
import { AssetError, KIND_MAX_BYTES, deleteAsset, getAsset, saveAsset, sizeLimitError, toAssetInfo } from './assets.js'
import {
  attachUser,
  checkOrigin,
  clearFailures,
  createSession,
  createUser,
  deleteSession,
  findUserByEmail,
  isLocked,
  recordFailure,
  requireAuth,
  safeEqual,
  sessionCookie,
  trustForwarded,
  verifyPassword,
  type AppContext,
  type AppVariables,
} from './auth.js'
import type { Config } from './config.js'
import type { Db } from './db.js'
import { nowIso, num } from './db.js'
import {
  assetMap,
  createProject,
  deleteProject,
  getProject,
  getProjectByPreviewToken,
  getProjectBySlug,
  getSceneVersion,
  listProjects,
  listPublishEvents,
  parseScene,
  publishProject,
  publishedAssetIds,
  queryStats,
  resumeProject,
  rotatePreviewToken,
  runCleanup,
  toSummary,
  unpublishProject,
  updateProject,
  type ProjectRow,
} from './projects.js'
import type { Storage } from './storage.js'

export interface AppDeps {
  db: Db
  storage: Storage
  config: Config
}

const emailSchema = z.string().trim().toLowerCase().email().max(254)
const passwordSchema = z.string().min(8).max(200)
const nameSchema = z.string().trim().min(1).max(60)
const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const JSON_BODY_LIMIT = 1024 * 1024

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

function publicOrigin(c: AppContext, config: Config): string {
  if (config.publicOrigin) return config.publicOrigin
  const url = new URL(c.req.url)
  if (trustForwarded(c, config.trustProxy)) {
    const proto = c.req.header('x-forwarded-proto')?.split(',')[0]
    const host = c.req.header('x-forwarded-host')?.split(',')[0]
    if (host) return `${proto || url.protocol.replace(':', '')}://${host}`
  }
  return url.origin
}

/** FR-7-6 / NFR-9: 計測イベントのレート制限（slug ごと 60 req/分。DB に保持） */
async function rateLimitAllowed(db: Db, key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = Date.now()
  const r = await db.query<{ count: unknown }>(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start < $3 THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start < $3 THEN $2 ELSE rate_limits.window_start END
     RETURNING count`,
    [key, now, now - windowMs],
  )
  return num(r.rows[0]?.count) <= limit
}

/** Range ヘッダ（bytes=start-end / bytes=start- / bytes=-suffix）を解釈する */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid'
  let start: number
  let end: number
  if (m[1] === '') {
    const suffix = Number(m[2])
    if (suffix === 0) return 'invalid'
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  if (start > end || start >= size) return 'invalid'
  return { start, end }
}

/** ReadableStream を上限付きで読む。超えたら 413 */
export async function readBodyLimited(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!body) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => {})
      throw new HttpError(413, '送信データが大きすぎます（1 MB まで）')
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))))
}

export function createApp({ db, storage, config }: AppDeps) {
  const app = new Hono<{ Variables: AppVariables }>()

  if (config.compressResponses) app.use('*', compress())
  app.use('*', attachUser(db))
  app.use('/api/*', checkOrigin(config.trustProxy))
  // JSON API の本文上限（素材アップロードを除く）D-08
  app.use('/api/*', async (c, next) => {
    if (c.req.path.endsWith('/assets') && c.req.method === 'POST') return next()
    const len = Number(c.req.header('content-length') ?? 0)
    if (len > JSON_BODY_LIMIT) return c.json({ error: '送信データが大きすぎます（1 MB まで）' }, 413)
    await next()
  })

  /** JSON 本文を実バイト数で上限チェックしながら読む（R5-M-05: chunked でも 1 MB を超えたら 413） */
  const json = async <T>(c: AppContext): Promise<T> => {
    const text = await readBodyLimited(c.req.raw.body, JSON_BODY_LIMIT)
    try {
      return JSON.parse(text) as T
    } catch {
      throw new HttpError(400, 'JSON の形式が不正です')
    }
  }
  const user = (c: AppContext) => c.get('user')!
  const ownProject = async (c: AppContext): Promise<ProjectRow> => {
    const p = await getProject(db, user(c).id, c.req.param('id') ?? '')
    if (!p) throw new HttpError(404, 'プロジェクトが見つかりません')
    return p
  }

  // ---- 設定（R9 のサポート連絡先など）
  app.get('/api/config', (c) => c.json({ serviceName: config.serviceName, supportEmail: config.supportEmail, uploadMode: 'direct' }))

  // ---- 認証（FR-1）
  app.post('/api/auth/signup', async (c) => {
    const body = z.object({ email: emailSchema, password: passwordSchema }).safeParse(await json(c))
    if (!body.success) throw new HttpError(400, 'メールアドレスの形式、または 8 文字以上のパスワードを確認してください')
    if (await findUserByEmail(db, body.data.email)) throw new HttpError(409, 'このメールアドレスは登録済みです')
    const u = await createUser(db, body.data.email, body.data.password)
    const sid = await createSession(db, u.id)
    c.header('Set-Cookie', sessionCookie(sid, config.cookieSecure))
    return c.json({ user: u }, 201)
  })

  app.post('/api/auth/login', async (c) => {
    const body = z.object({ email: emailSchema, password: z.string().max(200) }).safeParse(await json(c))
    if (!body.success) throw new HttpError(400, 'メールアドレスまたはパスワードが違います')
    const { email, password } = body.data
    if (await isLocked(db, email)) throw new HttpError(429, 'ログインに連続して失敗したため、15 分間ロックされています')
    const u = await findUserByEmail(db, email)
    if (!u || !verifyPassword(password, u.passwordHash)) {
      await recordFailure(db, email)
      throw new HttpError(401, 'メールアドレスまたはパスワードが違います')
    }
    await clearFailures(db, email)
    const sid = await createSession(db, u.id)
    c.header('Set-Cookie', sessionCookie(sid, config.cookieSecure))
    return c.json({ user: { id: u.id, email: u.email } })
  })

  app.post('/api/auth/logout', async (c) => {
    const sid = c.get('sessionId')
    if (sid) await deleteSession(db, sid)
    c.header('Set-Cookie', sessionCookie('', config.cookieSecure, true))
    return c.body(null, 204)
  })

  app.get('/api/auth/me', (c) => {
    const u = c.get('user')
    if (!u) return c.json({ error: 'ログインが必要です' }, 401)
    return c.json({ user: u })
  })

  // ---- プロジェクト（FR-2）
  app.get('/api/projects', requireAuth, async (c) => {
    const rows = await listProjects(db, user(c).id)
    return c.json({ projects: await Promise.all(rows.map((p) => toSummary(db, p))) })
  })

  app.post('/api/projects', requireAuth, async (c) => {
    const body = z.object({ name: nameSchema }).safeParse(await json(c))
    if (!body.success) throw new HttpError(400, 'プロジェクト名を 1〜60 文字で入力してください')
    const p = await createProject(db, user(c).id, body.data.name)
    return c.json({ project: await toSummary(db, p) }, 201)
  })

  const projectDetail = async (c: AppContext, p: ProjectRow) => {
    const published = p.published_scene_id ? await getSceneVersion(db, p.published_scene_id) : null
    return {
      project: await toSummary(db, p),
      draftScene: parseScene(p.draft_scene),
      publishedScene: published ? parseScene(published.scene) : null,
      publishedAt: published?.published_at ?? null,
      assets: await assetMap(db, p.id),
      publicUrl: `${publicOrigin(c, config)}/v/${p.slug}`,
      previewUrl: `${publicOrigin(c, config)}/p/${p.preview_token}`,
      publishEvents: (await listPublishEvents(db, p.id)).map((e) => ({ type: e.type, at: e.at, sceneVersionId: e.scene_version_id })),
    }
  }

  app.get('/api/projects/:id', requireAuth, async (c) => c.json(await projectDetail(c, await ownProject(c))))

  app.patch('/api/projects/:id', requireAuth, async (c) => {
    const p = await ownProject(c)
    const body = z.object({ name: nameSchema.optional(), draftScene: sceneSchema.optional() }).safeParse(await json(c))
    // D-07: zod の英語メッセージは出さず、項目名のみ日本語で示す
    if (!body.success) throw new HttpError(400, '入力内容に誤りがあります（' + [...new Set(body.error.issues.map((i) => i.path.join('.') || 'body'))].join(', ') + '）')
    if (body.data.draftScene) {
      const s = body.data.draftScene
      for (const id of [s.target.imageAssetId, s.target.mindAssetId, s.overlay?.assetId, s.overlay?.thumbnailAssetId]) {
        if (id && (await getAsset(db, id))?.project_id !== p.id) throw new HttpError(400, '不正な素材が指定されています')
      }
    }
    await updateProject(db, p.id, body.data)
    return c.json(await projectDetail(c, await ownProject(c)))
  })

  app.delete('/api/projects/:id', requireAuth, async (c) => {
    await deleteProject(db, storage, await ownProject(c))
    return c.body(null, 204)
  })

  // ---- 素材（FR-3, FR-4）
  const numField = (v: unknown) => {
    const n = v === undefined || v === null || v === '' ? NaN : Number(v)
    return Number.isFinite(n) && n > 0 ? n : null
  }

  /**
   * アップロード。2 形式を受ける:
   * - multipart/form-data（kind, file, width, height, durationSec）
   * - 生ボディ（body = ファイル。kind 等はクエリ。Content-Length 必須）: 大きな動画をメモリに載せずストレージへ流す
   * 鍵と URL はサーバが生成する（クライアントの鍵 / URL は受け取らない）
   */
  app.post('/api/projects/:id/assets', requireAuth, async (c) => {
    const p = await ownProject(c)
    const ct = c.req.header('content-type') ?? ''
    let kind: string
    let body: Buffer | ReadableStream<Uint8Array>
    let size: number
    let meta: Record<string, unknown>
    let contentTypeHint: string | null = null
    if (ct.startsWith('multipart/form-data')) {
      const fd = await c.req.formData()
      kind = String(fd.get('kind') ?? '')
      const file = fd.get('file')
      if (!(file instanceof Blob)) throw new HttpError(400, 'ファイルがありません')
      body = Buffer.from(await file.arrayBuffer())
      size = body.length
      meta = { width: fd.get('width'), height: fd.get('height'), durationSec: fd.get('durationSec') }
    } else {
      kind = c.req.query('kind') ?? ''
      size = Number(c.req.header('content-length') ?? NaN)
      if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, 'Content-Length が必要です')
      if (!c.req.raw.body) throw new HttpError(400, 'ファイルがありません')
      if (!ASSET_KINDS.includes(kind as AssetKind)) throw new HttpError(400, 'kind が不正です')
      if (size > KIND_MAX_BYTES[kind as AssetKind]) throw sizeLimitError(kind as AssetKind)
      // ターゲットデータは gzip して保存するため本体をメモリに載せる（上限 20 MB）。それ以外はストレージへ流す
      body = kind === 'target_mind' ? Buffer.from(await c.req.arrayBuffer()) : (c.req.raw.body as ReadableStream<Uint8Array>)
      if (Buffer.isBuffer(body)) size = body.length
      contentTypeHint = ct || null
      meta = { width: c.req.query('width'), height: c.req.query('height'), durationSec: c.req.query('durationSec') }
    }
    if (!ASSET_KINDS.includes(kind as AssetKind)) throw new HttpError(400, 'kind が不正です')
    if (size > KIND_MAX_BYTES[kind as AssetKind]) throw sizeLimitError(kind as AssetKind)
    const a = await saveAsset(db, storage, {
      projectId: p.id,
      userId: user(c).id,
      accountQuotaBytes: config.accountQuotaBytes,
      kind: kind as AssetKind,
      body,
      size,
      contentTypeHint,
      width: numField(meta.width),
      height: numField(meta.height),
      durationSec: numField(meta.durationSec),
    })
    return c.json({ asset: toAssetInfo(a) }, 201)
  })

  app.delete('/api/projects/:id/assets/:assetId', requireAuth, async (c) => {
    const p = await ownProject(c)
    const a = await getAsset(db, c.req.param('assetId'))
    if (!a || a.project_id !== p.id) throw new HttpError(404, '素材が見つかりません')
    if ((await publishedAssetIds(db, p)).has(a.id)) throw new HttpError(409, '公開中の AR が使用している素材は削除できません')
    await deleteAsset(db, storage, a)
    return c.body(null, 204)
  })

  // ---- 公開・停止・プレビュー・QR（FR-6）
  app.post('/api/projects/:id/publish', requireAuth, async (c) => {
    const p = await ownProject(c)
    const blockers = publishBlockers(parseScene(p.draft_scene))
    if (blockers.length) throw new HttpError(400, blockers.join('。'))
    await publishProject(db, p, user(c).id)
    return c.json(await projectDetail(c, await ownProject(c)))
  })

  app.post('/api/projects/:id/unpublish', requireAuth, async (c) => {
    const p = await ownProject(c)
    if (p.status !== 'published') throw new HttpError(400, '公開中ではありません')
    await unpublishProject(db, p)
    return c.json(await projectDetail(c, await ownProject(c)))
  })

  app.post('/api/projects/:id/resume', requireAuth, async (c) => {
    const p = await ownProject(c)
    if (p.status !== 'unpublished' || !p.published_scene_id) throw new HttpError(400, '停止中の AR のみ再開できます')
    await resumeProject(db, p)
    return c.json(await projectDetail(c, await ownProject(c)))
  })

  app.post('/api/projects/:id/preview-token', requireAuth, async (c) => {
    const p = await ownProject(c)
    await rotatePreviewToken(db, p.id)
    return c.json(await projectDetail(c, await ownProject(c)))
  })

  const qrOptions = { errorCorrectionLevel: 'M' as const, margin: 4 }
  app.get('/api/projects/:id/qr.png', requireAuth, async (c) => {
    const p = await ownProject(c)
    const buf = await QRCode.toBuffer(`${publicOrigin(c, config)}/v/${p.slug}`, { ...qrOptions, type: 'png', width: 1024 })
    return c.body(new Uint8Array(buf), 200, { 'Content-Type': 'image/png', 'Content-Disposition': `attachment; filename="qr-${p.slug}.png"` })
  })
  app.get('/api/projects/:id/qr.svg', requireAuth, async (c) => {
    const p = await ownProject(c)
    const svg = await QRCode.toString(`${publicOrigin(c, config)}/v/${p.slug}`, { ...qrOptions, type: 'svg' })
    return c.body(svg, 200, { 'Content-Type': 'image/svg+xml', 'Content-Disposition': `attachment; filename="qr-${p.slug}.svg"` })
  })
  app.get('/api/projects/:id/preview-qr.png', requireAuth, async (c) => {
    const p = await ownProject(c)
    const buf = await QRCode.toBuffer(`${publicOrigin(c, config)}/p/${p.preview_token}`, { ...qrOptions, type: 'png', width: 512 })
    return c.body(new Uint8Array(buf), 200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' })
  })

  // ---- 計測（FR-9）
  const statsRange = (c: AppContext) => {
    const q = z.object({ from: daySchema, to: daySchema }).safeParse({ from: c.req.query('from'), to: c.req.query('to') })
    if (!q.success) throw new HttpError(400, 'from / to は YYYY-MM-DD で指定してください')
    if (q.data.from > q.data.to) throw new HttpError(400, '開始日は終了日以前にしてください') // D-15
    return q.data
  }
  app.get('/api/projects/:id/stats', requireAuth, async (c) => {
    const p = await ownProject(c)
    const { from, to } = statsRange(c)
    return c.json({ from, to, rows: await queryStats(db, p.id, from, to), publishEvents: (await listPublishEvents(db, p.id)).map((e) => ({ type: e.type, at: e.at })) })
  })
  app.get('/api/projects/:id/stats.csv', requireAuth, async (c) => {
    const p = await ownProject(c)
    const { from, to } = statsRange(c)
    const rows = await queryStats(db, p.id, from, to)
    // D-02: 数式インジェクション対策。= + - @ タブ CR で始まるセルは ' を前置する
    const esc = (v: unknown) => {
      let t = String(v ?? '')
      if (/^[=+\-@\t\r]/.test(t)) t = "'" + t
      return `"${t.replace(/"/g, '""')}"`
    }
    const csv = ['﻿日付,種別,ボタンID,OS,回数', ...rows.map((r) => [r.day, r.type, r.buttonId, r.os, r.count].map(esc).join(','))].join('\r\n')
    return c.body(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="stats-${p.slug}-${from}-${to}.csv"` })
  })

  // ---- エクスポート（NFR-8: 構造のみ）
  app.get('/api/projects/:id/export', requireAuth, async (c) => {
    const p = await ownProject(c)
    return c.json({ project: await toSummary(db, p), draftScene: parseScene(p.draft_scene), assets: Object.values(await assetMap(db, p.id)) })
  })

  // ---- 公開 API（FR-7）
  app.get('/api/public/:slug', async (c) => {
    c.header('Cache-Control', 'no-cache')
    const p = await getProjectBySlug(db, c.req.param('slug'))
    if (!p) return c.json({ reason: 'not_found' }, 404)
    if (p.status === 'deleted' || p.status === 'unpublished') {
      // R1 / Q1: 停止・削除後の「終了しました」画面にも、最後の公開版の行動ボタンと案内 URL を残す
      const v = p.published_scene_id ? await getSceneVersion(db, p.published_scene_id) : null
      const scene = v ? parseScene(v.scene) : null
      return c.json({ reason: 'unpublished', name: p.name, buttons: scene?.buttons ?? [], endedUrl: scene?.endedUrl ?? '' }, 410)
    }
    const v = p.published_scene_id ? await getSceneVersion(db, p.published_scene_id) : null
    if (p.status === 'draft' || !v) return c.json({ reason: 'draft', name: p.name }, 404)
    const scene = parseScene(v.scene)
    // D-01: 公開版が参照する素材のみ返す
    const refs = await publishedAssetIds(db, p)
    const assets = Object.fromEntries(Object.entries(await assetMap(db, p.id)).filter(([id]) => refs.has(id)))
    return c.json({ name: p.name, slug: p.slug, scene, sceneVersionId: v.id, assets, preview: false })
  })

  app.get('/api/preview/:token', async (c) => {
    c.header('Cache-Control', 'no-store')
    const p = await getProjectByPreviewToken(db, c.req.param('token'))
    if (!p || p.status === 'deleted') return c.json({ reason: 'not_found' }, 404)
    return c.json({ name: p.name, slug: p.slug, scene: parseScene(p.draft_scene), sceneVersionId: null, assets: await assetMap(db, p.id), preview: true })
  })

  app.post('/api/public/:slug/events', async (c) => {
    const slug = c.req.param('slug')
    const p = await getProjectBySlug(db, slug)
    if (!p) throw new HttpError(404, 'ページが見つかりません') // D-16: 存在しない slug ではバケットを作らない
    if (!(await rateLimitAllowed(db, `events:${slug}`, 60, 60_000))) throw new HttpError(429, 'リクエストが多すぎます')
    const body = analyticsEventSchema.safeParse(await json(c))
    if (!body.success) throw new HttpError(400, 'イベントの形式が不正です')
    // D-02: buttonId は公開版のボタン ID と照合する
    let buttonId: string | null = null
    if (body.data.type === 'cta_tap') {
      const v = p.status === 'published' && p.published_scene_id ? await getSceneVersion(db, p.published_scene_id) : null
      const ids = v ? parseScene(v.scene).buttons.map((b) => b.id) : []
      if (!body.data.buttonId || !ids.includes(body.data.buttonId)) throw new HttpError(400, 'ボタン ID が不正です')
      buttonId = body.data.buttonId
    }
    const now = new Date()
    await db.query('INSERT INTO analytics_events (project_id, scene_version_id, type, button_id, os, occurred_at, day_jst) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
      p.id,
      p.status === 'published' ? p.published_scene_id : null,
      body.data.type,
      buttonId,
      body.data.os,
      now.toISOString(),
      toDayJst(now),
    ])
    return c.body(null, 204)
  })

  // ---- 掃除（Q4。Cloudflare では Cron Trigger（scheduled）が runCleanup を直接呼ぶ。HTTP 経路は Bearer 保護つきで残す）
  app.get('/api/cron/cleanup', async (c) => {
    if (!config.cronSecret) throw new HttpError(503, 'CRON_SECRET が設定されていません')
    if (!safeEqual(String(c.req.header('authorization') ?? ''), `Bearer ${config.cronSecret}`)) throw new HttpError(401, '認証に失敗しました')
    return c.json(await runCleanup(db, storage))
  })

  // 未知の API パス（M-R3-04）
  app.all('/api/*', (c) => c.json({ error: 'ページが見つかりません' }, 404))

  // ---- 素材配信（ストレージから Range 対応で返す。ID は推測不能、公開 API は公開版の参照分しか返さない）
  app.get('/a/:name', async (c) => {
    const name = c.req.param('name')
    const a = await getAsset(db, name.split('.')[0])
    if (!a || a.url !== `/a/${name}`) return c.body(null, 404)
    const stat = await storage.stat(a.storage_key)
    if (!stat) return c.body(null, 404)
    const range = parseRange(c.req.header('range'), stat.size)
    const headers: Record<string, string> = {
      'Content-Type': a.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Accept-Ranges': 'bytes',
    }
    if (range === 'invalid') {
      c.header('Content-Range', `bytes */${stat.size}`)
      return c.body(null, 416)
    }
    const obj = await storage.get(a.storage_key, range ?? undefined)
    if (!obj) return c.body(null, 404)
    headers['Content-Length'] = String(obj.end - obj.start + 1)
    if (range) headers['Content-Range'] = `bytes ${obj.start}-${obj.end}/${obj.size}`
    if (a.kind === 'target_mind') headers['Content-Encoding'] = 'gzip' // 保存時に gzip 済み（D-19）。ブラウザが透過的に展開する
    const status: 200 | 206 = range ? 206 : 200
    return c.body(obj.body, status, headers)
  })

  app.get('/healthz', (c) => c.json({ ok: true, time: nowIso(), db: db.kind, storage: storage.kind }))

  // ---- エラーハンドラ
  app.onError((err, c) => {
    if (err instanceof HttpError || err instanceof AssetError) {
      return c.json({ error: err.message, code: err instanceof AssetError ? err.code : undefined }, err.status as ContentfulStatusCode)
    }
    console.error(JSON.stringify({ level: 'error', time: nowIso(), message: err.message, stack: err.stack }))
    return c.json({ error: 'サーバーでエラーが発生しました' }, 500)
  })

  return app
}

export type App = ReturnType<typeof createApp>
