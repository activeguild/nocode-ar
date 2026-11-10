import fs from 'node:fs'
import path from 'node:path'
import request from 'supertest'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyScene, type Scene } from '../../shared/src/index.js'
import { tinyGlb, tinyJpeg, tinyJpegHeader, tinyMind, tinyMp4, tinyPng } from './fixtures.js'
import { closeSharedDb, makeTestApp } from './helpers.js'

type App = Awaited<ReturnType<typeof makeTestApp>>

let t: App
beforeEach(async () => {
  t = await makeTestApp()
})
afterEach(() => t.cleanup())
afterAll(() => closeSharedDb())

async function count(sql: string, params: unknown[]): Promise<number> {
  return Number((await t.db.query<{ n: unknown }>(sql, params)).rows[0].n)
}

async function signup(email = 'sato@example.com', password = 'password123') {
  const res = await request(t.app).post('/api/auth/signup').send({ email, password })
  expect(res.status).toBe(201)
  const cookie = res.headers['set-cookie'][0].split(';')[0]
  return cookie
}

async function createProject(cookie: string, name = '展示会チラシ') {
  const res = await request(t.app).post('/api/projects').set('Cookie', cookie).send({ name })
  expect(res.status).toBe(201)
  return res.body.project as { id: string; slug: string; previewToken: string }
}

async function upload(cookie: string, projectId: string, kind: string, buf: Buffer, extra: Record<string, string> = {}) {
  let req = request(t.app).post(`/api/projects/${projectId}/assets`).set('Cookie', cookie).field('kind', kind)
  for (const [k, v] of Object.entries(extra)) req = req.field(k, v)
  return req.attach('file', buf, 'file.bin')
}

/** 公開可能な下書きを作る */
async function makeReady(cookie: string, projectId: string): Promise<Scene> {
  const img = await upload(cookie, projectId, 'target_image', tinyPng(), { width: '1', height: '1' })
  expect(img.status).toBe(201)
  const mind = await upload(cookie, projectId, 'target_mind', tinyMind())
  expect(mind.status).toBe(201)
  const ov = await upload(cookie, projectId, 'overlay', tinyPng())
  expect(ov.status).toBe(201)
  const scene: Scene = {
    ...emptyScene(),
    target: { ...emptyScene().target, imageAssetId: img.body.asset.id, mindAssetId: mind.body.asset.id, imageWidth: 1, imageHeight: 1, quality: 'good', featureCount: 1000 },
    overlay: {
      type: 'image',
      assetId: ov.body.asset.id,
      thumbnailAssetId: null,
      aspect: 1,
      transform: { x: 0.5, y: 0.5, width: 0.8, rotationDeg: 0 },
      video: { loop: true, withAudio: false },
      model: { lift: 0.1, yawDeg: 0, autoRotate: true },
    },
    buttons: [{ id: 'b1', label: '資料を請求する', url: 'https://example.com/docs', preset: 'docs' }],
  }
  const res = await request(t.app).patch(`/api/projects/${projectId}`).set('Cookie', cookie).send({ draftScene: scene })
  expect(res.status).toBe(200)
  return scene
}

describe('認証（FR-1）', () => {
  it('登録 → me → ログアウト', async () => {
    const cookie = await signup()
    const me = await request(t.app).get('/api/auth/me').set('Cookie', cookie)
    expect(me.body.user.email).toBe('sato@example.com')
    const out = await request(t.app).post('/api/auth/logout').set('Cookie', cookie)
    expect(out.status).toBe(204)
    const me2 = await request(t.app).get('/api/auth/me').set('Cookie', cookie)
    expect(me2.status).toBe(401)
  })

  it('重複登録・短いパスワードを拒否', async () => {
    await signup()
    const dup = await request(t.app).post('/api/auth/signup').send({ email: 'SATO@example.com', password: 'password123' })
    expect(dup.status).toBe(409)
    const short = await request(t.app).post('/api/auth/signup').send({ email: 'x@example.com', password: 'short' })
    expect(short.status).toBe(400)
  })

  it('ログイン失敗は理由を明かさず、10 回でロック', async () => {
    await signup()
    const bad = await request(t.app).post('/api/auth/login').send({ email: 'sato@example.com', password: 'wrong-password' })
    expect(bad.status).toBe(401)
    expect(bad.body.error).toBe('メールアドレスまたはパスワードが違います')
    for (let i = 0; i < 9; i++) await request(t.app).post('/api/auth/login').send({ email: 'sato@example.com', password: 'wrong-password' })
    const locked = await request(t.app).post('/api/auth/login').send({ email: 'sato@example.com', password: 'password123' })
    expect(locked.status).toBe(429)
  })

  it('正しいログインでセッションが発行される', async () => {
    await signup()
    const res = await request(t.app).post('/api/auth/login').send({ email: 'sato@example.com', password: 'password123' })
    expect(res.status).toBe(200)
    expect(res.headers['set-cookie'][0]).toMatch(/^sid=.+HttpOnly/)
  })
})

