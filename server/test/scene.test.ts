import { describe, expect, it } from 'vitest'
import { emptyScene, isAllowedButtonUrl, judgeTargetQuality, publishBlockers, sceneSchema, toDayJst } from '../../shared/src/index.js'
import { detectFileType, imageDimensions, looksLikeMind, validateAsset } from '../src/assets.js'
import { hashPassword, verifyPassword } from '../src/auth.js'
import { newSlug, newToken } from '../src/ids.js'
import { loadConfig } from '../src/config.js'
import { createRuntime } from '../src/runtime.js'
import { tinyGlb, tinyJpeg, tinyMind, tinyMp4, tinyPng } from './fixtures.js'

describe('シーン定義', () => {
  it('空のシーンは公開不可で、不足項目が列挙される', () => {
    const b = publishBlockers(emptyScene())
    expect(b).toHaveLength(3)
  })
  it('既定値が補われる', () => {
    const s = sceneSchema.parse({ version: 1, target: {}, buttons: [{ id: 'b1', label: 'x', url: 'https://example.com' }] })
    expect(s.target.printWidthMm).toBe(210)
    expect(s.buttons[0].preset).toBe('custom')
    expect(s.endedUrl).toBe('')
  })
  it('ボタン URL の許容（FR-5-2, R10, Q10）', () => {
    expect(isAllowedButtonUrl('https://example.com/form')).toBe(true)
    expect(isAllowedButtonUrl('https://line.me/R/ti/p/@abc')).toBe(true)
    expect(isAllowedButtonUrl('https://lin.ee/abc')).toBe(true)
    expect(isAllowedButtonUrl('line://ti/p/@abc')).toBe(true)
    expect(isAllowedButtonUrl('http://example.com')).toBe(false)
    expect(isAllowedButtonUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedButtonUrl('')).toBe(false)
  })
  it('認識しやすさの 3 段階（FR-3-4, Q13）', () => {
    expect(judgeTargetQuality(1200)).toBe('good')
    expect(judgeTargetQuality(400)).toBe('fair')
    expect(judgeTargetQuality(50)).toBe('poor')
  })
  it('JST 日付', () => {
    expect(toDayJst(new Date('2026-11-07T16:30:00Z'))).toBe('2026-11-08')
    expect(toDayJst(new Date('2026-11-07T14:59:00Z'))).toBe('2026-11-07')
  })
})

describe('ファイル判定', () => {
  it('マジックバイト', () => {
    expect(detectFileType(tinyPng())?.mime).toBe('image/png')
    expect(detectFileType(tinyGlb())?.mime).toBe('model/gltf-binary')
    expect(detectFileType(tinyMp4())?.mime).toBe('video/mp4')
    expect(detectFileType(tinyMp4('qt  '))?.mime).toBe('video/quicktime')
    expect(detectFileType(tinyMp4('heic'))).toBeNull()
    expect(detectFileType(Buffer.from('<html><body>x</body></html>'))).toBeNull()
    expect(looksLikeMind(tinyMind())).toBe(true)
    expect(looksLikeMind(tinyPng())).toBe(false)
  })
  it('寸法の読み取り（D-18）', () => {
    expect(imageDimensions(tinyPng(300, 200))).toEqual({ width: 300, height: 200 })
    expect(imageDimensions(tinyJpeg(640, 480))).toEqual({ width: 640, height: 480 })
    expect(imageDimensions(tinyGlb())).toBeNull()
  })
  it('先頭バイト列 + サイズでの検証（Blob 登録と共通）', () => {
    expect(validateAsset('target_image', tinyPng(100, 50), 1000)).toMatchObject({ mime: 'image/png', width: 100, height: 50 })
    expect(() => validateAsset('target_image', tinyPng(9000, 10), 1000)).toThrow(/8,000/)
    expect(() => validateAsset('overlay', tinyMp4(), 50 * 1024 * 1024 + 1)).toThrow(/50 MB/)
    expect(() => validateAsset('overlay', tinyMp4('qt  '), 100)).toThrow(/MOV/)
    expect(validateAsset('target_mind', tinyMind(), 100).ext).toBe('mind')
  })
})

describe('認証ユーティリティ', () => {
  it('scrypt ハッシュの照合', () => {
    const h = hashPassword('correct horse battery')
    expect(h.startsWith('scrypt$')).toBe(true)
    expect(verifyPassword('correct horse battery', h)).toBe(true)
    expect(verifyPassword('wrong', h)).toBe(false)
  })
  it('slug / token の形式', () => {
    expect(newSlug()).toMatch(/^[a-z0-9]{8}$/)
    expect(newToken()).toMatch(/^[A-Za-z0-9]{32}$/)
  })
})

describe('Vercel 構成の設定', () => {
  it('VERCEL=1 で必須の環境変数が無ければ明確なエラーになる', async () => {
    const base = { VERCEL: '1', DATA_DIR: '/tmp/nocode-ar-test-cfg' }
    await expect(createRuntime(loadConfig({ ...base }))).rejects.toThrow(/DATABASE_URL/)
    await expect(createRuntime(loadConfig({ ...base, DATABASE_URL: 'postgres://user:pass@localhost:1/db' }))).rejects.toThrow(/BLOB_READ_WRITE_TOKEN/)
  })
  it('設定の既定値（Vercel では Secure Cookie / trust proxy / 圧縮なし）', () => {
    const c = loadConfig({ VERCEL: '1', DATABASE_URL: 'postgres://x', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_dummy' })
    expect(c.isVercel).toBe(true)
    expect(c.cookieSecure).toBe(true)
    expect(c.trustProxy).toBe(true)
    expect(c.autoMigrate).toBe(false)
    const local = loadConfig({})
    expect(local.isVercel).toBe(false)
    expect(local.autoMigrate).toBe(true)
    expect(local.trustProxy).toBe('loopback')
  })
})
