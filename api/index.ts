// Vercel Function: すべての /api/* と /a/*（ローカル配信用。Vercel では未使用）をこの 1 関数で受ける（vercel.json の rewrites）。
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handler } from '../server/src/vercel.js'

export default function (req: IncomingMessage, res: ServerResponse) {
  return handler(req, res)
}
