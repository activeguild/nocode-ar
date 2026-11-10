// ランタイム非依存の設定（Node 常駐サーバと Cloudflare Worker の両方で使う）。
// Node 固有（ファイルパス等）は config-node.ts。

export interface Config {
  /** 公開 URL のオリジン（QR に埋め込む）。未設定ならリクエストから組み立てる */
  publicOrigin: string | null
  supportEmail: string | null
  serviceName: string
  cookieSecure: boolean
  /**
   * X-Forwarded-Host / Proto を信頼する範囲（D-22）。
   * 'loopback' = 同一ホスト（127.0.0.1 / ::1）からのプロキシのみ信頼（Node の既定）、true = 常に、false = 信頼しない（Workers）
   */
  trustProxy: boolean | 'loopback'
  /** 1 アカウントの素材合計上限（D-06 / NFR-4）。既定 2 GB */
  accountQuotaBytes: number
  /** Cron エンドポイント（任意公開）の Bearer 秘密。未設定なら 503 */
  cronSecret: string | null
  /** Node 常駐時のみ true（Hono の compress を使う。Cloudflare ではエッジが圧縮する） */
  compressResponses: boolean
  /** 起動時にマイグレーションを自動適用するか（PGlite は常に true。PostgreSQL は AUTO_MIGRATE=1 のときのみ） */
  autoMigrate: boolean
  /** PostgreSQL 接続文字列（Neon）。未設定なら PGlite（Node のみ） */
  databaseUrl: string | null
}

export type EnvLike = Record<string, string | undefined>

/** 環境変数（process.env または Worker の env）から共通設定を作る */
export function configFromEnv(env: EnvLike, opts: { runtime: 'node' | 'worker' }): Config {
  const isWorker = opts.runtime === 'worker'
  const databaseUrl = env.DATABASE_URL || null
  return {
    publicOrigin: env.PUBLIC_ORIGIN?.replace(/\/$/, '') || null,
    supportEmail: env.SUPPORT_EMAIL || null,
    serviceName: env.SERVICE_NAME || 'ARチラシ（仮）',
    cookieSecure: isWorker || env.COOKIE_SECURE === '1' || env.NODE_ENV === 'production',
    trustProxy: isWorker ? false : env.TRUST_PROXY === undefined || env.TRUST_PROXY === 'loopback' ? 'loopback' : env.TRUST_PROXY === 'true' || env.TRUST_PROXY === '1',
    accountQuotaBytes: Number(env.ACCOUNT_QUOTA_BYTES ?? 2 * 1024 * 1024 * 1024),
    cronSecret: env.CRON_SECRET || null,
    compressResponses: !isWorker,
    autoMigrate: databaseUrl ? env.AUTO_MIGRATE === '1' : true,
    databaseUrl,
  }
}
