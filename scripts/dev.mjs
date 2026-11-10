// 開発用: API サーバ（tsx watch, :3000）と Vite 開発サーバ（:5173）を同時に起動する
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const procs = [
  spawn(npm, ['run', 'dev', '-w', 'server'], { cwd: root, stdio: 'inherit', env: { ...process.env, PORT: process.env.PORT ?? '3000' } }),
  spawn(npm, ['run', 'dev', '-w', 'web', '--', '--host'], { cwd: root, stdio: 'inherit', env: { ...process.env, API_ORIGIN: `http://localhost:${process.env.PORT ?? '3000'}` } }),
]

const stop = () => {
  for (const p of procs) p.kill('SIGTERM')
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const p of procs) p.on('exit', (code) => (code && code !== 0 ? stop() : undefined))
