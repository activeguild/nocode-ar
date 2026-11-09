// 素材ストレージのアダプタ。ローカル = ファイル保存（/a/<id>.<ext> で配信）、Vercel = Vercel Blob（公開 URL を直接配信）。
// すべての操作は「自ストア内の key（pathname）」を起点にする。クライアントから渡された URL を取得・削除に使うことはない（B-R3-01）。
import fs from 'node:fs'
import path from 'node:path'

export interface StoredObject {
  key: string
  url: string
}
export interface ObjectStat extends StoredObject {
  size: number
  contentType: string | null
  uploadedAt: Date | null
}

export interface Storage {
  kind: 'local' | 'blob' | 'memory'
  /** key は `projects/<projectId>/<kind>/<name>.<ext>` */
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>
  /** 自ストア内の key のメタデータ（無ければ null）。返る url がサーバ側の正 */
  stat(key: string): Promise<ObjectStat | null>
  /** [start, end]（両端含む）のバイト列を取得 */
  readRange(key: string, start: number, end: number): Promise<Buffer>
  delete(key: string): Promise<void>
  /** プレフィックス配下の一覧（迷子の素材の掃除に使う）。未対応なら undefined */
  list?(prefix: string): Promise<ObjectStat[]>
  /** ローカル配信用: 保存先の絶対パス */
  localPath?(key: string): string
}

/** url が Vercel Blob の公開 URL か（多層防御: SDK が返した URL 以外へは決して fetch しない） */
export const isBlobUrl = (url: string) => /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//i.test(url)

/** key の形式（`projects/<projectId>/<kind>/<name>`。`..` やスラッシュ連続を含まない） */
export const isValidKey = (key: string) => /^projects\/[A-Za-z0-9]{1,32}\/[a-z_]{1,20}\/[A-Za-z0-9_.-]{1,120}$/.test(key) && !key.includes('..')

// ---------------------------------------------------------------- local
export function createLocalStorage(dataDir: string): Storage {
  const root = path.join(dataDir, 'assets')
  const abs = (key: string) => {
    if (!isValidKey(key)) throw new Error('invalid key')
    const p = path.resolve(root, key)
    if (!p.startsWith(root + path.sep)) throw new Error('invalid key')
    return p
  }
  const urlFor = (key: string) => `/a/${path.basename(key)}`
  return {
    kind: 'local',
    async put(key, body) {
      const p = abs(key)
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, body)
      return { key, url: urlFor(key) }
    },
    async stat(key) {
      if (!isValidKey(key)) return null
      try {
        const st = fs.statSync(abs(key))
        return { key, url: urlFor(key), size: st.size, contentType: null, uploadedAt: st.mtime }
      } catch {
        return null
      }
    },
    async readRange(key, start, end) {
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
    async delete(key) {
      try {
        fs.unlinkSync(abs(key))
      } catch {
        /* ignore */
      }
    },
    localPath: abs,
  }
}

// ---------------------------------------------------------------- memory（テスト用。Blob と同じ「key で照会」モデル）
export function createMemoryStorage(baseUrl = 'https://memstore.public.blob.vercel-storage.com'): Storage & { objects: Map<string, { body: Buffer; contentType: string; uploadedAt: Date }> } {
  const objects = new Map<string, { body: Buffer; contentType: string; uploadedAt: Date }>()
  const urlFor = (key: string) => `${baseUrl}/${key}`
  return {
    kind: 'memory',
    objects,
    async put(key, body, contentType) {
      if (!isValidKey(key)) throw new Error('invalid key')
      objects.set(key, { body, contentType, uploadedAt: new Date() })
      return { key, url: urlFor(key) }
    },
    async stat(key) {
      const o = objects.get(key)
      return o ? { key, url: urlFor(key), size: o.body.length, contentType: o.contentType, uploadedAt: o.uploadedAt } : null
    },
    async readRange(key, start, end) {
      const o = objects.get(key)
      if (!o) throw new Error('not found')
      return o.body.subarray(start, end + 1)
    },
    async delete(key) {
      objects.delete(key)
    },
    async list(prefix) {
      return [...objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, o]) => ({ key: k, url: urlFor(k), size: o.body.length, contentType: o.contentType, uploadedAt: o.uploadedAt }))
    },
  }
}

// ---------------------------------------------------------------- Vercel Blob
export function createBlobStorage(token: string, fetchImpl: typeof fetch = fetch): Storage {
  type BlobModule = typeof import('@vercel/blob')
  let mod: Promise<BlobModule> | null = null
  const blob = () => (mod ??= import('@vercel/blob'))
  const stat = async (key: string): Promise<ObjectStat | null> => {
    if (!isValidKey(key)) return null
    const { head, BlobNotFoundError } = await blob()
    try {
      // pathname で照会するため、常に自ストア（token が指すストア）の中だけを見る
      const h = await head(key, { token })
      if (!isBlobUrl(h.url)) return null
      return { key: h.pathname, url: h.url, size: h.size, contentType: h.contentType ?? null, uploadedAt: h.uploadedAt ?? null }
    } catch (e) {
      if (e instanceof BlobNotFoundError) return null
      throw e
    }
  }
  return {
    kind: 'blob',
    async put(key, body, contentType) {
      const { put } = await blob()
      // addRandomSuffix: URL を推測不能にする（公開 API には公開版の素材 URL しか返さないが、二重の防御）
      const r = await put(key, body, { access: 'public', addRandomSuffix: true, contentType, token })
      return { key: r.pathname, url: r.url }
    },
    stat,
    async readRange(key, start, end) {
      const s = await stat(key)
      if (!s) throw new Error('not found')
      if (!isBlobUrl(s.url)) throw new Error('unexpected blob url')
      const res = await fetchImpl(s.url, { headers: { Range: `bytes=${start}-${end}` } })
      if (!res.ok) throw new Error(`range fetch failed: ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      // Range 非対応で全体が返った場合に備える
      return res.status === 206 ? buf : buf.subarray(start, end + 1)
    },
    async delete(key) {
      if (!isValidKey(key)) return
      const { del } = await blob()
      await del(key, { token }) // pathname 指定: 自ストア内の、規約に合う key しか消せない
    },
    async list(prefix) {
      const { list } = await blob()
      const out: ObjectStat[] = []
      let cursor: string | undefined
      do {
        const page = await list({ prefix, cursor, limit: 1000, token })
        for (const b of page.blobs) out.push({ key: b.pathname, url: b.url, size: b.size, contentType: null, uploadedAt: b.uploadedAt })
        cursor = page.hasMore ? page.cursor : undefined
      } while (cursor)
      return out
    },
  }
}
