import { randomBytes, randomInt } from 'node:crypto'

const LOWER_NUM = 'abcdefghijklmnopqrstuvwxyz0123456789'
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function pick(alphabet: string, len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) s += alphabet[randomInt(alphabet.length)]
  return s
}

/** 公開 URL 用 slug（英小文字・数字 8 文字、FR-2-2） */
export const newSlug = () => pick(LOWER_NUM, 8)
/** 汎用 ID（22 文字） */
export const newId = () => pick(BASE62, 22)
/** プレビュー token（32 文字、FR-6-5） */
export const newToken = () => pick(BASE62, 32)
/** セッション ID */
export const newSessionId = () => randomBytes(32).toString('base64url')
