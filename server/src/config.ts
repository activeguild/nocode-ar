import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
// src/ (tsx) と dist/server/src/ (tsc) の両方からリポジトリルートを求める
const repoRoot = here.includes(`${path.sep}dist${path.sep}`) ? path.resolve(here, '../../../..') : path.resolve(here, '../..')

export interface Config {
  port: number
  dataDir: string
  webDist: string
  /** 公開 URL のオリジン（QR に埋め込む）。未設定ならリクエストの Host から組み立てる */
  publicOrigin: string | null
  supportEmail: string | null
  serviceName: string
  cookieSecure: boolean
  /** Express の trust proxy 設定（D-22）。既定は 'loopback'（同一ホストのリバースプロキシ / Vite 開発サーバのみ信頼） */
  trustProxy: string | boolean
  /** 1 アカウントの素材合計上限（D-06 / NFR-4）。既定 2 GB */
  accountQuotaBytes: number
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    dataDir: path.resolve(env.DATA_DIR ?? path.join(repoRoot, 'data')),
    webDist: path.resolve(env.WEB_DIST ?? path.join(repoRoot, 'web', 'dist')),
    publicOrigin: env.PUBLIC_ORIGIN?.replace(/\/$/, '') || null,
    supportEmail: env.SUPPORT_EMAIL || null,
    serviceName: env.SERVICE_NAME || 'ARチラシ（仮）',
    cookieSecure: env.COOKIE_SECURE === '1' || env.NODE_ENV === 'production',
    trustProxy: env.TRUST_PROXY === undefined ? 'loopback' : env.TRUST_PROXY === 'true' ? true : env.TRUST_PROXY === 'false' ? false : env.TRUST_PROXY,
    accountQuotaBytes: Number(env.ACCOUNT_QUOTA_BYTES ?? 2 * 1024 * 1024 * 1024),
  }
}
