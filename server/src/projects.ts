import { emptyScene, sceneSchema, type ProjectStatus, type Scene } from '../../shared/src/index.ts'
import { deleteAssetFile, listAssets, toAssetInfo } from './assets.ts'
import type { Db } from './db.ts'
import { nowIso } from './db.ts'
import { newId, newSlug, newToken } from './ids.ts'

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

export function toSummary(db: Db, p: ProjectRow): ProjectSummary {
  const t = db
    .prepare(
      `SELECT SUM(CASE WHEN type = 'view_start' THEN 1 ELSE 0 END) AS v, SUM(CASE WHEN type = 'cta_tap' THEN 1 ELSE 0 END) AS c
       FROM analytics_events WHERE project_id = ?`,
    )
    .get(p.id) as { v: number | null; c: number | null }
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    status: p.status,
    previewToken: p.preview_token,
    publishedSceneId: p.published_scene_id,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    totals: { viewStart: t.v ?? 0, ctaTap: t.c ?? 0 },
  }
}

export function parseScene(json: string): Scene {
  const r = sceneSchema.safeParse(JSON.parse(json))
  return r.success ? r.data : emptyScene()
}

export function listProjects(db: Db, userId: string): ProjectRow[] {
  return db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as ProjectRow[]
}

export function getProject(db: Db, userId: string, id: string): ProjectRow | null {
  return (db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, userId) as ProjectRow | undefined) ?? null
}

export function getProjectBySlug(db: Db, slug: string): ProjectRow | null {
  return (db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug) as ProjectRow | undefined) ?? null
}

export function getProjectByPreviewToken(db: Db, token: string): ProjectRow | null {
  return (db.prepare('SELECT * FROM projects WHERE preview_token = ?').get(token) as ProjectRow | undefined) ?? null
}

export function createProject(db: Db, userId: string, name: string): ProjectRow {
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
      db.prepare(
        `INSERT INTO projects (id, user_id, name, slug, status, preview_token, draft_scene, published_scene_id, created_at, updated_at)
         VALUES (@id, @user_id, @name, @slug, @status, @preview_token, @draft_scene, @published_scene_id, @created_at, @updated_at)`,
      ).run(row)
      return row
    } catch (e) {
      if (attempt === 4) throw e // slug 衝突のリトライ
    }
  }
  throw new Error('unreachable')
}

export function updateProject(db: Db, id: string, patch: { name?: string; draftScene?: Scene }) {
  const sets: string[] = ['updated_at = @updated_at']
  const params: Record<string, unknown> = { id, updated_at: nowIso() }
  if (patch.name !== undefined) {
    sets.push('name = @name')
    params.name = patch.name
  }
  if (patch.draftScene !== undefined) {
    sets.push('draft_scene = @draft_scene')
    params.draft_scene = JSON.stringify(patch.draftScene)
  }
  db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = @id`).run(params)
}

export function deleteProject(db: Db, dataDir: string, p: ProjectRow) {
  for (const a of listAssets(db, p.id)) deleteAssetFile(dataDir, a)
  db.prepare('DELETE FROM projects WHERE id = ?').run(p.id)
}

export function rotatePreviewToken(db: Db, id: string): string {
  const t = newToken()
  db.prepare('UPDATE projects SET preview_token = ?, updated_at = ? WHERE id = ?').run(t, nowIso(), id)
  return t
}

export interface SceneVersionRow {
  id: string
  project_id: string
  scene: string
  published_at: string
  published_by_user_id: string
}

export function getSceneVersion(db: Db, id: string): SceneVersionRow | null {
  return (db.prepare('SELECT * FROM scene_versions WHERE id = ?').get(id) as SceneVersionRow | undefined) ?? null
}

/** FR-6-3 / FR-6-7: 下書きのスナップショットを公開版にする。NFR-5: 10 世代保持 */
export function publishProject(db: Db, p: ProjectRow, userId: string): SceneVersionRow {
  const now = nowIso()
  const version: SceneVersionRow = { id: newId(), project_id: p.id, scene: p.draft_scene, published_at: now, published_by_user_id: userId }
  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO scene_versions (id, project_id, scene, published_at, published_by_user_id) VALUES (@id, @project_id, @scene, @published_at, @published_by_user_id)',
    ).run(version)
    db.prepare("UPDATE projects SET status = 'published', published_scene_id = ?, updated_at = ? WHERE id = ?").run(version.id, now, p.id)
    db.prepare('INSERT INTO publish_events (project_id, type, scene_version_id, at) VALUES (?, ?, ?, ?)').run(
      p.id,
      p.published_scene_id ? 'republish' : 'publish',
      version.id,
      now,
    )
    db.prepare(
      `DELETE FROM scene_versions WHERE project_id = ? AND id NOT IN (
         SELECT id FROM scene_versions WHERE project_id = ? ORDER BY published_at DESC LIMIT 10)`,
    ).run(p.id, p.id)
  })
  tx()
  return version
}

export function unpublishProject(db: Db, p: ProjectRow) {
  const now = nowIso()
  const tx = db.transaction(() => {
    db.prepare("UPDATE projects SET status = 'unpublished', updated_at = ? WHERE id = ?").run(now, p.id)
    db.prepare('INSERT INTO publish_events (project_id, type, scene_version_id, at) VALUES (?, ?, ?, ?)').run(p.id, 'unpublish', p.published_scene_id, now)
  })
  tx()
}

export interface PublishEventRow {
  type: 'publish' | 'republish' | 'unpublish'
  scene_version_id: string | null
  at: string
}

export function listPublishEvents(db: Db, projectId: string): PublishEventRow[] {
  return db.prepare('SELECT type, scene_version_id, at FROM publish_events WHERE project_id = ? ORDER BY at').all(projectId) as PublishEventRow[]
}

/** 公開版シーンが参照しているアセット ID */
export function publishedAssetIds(db: Db, p: ProjectRow): Set<string> {
  const ids = new Set<string>()
  if (!p.published_scene_id) return ids
  const v = getSceneVersion(db, p.published_scene_id)
  if (!v) return ids
  const s = parseScene(v.scene)
  for (const id of [s.target.imageAssetId, s.target.mindAssetId, s.overlay?.assetId, s.overlay?.thumbnailAssetId]) if (id) ids.add(id)
  return ids
}

export function assetMap(db: Db, projectId: string) {
  const out: Record<string, ReturnType<typeof toAssetInfo>> = {}
  for (const a of listAssets(db, projectId)) out[a.id] = toAssetInfo(a)
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

export function queryStats(db: Db, projectId: string, from: string, to: string): StatsRow[] {
  return (
    db
      .prepare(
        `SELECT day_jst AS day, type, button_id AS buttonId, os, COUNT(*) AS count
         FROM analytics_events WHERE project_id = ? AND day_jst BETWEEN ? AND ?
         GROUP BY day_jst, type, button_id, os ORDER BY day_jst`,
      )
      .all(projectId, from, to) as StatsRow[]
  )
}
