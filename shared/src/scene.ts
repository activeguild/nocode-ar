// シーン定義（docs/03_requirements_spec.md §6.1）の型・検証・ユーティリティ。
// server と web の両方から参照する（ランタイム依存は zod のみ）。
import { z } from 'zod'

export const SERVICE_NAME = 'ARチラシ（仮）'

/** アセット上限（NFR-4） */
export const LIMITS = {
  targetImageBytes: 10 * 1024 * 1024,
  imageBytes: 10 * 1024 * 1024,
  videoBytes: 50 * 1024 * 1024,
  modelBytes: 20 * 1024 * 1024,
  mindBytes: 20 * 1024 * 1024,
  projectTotalBytes: 100 * 1024 * 1024,
  /** R7: これを超える動画には回線の注意を出す */
  videoWarnBytes: 20 * 1024 * 1024,
  targetImageMaxEdgePx: 8000,
  printWidthMm: { min: 10, max: 3000, default: 210 },
} as const

export const BUTTON_PRESETS = {
  docs: '資料を請求する',
  line: 'LINE で友だち追加',
  web: 'Web サイトを見る',
} as const
export type ButtonPreset = keyof typeof BUTTON_PRESETS | 'custom'

/** FR-5-2 + R10: https:// / line:// / LINE 公式リンク */
export function isAllowedButtonUrl(url: string): boolean {
  if (url.length > 2048) return false
  if (/^line:\/\/\S+/i.test(url)) return true
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname.length > 0
  } catch {
    return false
  }
}

export const transformSchema = z.object({
  /** ターゲット画像の幅を 1.0 とした中心位置（0.5 = 中央） */
  x: z.number().min(-1).max(2),
  /** ターゲット画像の高さを 1.0 とした中心位置（0.5 = 中央） */
  y: z.number().min(-1).max(2),
  /** ターゲット幅比の横幅 */
  width: z.number().min(0.05).max(3),
  rotationDeg: z.number().min(-360).max(360),
})
export type Transform = z.infer<typeof transformSchema>

export const buttonSchema = z.object({
  id: z.string().min(1).max(20),
  label: z.string().min(1).max(20),
  url: z.string().refine(isAllowedButtonUrl, 'https:// または LINE のリンクを入力してください'),
  preset: z.enum(['docs', 'line', 'web', 'custom']).default('custom'),
})
export type SceneButton = z.infer<typeof buttonSchema>

export const overlaySchema = z.object({
  type: z.enum(['video', 'image', 'model']),
  assetId: z.string().min(1),
  thumbnailAssetId: z.string().nullable().default(null),
  /** 元ファイルの縦横比（幅 / 高さ）。動画・画像で使用。3D は 1 */
  aspect: z.number().positive().default(1),
  transform: transformSchema,
  video: z.object({ loop: z.boolean().default(true), withAudio: z.boolean().default(false) }).default({ loop: true, withAudio: false }),
  model: z
    .object({
      lift: z.number().min(0).max(2).default(0.1),
      yawDeg: z.number().min(-360).max(360).default(0),
      autoRotate: z.boolean().default(true),
    })
    .default({ lift: 0.1, yawDeg: 0, autoRotate: true }),
})
export type Overlay = z.infer<typeof overlaySchema>

export const targetSchema = z.object({
  imageAssetId: z.string().nullable().default(null),
  mindAssetId: z.string().nullable().default(null),
  imageWidth: z.number().int().positive().nullable().default(null),
  imageHeight: z.number().int().positive().nullable().default(null),
  printWidthMm: z.number().min(LIMITS.printWidthMm.min).max(LIMITS.printWidthMm.max).default(LIMITS.printWidthMm.default),
  /** FR-3-4: 認識しやすさの目安 */
  quality: z.enum(['good', 'fair', 'poor']).nullable().default(null),
  /** 判定に使った特徴点数（参考値） */
  featureCount: z.number().int().nonnegative().nullable().default(null),
})

export const sceneSchema = z.object({
  version: z.literal(1),
  target: targetSchema,
  overlay: overlaySchema.nullable().default(null),
  buttons: z.array(buttonSchema).max(3).default([]),
  /** R1: 公開停止後の「終了しました」画面に出す案内 URL（任意） */
  endedUrl: z.string().refine((v) => v === '' || isAllowedButtonUrl(v), 'https:// の URL を入力してください').default(''),
})
export type Scene = z.infer<typeof sceneSchema>

export function emptyScene(): Scene {
  return sceneSchema.parse({ version: 1, target: {}, overlay: null, buttons: [], endedUrl: '' })
}

export function defaultTransform(): Transform {
  return { x: 0.5, y: 0.5, width: 0.8, rotationDeg: 0 }
}

/** FR-6-2: 公開前チェック。空配列なら公開可能 */
export function publishBlockers(scene: Scene): string[] {
  const missing: string[] = []
  if (!scene.target.imageAssetId) missing.push('かざす対象（ターゲット画像）が登録されていません')
  else if (!scene.target.mindAssetId) missing.push('ターゲット画像の解析が完了していません')
  if (!scene.overlay) missing.push('表示するコンテンツ（動画・画像・3D）が登録されていません')
  if (scene.buttons.length === 0) missing.push('行動ボタンが 1 つも設定されていません')
  return missing
}

/** FR-3-4: 特徴点数からの 3 段階判定（目安。D7） */
export function judgeTargetQuality(featureCount: number): 'good' | 'fair' | 'poor' {
  if (featureCount >= 800) return 'good'
  if (featureCount >= 250) return 'fair'
  return 'poor'
}

export const ANALYTICS_EVENT_TYPES = ['page_open', 'blocked', 'view_start', 'recognized', 'cta_tap'] as const
export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number]
export const OS_KINDS = ['ios', 'android', 'other'] as const
export type OsKind = (typeof OS_KINDS)[number]

export const analyticsEventSchema = z.object({
  type: z.enum(ANALYTICS_EVENT_TYPES),
  buttonId: z.string().max(20).nullable().optional(),
  os: z.enum(OS_KINDS).default('other'),
})

export type ProjectStatus = 'draft' | 'published' | 'unpublished'

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: '下書き',
  published: '公開中',
  unpublished: '停止中',
}

/** 公開 API が返す非公開理由 */
export type PublicReason = 'not_found' | 'draft' | 'unpublished'

export const ASSET_KINDS = ['target_image', 'target_mind', 'overlay', 'thumbnail'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export interface AssetInfo {
  id: string
  kind: AssetKind
  mime: string
  sizeBytes: number
  width: number | null
  height: number | null
  url: string
}

/** 日本時間の日付 (YYYY-MM-DD) */
export function toDayJst(date: Date): string {
  const t = new Date(date.getTime() + 9 * 3600 * 1000)
  return t.toISOString().slice(0, 10)
}
