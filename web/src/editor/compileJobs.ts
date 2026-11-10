// D-04: ターゲット解析（.mind 生成）を画面遷移後も継続させるための、モジュールスコープのジョブ管理。
// 解析が終わったら、編集画面が開いていればその場で下書きに反映し、閉じていればサーバの下書きを直接更新する。
import type { Scene } from '@shared/scene.ts'
import { api, ApiError } from './api.ts'
import { compileTarget } from './compile.ts'
import { downscale, loadImage } from './media.ts'

export interface CompileJob {
  projectId: string
  imageAssetId: string
  progress: number
  status: 'running' | 'done' | 'error'
  error: string | null
  result: Pick<Scene['target'], 'mindAssetId' | 'quality' | 'featureCount'> | null
  /** 編集画面が結果を下書きに取り込んだら true（二重反映防止） */
  consumed: boolean
  listeners: Set<(job: CompileJob) => void>
}

const jobs = new Map<string, CompileJob>()

export function getCompileJob(projectId: string): CompileJob | null {
  return jobs.get(projectId) ?? null
}

export function subscribeCompileJob(projectId: string, fn: (job: CompileJob) => void): () => void {
  const job = jobs.get(projectId)
  if (!job) return () => {}
  job.listeners.add(fn)
  return () => job.listeners.delete(fn)
}

function notify(job: CompileJob) {
  for (const fn of job.listeners) fn(job)
}

/**
 * 解析を開始する。結果（mindAssetId / quality / featureCount）は job.result に入り、
 * - 編集画面が購読中: 通知を受けた画面が下書きに反映して自動保存する
 * - 購読者がいない（画面を離れた）: サーバの下書きを取得して target を更新し PATCH する
 */
export function startCompileJob(projectId: string, imageAssetId: string, image: HTMLImageElement | string): CompileJob {
  const job: CompileJob = { projectId, imageAssetId, progress: 0, status: 'running', error: null, result: null, consumed: false, listeners: new Set() }
  jobs.set(projectId, job)
  ;(async () => {
    try {
      const img = await downscale(typeof image === 'string' ? await loadImage(image) : image, 1024)
      const r = await compileTarget(img, (p) => {
        job.progress = p
        notify(job)
      })
      let mind
      try {
        mind = await api.uploadAsset(projectId, 'target_mind', r.mind)
      } catch (e) {
        throw new Error(e instanceof ApiError && e.status === 401 ? 'ログインが切れました。再ログイン後に「再解析」を押してください' : '画像の解析結果を保存できませんでした。「再試行」を押してください')
      }
      const patch = { mindAssetId: mind.asset.id, quality: r.quality, featureCount: r.featureCount }
      job.result = patch
      job.status = 'done'
      job.progress = 100
      notify(job)
      if (!job.consumed) {
        // 画面を離れている: サーバの下書きを直接更新（画像が差し替えられていなければ）
        const d = await api.project(projectId)
        if (d.draftScene.target.imageAssetId === imageAssetId && d.draftScene.target.mindAssetId !== patch.mindAssetId) {
          await api.updateProject(projectId, { draftScene: { ...d.draftScene, target: { ...d.draftScene.target, ...patch } } })
        }
        job.consumed = true
      }
    } catch (e) {
      job.status = 'error'
      job.error = (e as Error).message || '画像の解析に失敗しました。別の画像をお試しください'
      notify(job)
    } finally {
      // 完了したジョブは画面が結果を取り込めるよう少しの間保持する
      setTimeout(() => {
        if (jobs.get(projectId) === job) jobs.delete(projectId)
      }, 60_000)
    }
  })()
  return job
}
