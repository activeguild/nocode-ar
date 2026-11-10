// 素材ストレージのアダプタ（ランタイム非依存部分）。
// 本番 = Cloudflare R2（Worker 経由で配信）、ローカル = ファイル（storage-local.ts）、テスト = メモリ。
// 鍵（key）は常にサーバが生成し、クライアントから鍵や URL を受け取ることはない（B-R3-01 の構造的再発防止）。
import { Buffer } from 'node:buffer'

export interface ObjectStat {
  key: string
  size: number
  contentType: string | null
  uploadedAt: Date | null
}

export interface ObjectRange {
  start: number
  end: number // 両端含む
}

export interface ObjectBody {
  body: ReadableStream<Uint8Array>
  size: number // オブジェクト全体のサイズ
  start: number
  end: number
}

export interface Storage {
  kind: 'local' | 'r2' | 'memory'
  /** 本体を保存する。ストリームの場合は size（Content-Length）が必須 */
  put(key: string, body: Buffer | ReadableStream<Uint8Array>, contentType: string, size?: number): Promise<void>
  stat(key: string): Promise<ObjectStat | null>
  /** 配信用: 範囲指定つきで本体を取得（無ければ null） */
  get(key: string, range?: ObjectRange): Promise<ObjectBody | null>
  delete(key: string): Promise<void>
  /** プレフィックス配下の一覧（迷子の素材の掃除に使う）。未対応なら undefined */
  list?(prefix: string): Promise<ObjectStat[]>
}

/** key の形式（`projects/<projectId>/<kind>/<id>`。`..` やスラッシュ連続を含まない） */
export const isValidKey = (key: string) => /^projects\/[A-Za-z0-9]{1,32}\/[a-z_]{1,20}\/[A-Za-z0-9_.-]{1,120}$/.test(key) && !key.includes('..')

/** 先頭 [0, length) を Buffer で読む */
export async function readHead(storage: Storage, key: string, length: number): Promise<Buffer> {
  const obj = await storage.get(key, { start: 0, end: Math.max(0, length - 1) })
  if (!obj) throw new Error('not found')
  return Buffer.from(await new Response(obj.body).arrayBuffer())
}

export function bufferToStream(buf: Buffer): ReadableStream<Uint8Array> {
  return new Blob([new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)]).stream() as ReadableStream<Uint8Array>
}

// ---------------------------------------------------------------- memory（テスト用）
export function createMemoryStorage(): Storage & { objects: Map<string, { body: Buffer; contentType: string; uploadedAt: Date }> } {
  const objects = new Map<string, { body: Buffer; contentType: string; uploadedAt: Date }>()
  return {
    kind: 'memory',
    objects,
    async put(key, body, contentType) {
      if (!isValidKey(key)) throw new Error('invalid key')
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(await new Response(body).arrayBuffer())
      objects.set(key, { body: buf, contentType, uploadedAt: new Date() })
    },
    async stat(key) {
      const o = objects.get(key)
      return o ? { key, size: o.body.length, contentType: o.contentType, uploadedAt: o.uploadedAt } : null
    },
    async get(key, range) {
      const o = objects.get(key)
      if (!o) return null
      const start = range?.start ?? 0
      const end = Math.min(range?.end ?? o.body.length - 1, o.body.length - 1)
      return { body: bufferToStream(o.body.subarray(start, end + 1)), size: o.body.length, start, end }
    },
    async delete(key) {
      objects.delete(key)
    },
    async list(prefix) {
      return [...objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, o]) => ({ key: k, size: o.body.length, contentType: o.contentType, uploadedAt: o.uploadedAt }))
    },
  }
}

// ---------------------------------------------------------------- Cloudflare R2
/** R2 バインディングのうち使う部分（@cloudflare/workers-types に依存しないための最小定義） */
export interface R2BucketLike {
  put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>
  head(key: string): Promise<{ size: number; uploaded: Date; httpMetadata?: { contentType?: string } } | null>
  get(key: string, options?: { range?: { offset: number; length?: number } }): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null>
  delete(keys: string | string[]): Promise<void>
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{ objects: { key: string; size: number; uploaded: Date }[]; truncated: boolean; cursor?: string }>
}

declare const FixedLengthStream: (new (size: number) => { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }) | undefined

export function createR2Storage(bucket: R2BucketLike): Storage {
  return {
    kind: 'r2',
    async put(key, body, contentType, size) {
      if (!isValidKey(key)) throw new Error('invalid key')
      if (Buffer.isBuffer(body)) {
        await bucket.put(key, body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer, { httpMetadata: { contentType } })
        return
      }
      // R2 はストリームの長さを知る必要がある。Workers では FixedLengthStream で長さを与える
      if (size !== undefined && typeof FixedLengthStream === 'function') {
        const fl = new FixedLengthStream(size)
        void body.pipeTo(fl.writable)
        await bucket.put(key, fl.readable, { httpMetadata: { contentType } })
      } else {
        await bucket.put(key, await new Response(body).arrayBuffer(), { httpMetadata: { contentType } })
      }
    },
    async stat(key) {
      if (!isValidKey(key)) return null
      const h = await bucket.head(key)
      return h ? { key, size: h.size, contentType: h.httpMetadata?.contentType ?? null, uploadedAt: h.uploaded ?? null } : null
    },
    async get(key, range) {
      if (!isValidKey(key)) return null
      const opts = range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined
      const o = await bucket.get(key, opts)
      if (!o) return null
      const start = range?.start ?? 0
      const end = range ? Math.min(range.end, o.size - 1) : o.size - 1
      return { body: o.body, size: o.size, start, end }
    },
    async delete(key) {
      if (!isValidKey(key)) return
      await bucket.delete(key)
    },
    async list(prefix) {
      const out: ObjectStat[] = []
      let cursor: string | undefined
      do {
        const page = await bucket.list({ prefix, cursor, limit: 1000 })
        for (const o of page.objects) out.push({ key: o.key, size: o.size, contentType: null, uploadedAt: o.uploaded })
        cursor = page.truncated ? page.cursor : undefined
      } while (cursor)
      return out
    },
  }
}
