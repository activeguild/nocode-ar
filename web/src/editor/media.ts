// ブラウザ内の画像縮小・動画サムネイル生成（FR-3-2, FR-4-5）

export function loadImage(src: Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = typeof src === 'string' ? src : URL.createObjectURL(src)
    img.onload = () => {
      if (typeof src !== 'string') URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      if (typeof src !== 'string') URL.revokeObjectURL(url)
      reject(new Error('画像を読み込めません'))
    }
    img.src = url
  })
}

/** 長辺 maxEdge px に縮小した画像（元画像が小さければそのまま） */
export async function downscale(img: HTMLImageElement, maxEdge: number): Promise<HTMLImageElement> {
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (Math.max(w, h) <= maxEdge) return img
  const s = maxEdge / Math.max(w, h)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * s)
  canvas.height = Math.round(h * s)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('変換に失敗'))), 'image/png'))
  return loadImage(blob)
}

export interface VideoMeta {
  width: number
  height: number
  duration: number
  thumbnail: Blob
}

/** 動画の 1 フレーム目（0.5 秒付近）からサムネイルを作る */
export function videoMeta(file: File): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    const url = URL.createObjectURL(file)
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    const fail = () => {
      URL.revokeObjectURL(url)
      reject(new Error('この動画はブラウザで再生できません。MP4（H.264）で書き出してください'))
    }
    v.onerror = fail
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(0.5, v.duration / 2 || 0)
    }
    v.onseeked = () => {
      const canvas = document.createElement('canvas')
      canvas.width = v.videoWidth
      canvas.height = v.videoHeight
      try {
        canvas.getContext('2d')!.drawImage(v, 0, 0)
      } catch {
        fail()
        return
      }
      canvas.toBlob((b) => {
        URL.revokeObjectURL(url)
        if (!b) return fail()
        resolve({ width: v.videoWidth, height: v.videoHeight, duration: v.duration, thumbnail: b })
      }, 'image/jpeg', 0.8)
    }
    v.src = url
  })
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
