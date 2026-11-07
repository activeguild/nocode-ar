// Q19 / D1: オーナーがパスワードを再設定する管理コマンド。
//   npm run reset-password -- <email>
// 新しいパスワードは対話入力（または環境変数 NEW_PASSWORD）で受け取り、引数には書かない（シェル履歴に残さないため）。
import path from 'node:path'
import readline from 'node:readline/promises'
import { hashPassword } from '../auth.ts'
import { loadConfig } from '../config.ts'
import { openDb, nowIso } from '../db.ts'

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
  const config = loadConfig()
  const db = openDb(path.join(config.dataDir, 'app.db'))
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined
  if (!user) {
    console.error(`ユーザーが見つかりません: ${email}`)
    process.exit(1)
  }
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), user.id)
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id) // 既存セッションも無効化
  })
  tx()
  db.close()
  console.log(JSON.stringify({ level: 'info', time: nowIso(), message: `password reset: ${email}（既存セッションは無効化）` }))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
