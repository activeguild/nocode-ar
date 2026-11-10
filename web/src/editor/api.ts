import type { AssetInfo, AssetKind, ProjectStatus, Scene } from '@shared/scene.ts'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message)
  }
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

export type PublishEventType = 'publish' | 'republish' | 'unpublish' | 'resume' | 'delete'

export interface ProjectDetail {
  project: ProjectSummary
  draftScene: Scene
  publishedScene: Scene | null
  publishedAt: string | null
  assets: Record<string, AssetInfo>
  publicUrl: string
  previewUrl: string
  publishEvents: { type: PublishEventType; at: string; sceneVersionId: string | null }[]
}

export interface StatsResponse {
  from: string
  to: string
  rows: { day: string; type: string; buttonId: string | null; os: string; count: number }[]
  publishEvents: { type: PublishEventType; at: string }[]
}

export interface AppConfigResponse {
  serviceName: string
  supportEmail: string | null
  uploadMode: 'direct'
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body instanceof FormData ? {} : body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error ?? `エラー（${res.status}）`, data.code)
  return data as T
}

type UploadMeta = Record<string, string | number | undefined>

/**
 * 素材のアップロード: ファイル本体をそのまま POST し（Content-Length 付き）、種類とメタデータはクエリで渡す。
 * 鍵と URL はサーバが生成する。サーバ側で形式・寸法・上限を検証する。
 */
async function uploadAsset(id: string, kind: AssetKind, file: Blob, meta: UploadMeta = {}): Promise<{ asset: AssetInfo }> {
  const q = new URLSearchParams({ kind })
  for (const [k, v] of Object.entries(meta)) if (v !== undefined) q.set(k, String(v))
  const res = await fetch(`/api/projects/${id}/assets?${q}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error ?? `エラー（${res.status}）`, data.code)
  return data as { asset: AssetInfo }
}

export const api = {
  config: () => call<AppConfigResponse>('GET', '/api/config'),
  me: () => call<{ user: { id: string; email: string } }>('GET', '/api/auth/me'),
  signup: (email: string, password: string) => call<{ user: { id: string; email: string } }>('POST', '/api/auth/signup', { email, password }),
  login: (email: string, password: string) => call<{ user: { id: string; email: string } }>('POST', '/api/auth/login', { email, password }),
  logout: () => call<void>('POST', '/api/auth/logout'),
  projects: () => call<{ projects: ProjectSummary[] }>('GET', '/api/projects'),
  createProject: (name: string) => call<{ project: ProjectSummary }>('POST', '/api/projects', { name }),
  project: (id: string) => call<ProjectDetail>('GET', `/api/projects/${id}`),
  updateProject: (id: string, patch: { name?: string; draftScene?: Scene }) => call<ProjectDetail>('PATCH', `/api/projects/${id}`, patch),
  deleteProject: (id: string) => call<void>('DELETE', `/api/projects/${id}`),
  uploadAsset,
  publish: (id: string) => call<ProjectDetail>('POST', `/api/projects/${id}/publish`),
  unpublish: (id: string) => call<ProjectDetail>('POST', `/api/projects/${id}/unpublish`),
  resume: (id: string) => call<ProjectDetail>('POST', `/api/projects/${id}/resume`),
  rotatePreviewToken: (id: string) => call<ProjectDetail>('POST', `/api/projects/${id}/preview-token`),
  stats: (id: string, from: string, to: string) => call<StatsResponse>('GET', `/api/projects/${id}/stats?from=${from}&to=${to}`),
}
