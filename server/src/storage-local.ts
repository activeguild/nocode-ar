// ローカル（Node）用の素材ストレージ: ファイル保存。Worker バンドルには含めない
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { bufferToStream, isValidKey, type Storage } from './storage.js'

export function createLocalStorage(dataDir: string): Storage {
  const root = path.join(dataDir, 'assets')
  const abs = (key: string) => {
    if (!isValidKey(key)) throw new Error('invalid key')
    const p = path.resolve(root, key)
    if (!p.startsWith(root + path.sep)) throw new Error('invalid key')
    return p
  }
  return {
    kind: 'local',
    async put(key, body) {
      const p = abs(key)
      fs.mkdirSync(path.dirname(p), { recursive: true })
      if (Buffer.isBuffer(body)) fs.writeFileSync(p, body)
      else await pipeline(Readable.fromWeb(body as never), fs.createWriteStream(p))
    },
    async stat(key) {
      if (!isValidKey(key)) return null
      try {
        const st = fs.statSync(abs(key))
        return { key, size: st.size, contentType: null, uploadedAt: st.mtime }
      } catch {
        return null
      }
    },
    async get(key, range) {
      if (!isValidKey(key)) return null
      let st: fs.Stats
      try {
        st = fs.statSync(abs(key))
      } catch {
        return null
      }
      const start = range?.start ?? 0
      const end = Math.min(range?.end ?? st.size - 1, st.size - 1)
      if (st.size === 0) return { body: bufferToStream(Buffer.alloc(0)), size: 0, start: 0, end: -1 }
      const stream = Readable.toWeb(fs.createReadStream(abs(key), { start, end })) as ReadableStream<Uint8Array>
      return { body: stream, size: st.size, start, end }
    },
    async delete(key) {
      try {
        fs.unlinkSync(abs(key))
      } catch {
        /* ignore */
      }
    },
  }
}
