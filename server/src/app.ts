import express, { type NextFunction, type Request, type Response } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import multer from 'multer'
import QRCode from 'qrcode'
import { z } from 'zod'
import {
  ASSET_KINDS,
  LIMITS,
  analyticsEventSchema,
  publishBlockers,
  sceneSchema,
  toDayJst,
  type AssetKind,
} from '../../shared/src/index.ts'
import { AssetError, assetUrl, deleteAssetFile, getAsset, saveAsset, toAssetInfo } from './assets.ts'
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
} from './auth.ts'
import type { Config } from './config.ts'
import type { Db } from './db.ts'
import { nowIso } from './db.ts'
import {
  assetMap,
  cleanupUnreferencedAssets,
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
  toSummary,
  unpublishProject,
  updateProject,
  type ProjectRow,
} from './projects.ts'

export interface AppDeps {
  db: Db
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
  return `${proto}://${req.headers.host}`
}

/** FR-7-6 / NFR-9: 計測イベントのレート制限（slug ごと 60 req/分） */
function makeRateLimiter(limit: number, windowMs: number) {
  const buckets = new Map<string, { start: number; count: number }>()
  return (key: string): boolean => {
    const now = Date.now()
    const b = buckets.get(key)
    if (!b || now - b.start > windowMs) {
      buckets.set(key, { start: now, count: 1 })
      return true
    }
    b.count += 1
    return b.count <= limit
  }
}

