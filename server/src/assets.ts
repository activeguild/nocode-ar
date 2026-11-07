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
    return { mime: 'video/mp4', ext: 'mp4', category: 'video' }
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
    width: input.width ?? null,
    height: input.height ?? null,
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
