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

export type UploadMode = 'direct' | 'blob'
export interface AppConfigResponse {
  serviceName: string
  supportEmail: string | null
  uploadMode: UploadMode
}

let uploadMode: UploadMode = 'direct'
/** /api/config の結果で切り替える（Vercel では Blob へ直接アップロード） */
export function setUploadMode(mode: UploadMode) {
  uploadMode = mode
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

function guessContentType(kind: AssetKind, file: Blob, ext: string): string {
  if (kind === 'target_mind') return 'application/octet-stream'
  if (file.type) return file.type
  if (ext === 'glb') return 'model/gltf-binary'
  return 'application/octet-stream'
}

function extOf(file: Blob, kind: AssetKind): string {
  if (kind === 'target_mind') return 'mind'
  const name = (file as File).name ?? ''
  const fromName = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  if (fromName && /^[a-z0-9]{1,5}$/.test(fromName)) return fromName
  const map: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'model/gltf-binary': 'glb' }
  return map[file.type] ?? 'bin'
}

/**
 * 素材のアップロード。
 * - direct: multipart で API に送る（ローカル / Docker）
 * - blob: @vercel/blob/client で Vercel Blob に直接アップロードし、完了後に /assets/register でサーバに検証・登録させる
 */
async function uploadAsset(id: string, kind: AssetKind, file: Blob, meta: UploadMeta = {}): Promise<{ asset: AssetInfo }> {
  if (uploadMode === 'blob') {
    const { upload } = await import('@vercel/blob/client')
    const ext = extOf(file, kind)
    const pathname = `projects/${id}/${kind}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    let blob
    try {
      blob = await upload(pathname, file, {
        access: 'public',
        handleUploadUrl: `/api/projects/${id}/blob-upload`,
        clientPayload: JSON.stringify({ kind }),
        contentType: guessContentType(kind, file, ext),
        multipart: file.size > 8 * 1024 * 1024,
      })
    } catch (e) {
      throw new ApiError(400, (e as Error).message?.includes('size') ? 'ファイルが大きすぎます' : 'アップロードに失敗しました。通信環境を確認して再試行してください')
    }
    const clean: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(meta)) if (v !== undefined) clean[k] = v
    return call('POST', `/api/projects/${id}/assets/register`, { kind, url: blob.url, pathname: blob.pathname, ...clean })
  }
  const fd = new FormData()
  fd.append('kind', kind)
  for (const [k, v] of Object.entries(meta)) if (v !== undefined) fd.append(k, String(v))
  fd.append('file', file, 'upload.bin')
  return call('POST', `/api/projects/${id}/assets`, fd)
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
