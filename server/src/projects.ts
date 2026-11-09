import { emptyScene, sceneSchema, type ProjectStatus, type Scene } from '../../shared/src/index.js'
import { deleteAsset, listAssets, toAssetInfo, type AssetRow } from './assets.js'
import type { Db, Queryable } from './db.js'
import { all, nowIso, num, one } from './db.js'
import { newId, newSlug, newToken } from './ids.js'
import type { Storage } from './storage.js'

export interface ProjectRow {
  id: string
  user_id: string
  name: string
  slug: string
  status: ProjectStatus
  preview_token: string
  draft_scene: string
  published_scene_id: string | null
  created_at: string
  updated_at: string
}

export interface ProjectSummary {
  id: string
  name: string
  slug: string
  status: ProjectStatus
  previewToken: string
  publishedSceneId: string | null
  createdAt: string
  updatedAt: string
  totals: { viewStart: number; ctaTap: number }
}

export async function toSummary(db: Queryable, p: ProjectRow): Promise<ProjectSummary> {
  const t = await one<{ v: unknown; c: unknown }>(
    db,
    `SELECT SUM(CASE WHEN type = 'view_start' THEN 1 ELSE 0 END) AS v, SUM(CASE WHEN type = 'cta_tap' THEN 1 ELSE 0 END) AS c
     FROM analytics_events WHERE project_id = $1`,
    [p.id],
  )
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    status: p.status,
    previewToken: p.preview_token,
    publishedSceneId: p.published_scene_id,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    totals: { viewStart: num(t?.v), ctaTap: num(t?.c) },
  }
}

export function parseScene(json: string): Scene {
  const r = sceneSchema.safeParse(JSON.parse(json))
  return r.success ? r.data : emptyScene()
}

export const listProjects = (db: Queryable, userId: string) =>
  all<ProjectRow>(db, "SELECT * FROM projects WHERE user_id = $1 AND status <> 'deleted' ORDER BY updated_at DESC", [userId])

export const getProject = (db: Queryable, userId: string, id: string) =>
  one<ProjectRow>(db, "SELECT * FROM projects WHERE id = $1 AND user_id = $2 AND status <> 'deleted'", [id, userId])

export const getProjectBySlug = (db: Queryable, slug: string) => one<ProjectRow>(db, 'SELECT * FROM projects WHERE slug = $1', [slug])

export const getProjectByPreviewToken = (db: Queryable, token: string) => one<ProjectRow>(db, 'SELECT * FROM projects WHERE preview_token = $1', [token])

