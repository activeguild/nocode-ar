// 素材ストレージのアダプタ。ローカル = ファイル保存（/a/<id>.<ext> で配信）、Vercel = Vercel Blob（公開 URL を直接配信）。
import fs from 'node:fs'
import path from 'node:path'

export interface StoredObject {
  key: string
  url: string
}
export interface ListedObject {
  key: string
  url: string
  uploadedAt: Date
}

export interface Storage {
  kind: 'local' | 'blob' | 'memory'
  /** key は `projects/<projectId>/<kind>/<id>.<ext>` */
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>
  delete(obj: StoredObject): Promise<void>
  /** 存在すればサイズと Content-Type（HEAD 相当） */
  head(url: string): Promise<{ size: number; contentType: string | null } | null>
  /** [start, end]（両端含む）のバイト列を取得 */
  readRange(url: string, start: number, end: number): Promise<Buffer>
  /** プレフィックス配下の一覧（迷子の素材の掃除に使う）。未対応なら undefined */
  list?(prefix: string): Promise<ListedObject[]>
  /** ローカル配信用: 保存先の絶対パス */
  localPath?(key: string): string
}

/** url が Vercel Blob の公開 URL か */
export const isBlobUrl = (url: string) => /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//i.test(url)

// ---------------------------------------------------------------- local
export function createLocalStorage(dataDir: string): Storage {
  const root = path.join(dataDir, 'assets')
  const abs = (key: string) => {
    const p = path.resolve(root, key)
    if (!p.startsWith(root + path.sep)) throw new Error('invalid key')
    return p
  }
  const urlToKey = new Map<string, string>()
  return {
    kind: 'local',
    async put(key, body) {
      const p = abs(key)
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, body)
      const url = `/a/${path.basename(key)}`
      urlToKey.set(url, key)
      return { key, url }
    },
    async delete(obj) {
      try {
        fs.unlinkSync(abs(obj.key))
      } catch {
        /* ignore */
      }
    },
    async head(url) {
      const key = urlToKey.get(url)
      if (!key) return null
      try {
        const st = fs.statSync(abs(key))
        return { size: st.size, contentType: null }
      } catch {
        return null
      }
    },
    async readRange(url, start, end) {
      const key = urlToKey.get(url)
      if (!key) throw new Error('not found')
      const fd = fs.openSync(abs(key), 'r')
      try {
        const len = end - start + 1
        const buf = Buffer.alloc(len)
        const n = fs.readSync(fd, buf, 0, len, start)
        return buf.subarray(0, n)
      } finally {
        fs.closeSync(fd)
      }
    },
    localPath: abs,
  }
}

// ---------------------------------------------------------------- memory（テスト用）
export function createMemoryStorage(): Storage & { objects: Map<string, { body: Buffer; contentType: string }> } {
  const objects = new Map<string, { body: Buffer; contentType: string }>()
  const urlFor = (key: string) => `memory://store/${key}`
  const keyFor = (url: string) => url.replace(/^memory:\/\/store\//, '')
  return {
    kind: 'memory',
    objects,
    async put(key, body, contentType) {
      objects.set(key, { body, contentType })
      return { key, url: urlFor(key) }
    },
    async delete(obj) {
      objects.delete(obj.key)
    },
    async head(url) {
      const o = objects.get(keyFor(url))
      return o ? { size: o.body.length, contentType: o.contentType } : null
    },
    async readRange(url, start, end) {
      const o = objects.get(keyFor(url))
      if (!o) throw new Error('not found')
      return o.body.subarray(start, end + 1)
    },
    async list(prefix) {
      return [...objects.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ key: k, url: urlFor(k), uploadedAt: new Date(0) }))
    },
  }
}

// ---------------------------------------------------------------- Vercel Blob
export function createBlobStorage(token: string): Storage {
  type BlobModule = typeof import('@vercel/blob')
  let mod: Promise<BlobModule> | null = null
  const blob = () => (mod ??= import('@vercel/blob'))
  return {
    kind: 'blob',
    async put(key, body, contentType) {
      const { put } = await blob()
      // addRandomSuffix: URL を推測不能にする（公開 API には公開版の素材 URL しか返さないが、二重の防御）
      const r = await put(key, body, { access: 'public', addRandomSuffix: true, contentType, token })
      return { key: r.pathname, url: r.url }
    },
    async delete(obj) {
      const { del } = await blob()
      await del(obj.url, { token })
    },
    async head(url) {
      const res = await fetch(url, { method: 'HEAD' })
      if (!res.ok) return null
      return { size: Number(res.headers.get('content-length') ?? 0), contentType: res.headers.get('content-type') }
    },
    async readRange(url, start, end) {
      const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } })
      if (!res.ok) throw new Error(`range fetch failed: ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      // Range 非対応で全体が返った場合に備える
      return res.status === 206 ? buf : buf.subarray(start, end + 1)
    },
    async list(prefix) {
      const { list } = await blob()
      const out: ListedObject[] = []
      let cursor: string | undefined
      do {
        const page = await list({ prefix, cursor, limit: 1000, token })
        for (const b of page.blobs) out.push({ key: b.pathname, url: b.url, uploadedAt: b.uploadedAt })
        cursor = page.hasMore ? page.cursor : undefined
      } while (cursor)
      return out
    },
  }
}
