import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))
const shim = path.join(root, 'src/three-compat-shim.ts')

/**
 * mind-ar 1.2.5 のビルドは three r152 で廃止された sRGBEncoding を import する。
 * mind-ar 配下からの "three" import だけを互換 shim に向ける（docs/04_architecture.md §3）。
 */
const mindArThreeCompat = (): Plugin => ({
  name: 'mindar-three-compat',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === 'three' && importer && importer.includes('/mind-ar/')) return shim
    return null
  },
})

/** 開発サーバで /v/:slug と /p/:token を viewer.html に向ける（本番は Express が行う） */
const viewerRewrite = (): Plugin => ({
  name: 'viewer-rewrite',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /^\/(v|p)\/[^/?]+/.test(req.url)) req.url = '/viewer.html'
      next()
    })
  },
})

const apiTarget = process.env.API_ORIGIN ?? 'http://localhost:3000'
// HTTPS=1 で自己署名証明書の HTTPS 開発サーバにする（実機のカメラ・getUserMedia は secure context が必須）
const https = process.env.HTTPS === '1'

export default defineConfig({
  plugins: [mindArThreeCompat(), viewerRewrite(), react(), ...(https ? [basicSsl()] : [])],
  optimizeDeps: {
    // 依存の事前バンドルを通すと mindArThreeCompat が効かないため除外する
    exclude: ['mind-ar'],
  },
  resolve: {
    alias: { '@shared': path.join(root, '../shared/src') },
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      ['/api', '/a', '/healthz'].map((p) => [
        p,
        {
          target: apiTarget,
          // サーバ側の Origin 検査（CSRF 対策）のため、ブラウザが見ているホストを X-Forwarded-Host で渡す
          configure: (proxy: { on(ev: 'proxyReq', cb: (proxyReq: { setHeader(k: string, v: string): void }, req: { headers: Record<string, string | string[] | undefined> }) => void): void }) =>
            proxy.on('proxyReq', (proxyReq, req) => {
              if (req.headers.host) proxyReq.setHeader('x-forwarded-host', String(req.headers.host))
            }),
        },
      ]),
    ),
  },
  build: {
    rollupOptions: {
      input: {
        main: path.join(root, 'index.html'),
        viewer: path.join(root, 'viewer.html'),
      },
    },
    chunkSizeWarningLimit: 1500,
  },
})
