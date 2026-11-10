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
    /** assets/projects/<pid>/<kind>/<id> を走査（迷子ファイルの掃除用。R5-M-01） */
    async list(prefix) {
      const base = path.join(root, 'projects')
      if (!fs.existsSync(base)) return []
      const out: { key: string; size: number; contentType: null; uploadedAt: Date }[] = []
      for (const pid of fs.readdirSync(base)) {
        const pdir = path.join(base, pid)
        if (!fs.statSync(pdir).isDirectory()) continue
        for (const kind of fs.readdirSync(pdir)) {
          const kdir = path.join(pdir, kind)
          if (!fs.statSync(kdir).isDirectory()) continue
          for (const id of fs.readdirSync(kdir)) {
            const key = `projects/${pid}/${kind}/${id}`
            if (!key.startsWith(prefix) || !isValidKey(key)) continue
            const st = fs.statSync(path.join(kdir, id))
            if (st.isFile()) out.push({ key, size: st.size, contentType: null, uploadedAt: st.mtime })
          }
        }
      }
      return out
    },
  }
}