describe('プロジェクト（FR-2）と認可（FR-1-3）', () => {
  it('作成・一覧・名前変更・削除', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    expect(p.slug).toMatch(/^[a-z0-9]{8}$/)
    const list = await request(t.app).get('/api/projects').set('Cookie', cookie)
    expect(list.body.projects).toHaveLength(1)
    expect(list.body.projects[0].status).toBe('draft')
    const renamed = await request(t.app).patch(`/api/projects/${p.id}`).set('Cookie', cookie).send({ name: 'パネル' })
    expect(renamed.body.project.name).toBe('パネル')
    expect(renamed.body.publicUrl).toBe(`https://ar.example.test/v/${p.slug}`)
    const del = await request(t.app).delete(`/api/projects/${p.id}`).set('Cookie', cookie)
    expect(del.status).toBe(204)
    const after = await request(t.app).get('/api/projects').set('Cookie', cookie)
    expect(after.body.projects).toHaveLength(0)
  })

  it('他人のプロジェクトは 404', async () => {
    const a = await signup('a@example.com')
    const b = await signup('b@example.com')
    const p = await createProject(a)
    const res = await request(t.app).get(`/api/projects/${p.id}`).set('Cookie', b)
    expect(res.status).toBe(404)
    const patch = await request(t.app).patch(`/api/projects/${p.id}`).set('Cookie', b).send({ name: 'x' })
    expect(patch.status).toBe(404)
  })

  it('未ログインは 401', async () => {
    const res = await request(t.app).get('/api/projects')
    expect(res.status).toBe(401)
  })

  it('不正なシーン定義（許容外 URL、ボタン 4 個）を拒否', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    const bad = { ...emptyScene(), buttons: [{ id: 'b1', label: 'x', url: 'http://insecure.example.com', preset: 'custom' }] }
    const res = await request(t.app).patch(`/api/projects/${p.id}`).set('Cookie', cookie).send({ draftScene: bad })
    expect(res.status).toBe(400)
    const many = { ...emptyScene(), buttons: [1, 2, 3, 4].map((i) => ({ id: `b${i}`, label: 'x', url: 'https://example.com', preset: 'custom' })) }
    const res2 = await request(t.app).patch(`/api/projects/${p.id}`).set('Cookie', cookie).send({ draftScene: many })
    expect(res2.status).toBe(400)
    const line = { ...emptyScene(), buttons: [{ id: 'b1', label: 'LINE', url: 'https://line.me/R/ti/p/@abc', preset: 'line' }] }
    const res3 = await request(t.app).patch(`/api/projects/${p.id}`).set('Cookie', cookie).send({ draftScene: line })
    expect(res3.status).toBe(200)
  })
})

