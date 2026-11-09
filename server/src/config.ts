import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
// src/ (tsx) と dist/server/src/ (tsc) の両方からリポジトリルートを求める
export const repoRoot = here.includes(`${path.sep}dist${path.sep}`) ? path.resolve(here, '../../../..') : path.resolve(here, '../..')

export interface Config {
  port: number
  /** ローカル実行時のデータ置き場（PGlite のデータと素材ファイル） */
  dataDir: string
  webDist: string
  /** 公開 URL のオリジン（QR に埋め込む）。未設定ならリクエストの Host から組み立てる */
  publicOrigin: string | null
  supportEmail: string | null
  serviceName: string
  cookieSecure: boolean
  /** Express の trust proxy 設定（D-22）。既定は 'loopback'。Vercel 上では true（Vercel のプロキシが X-Forwarded-* を付ける） */
  trustProxy: string | boolean
  /** 1 アカウントの素材合計上限（D-06 / NFR-4）。既定 2 GB */
  accountQuotaBytes: number
  /** PostgreSQL 接続文字列（Neon など）。未設定なら PGlite（ローカル） */
  databaseUrl: string | null
  /** PGlite のデータディレクトリ。':memory:' でインメモリ */
  pgliteDir: string
  /** 起動時にマイグレーションを自動適用するか（PGlite は常に true。PostgreSQL は AUTO_MIGRATE=1 のときのみ） */
  autoMigrate: boolean
  /** Vercel Blob の読み書きトークン。設定されていれば素材は Blob に保存する */
  blobToken: string | null
  /** Vercel Cron からの呼び出しを保護する秘密（Authorization: Bearer <CRON_SECRET>） */
  cronSecret: string | null
  /** Vercel 上で動いているか（圧縮・静的配信の有無に影響） */
  isVercel: boolean
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const isVercel = env.VERCEL === '1' || env.VERCEL === 'true'
  const dataDir = path.resolve(env.DATA_DIR ?? (isVercel ? '/tmp/nocode-ar' : path.join(repoRoot, 'data')))
  const databaseUrl = env.DATABASE_URL || null
  return {
    port: Number(env.PORT ?? 3000),
    dataDir,
    webDist: path.resolve(env.WEB_DIST ?? path.join(repoRoot, 'web', 'dist')),
    publicOrigin: env.PUBLIC_ORIGIN?.replace(/\/$/, '') || null,
    supportEmail: env.SUPPORT_EMAIL || null,
    serviceName: env.SERVICE_NAME || 'ARチラシ（仮）',
    cookieSecure: env.COOKIE_SECURE === '1' || env.NODE_ENV === 'production' || isVercel,
    trustProxy: env.TRUST_PROXY === undefined ? (isVercel ? true : 'loopback') : env.TRUST_PROXY === 'true' ? true : env.TRUST_PROXY === 'false' ? false : env.TRUST_PROXY,
    accountQuotaBytes: Number(env.ACCOUNT_QUOTA_BYTES ?? 2 * 1024 * 1024 * 1024),
    databaseUrl,
    pgliteDir: env.PGLITE_DIR ?? path.join(dataDir, 'pglite'),
    autoMigrate: databaseUrl ? env.AUTO_MIGRATE === '1' : true,
    blobToken: env.BLOB_READ_WRITE_TOKEN || null,
    cronSecret: env.CRON_SECRET || null,
    isVercel,
  }
}
