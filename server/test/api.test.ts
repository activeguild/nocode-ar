import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyScene, type Scene } from '../../shared/src/index.ts'
import { tinyGlb, tinyJpegHeader, tinyMind, tinyMp4, tinyPng } from './fixtures.ts'
import { makeTestApp } from './helpers.ts'

type App = ReturnType<typeof makeTestApp>

let t: App
beforeEach(() => {
  t = makeTestApp()
})
afterEach(() => t.cleanup())

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
    const jpgTarget = await upload(cookie, p.id, 'target_image', tinyJpegHeader())
    expect(jpgTarget.status).toBe(201)
    const glbTarget = await upload(cookie, p.id, 'target_image', tinyGlb())
    expect(glbTarget.status).toBe(400)
  })

  it('上限超過を拒否', async () => {
    const cookie = await signup()
    const p = await createProject(cookie)
    const big = Buffer.concat([tinyPng(), Buffer.alloc(10 * 1024 * 1024 + 1)])
    const res = await upload(cookie, p.id, 'overlay', big)
    expect(res.status).toBe(413)
    const edge = await upload(cookie, p.id, 'target_image', tinyPng(), { width: '9000', height: '100' })
    expect(edge.status).toBe(400)
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

    const cols = t.db.prepare('PRAGMA table_info(analytics_events)').all() as { name: string }[]
    expect(cols.map((c) => c.name)).not.toContain('ip')
    expect(cols.map((c) => c.name)).not.toContain('user_agent')

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