export async function createProject(db: Db, userId: string, name: string): Promise<ProjectRow> {
  const now = nowIso()
  for (let attempt = 0; attempt < 5; attempt++) {
    const row: ProjectRow = {
      id: newId(),
      user_id: userId,
      name,
      slug: newSlug(),
      status: 'draft',
      preview_token: newToken(),
      draft_scene: JSON.stringify(emptyScene()),
      published_scene_id: null,
      created_at: now,
      updated_at: now,
    }
    try {
      await db.query(
        `INSERT INTO projects (id, user_id, name, slug, status, preview_token, draft_scene, published_scene_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [row.id, row.user_id, row.name, row.slug, row.status, row.preview_token, row.draft_scene, row.published_scene_id, row.created_at, row.updated_at],
      )
      return row
    } catch (e) {
      if (attempt === 4) throw e // slug 衝突のリトライ
    }
  }
  throw new Error('unreachable')
}

export async function updateProject(db: Queryable, id: string, patch: { name?: string; draftScene?: Scene }) {
  const sets: string[] = ['updated_at = $2']
  const params: unknown[] = [id, nowIso()]
  if (patch.name !== undefined) {
    params.push(patch.name)
    sets.push(`name = $${params.length}`)
  }
  if (patch.draftScene !== undefined) {
    params.push(JSON.stringify(patch.draftScene))
    sets.push(`draft_scene = $${params.length}`)
  }
  await db.query(`UPDATE projects SET ${sets.join(', ')} WHERE id = $1`, params)
}

/**
 * Q1: 削除は論理削除。slug と公開履歴（終了画面のボタン・案内 URL に使う）は残し、素材は削除する。
 */
export async function deleteProject(db: Db, storage: Storage, p: ProjectRow) {
  for (const a of await listAssets(db, p.id)) await deleteAsset(db, storage, a)
  await db.tx(async (q) => {
    await q.query("UPDATE projects SET status = 'deleted', draft_scene = $2, preview_token = $3, updated_at = $4 WHERE id = $1", [p.id, JSON.stringify(emptyScene()), newToken(), nowIso()])
    await q.query('INSERT INTO publish_events (project_id, type, scene_version_id, at) VALUES ($1, $2, $3, $4)', [p.id, 'delete', p.published_scene_id, nowIso()])
  })
}

export async function rotatePreviewToken(db: Queryable, id: string): Promise<string> {
  const t = newToken()
  await db.query('UPDATE projects SET preview_token = $2, updated_at = $3 WHERE id = $1', [id, t, nowIso()])
  return t
}

export interface SceneVersionRow {
  id: string
  project_id: string
  scene: string
  published_at: string
  published_by_user_id: string
}

export const getSceneVersion = (db: Queryable, id: string) => one<SceneVersionRow>(db, 'SELECT * FROM scene_versions WHERE id = $1', [id])

/** FR-6-3 / FR-6-7: 下書きのスナップショットを公開版にする。NFR-5: 10 世代保持 */
export async function publishProject(db: Db, p: ProjectRow, userId: string): Promise<SceneVersionRow> {
  const now = nowIso()
  const version: SceneVersionRow = { id: newId(), project_id: p.id, scene: p.draft_scene, published_at: now, published_by_user_id: userId }
  await db.tx(async (q) => {
    await q.query('INSERT INTO scene_versions (id, project_id, scene, published_at, published_by_user_id) VALUES ($1, $2, $3, $4, $5)', [
      version.id,
      version.project_id,
      version.scene,
      version.published_at,
      version.published_by_user_id,
    ])
    await q.query("UPDATE projects SET status = 'published', published_scene_id = $2, updated_at = $3 WHERE id = $1", [p.id, version.id, now])
    await q.query('INSERT INTO publish_events (project_id, type, scene_version_id, at) VALUES ($1, $2, $3, $4)', [p.id, p.published_scene_id ? 'republish' : 'publish', version.id, now])
    await q.query(
      `DELETE FROM scene_versions WHERE project_id = $1 AND id NOT IN (
         SELECT id FROM scene_versions WHERE project_id = $1 ORDER BY published_at DESC LIMIT 10)`,
      [p.id],
    )
  })
  return version
}

/** Q2: 再開は停止前の公開版にそのまま戻す（下書きは反映しない）。PublishEvent.type = 'resume' */
export async function resumeProject(db: Db, p: ProjectRow) {
  const now = nowIso()
  await db.tx(async (q) => {
    await q.query("UPDATE projects SET status = 'published', updated_at = $2 WHERE id = $1", [p.id, now])
    await q.query('INSERT INTO publish_events (project_id, type, scene_version_id, at) VALUES ($1, $2, $3, $4)', [p.id, 'resume', p.published_scene_id, now])
  })
}

export async function unpublishProject(db: Db, p: ProjectRow) {
  const now = nowIso()
  await db.tx(async (q) => {
    await q.query("UPDATE projects SET status = 'unpublished', updated_at = $2 WHERE id = $1", [p.id, now])
    await q.query('INSERT INTO publish_events (project_id, type, scene_version_id, at) VALUES ($1, $2, $3, $4)', [p.id, 'unpublish', p.published_scene_id, now])
  })
}

export type PublishEventType = 'publish' | 'republish' | 'unpublish' | 'resume' | 'delete'
export interface PublishEventRow {
  type: PublishEventType
  scene_version_id: string | null
  at: string
}

export const listPublishEvents = (db: Queryable, projectId: string) =>
  all<PublishEventRow>(db, 'SELECT type, scene_version_id, at FROM publish_events WHERE project_id = $1 ORDER BY at, id', [projectId])

/** 公開版シーンが参照しているアセット ID */
export async function publishedAssetIds(db: Queryable, p: ProjectRow): Promise<Set<string>> {
  const ids = new Set<string>()
  if (!p.published_scene_id) return ids
  const v = await getSceneVersion(db, p.published_scene_id)
  if (!v) return ids
  const s = parseScene(v.scene)
  for (const id of [s.target.imageAssetId, s.target.mindAssetId, s.overlay?.assetId, s.overlay?.thumbnailAssetId]) if (id) ids.add(id)
  return ids
}

export async function assetMap(db: Queryable, projectId: string) {
  const out: Record<string, ReturnType<typeof toAssetInfo>> = {}
  for (const a of await listAssets(db, projectId)) out[a.id] = toAssetInfo(a)
  return out
}

/** FR-9: 日別 × 種別 × ボタン × OS の集計 */
export interface StatsRow {
  day: string
  type: string
  buttonId: string | null
  os: string
  count: number
}

export async function queryStats(db: Queryable, projectId: string, from: string, to: string): Promise<StatsRow[]> {
  const rows = await all<{ day: string; type: string; buttonid: string | null; os: string; count: unknown }>(
    db,
    `SELECT day_jst AS day, type, button_id AS buttonid, os, COUNT(*) AS count
     FROM analytics_events WHERE project_id = $1 AND day_jst BETWEEN $2 AND $3
     GROUP BY day_jst, type, button_id, os ORDER BY day_jst`,
    [projectId, from, to],
  )
  return rows.map((r) => ({ day: r.day, type: r.type, buttonId: r.buttonid, os: r.os, count: num(r.count) }))
}

// ---------------------------------------------------------------- 掃除（Q4 → Vercel Cron）
export const CLEANUP_GRACE_MS = 15 * 60_000

export interface CleanupResult {
  assetsDeleted: number
  orphanBlobsDeleted: number
  sessionsDeleted: number
}

/**
 * - 下書きにも公開版にも参照されず、作成から 15 分以上経った素材を削除（Q4）
 * - DB に無い迷子の Blob（登録前に離脱したアップロード）を削除
 * - 期限切れセッション、古いレート制限 / ログインロック行を削除
 */
export async function runCleanup(db: Db, storage: Storage, now = Date.now()): Promise<CleanupResult> {
  const cutoff = new Date(now - CLEANUP_GRACE_MS).toISOString()
  const result: CleanupResult = { assetsDeleted: 0, orphanBlobsDeleted: 0, sessionsDeleted: 0 }
  const projects = await all<ProjectRow>(db, "SELECT * FROM projects WHERE status <> 'deleted'")
  for (const p of projects) {
    const keep = await publishedAssetIds(db, p)
    const d = parseScene(p.draft_scene)
    for (const id of [d.target.imageAssetId, d.target.mindAssetId, d.overlay?.assetId, d.overlay?.thumbnailAssetId]) if (id) keep.add(id)
    for (const a of await listAssets(db, p.id)) {
      if (keep.has(a.id) || a.created_at > cutoff) continue
      await deleteAsset(db, storage, a)
      result.assetsDeleted++
    }
  }
  if (storage.list) {
    const known = new Set((await all<{ storage_key: string }>(db, 'SELECT storage_key FROM assets')).map((r) => r.storage_key))
    for (const obj of await storage.list('projects/')) {
      if (known.has(obj.key) || obj.uploadedAt.getTime() > now - CLEANUP_GRACE_MS) continue
      await storage.delete(obj).catch(() => {})
      result.orphanBlobsDeleted++
    }
  }
  const s = await db.query('DELETE FROM sessions WHERE expires_at < $1 RETURNING id', [new Date(now).toISOString()])
  result.sessionsDeleted = s.rows.length
  await db.query('DELETE FROM rate_limits WHERE window_start < $1', [now - 3600_000])
  await db.query('DELETE FROM login_locks WHERE locked_until < $1 AND last_attempt < $1', [now - 3600_000])
  return result
}

export type { AssetRow }