describe('素材（FR-3, FR-4, NFR-4, NFR-9）', () => {
  it('形式をマジックバイトで判定し、配信できる', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    const png = await upload(cookie, p.id, 'overlay', tinyPng())
    expect(png.status).toBe(201)
    expect(png.body.asset.mime).toBe('image/png')
    const glb = await upload(cookie, p.id, 'overlay', tinyGlb())
    expect(glb.body.asset.mime).toBe('model/gltf-binary')
    const mp4 = await upload(cookie, p.id, 'overlay', tinyMp4())
    expect(mp4.body.asset.mime).toBe('video/mp4')
    const served = await request(t.app).get(png.body.asset.url)
    expect(served.status).toBe(200)
    expect(served.headers['content-type']).toBe('image/png')
    expect(served.headers['x-content-type-options']).toBe('nosniff')
    const wrongExt = await request(t.app).get(png.body.asset.url.replace('.png', '.html'))
    expect(wrongExt.status).toBe(404)
  })

  it('MOV（R5）・未対応形式・ターゲットに WebP を拒否', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    const mov = await upload(cookie, p.id, 'overlay', tinyMp4('qt  '))
    expect(mov.status).toBe(400)
    expect(mov.body.code).toBe('mov')
    expect(mov.body.error).toContain('互換性優先')
    const txt = await upload(cookie, p.id, 'overlay', Buffer.from('hello world, this is not media'))
    expect(txt.status).toBe(400)
    const jpgTarget = await upload(cookie, p.id, 'target_image', tinyJpeg(640, 480))
    expect(jpgTarget.status).toBe(201)
    expect(jpgTarget.body.asset.width).toBe(640)
    const noSof = await upload(cookie, p.id, 'target_image', tinyJpegHeader())
    expect(noSof.status).toBe(400)
    const glbTarget = await upload(cookie, p.id, 'target_image', tinyGlb())
    expect(glbTarget.status).toBe(400)
  })

  it('上限超過を拒否', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    const big = Buffer.concat([tinyPng(), Buffer.alloc(10 * 1024 * 1024 + 1)])
    const res = await upload(cookie, p.id, 'overlay', big)
    expect(res.status).toBe(413)
    // D-18: 寸法はサーバがヘッダから読む（申告値は信用しない）
    const edge = await upload(cookie, p.id, 'target_image', tinyPng(9000, 100), { width: '1', height: '1' })
    expect(edge.status).toBe(400)
    const ok = await upload(cookie, p.id, 'target_image', tinyPng(300, 200), { width: 'abc' })
    expect(ok.status).toBe(201)
    expect(ok.body.asset).toMatchObject({ width: 300, height: 200 })
  })

  it('公開中の素材は削除できない', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    const scene = await makeReady(cookie, p.id)
    await request(t.app).post(`/api/projects/${p.id}/publish`).set('Cookie', cookie)
    const del = await request(t.app).delete(`/api/projects/${p.id}/assets/${scene.overlay!.assetId}`).set('Cookie', cookie)
    expect(del.status).toBe(409)
  })
})

describe('公開・停止・プレビュー（FR-6）と公開 API（FR-7）', () => {
  it('不足があると公開できない', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    const res = await request(t.app).post(`/api/projects/${p.id}/publish`).set('Cookie', cookie)
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('ターゲット画像')
  })

  it('公開 → 差し替え → 停止 → 再開の状態遷移と公開 API の応答', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    const before = await request(t.app).get(`/api/public/${p.slug}`)
    expect(before.status).toBe(404)
    expect(before.body.reason).toBe('draft')

    const scene = await makeReady(cookie, p.id)
    const pub = await request(t.app).post(`/api/projects/${p.id}/publish`).set('Cookie', cookie)
    expect(pub.status).toBe(200)
    expect(pub.body.project.status).toBe('published')
    expect(pub.body.publishEvents.map((e: { type: string }) => e.type)).toEqual(['publish'])

    const open = await request(t.app).get(`/api/public/${p.slug}`)
    expect(open.status).toBe(200)
    expect(open.body.scene.buttons[0].label).toBe('資料を請求する')
    expect(open.body.assets[scene.overlay!.assetId].url).toMatch(/^\/a\//)
    expect(open.headers['cache-control']).toBe('no-cache')

    // 下書きを編集しても公開版は変わらない（FR-6-3）
    const edited = { ...scene, buttons: [{ id: 'b1', label: 'LINE で友だち追加', url: 'https://lin.ee/abc', preset: 'line' as const }] }
    await request(t.app).patch(`/api/projects/${p.id}`).set('Cookie', cookie).send({ draftScene: edited })
    const still = await request(t.app).get(`/api/public/${p.slug}`)
    expect(still.body.scene.buttons[0].label).toBe('資料を請求する')

    // 再公開で差し替わる（FR-6-7）。slug は不変
    const re = await request(t.app).post(`/api/projects/${p.id}/publish`).set('Cookie', cookie)
    expect(re.body.project.slug).toBe(p.slug)
    expect(re.body.publishEvents.map((e: { type: string }) => e.type)).toEqual(['publish', 'republish'])
    const now = await request(t.app).get(`/api/public/${p.slug}`)
    expect(now.body.scene.buttons[0].label).toBe('LINE で友だち追加')

    // 停止（FR-6-9）: 410 とボタン（R1）
    const stop = await request(t.app).post(`/api/projects/${p.id}/unpublish`).set('Cookie', cookie)
    expect(stop.body.project.status).toBe('unpublished')
    const ended = await request(t.app).get(`/api/public/${p.slug}`)
    expect(ended.status).toBe(410)
    expect(ended.body.reason).toBe('unpublished')
    expect(ended.body.buttons[0].url).toBe('https://lin.ee/abc')

    // 再開
    const resume = await request(t.app).post(`/api/projects/${p.id}/publish`).set('Cookie', cookie)
    expect(resume.body.project.status).toBe('published')
    expect((await request(t.app).get(`/api/public/${p.slug}`)).status).toBe(200)
  })

  it('プレビュー token は下書きを返し、再発行で無効になる', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    const pv = await request(t.app).get(`/api/preview/${p.previewToken}`)
    expect(pv.status).toBe(200)
    expect(pv.body.preview).toBe(true)
    const rot = await request(t.app).post(`/api/projects/${p.id}/preview-token`).set('Cookie', cookie)
    expect(rot.body.project.previewToken).not.toBe(p.previewToken)
    expect((await request(t.app).get(`/api/preview/${p.previewToken}`)).status).toBe(404)
  })

  it('QR を PNG / SVG で取得でき、公開前でも取得できる（FR-6-4）', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    const png = await request(t.app).get(`/api/projects/${p.id}/qr.png`).set('Cookie', cookie)
    expect(png.status).toBe(200)
    expect(png.headers['content-type']).toBe('image/png')
    const svg = await request(t.app).get(`/api/projects/${p.id}/qr.svg`).set('Cookie', cookie).buffer(true)
    expect(svg.status).toBe(200)
    expect(Buffer.from(svg.body).toString()).toContain('<svg')
  })

  it('存在しない slug は 404', async () => {
    expect((await request(t.app).get('/api/public/nope1234')).body.reason).toBe('not_found')
  })
})

