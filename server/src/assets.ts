import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { LIMITS, type AssetInfo, type AssetKind } from '../../shared/src/index.ts'
import type { Db } from './db.ts'
import { nowIso } from './db.ts'
import { newId } from './ids.ts'

export interface Detected {
  mime: string
  ext: string
  category: 'image' | 'video' | 'model' | 'mind'
}

/** マジックバイトで種類を判定する（NFR-9。拡張子や申告 MIME は信用しない） */
export function detectFileType(buf: Buffer): Detected | null {
  if (buf.length < 12) return null
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { mime: 'image/png', ext: 'png', category: 'image' }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg', category: 'image' }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp', category: 'image' }
  if (buf.toString('ascii', 0, 4) === 'glTF') return { mime: 'model/gltf-binary', ext: 'glb', category: 'model' }
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12)
    // QuickTime (.mov) は MP4 ではない → R5 の案内に使う
    if (brand === 'qt  ') return { mime: 'video/quicktime', ext: 'mov', category: 'video' }
    // D-17: ISO-BMFF のうち MP4 の動画ブランドのみ受理（HEIC / 3GP / M4A 等は拒否）
    if (MP4_BRANDS.has(brand)) return { mime: 'video/mp4', ext: 'mp4', category: 'video' }
    return null
  }
  return null
}

const MP4_BRANDS = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash', 'MSNV', 'NDSC', 'NDSH', 'NDSM', 'NDSP', 'NDSS', 'NDXC', 'NDXH', 'NDXM', 'NDXP', 'NDXS'])

/** D-18: PNG / JPEG の実寸をヘッダから読む（クライアント申告値に依存しない） */
export function imageDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length >= 24 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG' && buf.toString('ascii', 12, 16) === 'IHDR') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++
        continue
      }
      const marker = buf[i + 1]
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) {
        i += marker === 0xff ? 1 : 2
        continue
      }
      const len = buf.readUInt16BE(i + 2)
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      if (marker === 0xda) break // SOS 以降に SOF は無い
      i += 2 + len
    }
  }
  return null
}

/** msgpack でエンコードされた MindAR の .mind（先頭は map: 0x8x, {v, dataList}） */
export function looksLikeMind(buf: Buffer): boolean {
  return buf.length > 16 && (buf[0] & 0xf0) === 0x80 && buf.includes('dataList')
}

export interface StoredAssetRow {
  id: string
  project_id: string
  kind: AssetKind
  mime: string
  ext: string
  size_bytes: number
  storage_path: string
  width: number | null
  height: number | null
  duration_sec: number | null
  sha256: string
}

export function assetUrl(a: { id: string; ext: string }): string {
  return `/a/${a.id}.${a.ext}`
}

export function toAssetInfo(a: StoredAssetRow): AssetInfo {
  return { id: a.id, kind: a.kind, mime: a.mime, sizeBytes: a.size_bytes, width: a.width, height: a.height, url: assetUrl(a) }
}

export class AssetError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message)
  }
}

export interface SaveAssetInput {
  projectId: string
  /** アカウント合計上限（D-06）の判定に使う */
  userId: string
  accountQuotaBytes: number
  kind: AssetKind
  buffer: Buffer
  width?: number | null
  height?: number | null
  durationSec?: number | null
}

