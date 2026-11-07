// MindAR（画像トラッキング）セッション。カメラ映像は端末内で処理され、ネットワークには送られない（NFR-6）。
import type { BuiltOverlay } from '../ar/overlay.ts'
import { addSceneLights } from '../ar/overlay.ts'

export interface ArSessionOptions {
  container: HTMLElement
  mindUrl: string
  overlay: BuiltOverlay | null
  onFound(): void
  onLost(): void
}

export interface ArSession {
  stop(): void
}

export class CameraError extends Error {
  constructor(
    public kind: 'denied' | 'unavailable' | 'unknown',
    message: string,
  ) {
    super(message)
  }
}

/**
 * D-03: mind-ar の _startVideo は getUserMedia の失敗理由を捨てて reject するため、
 * 先に自前で getUserMedia を試して失敗種別（許可拒否 / カメラなし）を判別する。成功したストリームは即座に止める。
 */
export async function probeCamera(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unavailable', 'このブラウザではカメラを使えません')
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } })
    stream.getTracks().forEach((t) => t.stop())
  } catch (e) {
    const name = (e as { name?: string })?.name ?? ''
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') throw new CameraError('denied', 'カメラの許可が必要です')
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError' || name === 'AbortError') {
      throw new CameraError('unavailable', 'カメラを利用できません')
    }
    throw new CameraError('unknown', (e as Error)?.message || 'カメラを起動できませんでした')
  }
}

export async function startArSession(opts: ArSessionOptions): Promise<ArSession> {
  await probeCamera()
  const { MindARThree } = await import('mind-ar/dist/mindar-image-three.prod.js')
  const mindar = new MindARThree({
    container: opts.container,
    imageTargetSrc: opts.mindUrl,
    maxTrack: 1,
    uiLoading: 'no',
    uiScanning: 'no',
    uiError: 'no',
    filterMinCF: 0.0005,
    filterBeta: 0.01,
    warmupTolerance: 3,
    missTolerance: 8,
  })
  const { renderer, scene, camera } = mindar
  addSceneLights(scene)
  const anchor = mindar.addAnchor(0)
  if (opts.overlay) anchor.group.add(opts.overlay.group)
  anchor.onTargetFound = () => opts.onFound()
  anchor.onTargetLost = () => opts.onLost()

  try {
    await mindar.start()
  } catch (e) {
    // probeCamera を通過した後の失敗（ターゲットデータの読み込み失敗など）
    throw new CameraError('unknown', (e as Error)?.message || 'AR を開始できませんでした。通信環境を確認して再読み込みしてください')
  }

  let last = performance.now()
  renderer.setAnimationLoop(() => {
    const now = performance.now()
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    opts.overlay?.update(dt)
    renderer.render(scene, camera)
  })

  return {
    stop() {
      renderer.setAnimationLoop(null)
      try {
        mindar.stop()
      } catch {
        /* already stopped */
      }
      renderer.dispose()
    },
  }
}
