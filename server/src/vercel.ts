// Vercel Function 用エントリ。コールドスタート時に 1 回だけ DB 接続とアプリを組み立て、以後は再利用する。
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRuntime, type Runtime } from './runtime.js'

let runtimePromise: Promise<Runtime> | null = null

export function getRuntime(): Promise<Runtime> {
  runtimePromise ??= createRuntime().catch((e) => {
    runtimePromise = null // 次のリクエストで再試行できるようにする
    throw e
  })
  return runtimePromise
}

export async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { app } = await getRuntime()
  app(req, res)
}
