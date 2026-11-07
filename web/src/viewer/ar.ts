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

export async function startArSession(opts: ArSessionOptions): Promise<ArSession> {
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
    const err = e as Error & { name?: string }
    const name = err?.name ?? ''
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new CameraError('denied', 'カメラの許可が必要です')
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') throw new CameraError('unavailable', 'カメラを利用できません')
    throw new CameraError('unknown', err?.message || 'カメラを起動できませんでした')
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
