import fs from 'node:fs'
import path from 'node:path'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { openDb, nowIso } from './db.ts'

const config = loadConfig()
fs.mkdirSync(config.dataDir, { recursive: true })
const db = openDb(path.join(config.dataDir, 'app.db'))
const app = createApp({ db, config })

app.listen(config.port, () => {
  console.log(
    JSON.stringify({
      level: 'info',
      time: nowIso(),
      message: `listening on http://localhost:${config.port}`,
      dataDir: config.dataDir,
      webDist: fs.existsSync(config.webDist) ? config.webDist : '(not built: API only)',
    }),
  )
})
