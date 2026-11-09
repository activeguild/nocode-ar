import { createHash } from 'node:crypto'
import { LIMITS, type AssetInfo, type AssetKind } from '../../shared/src/index.js'
import type { Db, Queryable } from './db.js'
import { all, nowIso, num, one } from './db.js'
import { newId } from './ids.js'
import { isValidKey, type Storage } from './storage.js'

export interface Detected {
  mime: string
  ext: string
  category: 'image' | 'video' | 'model' | 'mind'
}

const MP4_BRANDS = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash', 'MSNV', 'NDSC', 'NDSH', 'NDSM', 'NDSP', 'NDSS', 'NDXC', 'NDXH', 'NDXM', 'NDXP', 'NDXS'])

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
  return buf.length > 16 && (buf[0] & 0xf0) === 0x80 && buf.subarray(0, 4096).includes('dataList')
}

export interface AssetRow {
  id: string
  project_id: string
  kind: AssetKind
  mime: string
  ext: string
  size_bytes: number | string
  storage: string
  storage_key: string
  url: string
  width: number | null
  height: number | null
  duration_sec: number | null
  sha256: string | null
  created_at: string
}

export function toAssetInfo(a: AssetRow): AssetInfo {
  return { id: a.id, kind: a.kind, mime: a.mime, sizeBytes: num(a.size_bytes), width: a.width, height: a.height, url: a.url }
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

/** 種類ごとの上限と許可 MIME（Blob クライアントアップロードのトークン発行にも使う） */
export const KIND_LIMITS: Record<AssetKind, { maxBytes: number; contentTypes: string[] }> = {
  target_image: { maxBytes: LIMITS.targetImageBytes, contentTypes: ['image/png', 'image/jpeg'] },
  thumbnail: { maxBytes: LIMITS.imageBytes, contentTypes: ['image/png', 'image/jpeg', 'image/webp'] },
  overlay: { maxBytes: LIMITS.videoBytes, contentTypes: ['video/mp4', 'image/png', 'image/jpeg', 'image/webp', 'model/gltf-binary', 'application/octet-stream'] },
  target_mind: { maxBytes: LIMITS.mindBytes, contentTypes: ['application/octet-stream'] },
}

export interface Validated {
  mime: string
  ext: string
  width: number | null
  height: number | null
}

/**
 * 先頭バイト列（head）と全体サイズから、種類・上限・寸法を検証する。
 * 直接アップロード（本体全体）と Blob 登録（先頭 64 KB のレンジ取得）の両方で使う。
 */
export function validateAsset(kind: AssetKind, head: Buffer, size: number, hint: { width?: number | null; height?: number | null } = {}): Validated {
  let width = hint.width ?? null
  let height = hint.height ?? null
  if (kind === 'target_mind') {
    if (!looksLikeMind(head)) throw new AssetError(400, 'ターゲットデータの形式が不正です')
    if (size > LIMITS.mindBytes) throw new AssetError(413, 'ターゲットデータが大きすぎます', 'too_large')
    return { mime: 'application/octet-stream', ext: 'mind', width: null, height: null }
  }
  const d = detectFileType(head)
  if (!d) throw new AssetError(400, '対応していないファイル形式です（MP4 / PNG / JPG / WebP / GLB）', 'unsupported')
  if (kind === 'target_image' || kind === 'thumbnail') {
    if (d.category !== 'image' || (d.mime === 'image/webp' && kind === 'target_image')) throw new AssetError(400, 'PNG または JPG を選択してください', 'unsupported')
    if (size > LIMITS.targetImageBytes) throw new AssetError(413, '10 MB 以下の画像にしてください', 'too_large')
    const dim = imageDimensions(head)
    if (!dim || !dim.width || !dim.height) throw new AssetError(400, '画像のサイズを読み取れません。別の画像をお試しください', 'unsupported')
    width = dim.width
    height = dim.height
    if (kind === 'target_image' && Math.max(width, height) > LIMITS.targetImageMaxEdgePx) throw new AssetError(400, '長辺 8,000 px 以下の画像にしてください', 'too_large')
  } else {
    if (d.category === 'video') {
      if (d.mime === 'video/quicktime') {
        throw new AssetError(
          400,
          'MOV 形式には対応していません。iPhone で撮影した動画は「設定 > カメラ > フォーマット > 互換性優先」で撮影するか、MP4（H.264）で書き出してください',
          'mov',
        )
      }
      if (size > LIMITS.videoBytes) throw new AssetError(413, '動画は 50 MB 以下にしてください', 'too_large')
    } else if (d.category === 'image') {
      if (size > LIMITS.imageBytes) throw new AssetError(413, '画像は 10 MB 以下にしてください', 'too_large')
      const dim = imageDimensions(head)
      if (dim) {
        width = dim.width
        height = dim.height
      }
    } else if (d.category === 'model') {
      if (size > LIMITS.modelBytes) throw new AssetError(413, '3D モデルは 20 MB 以下にしてください', 'too_large')
    } else {
      throw new AssetError(400, '対応していないファイル形式です', 'unsupported')
    }
  }
  return { mime: d.mime, ext: d.ext, width, height }
}

async function checkQuotas(db: Queryable, projectId: string, userId: string, accountQuotaBytes: number, incoming: number) {
  const total = num((await one<{ t: unknown }>(db, 'SELECT COALESCE(SUM(size_bytes), 0) AS t FROM assets WHERE project_id = $1', [projectId]))?.t)
  if (total + incoming > LIMITS.projectTotalBytes) {
    throw new AssetError(413, 'このプロジェクトの素材の合計が 100 MB を超えます。不要な素材を削除してください', 'quota')
  }
  const accountTotal = num(
    (await one<{ t: unknown }>(db, 'SELECT COALESCE(SUM(a.size_bytes), 0) AS t FROM assets a JOIN projects p ON p.id = a.project_id WHERE p.user_id = $1', [userId]))?.t,
  )
  if (accountTotal + incoming > accountQuotaBytes) {
    throw new AssetError(413, `アカウント全体の素材の合計が上限（${Math.round(accountQuotaBytes / 1024 / 1024)} MB）を超えます。不要なプロジェクトや素材を削除してください`, 'quota')
  }
}

async function insertAsset(db: Queryable, row: AssetRow) {
  await db.query(
    `INSERT INTO assets (id, project_id, kind, mime, ext, size_bytes, storage, storage_key, url, width, height, duration_sec, sha256, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [row.id, row.project_id, row.kind, row.mime, row.ext, row.size_bytes, row.storage, row.storage_key, row.url, row.width, row.height, row.duration_sec, row.sha256, row.created_at],
  )
}

export interface SaveAssetInput {
  projectId: string
  userId: string
  accountQuotaBytes: number
  kind: AssetKind
  buffer: Buffer
  width?: number | null
  height?: number | null
  durationSec?: number | null
}

/** 直接アップロード（multipart）: 本体全体を検証してストレージに保存する */
export async function saveAsset(db: Db, storage: Storage, input: SaveAssetInput): Promise<AssetRow> {
  const { projectId, kind, buffer } = input
  const v = validateAsset(kind, buffer, buffer.length, input)
  await checkQuotas(db, projectId, input.userId, input.accountQuotaBytes, buffer.length)
  const id = newId()
  const stored = await storage.put(`projects/${projectId}/${kind}/${id}.${v.ext}`, buffer, v.mime)
  const row: AssetRow = {
    id,
    project_id: projectId,
    kind,
    mime: v.mime,
    ext: v.ext,
    size_bytes: buffer.length,
    storage: storage.kind,
    storage_key: stored.key,
    url: stored.url,
    width: v.width,
    height: v.height,
    duration_sec: input.durationSec ?? null,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    created_at: nowIso(),
  }
  try {
    await insertAsset(db, row)
  } catch (e) {
    await storage.delete(stored.key).catch(() => {})
    throw e
  }
  return row
}

export interface RegisterAssetInput {
  projectId: string
  userId: string
  accountQuotaBytes: number
  kind: AssetKind
  /** クライアントが申告した pathname（自プロジェクト配下の規約に一致することを必須とする） */
  key: string
  /** クライアントが申告した URL（任意）。ストアが返す URL と一致しなければ拒否。取得・削除には一切使わない */
  url?: string | null
  width?: number | null
  height?: number | null
  durationSec?: number | null
}

const HEAD_BYTES = 64 * 1024

/**
 * クライアントが Blob に直接アップロードした素材を登録する（B-R3-01 対応）。
 * - pathname は `projects/<projectId>/<kind>/<name>` に一致する自プロジェクトのものだけ受け付ける
 * - メタデータと URL は自ストアを pathname で照会した結果（storage.stat）をサーバ側の正とし、クライアントの url は照合にしか使わない
 * - 先頭 64 KB をレンジ取得して形式・寸法・上限を検証する。失敗した場合に削除するのは、この自プロジェクト配下の pathname のみ
 */
export async function registerUploadedAsset(db: Db, storage: Storage, input: RegisterAssetInput): Promise<AssetRow> {
  const { projectId, kind, key } = input
  const prefix = `projects/${projectId}/${kind}/`
  if (!isValidKey(key) || !key.startsWith(prefix)) throw new AssetError(400, '素材のパスが不正です')
  const stat = await storage.stat(key)
  if (!stat) throw new AssetError(400, 'アップロードされた素材が見つかりません')
  if (stat.key !== key) throw new AssetError(400, '素材のパスが一致しません')
  if (input.url && input.url !== stat.url) throw new AssetError(400, '素材の URL が一致しません')
  const fail = async (e: unknown) => {
    await storage.delete(key).catch(() => {})
    throw e
  }
  let v: Validated
  try {
    const bytes = await storage.readRange(key, 0, Math.min(HEAD_BYTES, Math.max(stat.size, 1)) - 1)
    v = validateAsset(kind, bytes, stat.size, input)
    await checkQuotas(db, projectId, input.userId, input.accountQuotaBytes, stat.size)
  } catch (e) {
    return fail(e)
  }
  const id = newId()
  const row: AssetRow = {
    id,
    project_id: projectId,
    kind,
    mime: v.mime,
    ext: v.ext,
    size_bytes: stat.size,
    storage: storage.kind,
    storage_key: key,
    url: stat.url,
    width: v.width,
    height: v.height,
    duration_sec: input.durationSec ?? null,
    sha256: null, // 先頭のみ取得するため全体のハッシュは持たない
    created_at: nowIso(),
  }
  try {
    await insertAsset(db, row)
  } catch (e) {
    return fail(e)
  }
  return row
}

export async function getAsset(db: Queryable, id: string): Promise<AssetRow | null> {
  return one<AssetRow>(db, 'SELECT * FROM assets WHERE id = $1', [id])
}

export async function listAssets(db: Queryable, projectId: string): Promise<AssetRow[]> {
  return all<AssetRow>(db, 'SELECT * FROM assets WHERE project_id = $1 ORDER BY created_at', [projectId])
}

/** DB に登録済みの素材だけを、その storage_key で削除する（URL では削除しない） */
export async function deleteAsset(db: Queryable, storage: Storage, a: AssetRow) {
  await db.query('DELETE FROM assets WHERE id = $1', [a.id])
  await storage.delete(a.storage_key).catch(() => {})
}
