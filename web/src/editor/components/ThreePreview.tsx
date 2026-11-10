import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { Overlay } from '@shared/scene.ts'
import { addSceneLights, buildOverlay, type BuiltOverlay } from '../../ar/overlay.ts'

interface Props {
  targetUrl: string
  targetWidth: number
  targetHeight: number
  overlay: Overlay
  overlayUrl: string
}

/** FR-4-4 / FR-4-6: 閲覧ページと同じ描画コードで、ターゲット画像の上に実際の見え方（斜め視点）を表示する */
export function ThreePreview({ targetUrl, targetWidth, targetHeight, overlay, overlayUrl }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const key = JSON.stringify({ overlay, overlayUrl, targetUrl })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let disposed = false
    let built: BuiltOverlay | null = null
    let renderer: THREE.WebGLRenderer | null = null
    const hRatio = targetHeight / targetWidth

    const run = async () => {
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      } catch {
        setError('この環境では 3D プレビューを表示できません')
        return
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(el.clientWidth, el.clientHeight || el.clientWidth * 0.75)
      el.appendChild(renderer.domElement)
      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x2a2d36)
      addSceneLights(scene)
      const camera = new THREE.PerspectiveCamera(40, el.clientWidth / (el.clientHeight || el.clientWidth * 0.75), 0.01, 20)
      camera.position.set(0, -1.3, 1.6)
      camera.lookAt(0, 0, 0.05)

      const tex = await new THREE.TextureLoader().loadAsync(targetUrl)
      tex.colorSpace = THREE.SRGBColorSpace
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, hRatio), new THREE.MeshBasicMaterial({ map: tex }))
      scene.add(plane)
      try {
        built = await buildOverlay(overlay, overlayUrl, { heightRatio: hRatio })
      } catch (e) {
        setError(overlay.type === 'model' ? 'この 3D ファイルは読み込めません' : (e as Error).message)
        return
      }
      if (disposed) {
        built.dispose()
        return
      }
      scene.add(built.group)
      built.video?.play().catch(() => {})
      let last = performance.now()
      renderer.setAnimationLoop(() => {
        const now = performance.now()
        built?.update(Math.min((now - last) / 1000, 0.1))
        last = now
        renderer!.render(scene, camera)
      })
      setError(null)
    }
    run()
    return () => {
      disposed = true
      renderer?.setAnimationLoop(null)
      built?.dispose()
      renderer?.dispose()
      renderer?.domElement.remove()
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div ref={ref} className="three-preview" aria-label="3D プレビュー" />
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}
