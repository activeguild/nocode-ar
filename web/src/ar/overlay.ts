// オーバーレイ（動画 / 画像 / 3D）の three.js オブジェクトを組み立てる。
// 閲覧ページ（MindAR のアンカー配下）と作成画面のプレビューで同じコードを使う（FR-4-6）。
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { Overlay } from '@shared/scene.ts'

export interface BuiltOverlay {
  group: THREE.Group
  video: HTMLVideoElement | null
  /** 毎フレーム呼ぶ（自動回転など） */
  update(dtSec: number): void
  dispose(): void
}

export interface TargetDims {
  /** 高さ / 幅（ターゲット幅 = 1.0 に対する高さ） */
  heightRatio: number
}

/** 2D 配置（ターゲット画像上の相対座標）→ three.js 座標 */
export function placeOnTarget(obj: THREE.Object3D, t: Overlay['transform'], target: TargetDims, z = 0.002) {
  obj.position.set(t.x - 0.5, -(t.y - 0.5) * target.heightRatio, z)
  obj.rotation.set(0, 0, (-t.rotationDeg * Math.PI) / 180)
}

export function addSceneLights(scene: THREE.Scene) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6)
  const dir = new THREE.DirectionalLight(0xffffff, 1.8)
  dir.position.set(0.5, 1, 2)
  scene.add(hemi, dir)
}

export function createVideoElement(url: string, opts: { loop: boolean }): HTMLVideoElement {
  const v = document.createElement('video')
  v.src = url
  v.crossOrigin = 'anonymous'
  v.muted = true
  v.defaultMuted = true
  v.loop = opts.loop
  v.playsInline = true
  v.setAttribute('playsinline', '')
  v.setAttribute('webkit-playsinline', '')
  v.preload = 'auto'
  v.style.position = 'absolute'
  v.style.width = '1px'
  v.style.height = '1px'
  v.style.opacity = '0'
  v.style.pointerEvents = 'none'
  return v
}

export async function buildOverlay(overlay: Overlay, assetUrl: string, target: TargetDims): Promise<BuiltOverlay> {
  const group = new THREE.Group()
  const disposables: { dispose(): void }[] = []
  let video: HTMLVideoElement | null = null
  let update = (_dt: number) => {}

  if (overlay.type === 'image') {
    const tex = await new THREE.TextureLoader().loadAsync(assetUrl)
    tex.colorSpace = THREE.SRGBColorSpace
    const aspect = tex.image && tex.image.width ? tex.image.width / tex.image.height : overlay.aspect
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide })
    const geo = new THREE.PlaneGeometry(overlay.transform.width, overlay.transform.width / aspect)
    const mesh = new THREE.Mesh(geo, mat)
    placeOnTarget(mesh, overlay.transform, target)
    group.add(mesh)
    disposables.push(tex, mat, geo)
  } else if (overlay.type === 'video') {
    video = createVideoElement(assetUrl, { loop: overlay.video.loop })
    document.body.appendChild(video)
    const aspect = await new Promise<number>((resolve) => {
      const done = () => resolve(video!.videoWidth && video!.videoHeight ? video!.videoWidth / video!.videoHeight : overlay.aspect)
      if (video!.readyState >= 1) done()
      else {
        video!.addEventListener('loadedmetadata', done, { once: true })
        video!.addEventListener('error', () => resolve(overlay.aspect), { once: true })
        setTimeout(() => resolve(overlay.aspect), 8000)
      }
    })
    const tex = new THREE.VideoTexture(video)
    tex.colorSpace = THREE.SRGBColorSpace
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
    const geo = new THREE.PlaneGeometry(overlay.transform.width, overlay.transform.width / aspect)
    const mesh = new THREE.Mesh(geo, mat)
    placeOnTarget(mesh, overlay.transform, target)
    group.add(mesh)
    disposables.push(tex, mat, geo)
  } else {
    const gltf = await new GLTFLoader().loadAsync(assetUrl)
    const model = gltf.scene
    const box = new THREE.Box3().setFromObject(model)
    const size = new THREE.Vector3()
    box.getSize(size)
    const maxDim = Math.max(size.x, size.y, size.z) || 1
    const s = overlay.transform.width / maxDim
    const center = new THREE.Vector3()
    box.getCenter(center)
    // 底面をターゲット面に接地させ、中心を原点に
    const inner = new THREE.Group()
    model.position.set(-center.x, -box.min.y, -center.z)
    inner.add(model)
    inner.scale.setScalar(s)
    inner.rotation.y = (overlay.model.yawDeg * Math.PI) / 180
    const stand = new THREE.Group()
    stand.rotation.x = Math.PI / 2 // モデルの +Y をターゲット面の法線（+Z）に
    stand.add(inner)
    placeOnTarget(stand, overlay.transform, target, overlay.model.lift)
    group.add(stand)
    if (overlay.model.autoRotate) update = (dt) => (inner.rotation.y += dt * 0.6)
    const mixer = gltf.animations.length ? new THREE.AnimationMixer(model) : null
    if (mixer) {
      gltf.animations.forEach((clip) => mixer.clipAction(clip).play())
      const prev = update
      update = (dt) => {
        prev(dt)
        mixer.update(dt)
      }
    }
  }

  return {
    group,
    video,
    update,
    dispose() {
      disposables.forEach((d) => d.dispose())
      if (video) {
        video.pause()
        video.removeAttribute('src')
        video.load()
        video.remove()
      }
    },
  }
}