describe('計測（FR-7-6, FR-9, NFR-6）', () => {
  it('イベントが日別 × 種別 × ボタン × OS で集計され、個人情報を持たない', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    await makeReady(cookie, p.id)
    await request(t.app).post(`/api/projects/${p.id}/publish`).set('Cookie', cookie)
    const send = (body: object) => request(t.app).post(`/api/public/${p.slug}/events`).set('User-Agent', 'Mozilla/5.0 (iPhone)').send(body)
    expect((await send({ type: 'page_open', os: 'ios' })).status).toBe(204)
    expect((await send({ type: 'view_start', os: 'ios' })).status).toBe(204)
    expect((await send({ type: 'recognized', os: 'ios' })).status).toBe(204)
    expect((await send({ type: 'cta_tap', os: 'ios', buttonId: 'b1' })).status).toBe(204)
    expect((await send({ type: 'blocked', os: 'android' })).status).toBe(204)
    expect((await send({ type: 'bogus', os: 'ios' })).status).toBe(400)

    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
    const stats = await request(t.app).get(`/api/projects/${p.id}/stats?from=${today}&to=${today}`).set('Cookie', cookie)
    expect(stats.status).toBe(200)
    const byType = Object.fromEntries(stats.body.rows.map((r: { type: string; count: number }) => [r.type, r.count]))
    expect(byType).toEqual({ page_open: 1, view_start: 1, recognized: 1, cta_tap: 1, blocked: 1 })
    const tap = stats.body.rows.find((r: { type: string }) => r.type === 'cta_tap')
    expect(tap.buttonId).toBe('b1')
    expect(tap.os).toBe('ios')

    const cols = (await t.db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'analytics_events'")).rows.map((c) => c.column_name)
    expect(cols).not.toContain('ip')
    expect(cols).not.toContain('user_agent')

    const list = await request(t.app).get('/api/projects').set('Cookie', cookie)
    expect(list.body.projects[0].totals).toEqual({ viewStart: 1, ctaTap: 1 })

    const csv = await request(t.app).get(`/api/projects/${p.id}/stats.csv?from=${today}&to=${today}`).set('Cookie', cookie)
    expect(csv.status).toBe(200)
    expect(csv.text).toContain('cta_tap')
  })

  it('不正な期間は 400、レート制限は 429', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    const bad = await request(t.app).get(`/api/projects/${p.id}/stats?from=x&to=y`).set('Cookie', cookie)
    expect(bad.status).toBe(400)
    let last = 204
    for (let i = 0; i < 65; i++) {
      last = (await request(t.app).post(`/api/public/${p.slug}/events`).send({ type: 'page_open', os: 'other' })).status
    }
    expect(last).toBe(429)
  })
})

describe('健全性', () => {
  it('healthz', async () => {
    const res = await request(t.app).get('/healthz')
    expect(res.body.ok).toBe(true)
  })
  it('Origin 不一致の状態変更は 403', async () => {
    const res = await request(t.app).post('/api/auth/signup').set('Origin', 'https://evil.example').send({ email: 'x@example.com', password: 'password123' })
    expect(res.status).toBe(403)
  })
})

