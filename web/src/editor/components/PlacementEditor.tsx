import { useRef, useState } from 'react'
import type { Overlay, Transform } from '@shared/scene.ts'

interface Props {
  targetUrl: string
  targetWidth: number
  targetHeight: number
  overlay: Overlay
  previewUrl: string | null
  onChange(t: Transform): void
}

/** FR-4-3: ターゲット画像の上でオーバーレイをドラッグ・拡大縮小・回転する（マウス / タッチ） */
export function PlacementEditor({ targetUrl, targetWidth, targetHeight, overlay, previewUrl, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ kind: 'move' | 'scale' | 'rotate'; startX: number; startY: number; start: Transform } | null>(null)
  const t = overlay.transform
  const aspect = overlay.type === 'model' ? 1 : overlay.aspect
  const hRatio = targetHeight / targetWidth

  // 表示座標（% of container）
  const wPct = t.width * 100
  const hPct = (t.width / aspect / hRatio) * 100
  const leftPct = t.x * 100 - wPct / 2
  const topPct = t.y * 100 - hPct / 2

  const begin = (kind: 'move' | 'scale' | 'rotate') => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    setDrag({ kind, startX: e.clientX, startY: e.clientY, start: { ...t } })
  }

  const move = (e: React.PointerEvent) => {
    if (!drag || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const dx = (e.clientX - drag.startX) / rect.width
    const dy = (e.clientY - drag.startY) / rect.height
    const s = drag.start
    if (drag.kind === 'move') {
      onChange({ ...s, x: clamp(s.x + dx, -0.5, 1.5), y: clamp(s.y + dy, -0.5, 1.5) })
    } else if (drag.kind === 'scale') {
      const w = clamp(s.width + dx * 2, 0.05, 3)
      onChange({ ...s, width: round(w) })
    } else {
      const cx = rect.left + (s.x * rect.width)
      const cy = rect.top + (s.y * rect.height)
      const a0 = Math.atan2(drag.startY - cy, drag.startX - cx)
      const a1 = Math.atan2(e.clientY - cy, e.clientX - cx)
      let deg = s.rotationDeg + ((a1 - a0) * 180) / Math.PI
      deg = ((deg + 180) % 360 + 360) % 360 - 180
      onChange({ ...s, rotationDeg: Math.round(deg) })
    }
  }

  const end = () => setDrag(null)

  return (
    <div ref={ref} className="placement" onPointerMove={move} onPointerUp={end} onPointerCancel={end} data-testid="placement">
      <img className="target" src={targetUrl} alt="ターゲット画像" draggable={false} />
      <div
        className="ov"
        role="group"
        aria-label="コンテンツの配置（ドラッグで移動）"
        style={{ left: `${leftPct}%`, top: `${topPct}%`, width: `${wPct}%`, height: `${hPct}%`, transform: `rotate(${t.rotationDeg}deg)` }}
        onPointerDown={begin('move')}
      >
        {previewUrl ? <img src={previewUrl} alt="" draggable={false} /> : <div className="model-ph">3D モデル</div>}
        <div className="rotate" onPointerDown={begin('rotate')} title="回転" />
        <div className="handle" onPointerDown={begin('scale')} title="大きさ" />
      </div>
    </div>
  )
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const round = (v: number) => Math.round(v * 1000) / 1000
