import compression from 'compression'
import express, { type NextFunction, type Request, type Response } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import multer from 'multer'
import QRCode from 'qrcode'
import { z } from 'zod'
import { ASSET_KINDS, LIMITS, analyticsEventSchema, publishBlockers, sceneSchema, toDayJst, type AssetKind } from '../../shared/src/index.js'
import { AssetError, KIND_LIMITS, deleteAsset, getAsset, registerUploadedAsset, saveAsset, toAssetInfo } from './assets.js'
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
  sessionCookie,
  verifyPassword,
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

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

function publicOrigin(req: Request, config: Config): string {
  if (config.publicOrigin) return config.publicOrigin
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] || req.protocol
  const host = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0] || req.headers.host
  return `${proto}://${host}`
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

export function createApp({ db, storage, config }: AppDeps) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', config.trustProxy)
  // D-05: ローカル / Docker では Express で gzip / brotli。Vercel ではエッジが圧縮するため不要
  if (!config.isVercel) {
    app.use(
      compression({
        threshold: 1024,
        filter: (req, res) => req.path.endsWith('.mind') || compression.filter(req, res),
      }),
    )
  }
  app.use(express.json({ limit: '1mb' }))
  app.use(attachUser(db))
  app.use('/api', checkOrigin)

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITS.videoBytes + 1024 } })
  const uploadMode: 'blob' | 'direct' = storage.kind === 'blob' ? 'blob' : 'direct'

  const wrap = (fn: (req: Request, res: Response) => Promise<void> | void) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next)
  }

  const ownProject = async (req: Request): Promise<ProjectRow> => {
    const p = await getProject(db, req.user!.id, String(req.params.id))
    if (!p) throw new HttpError(404, 'プロジェクトが見つかりません')
    return p
  }

  // ---- 設定（R9 のサポート連絡先、アップロード方式）
  app.get('/api/config', (_req, res) => {
    res.json({ serviceName: config.serviceName, supportEmail: config.supportEmail, uploadMode })
  })

  // ---- 認証（FR-1）
  app.post(
    '/api/auth/signup',
    wrap(async (req, res) => {
      const body = z.object({ email: emailSchema, password: passwordSchema }).safeParse(req.body)
      if (!body.success) throw new HttpError(400, 'メールアドレスの形式、または 8 文字以上のパスワードを確認してください')
      if (await findUserByEmail(db, body.data.email)) throw new HttpError(409, 'このメールアドレスは登録済みです')
      const user = await createUser(db, body.data.email, body.data.password)
      const sid = await createSession(db, user.id)
      res.setHeader('Set-Cookie', sessionCookie(sid, config.cookieSecure))
      res.status(201).json({ user })
    }),
  )

  app.post(
    '/api/auth/login',
    wrap(async (req, res) => {
      const body = z.object({ email: emailSchema, password: z.string().max(200) }).safeParse(req.body)
      if (!body.success) throw new HttpError(400, 'メールアドレスまたはパスワードが違います')
      const { email, password } = body.data
      if (await isLocked(db, email)) throw new HttpError(429, 'ログインに連続して失敗したため、15 分間ロックされています')
      const user = await findUserByEmail(db, email)
      if (!user || !verifyPassword(password, user.passwordHash)) {
        await recordFailure(db, email)
        throw new HttpError(401, 'メールアドレスまたはパスワードが違います')
      }
      await clearFailures(db, email)
      const sid = await createSession(db, user.id)
      res.setHeader('Set-Cookie', sessionCookie(sid, config.cookieSecure))
      res.json({ user: { id: user.id, email: user.email } })
    }),
  )

  app.post(
    '/api/auth/logout',
    wrap(async (req, res) => {
      if (req.sessionId) await deleteSession(db, req.sessionId)
      res.setHeader('Set-Cookie', sessionCookie('', config.cookieSecure, true))
      res.status(204).end()
    }),
  )

  app.get('/api/auth/me', (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'ログインが必要です' })
      return
    }
    res.json({ user: req.user })
  })

  // ---- プロジェクト（FR-2）
  app.get(
    '/api/projects',
    requireAuth,
    wrap(async (req, res) => {
      const rows = await listProjects(db, req.user!.id)
      res.json({ projects: await Promise.all(rows.map((p) => toSummary(db, p))) })
    }),
  )

  app.post(
    '/api/projects',
    requireAuth,
    wrap(async (req, res) => {
      const body = z.object({ name: nameSchema }).safeParse(req.body)
      if (!body.success) throw new HttpError(400, 'プロジェクト名を 1〜60 文字で入力してください')
      const p = await createProject(db, req.user!.id, body.data.name)
      res.status(201).json({ project: await toSummary(db, p) })
    }),
  )

  const projectDetail = async (req: Request, p: ProjectRow) => {
    const published = p.published_scene_id ? await getSceneVersion(db, p.published_scene_id) : null
    return {
      project: await toSummary(db, p),
      draftScene: parseScene(p.draft_scene),
      publishedScene: published ? parseScene(published.scene) : null,
      publishedAt: published?.published_at ?? null,
      assets: await assetMap(db, p.id),
      publicUrl: `${publicOrigin(req, config)}/v/${p.slug}`,
      previewUrl: `${publicOrigin(req, config)}/p/${p.preview_token}`,
      publishEvents: (await listPublishEvents(db, p.id)).map((e) => ({ type: e.type, at: e.at, sceneVersionId: e.scene_version_id })),
    }
  }

  app.get(
    '/api/projects/:id',
    requireAuth,
    wrap(async (req, res) => {
      res.json(await projectDetail(req, await ownProject(req)))
    }),
  )

  app.patch(
    '/api/projects/:id',
    requireAuth,
    wrap(async (req, res) => {
      const p = await ownProject(req)
      const body = z.object({ name: nameSchema.optional(), draftScene: sceneSchema.optional() }).safeParse(req.body)
      // D-07: zod の英語メッセージは出さず、項目名のみ日本語で示す
      if (!body.success) throw new HttpError(400, '入力内容に誤りがあります（' + [...new Set(body.error.issues.map((i) => i.path.join('.') || 'body'))].join(', ') + '）')
      if (body.data.draftScene) {
        const s = body.data.draftScene
        for (const id of [s.target.imageAssetId, s.target.mindAssetId, s.overlay?.assetId, s.overlay?.thumbnailAssetId]) {
          if (id && (await getAsset(db, id))?.project_id !== p.id) throw new HttpError(400, '不正な素材が指定されています')
        }
      }
      await updateProject(db, p.id, body.data)
      res.json(await projectDetail(req, await ownProject(req)))
    }),
  )

  app.delete(
    '/api/projects/:id',
    requireAuth,
    wrap(async (req, res) => {
      await deleteProject(db, storage, await ownProject(req))
      res.status(204).end()
    }),
  )

  // ---- 素材（FR-3, FR-4）
  const numField = (v: unknown) => {
    const n = v === undefined || v === null || v === '' ? NaN : Number(v)
    return Number.isFinite(n) && n > 0 ? n : null
  }

  // 直接アップロード（ローカル / Docker。Vercel では本文上限 4.5 MB のため Blob 直接アップロードを使う）
  app.post(
    '/api/projects/:id/assets',
    requireAuth,
    upload.single('file'),
    wrap(async (req, res) => {
      const p = await ownProject(req)
      const kind = String(req.body?.kind ?? '') as AssetKind
      if (!ASSET_KINDS.includes(kind)) throw new HttpError(400, 'kind が不正です')
      if (!req.file) throw new HttpError(400, 'ファイルがありません')
      const a = await saveAsset(db, storage, {
        projectId: p.id,
        userId: req.user!.id,
        accountQuotaBytes: config.accountQuotaBytes,
        kind,
        buffer: req.file.buffer,
        width: numField(req.body.width),
        height: numField(req.body.height),
        durationSec: numField(req.body.durationSec),
      })
      res.status(201).json({ asset: toAssetInfo(a) })
    }),
  )

  // Blob 直接アップロード: トークン発行（@vercel/blob/client の upload() から呼ばれる）
  app.post(
    '/api/projects/:id/blob-upload',
    requireAuth,
    wrap(async (req, res) => {
      if (storage.kind !== 'blob' || !config.blobToken) throw new HttpError(404, 'Blob アップロードは無効です')
      const p = await ownProject(req)
      const { handleUpload } = await import('@vercel/blob/client')
      const result = await handleUpload({
        token: config.blobToken,
        body: req.body,
        request: req,
        onBeforeGenerateToken: async (pathname, clientPayload) => {
          let kind: AssetKind | null = null
          try {
            kind = JSON.parse(clientPayload ?? '{}').kind ?? null
          } catch {
            kind = null
          }
          if (!kind || !ASSET_KINDS.includes(kind)) throw new Error('kind が不正です')
          const re = new RegExp(`^projects/${p.id}/${kind}/[A-Za-z0-9_.-]{1,80}$`)
          if (!re.test(pathname)) throw new Error('アップロード先のパスが不正です')
          const lim = KIND_LIMITS[kind]
          return {
            allowedContentTypes: lim.contentTypes,
            maximumSizeInBytes: lim.maxBytes,
            addRandomSuffix: true,
            tokenPayload: JSON.stringify({ projectId: p.id, userId: req.user!.id, kind }),
          }
        },
        // 完了通知（Webhook）はローカルでは届かないため使わず、クライアントが /assets/register を呼ぶ
        onUploadCompleted: async () => {},
      })
      res.json(result)
    }),
  )

  // Blob 直接アップロードの登録（所有権・形式・寸法・上限をサーバで検証）
  app.post(
    '/api/projects/:id/assets/register',
    requireAuth,
    wrap(async (req, res) => {
      if (storage.kind === 'local') throw new HttpError(404, 'この環境では直接アップロードを使用してください')
      const p = await ownProject(req)
      const body = z
        .object({
          kind: z.enum(ASSET_KINDS),
          url: z.string().url().max(2048),
          pathname: z.string().min(1).max(200),
          width: z.coerce.number().positive().optional(),
          height: z.coerce.number().positive().optional(),
          durationSec: z.coerce.number().positive().optional(),
        })
        .safeParse(req.body)
      if (!body.success) throw new HttpError(400, '登録内容が不正です')
      const a = await registerUploadedAsset(db, storage, {
        projectId: p.id,
        userId: req.user!.id,
        accountQuotaBytes: config.accountQuotaBytes,
        kind: body.data.kind,
        url: body.data.url,
        key: body.data.pathname,
        width: body.data.width ?? null,
        height: body.data.height ?? null,
        durationSec: body.data.durationSec ?? null,
      })
      res.status(201).json({ asset: toAssetInfo(a) })
    }),
  )

  app.delete(
    '/api/projects/:id/assets/:assetId',
    requireAuth,
    wrap(async (req, res) => {
      const p = await ownProject(req)
      const a = await getAsset(db, String(req.params.assetId))
      if (!a || a.project_id !== p.id) throw new HttpError(404, '素材が見つかりません')
      if ((await publishedAssetIds(db, p)).has(a.id)) throw new HttpError(409, '公開中の AR が使用している素材は削除できません')
      await deleteAsset(db, storage, a)
      res.status(204).end()
    }),
  )

  // ---- 公開・停止・プレビュー・QR（FR-6）
  app.post(
    '/api/projects/:id/publish',
    requireAuth,
    wrap(async (req, res) => {
      const p = await ownProject(req)
      const blockers = publishBlockers(parseScene(p.draft_scene))
      if (blockers.length) throw new HttpError(400, blockers.join('。'))
      await publishProject(db, p, req.user!.id)
      res.json(await projectDetail(req, await ownProject(req)))
    }),
  )

  app.post(
    '/api/projects/:id/unpublish',
    requireAuth,
    wrap(async (req, res) => {
      const p = await ownProject(req)
      if (p.status !== 'published') throw new HttpError(400, '公開中ではありません')
      await unpublishProject(db, p)
      res.json(await projectDetail(req, await ownProject(req)))
    }),
  )

  app.post(
    '/api/projects/:id/resume',
    requireAuth,
    wrap(async (req, res) => {
      const p = await ownProject(req)
      if (p.status !== 'unpublished' || !p.published_scene_id) throw new HttpError(400, '停止中の AR のみ再開できます')
      await resumeProject(db, p)
      res.json(await projectDetail(req, await ownProject(req)))
    }),
  )

  app.post(
    '/api/projects/:id/preview-token',
    requireAuth,
    wrap(async (req, res) => {
      const p = await ownProject(req)
      await rotatePreviewToken(db, p.id)
      res.json(await projectDetail(req, await ownProject(req)))
    }),
  )

  const qrOptions = { errorCorrectionLevel: 'M' as const, margin: 4 }
  app.get(
    '/api/projects/:id/qr.png',
    requireAuth,
    wrap(async (req, res) => {
      const p = await ownProject(req)
      const buf = await QRCode.toBuffer(`${publicOrigin(req, config)}/v/${p.slug}`, { ...qrOptions, type: 'png', width: 1024 })
      res.setHeader('Content-Type', 'image/png')
      res.setHeader('Content-Disposition', `attachment; filename="qr-${p.slug}.png"`)
      res.send(buf)
    }),
  )
  app.get(
    '/api/projects/:id/qr.svg',
    requireAuth,
    wrap(async (req, res) => {
      const p = await ownProject(req)
      const svg = await QRCode.toString(`${publicOrigin(req, config)}/v/${p.slug}`, { ...qrOptions, type: 'svg' })
      res.setHeader('Content-Type', 'image/svg+xml')
      res.setHeader('Content-Disposition', `attachment; filename="qr-${p.slug}.svg"`)
      res.send(svg)
    }),
  )
  app.get(
    '/api/projects/:id/preview-qr.png',
    requireAuth,
    wrap(async (req, res) => {
      const p = await ownProject(req)
      const buf = await QRCode.toBuffer(`${publicOrigin(req, config)}/p/${p.preview_token}`, { ...qrOptions, type: 'png', width: 512 })
      res.setHeader('Content-Type', 'image/png')
      res.setHeader('Cache-Control', 'no-store')
      res.send(buf)
    }),
  )

  // ---- 計測（FR-9）
  const statsRange = (req: Request) => {
    const q = z.object({ from: daySchema, to: daySchema }).safeParse(req.query)
    if (!q.success) throw new HttpError(400, 'from / to は YYYY-MM-DD で指定してください')
    if (q.data.from > q.data.to) throw new HttpError(400, '開始日は終了日以前にしてください') // D-15
    return q.data
  }
  app.get(
    '/api/projects/:id/stats',
    requireAuth,
    wrap(async (req, res) => {
      const p = await ownProject(req)
      const { from, to } = statsRange(req)
      res.json({ from, to, rows: await queryStats(db, p.id, from, to), publishEvents: (await listPublishEvents(db, p.id)).map((e) => ({ type: e.type, at: e.at })) })
    }),
  )
  app.get(
    '/api/projects/:id/stats.csv',
    requireAuth,
    wrap(async (req, res) => {
      const p = await ownProject(req)
      const { from, to } = statsRange(req)
      const rows = await queryStats(db, p.id, from, to)
      // D-02: 数式インジェクション対策。= + - @ タブ CR で始まるセルは ' を前置する
      const esc = (v: unknown) => {
        let t = String(v ?? '')
        if (/^[=+\-@\t\r]/.test(t)) t = "'" + t
        return `"${t.replace(/"/g, '""')}"`
      }
      const csv = ['﻿日付,種別,ボタンID,OS,回数', ...rows.map((r) => [r.day, r.type, r.buttonId, r.os, r.count].map(esc).join(','))].join('\r\n')
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="stats-${p.slug}-${from}-${to}.csv"`)
      res.send(csv)
    }),
  )

  // ---- エクスポート（NFR-8: 構造のみ）
  app.get(
    '/api/projects/:id/export',
    requireAuth,
    wrap(async (req, res) => {
      const p = await ownProject(req)
      res.json({ project: await toSummary(db, p), draftScene: parseScene(p.draft_scene), assets: Object.values(await assetMap(db, p.id)) })
    }),
  )

  // ---- 公開 API（FR-7）
  app.get(
    '/api/public/:slug',
    wrap(async (req, res) => {
      res.setHeader('Cache-Control', 'no-cache')
      const p = await getProjectBySlug(db, String(req.params.slug))
      if (!p) {
        res.status(404).json({ reason: 'not_found' })
        return
      }
      if (p.status === 'deleted' || p.status === 'unpublished') {
        // R1 / Q1: 停止・削除後の「終了しました」画面にも、最後の公開版の行動ボタンと案内 URL を残す
        const v = p.published_scene_id ? await getSceneVersion(db, p.published_scene_id) : null
        const scene = v ? parseScene(v.scene) : null
        res.status(410).json({ reason: 'unpublished', name: p.name, buttons: scene?.buttons ?? [], endedUrl: scene?.endedUrl ?? '' })
        return
      }
      const v = p.published_scene_id ? await getSceneVersion(db, p.published_scene_id) : null
      if (p.status === 'draft' || !v) {
        res.status(404).json({ reason: 'draft', name: p.name })
        return
      }
      const scene = parseScene(v.scene)
      // D-01: 公開版が参照する素材のみ返す
      const refs = await publishedAssetIds(db, p)
      const assets = Object.fromEntries(Object.entries(await assetMap(db, p.id)).filter(([id]) => refs.has(id)))
      res.json({ name: p.name, slug: p.slug, scene, sceneVersionId: v.id, assets, preview: false })
    }),
  )

  app.get(
    '/api/preview/:token',
    wrap(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store')
      const p = await getProjectByPreviewToken(db, String(req.params.token))
      if (!p || p.status === 'deleted') {
        res.status(404).json({ reason: 'not_found' })
        return
      }
      res.json({ name: p.name, slug: p.slug, scene: parseScene(p.draft_scene), sceneVersionId: null, assets: await assetMap(db, p.id), preview: true })
    }),
  )

  app.post(
    '/api/public/:slug/events',
    wrap(async (req, res) => {
      const slug = String(req.params.slug)
      const p = await getProjectBySlug(db, slug)
      if (!p) throw new HttpError(404, 'not found') // D-16: 存在しない slug ではバケットを作らない
      if (!(await rateLimitAllowed(db, `events:${slug}`, 60, 60_000))) throw new HttpError(429, 'too many requests')
      const body = analyticsEventSchema.safeParse(req.body)
      if (!body.success) throw new HttpError(400, 'invalid event')
      // D-02: buttonId は公開版のボタン ID と照合する
      let buttonId: string | null = null
      if (body.data.type === 'cta_tap') {
        const v = p.status === 'published' && p.published_scene_id ? await getSceneVersion(db, p.published_scene_id) : null
        const ids = v ? parseScene(v.scene).buttons.map((b) => b.id) : []
        if (!body.data.buttonId || !ids.includes(body.data.buttonId)) throw new HttpError(400, 'invalid buttonId')
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
      res.status(204).end()
    }),
  )

  // ---- 掃除（Q4。Vercel Cron から GET。Authorization: Bearer <CRON_SECRET>）
  app.get(
    '/api/cron/cleanup',
    wrap(async (req, res) => {
      if (!config.cronSecret) throw new HttpError(503, 'CRON_SECRET が設定されていません')
      if (req.headers.authorization !== `Bearer ${config.cronSecret}`) throw new HttpError(401, 'unauthorized')
      res.json(await runCleanup(db, storage))
    }),
  )

  // ---- 素材配信（ローカル保存のみ。Blob は公開 URL から直接配信）
  app.get(
    '/a/:name',
    wrap(async (req, res) => {
      const name = String(req.params.name)
      const a = await getAsset(db, name.split('.')[0])
      if (!a || a.storage !== 'local' || a.url !== `/a/${name}` || !storage.localPath) {
        res.status(404).end()
        return
      }
      res.sendFile(storage.localPath(a.storage_key), {
        headers: {
          'Content-Type': a.mime,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': 'inline',
        },
      })
    }),
  )

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, time: nowIso(), db: db.kind, storage: storage.kind })
  })

  // ---- フロントエンド（ビルド済み web/dist。Vercel では CDN が配信するためここは通らない）
  const viewerHtml = path.join(config.webDist, 'viewer.html')
  const indexHtml = path.join(config.webDist, 'index.html')
  if (!config.isVercel && fs.existsSync(config.webDist)) {
    app.use(
      express.static(config.webDist, {
        index: false,
        maxAge: '1y',
        setHeaders: (res, p) => {
          if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache')
        },
      }),
    )
    app.get(['/v/:slug', '/p/:token'], (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(viewerHtml)
    })
    app.get(/^\/(?!api\/|a\/).*/, (req, res, next) => {
      if (!req.accepts('html')) return next()
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(indexHtml)
    })
  }

  // ---- エラーハンドラ
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError || err instanceof AssetError) {
      res.status(err.status).json({ error: err.message, code: err instanceof AssetError ? err.code : undefined })
      return
    }
    if (err instanceof multer.MulterError) {
      res.status(413).json({ error: 'ファイルが大きすぎます（動画 50 MB / 3D 20 MB / 画像 10 MB）', code: 'too_large' })
      return
    }
    if (err instanceof SyntaxError && 'body' in (err as object)) {
      res.status(400).json({ error: 'JSON の形式が不正です' })
      return
    }
    if ((err as { type?: string }).type === 'entity.too.large') {
      res.status(413).json({ error: '送信データが大きすぎます（1 MB まで）' }) // D-08
      return
    }
    console.error(JSON.stringify({ level: 'error', time: nowIso(), message: (err as Error).message, stack: (err as Error).stack }))
    res.status(500).json({ error: 'サーバーでエラーが発生しました' })
  })

  return app
}
