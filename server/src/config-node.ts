// Node 常駐サーバ / CLI 用の設定（ファイルパスを含む）
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { configFromEnv, type Config } from './config.js'

const here = path.dirname(fileURLToPath(import.meta.url))
// src/ (tsx) と dist/server/src/ (tsc) の両方からリポジトリルートを求める
export const repoRoot = here.includes(`${path.sep}dist${path.sep}`) ? path.resolve(here, '../../../..') : path.resolve(here, '../..')

export interface NodeConfig extends Config {
  port: number
  /** ローカル実行時のデータ置き場（PGlite のデータと素材ファイル） */
  dataDir: string
  webDist: string
  /** PGlite のデータディレクトリ。':memory:' でインメモリ */
  pgliteDir: string
}

export function loadNodeConfig(env: NodeJS.ProcessEnv = process.env): NodeConfig {
  const dataDir = path.resolve(env.DATA_DIR ?? path.join(repoRoot, 'data'))
  return {
    ...configFromEnv(env, { runtime: 'node' }),
    port: Number(env.PORT ?? 3000),
    dataDir,
    webDist: path.resolve(env.WEB_DIST ?? path.join(repoRoot, 'web', 'dist')),
    pgliteDir: env.PGLITE_DIR ?? path.join(dataDir, 'pglite'),
  }
}