/** 上限（NFR-4）と形式を検証して保存する。失敗時は AssetError */
export function saveAsset(db: Db, dataDir: string, input: SaveAssetInput): StoredAssetRow {
  const { projectId, kind, buffer } = input
  let mime: string
  let ext: string
  let width = input.width ?? null
  let height = input.height ?? null
  if (kind === 'target_mind') {
    if (!looksLikeMind(buffer)) throw new AssetError(400, 'ターゲットデータの形式が不正です')
    if (buffer.length > LIMITS.mindBytes) throw new AssetError(413, 'ターゲットデータが大きすぎます')
    mime = 'application/octet-stream'
    ext = 'mind'
  } else {
    const d = detectFileType(buffer)
    if (!d) throw new AssetError(400, '対応していないファイル形式です（MP4 / PNG / JPG / WebP / GLB）', 'unsupported')
    if (kind === 'target_image' || kind === 'thumbnail') {
      if (d.category !== 'image' || d.mime === 'image/webp' && kind === 'target_image') {
        throw new AssetError(400, 'PNG または JPG を選択してください', 'unsupported')
      }
      if (buffer.length > LIMITS.targetImageBytes) throw new AssetError(413, '10 MB 以下の画像にしてください', 'too_large')
      const dim = imageDimensions(buffer)
      if (!dim || !dim.width || !dim.height) throw new AssetError(400, '画像のサイズを読み取れません。別の画像をお試しください', 'unsupported')
      width = dim.width
      height = dim.height
      if (kind === 'target_image' && Math.max(width, height) > LIMITS.targetImageMaxEdgePx) throw new AssetError(400, '長辺 8,000 px 以下の画像にしてください', 'too_large')
    } else if (kind === 'overlay') {
      if (d.category === 'video') {
        if (d.mime === 'video/quicktime') {
          throw new AssetError(
            400,
            'MOV 形式には対応していません。iPhone で撮影した動画は「設定 > カメラ > フォーマット > 互換性優先」で撮影するか、MP4（H.264）で書き出してください',
            'mov',
          )
        }
        if (buffer.length > LIMITS.videoBytes) throw new AssetError(413, '動画は 50 MB 以下にしてください', 'too_large')
      } else if (d.category === 'image') {
        if (buffer.length > LIMITS.imageBytes) throw new AssetError(413, '画像は 10 MB 以下にしてください', 'too_large')
        const dim = imageDimensions(buffer)
        if (dim) {
          width = dim.width
          height = dim.height
        }
      } else if (d.category === 'model') {
        if (buffer.length > LIMITS.modelBytes) throw new AssetError(413, '3D モデルは 20 MB 以下にしてください', 'too_large')
      } else {
        throw new AssetError(400, '対応していないファイル形式です', 'unsupported')
      }
    }
    mime = d.mime
    ext = d.ext
  }

  const total = (db.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS t FROM assets WHERE project_id = ?').get(projectId) as { t: number }).t
  if (total + buffer.length > LIMITS.projectTotalBytes) {
    throw new AssetError(413, 'このプロジェクトの素材の合計が 100 MB を超えます。不要な素材を削除してください', 'quota')
  }
  const accountTotal = (
    db.prepare('SELECT COALESCE(SUM(a.size_bytes), 0) AS t FROM assets a JOIN projects p ON p.id = a.project_id WHERE p.user_id = ?').get(input.userId) as { t: number }
  ).t
  if (accountTotal + buffer.length > input.accountQuotaBytes) {
    throw new AssetError(413, `アカウント全体の素材の合計が上限（${Math.round(input.accountQuotaBytes / 1024 / 1024)} MB）を超えます。不要なプロジェクトや素材を削除してください`, 'quota')
  }

  const id = newId()
  const rel = path.join('assets', projectId, `${id}.${ext}`)
  const abs = path.join(dataDir, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, buffer)
  const row: StoredAssetRow = {
    id,
    project_id: projectId,
    kind,
    mime,
    ext,
    size_bytes: buffer.length,
    storage_path: rel,
    width,
    height,
    duration_sec: input.durationSec ?? null,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  }
  db.prepare(
    `INSERT INTO assets (id, project_id, kind, mime, ext, size_bytes, storage_path, width, height, duration_sec, sha256, created_at)
     VALUES (@id, @project_id, @kind, @mime, @ext, @size_bytes, @storage_path, @width, @height, @duration_sec, @sha256, @created_at)`,
  ).run({ ...row, created_at: nowIso() })
  return row
}

export function getAsset(db: Db, id: string): StoredAssetRow | null {
  return (db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as StoredAssetRow | undefined) ?? null
}

export function listAssets(db: Db, projectId: string): StoredAssetRow[] {
  return db.prepare('SELECT * FROM assets WHERE project_id = ? ORDER BY created_at').all(projectId) as StoredAssetRow[]
}

export function deleteAssetFile(dataDir: string, a: StoredAssetRow) {
  try {
    fs.unlinkSync(path.join(dataDir, a.storage_path))
  } catch {
    /* ignore */
  }
}
