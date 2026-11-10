// E2E 実行: ビルド → フィクスチャ生成 → 一時データディレクトリでサーバ起動 → Playwright で検証
//   npm run e2e            （--no-build でビルドを省略）
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const args = process.argv.slice(2)

const run = (cmd, a, env = {}) => {
  const r = spawnSync(cmd, a, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

if (!args.includes('--no-build')) run(npm, ['run', 'build'])
run(process.execPath, ['scripts/gen-fixtures.mjs', 'e2e/.fixtures'])

const port = await new Promise((resolve) => {
  const s = net.createServer()
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port
    s.close(() => resolve(p))
  })
})
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nocode-ar-e2e-'))
const server = spawn(process.execPath, ['server/dist/server/src/index.js'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, PUBLIC_ORIGIN: `http://127.0.0.1:${port}`, SUPPORT_EMAIL: 'support@example.com' },
})
server.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`))

const base = `http://127.0.0.1:${port}`
for (let i = 0; i < 150; i++) {
  try {
    const r = await fetch(`${base}/healthz`)
    if (r.ok) break
  } catch {
    /* retry */
  }
  await new Promise((r) => setTimeout(r, 200))
}

const e2e = spawnSync(process.execPath, ['e2e/run.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, BASE_URL: base, FIXTURES: path.join(root, 'e2e/.fixtures'), OUT: path.join(root, 'e2e/.out') },
})
server.kill('SIGTERM')
fs.rmSync(dataDir, { recursive: true, force: true })
process.exit(e2e.status ?? 1)
