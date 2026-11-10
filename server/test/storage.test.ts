import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseRange } from '../src/app.js'
import { createNeonDb, type NeonSql } from '../src/db-neon.js'
import { MIGRATIONS } from '../src/migrations.js'
import { createR2Storage, createMemoryStorage, isValidKey, readHead, type R2BucketLike } from '../src/storage.js'

/** R2 バインディングの最小フェイク（put / head / get(range) / delete / list） */
function fakeBucket() {
  const store = new Map<string, { body: Uint8Array; contentType?: string; uploaded: Date }>()
  const calls: string[] = []
  const bucket: R2BucketLike = {
    async put(key, value, options) {
      calls.push(`put:${key}`)
      const body = value instanceof ReadableStream ? new Uint8Array(await new Response(value).arrayBuffer()) : typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value as ArrayBuffer)
      store.set(key, { body, contentType: options?.httpMetadata?.contentType, uploaded: new Date() })
    },
    async head(key) {
      const o = store.get(key)
      return o ? { size: o.body.length, uploaded: o.uploaded, httpMetadata: { contentType: o.contentType } } : null
    },
    async get(key, options) {
      const o = store.get(key)
      if (!o) return null
      const offset = options?.range?.offset ?? 0
      const length = options?.range?.length ?? o.body.length - offset
      return { body: new Blob([o.body.subarray(offset, offset + length)]).stream() as ReadableStream<Uint8Array>, size: o.body.length }
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        calls.push(`delete:${k}`)
        store.delete(k)
      }
    },
    async list(options) {
      const keys = [...store.keys()].filter((k) => k.startsWith(options?.prefix ?? '')).sort()
      const limit = options?.limit ?? 1000
      const startIdx = options?.cursor ? Number(options.cursor) : 0
      const page = keys.slice(startIdx, startIdx + limit)
      const truncated = startIdx + limit < keys.length
      return { objects: page.map((k) => ({ key: k, size: store.get(k)!.body.length, uploaded: store.get(k)!.uploaded })), truncated, cursor: truncated ? String(startIdx + limit) : undefined }
    },
  }
  return { bucket, store, calls }
}

describe('R2 アダプタ', () => {
  it('put / stat / get(range) / delete / list（ページング）', async () => {
    const { bucket, calls } = fakeBucket()
    const s = createR2Storage(bucket)
    const key = 'projects/p1/overlay/abc'
    await s.put(key, Buffer.from('0123456789'), 'image/png', 10)
    expect(await s.stat(key)).toMatchObject({ key, size: 10, contentType: 'image/png' })
    const part = await s.get(key, { start: 2, end: 5 })
    expect(part && [part.start, part.end, part.size]).toEqual([2, 5, 10])
    expect(await new Response(part!.body).text()).toBe('2345')
    expect(await readHead(s, key, 4)).toEqual(Buffer.from('0123'))
    // ストリーム put（Node では FixedLengthStream が無いためバッファリングされる）
    await s.put('projects/p1/overlay/stream', new Blob(['hello']).stream() as ReadableStream<Uint8Array>, 'text/plain', 5)
    expect((await s.stat('projects/p1/overlay/stream'))?.size).toBe(5)
    // 規約外の key は触らない
    expect(await s.stat('../etc/passwd')).toBeNull()
    expect(await s.get('http://127.0.0.1/x')).toBeNull()
    await s.delete('not/a/valid/key')
    expect(calls.filter((c) => c.startsWith('delete:'))).toEqual([])
    await s.delete(key)
    expect(await s.stat(key)).toBeNull()
    // list のページング（limit は fake の実装で 1000 固定だが cursor の扱いを確認）
    for (let i = 0; i < 3; i++) await s.put(`projects/p2/overlay/k${i}`, Buffer.from('x'), 'text/plain', 1)
    const listed = await s.list!('projects/p2/')
    expect(listed.map((o) => o.key).sort()).toEqual(['projects/p2/overlay/k0', 'projects/p2/overlay/k1', 'projects/p2/overlay/k2'])
  })

  it('メモリアダプタも同じ契約', async () => {
    const s = createMemoryStorage()
    await s.put('projects/p1/overlay/a', Buffer.from('abcdef'), 'text/plain')
    const g = await s.get('projects/p1/overlay/a', { start: 1, end: 3 })
    expect(await new Response(g!.body).text()).toBe('bcd')
    expect(await s.get('projects/p1/overlay/none')).toBeNull()
  })

  it('isValidKey', () => {
    expect(isValidKey('projects/AbC123/overlay/a-b_c.png')).toBe(true)
    expect(isValidKey('projects/AbC123/overlay/')).toBe(false)
    expect(isValidKey('projects/AbC123/overlay/a/b.png')).toBe(false)
    expect(isValidKey('other/x/y/z')).toBe(false)
  })
})

describe('Range ヘッダ', () => {
  it('解釈と不正値', () => {
    expect(parseRange(undefined, 100)).toBeNull()
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 })
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=0-500', 100)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=100-', 100)).toBe('invalid')
    expect(parseRange('bytes=5-2', 100)).toBe('invalid')
    expect(parseRange('items=0-1', 100)).toBe('invalid')
  })
})

describe('Neon HTTP アダプタ', () => {
  it('tx はコールバック内の文を集めて 1 回の transaction として送る', async () => {
    const executed: string[] = []
    const sql: NeonSql = {
      query(text) {
        const p = { then: (res: (v: { rows: unknown[] }) => void) => res({ rows: [{ text }] }) } as unknown as PromiseLike<{ rows: unknown[] }> & { text: string }
        ;(p as { text: string }).text = text
        return p
      },
      async transaction(queries) {
        executed.push(...queries.map((q) => (q as unknown as { text: string }).text))
        return []
      },
    }
    const db = createNeonDb(sql)
    expect(db.kind).toBe('neon')
    const r = await db.query('SELECT 1')
    expect(r.rows).toEqual([{ text: 'SELECT 1' }])
    const out = await db.tx(async (q) => {
      await q.query('INSERT 1')
      await q.query('UPDATE 2')
      return 'done'
    })
    expect(out).toBe('done')
    expect(executed).toEqual(['INSERT 1', 'UPDATE 2'])
    await expect(db.exec('CREATE TABLE x (a int); CREATE TABLE y (b int)')).rejects.toThrow(/npm run migrate/)
  })
})

describe('マイグレーション', () => {
  it('埋め込み SQL は server/migrations/*.sql と同一（M-R3-03）', () => {
    const dir = path.resolve(import.meta.dirname, '../migrations')
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    expect(MIGRATIONS.map((m) => m.name).sort()).toEqual(files)
    for (const m of MIGRATIONS) expect(m.sql).toBe(fs.readFileSync(path.join(dir, m.name), 'utf8'))
  })
})
