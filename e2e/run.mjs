// E2E: 作成者フロー（登録 → 作成 → ターゲット登録 → オーバーレイ配置 → ボタン → 公開 → QR）と
// 体験者フロー（閲覧ページ起動 → フェイクカメラで認識 → ボタンタップ → 計測に反映）を、
// ビルド済みアプリ + Express に対してヘッドレス Chromium で検証する。
//   node e2e/run.mjs            （scripts/e2e.mjs から呼ばれる。環境変数 BASE_URL, FIXTURES, OUT）
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000'
const FIX = path.resolve(process.env.FIXTURES ?? 'e2e/.fixtures')
const OUT = path.resolve(process.env.OUT ?? 'e2e/.out')
fs.mkdirSync(OUT, { recursive: true })

const results = []
let failed = 0
const t0 = Date.now()
const log = (msg) => console.log(`[e2e +${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`)
async function step(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    log(`PASS ${name}`)
  } catch (e) {
    failed++
    results.push({ name, ok: false, error: String(e?.message ?? e) })
    log(`FAIL ${name}: ${e?.stack ?? e}`)
    throw e
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

const email = `e2e-${Date.now()}@example.com`
const password = `pw-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

const browser = await chromium.launch({
  args: [
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${path.join(FIX, 'camera.y4m')}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
})
// ヘッドレス（SwiftShader = ソフトウェア描画）では TF.js が failIfMajorPerformanceCaveat で WebGL を拒否し CPU に落ちるため、
// テスト環境でのみその属性を外す（実機 GPU では不要）。
const SWIFTSHADER_SHIM = `(() => {
  const orig = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (attrs && typeof attrs === 'object' && 'failIfMajorPerformanceCaveat' in attrs) attrs = { ...attrs, failIfMajorPerformanceCaveat: false }
    return orig.call(this, type, attrs)
  }
})()`
const newContext = async (opts = {}) => {
  const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ja-JP', ...opts })
  await c.addInitScript(SWIFTSHADER_SHIM)
  // 行動ボタンのリンク先（外部サイト）はネットワークに出さずにスタブ応答する
  await c.route('https://example.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>stub</title>ok' }))
  return c
}
const context = await newContext()
const consoleErrors = []
const requests = []
const trackErrors = (page, label) => {
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[${label}] ${m.text()}`)
  })
  page.on('request', (r) => requests.push({ page: label, method: r.method(), url: r.url(), size: r.postData()?.length ?? 0 }))
}
const page = await context.newPage()
trackErrors(page, 'editor')

let projectId = ''
let publicUrl = ''
let previewUrl = ''