describe('QA 曖昧点の確定仕様（Q1, Q2, Q4）', () => {
  it('Q1: 削除後は「終了しました」（410）で、最後の公開版のボタンを返す', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    await makeReady(cookie, p.id)
    await request(t.app).post(`/api/projects/${p.id}/publish`).set('Cookie', cookie)
    const del = await request(t.app).delete(`/api/projects/${p.id}`).set('Cookie', cookie)
    expect(del.status).toBe(204)
    const pub = await request(t.app).get(`/api/public/${p.slug}`)
    expect(pub.status).toBe(410)
    expect(pub.body.buttons[0].label).toBe('資料を請求する')
    expect((await request(t.app).get(`/api/projects/${p.id}`).set('Cookie', cookie)).status).toBe(404)
    expect((await request(t.app).get(`/api/preview/${p.previewToken}`)).status).toBe(404)
    // 素材ファイルは削除される
    expect(await count('SELECT COUNT(*) AS n FROM assets WHERE project_id = $1', [p.id])).toBe(0)
  })

  it('Q2: 再開は停止前の公開版に戻し、下書きは反映しない（type = resume）', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    const scene = await makeReady(cookie, p.id)
    await request(t.app).post(`/api/projects/${p.id}/publish`).set('Cookie', cookie)
    await request(t.app).post(`/api/projects/${p.id}/unpublish`).set('Cookie', cookie)
    const edited = { ...scene, buttons: [{ id: 'b1', label: '変更後', url: 'https://example.com/new', preset: 'custom' as const }] }
    await request(t.app).patch(`/api/projects/${p.id}`).set('Cookie', cookie).send({ draftScene: edited })
    const badResume = await request(t.app).post(`/api/projects/${p.id}/resume`).set('Cookie', cookie)
    expect(badResume.status).toBe(200)
    expect(badResume.body.project.status).toBe('published')
    expect(badResume.body.publishEvents.map((e: { type: string }) => e.type)).toEqual(['publish', 'unpublish', 'resume'])
    const pub = await request(t.app).get(`/api/public/${p.slug}`)
    expect(pub.body.scene.buttons[0].label).toBe('資料を請求する')
    expect((await request(t.app).post(`/api/projects/${p.id}/resume`).set('Cookie', cookie)).status).toBe(400)
  })

  it('Q4: 下書きにも公開版にも参照されない古い素材は掃除（/api/cron/cleanup）で削除される', async () => {
    t.cleanup()
    t = await makeTestApp({}, 'memory')
    const cookie = await signup()
    const p = await createProject(cookie)
    const scene = await makeReady(cookie, p.id)
    const old = await upload(cookie, p.id, 'overlay', tinyGlb())
    expect(old.status).toBe(201)
    // 猶予時間（15 分）内は削除されない
    const cron = () => request(t.app).get('/api/cron/cleanup').set('Authorization', 'Bearer test-cron-secret')
    expect((await request(t.app).get('/api/cron/cleanup')).status).toBe(401)
    let r = await cron()
    expect(r.status).toBe(200)
    expect(r.body.assetsDeleted).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM assets WHERE id = $1', [old.body.asset.id])).toBe(1)
    // 古い素材として扱わせる
    await t.db.query('UPDATE assets SET created_at = $1 WHERE id = $2', ['2000-01-01T00:00:00.000Z', old.body.asset.id])
    r = await cron()
    expect(r.body.assetsDeleted).toBe(1)
    expect(await count('SELECT COUNT(*) AS n FROM assets WHERE id = $1', [old.body.asset.id])).toBe(0)
    expect(t.storage.objects!.has(`projects/${p.id}/overlay/${old.body.asset.id}`)).toBe(false)
    // 参照中の素材は残る
    expect(await count('SELECT COUNT(*) AS n FROM assets WHERE id = $1', [scene.overlay!.assetId])).toBe(1)
    // 迷子の Blob（DB に無い）も、猶予（15 分）を過ぎていれば掃除される
    const orphanKey = `projects/${p.id}/overlay/orphan`
    await t.storage.put(orphanKey, tinyPng(), 'image/png')
    r = await cron()
    expect(r.body.orphanBlobsDeleted).toBe(0)
    t.storage.objects!.get(orphanKey)!.uploadedAt = new Date(0)
    r = await cron()
    expect(r.body.orphanBlobsDeleted).toBe(1)
    expect(t.storage.objects!.has(orphanKey)).toBe(false)
  })
})

