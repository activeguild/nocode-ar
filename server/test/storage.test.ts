import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MIGRATIONS } from '../src/migrations.js'
import { createBlobStorage, isBlobUrl, isValidKey } from '../src/storage.js'

const STORE = 'https://abc123.public.blob.vercel-storage.com'
const headMock = vi.fn()
const delMock = vi.fn()
class BlobNotFoundError extends Error {}
vi.mock('@vercel/blob', () => ({
  head: (...a: unknown[]) => headMock(...a),
  del: (...a: unknown[]) => delMock(...a),
  put: vi.fn(),
  list: vi.fn(),
  BlobNotFoundError,
}))

describe('Vercel Blob アダプタ（B-R3-01）', () => {
  afterEach(() => vi.restoreAllMocks())

  it('stat は pathname で自ストアを照会し、URL は SDK の結果を正とする', async () => {
    headMock.mockImplementation(async (key: string) => {
      if (key !== 'projects/p1/overlay/a-xyz.png') throw new BlobNotFoundError('not found')
      return { url: `${STORE}/projects/p1/overlay/a-xyz.png`, pathname: key, size: 123, contentType: 'image/png', uploadedAt: new Date(0) }
    })
    const s = createBlobStorage('vercel_blob_rw_dummy')
    const st = await s.stat('projects/p1/overlay/a-xyz.png')
    expect(st).toMatchObject({ key: 'projects/p1/overlay/a-xyz.png', url: `${STORE}/projects/p1/overlay/a-xyz.png`, size: 123 })
    expect(headMock).toHaveBeenCalledWith('projects/p1/overlay/a-xyz.png', { token: 'vercel_blob_rw_dummy' })
    expect(await s.stat('projects/p1/overlay/missing.png')).toBeNull()
    // 規約外の key は SDK を呼ばずに null
    headMock.mockClear()
    expect(await s.stat('http://127.0.0.1/evil.png')).toBeNull()
    expect(await s.stat('projects/p1/overlay/../../etc/passwd')).toBeNull()
    expect(headMock).not.toHaveBeenCalled()
  })

  it('readRange は SDK が返した Blob URL だけを fetch し、delete は pathname 指定で行う', async () => {
    headMock.mockImplementation(async (key: string) => ({ url: `${STORE}/${key}`, pathname: key, size: 10, contentType: 'image/png', uploadedAt: new Date(0) }))
    const fetched: string[] = []
    const fakeFetch = (async (url: string | URL | Request) => {
      fetched.push(String(url))
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 206 })
    }) as typeof fetch
    const s = createBlobStorage('tkn', fakeFetch)
    const buf = await s.readRange('projects/p1/overlay/a.png', 0, 3)
    expect([...buf]).toEqual([1, 2, 3, 4])
    expect(fetched).toEqual([`${STORE}/projects/p1/overlay/a.png`])
    // SDK が Blob 以外の URL を返した場合は fetch しない
    headMock.mockImplementationOnce(async (key: string) => ({ url: 'http://127.0.0.1/x', pathname: key, size: 1, contentType: null, uploadedAt: null }))
    await expect(s.readRange('projects/p1/overlay/b.png', 0, 0)).rejects.toThrow()
    expect(fetched).toHaveLength(1)
    await s.delete('projects/p1/overlay/a.png')
    expect(delMock).toHaveBeenCalledWith('projects/p1/overlay/a.png', { token: 'tkn' })
    delMock.mockClear()
    await s.delete(`${STORE}/projects/p1/overlay/a.png`) // URL は key として無効 → 何もしない
    expect(delMock).not.toHaveBeenCalled()
  })

  it('isBlobUrl / isValidKey', () => {
    expect(isBlobUrl(`${STORE}/x.png`)).toBe(true)
    expect(isBlobUrl('https://evil.example.com/x.png')).toBe(false)
    expect(isBlobUrl('http://abc.public.blob.vercel-storage.com/x')).toBe(false)
    expect(isValidKey('projects/AbC123/overlay/a-b_c.png')).toBe(true)
    expect(isValidKey('projects/AbC123/overlay/')).toBe(false)
    expect(isValidKey('projects/AbC123/overlay/a/b.png')).toBe(false)
    expect(isValidKey('other/x/y/z')).toBe(false)
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