try {
  await step('AC-M0 登録（メール + パスワードのみ）', async () => {
    await page.goto(`${BASE}/signup`)
    await page.fill('#email', email)
    await page.fill('#password', password)
    await page.click('[data-testid=auth-submit]')
    await page.waitForURL('**/projects')
    assert(await page.locator('h1').first().textContent() === 'プロジェクト一覧', '一覧が表示される')
  })

  await step('FR-2 プロジェクト作成', async () => {
    await page.fill('#new-name', '展示会チラシ E2E')
    await page.click('[data-testid=create-project]')
    await page.waitForURL(/\/projects\/[A-Za-z0-9]+$/)
    projectId = page.url().split('/').pop()
    publicUrl = (await page.locator('[data-testid=public-url]').textContent()).trim()
    assert(/\/v\/[a-z0-9]{8}$/.test(publicUrl), `公開 URL の形式: ${publicUrl}`)
  })

  await step('FR-6-4 公開前に QR を取得できる', async () => {
    const res = await context.request.get(`${BASE}/api/projects/${projectId}/qr.png`)
    assert(res.status() === 200 && res.headers()['content-type'] === 'image/png', 'QR PNG')
    const svg = await context.request.get(`${BASE}/api/projects/${projectId}/qr.svg`)
    assert((await svg.text()).includes('<svg'), 'QR SVG')
    await page.waitForSelector('[data-testid=qr-img]')
  })

  await step('AC-M1 ターゲット画像の登録とブラウザ内解析（.mind 生成、認識しやすさ判定）', async () => {
    await page.setInputFiles('[data-testid=target-file]', path.join(FIX, 'target.png'))
    await page.waitForSelector('[data-testid=quality]', { timeout: 240_000 })
    const q = await page.getAttribute('[data-testid=quality]', 'data-quality')
    const txt = await page.locator('[data-testid=quality]').textContent()
    log(`quality=${q} ${txt}`)
    assert(q === 'good' || q === 'fair', `チラシ風画像は 良い/普通 になる（実際: ${q}）`)
  })

  await step('AC-M2 オーバーレイ画像の登録と配置（数値で幅を変更）', async () => {
    await page.setInputFiles('[data-testid=overlay-file]', path.join(FIX, 'overlay.png'))
    await page.waitForSelector('[data-testid=placement]')
    await page.fill('[data-testid=overlay-width]', '60')
    // ドラッグで移動（FR-4-3）
    const box = await page.locator('[data-testid=placement] .ov').boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 5 })
    await page.mouse.up()
  })

  await step('AC-M2 3D モデル（GLB）の読み込みと 3D プレビュー', async () => {
    await page.setInputFiles('[data-testid=overlay-file]', path.join(FIX, 'sample.glb'))
    await page.waitForSelector('.three-preview canvas', { timeout: 60_000 })
    // 最終的には画像オーバーレイに戻す（閲覧ページの検証用）
    await page.setInputFiles('[data-testid=overlay-file]', path.join(FIX, 'overlay.png'))
    await page.waitForSelector('[data-testid=placement] .ov img')
  })

  await step('AC-M3 行動ボタン（不足時は公開不可 → 追加で公開可）', async () => {
    assert(await page.locator('[data-testid=publish]').isDisabled(), 'ボタン無しでは公開ボタンが無効')
    await page.click('[data-testid=add-button-docs]')
    const row = page.locator('[data-testid=button-row]').first()
    await row.locator('input[type=url]').fill('https://example.com/docs')
    await page.waitForFunction(() => !document.querySelector('[data-testid=publish]').disabled)
  })

  await step('FR-4-7 自動保存（保存済みになる）', async () => {
    await page.waitForFunction(() => document.querySelector('[data-testid=save-status]')?.dataset.state === 'saved', null, { timeout: 15_000 })
  })

  await step('AC-M5 プレビュー QR / URL が得られ、計測には含まれない', async () => {
    await page.click('[data-testid=preview-qr]')
    await page.waitForSelector('[data-testid=preview-qr-img]')
    previewUrl = await page.locator('.qr-box a[target=_blank]').first().getAttribute('href')
    assert(/\/p\/[A-Za-z0-9]{32}$/.test(previewUrl), `プレビュー URL: ${previewUrl}`)
    const pv = await context.newPage()
    trackErrors(pv, 'preview')
    await pv.goto(previewUrl.replace(/^https?:\/\/[^/]+/, BASE))
    await pv.waitForSelector('.preview-badge')
    await pv.waitForSelector('[data-testid=start-camera]')
    await pv.close()
    // 公開前の公開 URL は「準備中」
    const pub = await context.newPage()
    await pub.goto(publicUrl.replace(/^https?:\/\/[^/]+/, BASE))
    await pub.waitForSelector('text=準備中です')
    await pub.close()
  })

  await step('AC-M4 公開', async () => {
    await page.click('[data-testid=publish]')
    await page.waitForSelector('[data-testid=publish-msg]')
    const msg = await page.locator('[data-testid=publish-msg]').textContent()
    assert(msg.includes('公開しました'), `公開メッセージ: ${msg}`)
    await page.waitForSelector('[data-testid=unpublish]')
    await page.screenshot({ path: path.join(OUT, 'editor-published.png'), fullPage: true })
  })

  const viewerPage = await context.newPage()
  trackErrors(viewerPage, 'viewer')
  await viewerPage.setViewportSize({ width: 390, height: 844 })
  let popupUrl = null
  viewerPage.on('popup', async (p) => {
    popupUrl = p.url()
    await p.close().catch(() => {})
  })

  await step('AC-M4 閲覧ページ: 導入画面 → カメラ起動（フェイクカメラ）', async () => {
    await viewerPage.goto(publicUrl.replace(/^https?:\/\/[^/]+/, BASE))
    await viewerPage.waitForSelector('[data-testid=start-camera]')
    assert((await viewerPage.locator('.intro h1').textContent()) === '展示会チラシ E2E', '導入画面にプロジェクト名')
    await viewerPage.click('[data-testid=start-camera]')
    await viewerPage.waitForFunction(() => document.querySelector('.viewer')?.dataset.phase === 'running', null, { timeout: 120_000 })
    assert(await viewerPage.locator('.ar-container video').count() === 1, 'カメラ映像の video 要素')
  })

  await step('AC-M1(3) / FR-7-3 ターゲット認識（フェイクカメラ映像）', async () => {
    await viewerPage.waitForFunction(() => document.querySelector('.viewer')?.dataset.found === 'true', null, { timeout: 180_000 })
    await viewerPage.waitForTimeout(1500)
    await viewerPage.screenshot({ path: path.join(OUT, 'viewer-recognized.png') })
  })

  await step('AC-M3 行動ボタンのタップで外部ページが開く', async () => {
    const [popup] = await Promise.all([viewerPage.waitForEvent('popup', { timeout: 10_000 }).catch(() => null), viewerPage.click('[data-testid^=cta-]')])
    const url = popup ? popup.url() : popupUrl
    assert(url && url.startsWith('https://example.com/docs'), `開いた URL: ${url}`)
    await popup?.close().catch(() => {})
  })

  await step('AC-K5 カメラ映像をサーバーに送っていない（送信は計測イベントと素材取得のみ）', async () => {
    // 閲覧ページで発生した POST を確認
    const posts = requests.filter((r) => r.page === 'viewer' && r.method === 'POST')
    assert(posts.length > 0 && posts.every((r) => /\/api\/public\/[a-z0-9]+\/events$/.test(r.url)), `POST 先: ${JSON.stringify(posts)}`)
    assert(posts.every((r) => (r.size ?? 0) < 512), '計測イベントは小さな JSON のみ')
  })

  await step('AC-M7 計測ダッシュボードに反映（体験 1 / 認識 1 / タップ 1 / ページ 1）', async () => {
    await viewerPage.waitForTimeout(1000)
    await page.goto(`${BASE}/projects/${projectId}/stats`)
    const read = async (k) => Number(await page.locator(`[data-testid=stat-${k}]`).textContent())
    await page.waitForFunction(() => Number(document.querySelector('[data-testid=stat-view_start]')?.textContent) >= 1, null, { timeout: 15_000 })
    const v = { view: await read('view_start'), rec: await read('recognized'), tap: await read('cta_tap'), open: await read('page_open') }
    log(`stats=${JSON.stringify(v)}`)
    assert(v.view === 1 && v.rec === 1 && v.tap === 1 && v.open >= 1, `集計値: ${JSON.stringify(v)}`)
    await page.screenshot({ path: path.join(OUT, 'stats.png'), fullPage: true })
  })

  await step('R2 / R3 アプリ内ブラウザ: 案内 + 「このまま試す」で起動できる（blocked を計測）', async () => {
    const line = await newContext({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/14.0.0', viewport: { width: 390, height: 844 } })
    const p = await line.newPage()
    await p.goto(publicUrl.replace(/^https?:\/\/[^/]+/, BASE))
    await p.waitForSelector('[data-testid=try-anyway]')
    assert((await p.locator('h1').textContent()).includes('Safari / Chrome'), '案内文')
    await p.click('[data-testid=try-anyway]')
    await p.waitForFunction(() => document.querySelector('.viewer')?.dataset.phase === 'running', null, { timeout: 120_000 })
    await line.close()
    const res = await context.request.get(`${BASE}/api/projects/${projectId}/stats?from=2000-01-01&to=2100-01-01`)
    const rows = (await res.json()).rows
    assert(rows.some((r) => r.type === 'blocked' && r.os === 'ios'), 'blocked が iOS で記録される')
  })

  await step('AC-M6 差し替え: 同じ URL で新しい内容になる', async () => {
    await page.goto(`${BASE}/projects/${projectId}`)
    const row = page.locator('[data-testid=button-row]').first()
    await row.locator('input[type=text]').fill('資料ダウンロード')
    await page.waitForFunction(() => document.querySelector('[data-testid=save-status]')?.dataset.state === 'saved', null, { timeout: 15_000 })
    await page.waitForSelector('text=未公開の変更があります')
    await page.click('[data-testid=publish]')
    await page.waitForSelector('text=更新を公開しました')
    const res = await context.request.get(`${BASE}/api/public/${publicUrl.split('/').pop()}`)
    const body = await res.json()
    assert(body.scene.buttons[0].label === '資料ダウンロード', '公開版が差し替わる')
  })

  await step('AC-M6 停止 → 終了画面にボタンが残る（R1）→ 再開', async () => {
    page.once('dialog', (d) => d.accept())
    await page.click('[data-testid=unpublish]')
    await page.waitForSelector('[data-testid=resume]')
    const ended = await context.newPage()
    await ended.goto(publicUrl.replace(/^https?:\/\/[^/]+/, BASE))
    await ended.waitForSelector('text=この AR は終了しました')
    assert(await ended.locator('.cta-list a', { hasText: '資料ダウンロード' }).count() === 1, '終了画面に行動ボタン')
    assert((await ended.locator('.ar-container video').count()) === 0, '終了画面ではカメラを起動しない')
    await ended.screenshot({ path: path.join(OUT, 'viewer-ended.png') })
    await ended.close()
    await page.click('[data-testid=resume]')
    await page.waitForSelector('[data-testid=unpublish]')
    const res = await context.request.get(`${BASE}/api/public/${publicUrl.split('/').pop()}`)
    assert(res.status() === 200, '再開後は 200')
  })

  await step('FR-7-8 存在しない slug は「ページが見つかりません」', async () => {
    const p = await context.newPage()
    await p.goto(`${BASE}/v/zzzzzzzz`)
    await p.waitForSelector('text=ページが見つかりません')
    await p.close()
  })

  await step('AC-M0 ログアウト後は一覧にアクセスできない', async () => {
    await page.goto(`${BASE}/projects`)
    await page.click('text=ログアウト')
    await page.waitForURL('**/login')
    await page.goto(`${BASE}/projects/${projectId}`)
    await page.waitForURL('**/login')
  })
} catch {
  // step() 内で記録済み
} finally {
  await browser.close()
}

const relevantErrors = consoleErrors.filter((e) => !/favicon|GPU stall|SwiftShader|WebGL.*deprecated|ReadPixels|401 \(Unauthorized\)/i.test(e))
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, consoleErrors }, null, 2))
console.log('\n==== E2E 結果 ====')
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.error ? ' — ' + r.error : ''}`)
console.log(`console errors (filtered): ${relevantErrors.length}`)
relevantErrors.slice(0, 10).forEach((e) => console.log('  ' + e))
process.exit(failed || relevantErrors.length ? 1 : 0)