describe('QA ラウンド 1 の修正（D-01〜D-22）', () => {
  it('D-01: 公開 API は公開版が参照する素材のみ返す（下書き専用の素材を列挙しない）', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    const scene = await makeReady(cookie, p.id)
    await request(t.app).post(`/api/projects/${p.id}/publish`).set('Cookie', cookie)
    const draftOnly = await upload(cookie, p.id, 'overlay', tinyGlb())
    await request(t.app)
      .patch(`/api/projects/${p.id}`)
      .set('Cookie', cookie)
      .send({ draftScene: { ...scene, overlay: { ...scene.overlay!, type: 'model', assetId: draftOnly.body.asset.id } } })
    const pub = await request(t.app).get(`/api/public/${p.slug}`)
    expect(pub.status).toBe(200)
    expect(Object.keys(pub.body.assets).sort()).toEqual([scene.target.imageAssetId, scene.target.mindAssetId, scene.overlay!.assetId].sort())
    expect(pub.body.assets[draftOnly.body.asset.id]).toBeUndefined()
    // プレビュー（token 保持者のみ）は下書きの素材を含む
    const pv = await request(t.app).get(`/api/preview/${p.previewToken}`)
    expect(pv.body.assets[draftOnly.body.asset.id]).toBeDefined()
  })

  it('D-02: buttonId は公開版のボタン ID のみ受理し、CSV は数式を無害化する', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    await makeReady(cookie, p.id)
    const send = (body: object) => request(t.app).post(`/api/public/${p.slug}/events`).send(body)
    // 未公開では cta_tap を受理しない
    expect((await send({ type: 'cta_tap', buttonId: 'b1', os: 'ios' })).status).toBe(400)
    await request(t.app).post(`/api/projects/${p.id}/publish`).set('Cookie', cookie)
    expect((await send({ type: 'cta_tap', buttonId: '=cmd|"/c calc"!A1', os: 'ios' })).status).toBe(400)
    expect((await send({ type: 'cta_tap', buttonId: 'bogus', os: 'ios' })).status).toBe(400)
    expect((await send({ type: 'cta_tap', os: 'ios' })).status).toBe(400)
    expect((await send({ type: 'cta_tap', buttonId: 'b1', os: 'ios' })).status).toBe(204)
    // 万一 DB に危険な値があっても CSV セルは ' で無害化される
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
    await t.db.query("INSERT INTO analytics_events (project_id, scene_version_id, type, button_id, os, occurred_at, day_jst) VALUES ($1, NULL, 'cta_tap', $2, 'ios', $3, $4)", [
      p.id,
      '=HYPERLINK("x")',
      new Date().toISOString(),
      today,
    ])
    const csv = await request(t.app).get(`/api/projects/${p.id}/stats.csv?from=${today}&to=${today}`).set('Cookie', cookie)
    expect(csv.text).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv.text).not.toMatch(/,"=/)
  })

  it('D-05: 応答が gzip 圧縮される（.mind と JSON）', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    const mind = await upload(cookie, p.id, 'target_mind', tinyMind(4000))
    expect(mind.status).toBe(201)
    const served = await request(t.app).get(mind.body.asset.url).set('Accept-Encoding', 'gzip')
    expect(served.status).toBe(200)
    expect(served.headers['content-encoding']).toBe('gzip')
    const longScene = { ...emptyScene(), buttons: [1, 2, 3].map((i) => ({ id: `b${i}`, label: 'x', url: 'https://example.com/' + 'a'.repeat(900), preset: 'custom' })) }
    await request(t.app).patch(`/api/projects/${p.id}`).set('Cookie', cookie).send({ draftScene: longScene })
    const json = await request(t.app).get(`/api/projects/${p.id}`).set('Cookie', cookie).set('Accept-Encoding', 'gzip')
    expect(json.headers['content-encoding']).toBe('gzip')
    expect(json.body.draftScene.buttons).toHaveLength(3)
    // .mind は保存時点で gzip 済みのため常に Content-Encoding: gzip（CDN が octet-stream を圧縮しないため。D-19）
    const plain = await request(t.app).get(mind.body.asset.url).set('Accept-Encoding', 'identity')
    expect(plain.headers['content-encoding']).toBe('gzip')
    const jsonPlain = await request(t.app).get(`/api/projects/${p.id}`).set('Cookie', cookie).set('Accept-Encoding', 'identity')
    expect(jsonPlain.headers['content-encoding']).toBeUndefined()
  })

  it('D-06: アカウント合計の上限を超えると 413', async () => {
    t.cleanup()
    t = await makeTestApp({ accountQuotaBytes: 1500 })
    const cookie = await signup()
    const p1 = await createProject(cookie)
    const p2 = await createProject(cookie, '2 本目')
    expect((await upload(cookie, p1.id, 'overlay', tinyPng())).status).toBe(201)
    expect((await upload(cookie, p2.id, 'overlay', tinyPng())).status).toBe(201)
    const over = await upload(cookie, p2.id, 'overlay', tinyMind(600) && tinyPng(), {})
    const big = await upload(cookie, p2.id, 'overlay', Buffer.concat([tinyPng(), Buffer.alloc(1400)]))
    expect(over.status === 201 || over.status === 413).toBe(true)
    expect(big.status).toBe(413)
    expect(big.body.error).toContain('アカウント全体')
  })

  it('D-07 / D-08: 検証エラーは日本語のみ、1 MB 超の本文は 413', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    const many = { ...emptyScene(), buttons: [1, 2, 3, 4].map((i) => ({ id: `b${i}`, label: 'x', url: 'https://example.com', preset: 'custom' })) }
    const res = await request(t.app).patch(`/api/projects/${p.id}`).set('Cookie', cookie).send({ draftScene: many })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/^入力内容に誤りがあります（.*buttons.*）$/)
    expect(res.body.error).not.toMatch(/Too big|expected/)
    const huge = await request(t.app).patch(`/api/projects/${p.id}`).set('Cookie', cookie).set('Content-Type', 'application/json').send(JSON.stringify({ name: 'x'.repeat(1024 * 1024 + 10) }))
    expect(huge.status).toBe(413)
    expect(huge.body.error).toContain('大きすぎます')
  })

  it('D-15 / D-16: from > to は 400、存在しない slug は常に 404（レート制限より前）', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    const bad = await request(t.app).get(`/api/projects/${p.id}/stats?from=2026-11-10&to=2026-11-01`).set('Cookie', cookie)
    expect(bad.status).toBe(400)
    let last = 0
    for (let i = 0; i < 65; i++) last = (await request(t.app).post('/api/public/nope9999/events').send({ type: 'page_open', os: 'other' })).status
    expect(last).toBe(404)
  })

  it('D-17: MP4 以外の ISO-BMFF（HEIC / 3GP / M4A）は拒否', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    for (const brand of ['heic', 'mif1', '3gp5', 'M4A ']) expect((await upload(cookie, p.id, 'overlay', tinyMp4(brand))).status).toBe(400)
    for (const brand of ['isom', 'mp42', 'avc1']) expect((await upload(cookie, p.id, 'overlay', tinyMp4(brand))).status).toBe(201)
  })

  it('D-21: ロック中でも 60 秒に 1 回は正しいパスワードで入れる', async () => {
    await signup()
    const login = (password: string) => request(t.app).post('/api/auth/login').send({ email: 'sato@example.com', password })
    for (let i = 0; i < 10; i++) await login('wrong-password')
    expect((await login('password123')).status).toBe(429)
    const realNow = Date.now
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 61_000)
    try {
      expect((await login('wrong-password')).status).toBe(401) // 1 回だけ照合される
      expect((await login('password123')).status).toBe(429) // 直後はまたロック
      spy.mockImplementation(() => realNow() + 122_000)
      expect((await login('password123')).status).toBe(200)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('Cloudflare 構成（生ボディのアップロード、鍵はサーバ生成、Range 配信、DB 保持の状態）', () => {
  it('生ボディ（ストリーム）アップロード: kind はクエリ、Content-Length 必須、検証はサーバ', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    const png = tinyPng(320, 200)
    const res = await request(t.app).post(`/api/projects/${p.id}/assets?kind=overlay&width=1&height=1`).set('Cookie', cookie).set('Content-Type', 'image/png').send(png)
    expect(res.status).toBe(201)
    expect(res.body.asset).toMatchObject({ mime: 'image/png', width: 320, height: 200 })
    expect(res.body.asset.url).toMatch(/^\/a\/[A-Za-z0-9]{22}\.png$/)
    // 形式不正はストレージから削除される
    const bad = await request(t.app).post(`/api/projects/${p.id}/assets?kind=overlay`).set('Cookie', cookie).set('Content-Type', 'image/png').send(Buffer.from('<html>not an image at all</html>'))
    expect(bad.status).toBe(400)
    expect(await count('SELECT COUNT(*) AS n FROM assets WHERE project_id = $1', [p.id])).toBe(1)
    const files = fs.readdirSync(path.join(t.dataDir, 'assets', 'projects', p.id, 'overlay'))
    expect(files).toHaveLength(1)
    // 上限超過の申告は本体を受ける前に 413
    const huge = await request(t.app).post(`/api/projects/${p.id}/assets?kind=overlay`).set('Cookie', cookie).set('Content-Type', 'video/mp4').set('Content-Length', String(60 * 1024 * 1024)).send(Buffer.alloc(0))
    expect(huge.status).toBe(413)
    // kind 不正
    expect((await request(t.app).post(`/api/projects/${p.id}/assets?kind=evil`).set('Cookie', cookie).set('Content-Type', 'image/png').send(png)).status).toBe(400)
  })

  it('クライアントは鍵や URL を指定できない（B-R3-01 の構造的防止）', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    expect((await request(t.app).post(`/api/projects/${p.id}/assets/register`).set('Cookie', cookie).send({ kind: 'overlay', pathname: 'x', url: 'http://127.0.0.1/x' })).status).toBe(404)
    expect((await request(t.app).post(`/api/projects/${p.id}/blob-upload`).set('Cookie', cookie).send({})).status).toBe(404)
    const png = await upload(cookie, p.id, 'overlay', tinyPng(), { url: 'http://127.0.0.1/evil.png', pathname: 'projects/other/overlay/x', key: 'zzz' })
    expect(png.status).toBe(201)
    expect(png.body.asset.url).toMatch(/^\/a\//)
    const row = await t.db.query<{ storage_key: string }>('SELECT storage_key FROM assets WHERE id = $1', [png.body.asset.id])
    expect(row.rows[0].storage_key).toBe(`projects/${p.id}/overlay/${png.body.asset.id}`)
  })

  it('/a/:id.ext は Range に対応し、公開版が参照しない素材は公開 API に出ない', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    const body = Buffer.concat([tinyPng(), Buffer.alloc(5000, 7)])
    const up = await upload(cookie, p.id, 'overlay', body)
    const full = await request(t.app).get(up.body.asset.url).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))) })
    expect(full.status).toBe(200)
    expect(full.headers['accept-ranges']).toBe('bytes')
    expect(full.headers['content-type']).toBe('image/png')
    expect(full.headers['cache-control']).toContain('immutable')
    expect(full.headers['x-content-type-options']).toBe('nosniff')
    expect((full.body as Buffer).length).toBe(body.length)
    const part = await request(t.app).get(up.body.asset.url).set('Range', 'bytes=10-19').buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))) })
    expect(part.status).toBe(206)
    expect(part.headers['content-range']).toBe(`bytes 10-19/${body.length}`)
    expect(part.headers['content-length']).toBe('10')
    expect(Buffer.compare(part.body as Buffer, body.subarray(10, 20))).toBe(0)
    const bad = await request(t.app).get(up.body.asset.url).set('Range', 'bytes=999999-')
    expect(bad.status).toBe(416)
    expect((await request(t.app).get(up.body.asset.url.replace('.png', '.html'))).status).toBe(404)
  })

  it('/api/config は uploadMode=direct、healthz は db / storage の種類を返す', async () => {
    const cfg = await request(t.app).get('/api/config')
    expect(cfg.body.uploadMode).toBe('direct')
    const health = await request(t.app).get('/healthz')
    expect(health.body).toMatchObject({ ok: true, db: 'pglite', storage: 'local' })
  })

  it('ログインロックとレート制限が DB に保持される（別インスタンスでも継続）', async () => {
    await signup()
    for (let i = 0; i < 10; i++) await request(t.app).post('/api/auth/login').send({ email: 'sato@example.com', password: 'wrong-password' })
    expect(await count('SELECT COUNT(*) AS n FROM login_locks WHERE email = $1', ['sato@example.com'])).toBe(1)
    const { createApp } = await import('../src/app.js')
    const { getRequestListener } = await import('@hono/node-server')
    const app2 = getRequestListener(createApp({ db: t.db, storage: t.storage, config: t.config }).fetch)
    expect((await request(app2).post('/api/auth/login').send({ email: 'sato@example.com', password: 'password123' })).status).toBe(429)
    const p = await createProject((await request(t.app).post('/api/auth/signup').send({ email: 'b@example.com', password: 'password123' })).headers['set-cookie'][0].split(';')[0])
    for (let i = 0; i < 60; i++) await request(t.app).post(`/api/public/${p.slug}/events`).send({ type: 'page_open', os: 'other' })
    expect((await request(app2).post(`/api/public/${p.slug}/events`).send({ type: 'page_open', os: 'other' })).status).toBe(429)
    expect(await count('SELECT COUNT(*) AS n FROM rate_limits', [])).toBe(1)
  })

  it('M-R3-04: 未知の API パスは日本語 JSON の 404、Cron の認証はタイミングセーフ比較', async () => {
    const nf = await request(t.app).get('/api/nothing-here')
    expect(nf.status).toBe(404)
    expect(nf.body.error).toBe('ページが見つかりません')
    const partial = await request(t.app).get('/api/cron/cleanup').set('Authorization', 'Bearer test-cron-secre')
    expect(partial.status).toBe(401)
    expect(partial.body.error).toBe('認証に失敗しました')
  })
})