export function createApp({ db, config }: AppDeps) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', true)
  app.use(express.json({ limit: '1mb' }))
  app.use(attachUser(db))
  app.use('/api', checkOrigin)

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITS.videoBytes + 1024 } })
  const eventLimiter = makeRateLimiter(60, 60_000)

  const wrap = (fn: (req: Request, res: Response) => Promise<void> | void) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next)
  }

  const ownProject = (req: Request): ProjectRow => {
    const p = getProject(db, req.user!.id, String(req.params.id))
    if (!p) throw new HttpError(404, 'プロジェクトが見つかりません')
    return p
  }

  // ---- 設定（R9 のサポート連絡先など）
  app.get('/api/config', (_req, res) => {
    res.json({ serviceName: config.serviceName, supportEmail: config.supportEmail })
  })

  // ---- 認証（FR-1）
  app.post(
    '/api/auth/signup',
    wrap((req, res) => {
      const body = z.object({ email: emailSchema, password: passwordSchema }).safeParse(req.body)
      if (!body.success) throw new HttpError(400, 'メールアドレスの形式、または 8 文字以上のパスワードを確認してください')
      if (findUserByEmail(db, body.data.email)) throw new HttpError(409, 'このメールアドレスは登録済みです')
      const user = createUser(db, body.data.email, body.data.password)
      const sid = createSession(db, user.id)
      res.setHeader('Set-Cookie', sessionCookie(sid, config.cookieSecure))
      res.status(201).json({ user })
    }),
  )

  app.post(
    '/api/auth/login',
    wrap((req, res) => {
      const body = z.object({ email: emailSchema, password: z.string().max(200) }).safeParse(req.body)
      if (!body.success) throw new HttpError(400, 'メールアドレスまたはパスワードが違います')
      const { email, password } = body.data
      if (isLocked(email)) throw new HttpError(429, 'ログインに連続して失敗したため、15 分間ロックされています')
      const user = findUserByEmail(db, email)
      if (!user || !verifyPassword(password, user.passwordHash)) {
        recordFailure(email)
        throw new HttpError(401, 'メールアドレスまたはパスワードが違います')
      }
      clearFailures(email)
      const sid = createSession(db, user.id)
      res.setHeader('Set-Cookie', sessionCookie(sid, config.cookieSecure))
      res.json({ user: { id: user.id, email: user.email } })
    }),
  )

  app.post('/api/auth/logout', (req, res) => {
    if (req.sessionId) deleteSession(db, req.sessionId)
    res.setHeader('Set-Cookie', sessionCookie('', config.cookieSecure, true))
    res.status(204).end()
  })

  app.get('/api/auth/me', (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'ログインが必要です' })
      return
    }
    res.json({ user: req.user })
  })

  // ---- プロジェクト（FR-2）
  app.get('/api/projects', requireAuth, (req, res) => {
    res.json({ projects: listProjects(db, req.user!.id).map((p) => toSummary(db, p)) })
  })

  app.post(
    '/api/projects',
    requireAuth,
    wrap((req, res) => {
      const body = z.object({ name: nameSchema }).safeParse(req.body)
      if (!body.success) throw new HttpError(400, 'プロジェクト名を 1〜60 文字で入力してください')
      const p = createProject(db, req.user!.id, body.data.name)
      res.status(201).json({ project: toSummary(db, p) })
    }),
  )

  const projectDetail = (req: Request, p: ProjectRow) => {
    const published = p.published_scene_id ? getSceneVersion(db, p.published_scene_id) : null
    return {
      project: toSummary(db, p),
      draftScene: parseScene(p.draft_scene),
      publishedScene: published ? parseScene(published.scene) : null,
      publishedAt: published?.published_at ?? null,
      assets: assetMap(db, p.id),
      publicUrl: `${publicOrigin(req, config)}/v/${p.slug}`,
      previewUrl: `${publicOrigin(req, config)}/p/${p.preview_token}`,
      publishEvents: listPublishEvents(db, p.id).map((e) => ({ type: e.type, at: e.at, sceneVersionId: e.scene_version_id })),
    }
  }

  app.get(
    '/api/projects/:id',
    requireAuth,
    wrap((req, res) => {
      res.json(projectDetail(req, ownProject(req)))
    }),
  )

  app.patch(
    '/api/projects/:id',
    requireAuth,
    wrap((req, res) => {
      const p = ownProject(req)
      const body = z.object({ name: nameSchema.optional(), draftScene: sceneSchema.optional() }).safeParse(req.body)
      if (!body.success) throw new HttpError(400, '入力内容に誤りがあります: ' + body.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; '))
      if (body.data.draftScene) {
        // 参照アセットがこのプロジェクトのものか検証
        const s = body.data.draftScene
        for (const id of [s.target.imageAssetId, s.target.mindAssetId, s.overlay?.assetId, s.overlay?.thumbnailAssetId]) {
          if (id && getAsset(db, id)?.project_id !== p.id) throw new HttpError(400, '不正な素材が指定されています')
        }
      }
      updateProject(db, p.id, body.data)
      if (body.data.draftScene) cleanupUnreferencedAssets(db, config.dataDir, ownProject(req))
      res.json(projectDetail(req, ownProject(req)))
    }),
  )

  app.delete(
    '/api/projects/:id',
    requireAuth,
    wrap((req, res) => {
      deleteProject(db, config.dataDir, ownProject(req))
      res.status(204).end()
    }),
  )

  // ---- 素材（FR-3, FR-4）
  app.post(
    '/api/projects/:id/assets',
    requireAuth,
    upload.single('file'),
    wrap((req, res) => {
      const p = ownProject(req)
      const kind = String(req.body?.kind ?? '') as AssetKind
      if (!ASSET_KINDS.includes(kind)) throw new HttpError(400, 'kind が不正です')
      if (!req.file) throw new HttpError(400, 'ファイルがありません')
      const num = (v: unknown) => (v === undefined || v === '' ? null : Number(v))
      const width = num(req.body.width)
      const height = num(req.body.height)
      if (kind === 'target_image' && width && height && Math.max(width, height) > LIMITS.targetImageMaxEdgePx) {
        throw new HttpError(400, '長辺 8,000 px 以下の画像にしてください')
      }
      const a = saveAsset(db, config.dataDir, { projectId: p.id, kind, buffer: req.file.buffer, width, height, durationSec: num(req.body.durationSec) })
      res.status(201).json({ asset: toAssetInfo(a) })
    }),
  )

  app.delete(
    '/api/projects/:id/assets/:assetId',
    requireAuth,
    wrap((req, res) => {
      const p = ownProject(req)
      const a = getAsset(db, String(req.params.assetId))
      if (!a || a.project_id !== p.id) throw new HttpError(404, '素材が見つかりません')
      if (publishedAssetIds(db, p).has(a.id)) throw new HttpError(409, '公開中の AR が使用している素材は削除できません')
      db.prepare('DELETE FROM assets WHERE id = ?').run(a.id)
      deleteAssetFile(config.dataDir, a)
      res.status(204).end()
    }),
  )

  // ---- 公開・停止・プレビュー・QR（FR-6）
  app.post(
    '/api/projects/:id/publish',
    requireAuth,
    wrap((req, res) => {
      const p = ownProject(req)
      const blockers = publishBlockers(parseScene(p.draft_scene))
      if (blockers.length) throw new HttpError(400, blockers.join('。'))
      publishProject(db, p, req.user!.id)
      cleanupUnreferencedAssets(db, config.dataDir, ownProject(req))
      res.json(projectDetail(req, ownProject(req)))
    }),
  )

  app.post(
    '/api/projects/:id/unpublish',
    requireAuth,
    wrap((req, res) => {
      const p = ownProject(req)
      if (p.status !== 'published') throw new HttpError(400, '公開中ではありません')
      unpublishProject(db, p)
      res.json(projectDetail(req, ownProject(req)))
    }),
  )

  app.post(
    '/api/projects/:id/resume',
    requireAuth,
    wrap((req, res) => {
      const p = ownProject(req)
      if (p.status !== 'unpublished' || !p.published_scene_id) throw new HttpError(400, '停止中の AR のみ再開できます')
      resumeProject(db, p)
      res.json(projectDetail(req, ownProject(req)))
    }),
  )

  app.post(
    '/api/projects/:id/preview-token',
    requireAuth,
    wrap((req, res) => {
      const p = ownProject(req)
      rotatePreviewToken(db, p.id)
      res.json(projectDetail(req, ownProject(req)))
    }),
  )

  const qrOptions = { errorCorrectionLevel: 'M' as const, margin: 4 }
  app.get(
    '/api/projects/:id/qr.png',
    requireAuth,
    wrap(async (req, res) => {
      const p = ownProject(req)
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
      const p = ownProject(req)
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
      const p = ownProject(req)
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
    return q.data
  }
  app.get(
    '/api/projects/:id/stats',
    requireAuth,
    wrap((req, res) => {
      const p = ownProject(req)
      const { from, to } = statsRange(req)
      res.json({ from, to, rows: queryStats(db, p.id, from, to), publishEvents: listPublishEvents(db, p.id).map((e) => ({ type: e.type, at: e.at })) })
    }),
  )
  app.get(
    '/api/projects/:id/stats.csv',
    requireAuth,
    wrap((req, res) => {
      const p = ownProject(req)
      const { from, to } = statsRange(req)
      const rows = queryStats(db, p.id, from, to)
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
      const csv = ['﻿日付,種別,ボタンID,OS,回数', ...rows.map((r) => [r.day, r.type, r.buttonId, r.os, r.count].map(esc).join(','))].join('\r\n')
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="stats-${p.slug}-${from}-${to}.csv"`)
      res.send(csv)
    }),
  )

  // ---- エクスポート（NFR-8: 構造のみ。素材 URL とシーン定義のマニフェスト）
  app.get(
    '/api/projects/:id/export',
    requireAuth,
    wrap((req, res) => {
      const p = ownProject(req)
      res.json({ project: toSummary(db, p), draftScene: parseScene(p.draft_scene), assets: Object.values(assetMap(db, p.id)) })
    }),
  )

  // ---- 公開 API（FR-7）
  app.get('/api/public/:slug', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    const p = getProjectBySlug(db, String(req.params.slug))
    if (!p) {
      res.status(404).json({ reason: 'not_found' })
      return
    }
    if (p.status === 'deleted' || p.status === 'unpublished') {
      // R1 / Q1: 停止・削除後の「終了しました」画面にも、最後の公開版の行動ボタンと案内 URL を残す
      const v = p.published_scene_id ? getSceneVersion(db, p.published_scene_id) : null
      const scene = v ? parseScene(v.scene) : null
      res.status(410).json({ reason: 'unpublished', name: p.name, buttons: scene?.buttons ?? [], endedUrl: scene?.endedUrl ?? '' })
      return
    }
    if (p.status === 'draft' || !p.published_scene_id) {
      res.status(404).json({ reason: 'draft', name: p.name })
      return
    }
    const v = getSceneVersion(db, p.published_scene_id)
    if (!v) {
      res.status(404).json({ reason: 'draft', name: p.name })
      return
    }
    const scene = parseScene(v.scene)
    res.json({ name: p.name, slug: p.slug, scene, sceneVersionId: v.id, assets: assetMap(db, p.id), preview: false })
  })

  app.get('/api/preview/:token', (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    const p = getProjectByPreviewToken(db, String(req.params.token))
    if (!p || p.status === 'deleted') {
      res.status(404).json({ reason: 'not_found' })
      return
    }
    res.json({ name: p.name, slug: p.slug, scene: parseScene(p.draft_scene), sceneVersionId: null, assets: assetMap(db, p.id), preview: true })
  })

  app.post(
    '/api/public/:slug/events',
    wrap((req, res) => {
      const slug = String(req.params.slug)
      if (!eventLimiter(slug)) throw new HttpError(429, 'too many requests')
      const p = getProjectBySlug(db, slug)
      if (!p) throw new HttpError(404, 'not found')
      const body = analyticsEventSchema.safeParse(req.body)
      if (!body.success) throw new HttpError(400, 'invalid event')
      const now = new Date()
      db.prepare(
        'INSERT INTO analytics_events (project_id, scene_version_id, type, button_id, os, occurred_at, day_jst) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(p.id, p.status === 'published' ? p.published_scene_id : null, body.data.type, body.data.type === 'cta_tap' ? (body.data.buttonId ?? null) : null, body.data.os, now.toISOString(), toDayJst(now))
      res.status(204).end()
    }),
  )

  // ---- 素材配信（Range 対応は sendFile が行う）
  app.get('/a/:name', (req, res) => {
    const name = String(req.params.name)
    const id = name.split('.')[0]
    const a = getAsset(db, id)
    if (!a || assetUrl(a) !== `/a/${name}`) {
      res.status(404).end()
      return
    }
    res.sendFile(path.join(config.dataDir, a.storage_path), {
      headers: {
        'Content-Type': a.mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
      },
    })
  })

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, time: nowIso() })
  })

  // ---- フロントエンド（ビルド済み web/dist）
  const viewerHtml = path.join(config.webDist, 'viewer.html')
  const indexHtml = path.join(config.webDist, 'index.html')
  if (fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1y', setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache') } }))
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
    console.error(JSON.stringify({ level: 'error', time: nowIso(), message: (err as Error).message, stack: (err as Error).stack }))
    res.status(500).json({ error: 'サーバーでエラーが発生しました' })
  })

  return app
}
