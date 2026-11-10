// Q19 / D1: オーナーがパスワードを再設定する管理コマンド。
//   npm run reset-password -- <email>
// 新しいパスワードは対話入力（または環境変数 NEW_PASSWORD）で受け取り、引数には書かない（シェル履歴に残さないため）。
import readline from 'node:readline/promises'
import { hashPassword } from '../auth.js'
import { loadNodeConfig } from '../config-node.js'
import { nowIso, one } from '../db.js'
import { openNodeDb } from '../runtime-node.js'

async function main() {
  const email = (process.argv[2] ?? '').trim().toLowerCase()
  if (!email) {
    console.error('使い方: npm run reset-password -- <email>')
    process.exit(2)
  }
  let password = process.env.NEW_PASSWORD ?? ''
  if (!password) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    password = await rl.question(`${email} の新しいパスワード（8 文字以上）: `)
    rl.close()
  }
  if (password.length < 8) {
    console.error('パスワードは 8 文字以上にしてください')
    process.exit(2)
  }
  const db = await openNodeDb(loadNodeConfig())
  try {
    const user = await one<{ id: string }>(db, 'SELECT id FROM users WHERE email = $1', [email])
    if (!user) {
      console.error(`ユーザーが見つかりません: ${email}`)
      process.exit(1)
    }
    await db.tx(async (q) => {
      await q.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, hashPassword(password)])
      await q.query('DELETE FROM sessions WHERE user_id = $1', [user.id]) // 既存セッションも無効化
      await q.query('DELETE FROM login_locks WHERE email = $1', [email])
    })
    console.log(JSON.stringify({ level: 'info', time: nowIso(), message: `password reset: ${email}（既存セッションは無効化）` }))
  } finally {
    await db.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
