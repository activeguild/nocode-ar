// FR-3-3: ターゲットデータ（.mind）を作成者のブラウザ内で生成する
import { judgeTargetQuality } from '@shared/scene.ts'

export interface CompileResult {
  mind: Blob
  featureCount: number
  quality: 'good' | 'fair' | 'poor'
}

export async function compileTarget(image: HTMLImageElement, onProgress: (percent: number) => void): Promise<CompileResult> {
  const { Compiler } = await import('mind-ar/dist/mindar-image.prod.js')
  const compiler = new Compiler()
  const list = await compiler.compileImageTargets([image], (p) => onProgress(Math.min(99, Math.round(p))))
  const data = list[0]
  // 全スケールの特徴点（極大・極小）の合計を「認識しやすさ」の目安にする（Q13: 800 以上 良い / 250 以上 普通 / それ未満 認識しにくい）
  const featureCount = data.matchingData.reduce((n, s) => n + s.maximaPoints.length + s.minimaPoints.length, 0)
  const buf = await compiler.exportData()
  onProgress(100)
  return { mind: new Blob([buf as BlobPart], { type: 'application/octet-stream' }), featureCount, quality: judgeTargetQuality(featureCount) }
}
