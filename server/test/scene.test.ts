import { describe, expect, it } from 'vitest'
import { emptyScene, isAllowedButtonUrl, judgeTargetQuality, publishBlockers, sceneSchema, toDayJst } from '../../shared/src/index.js'
import { detectFileType, imageDimensions, looksLikeMind, sizeLimitError, validateAsset } from '../src/assets.js'
import { hashPassword, verifyPassword } from '../src/auth.js'
import { newSlug, newToken } from '../src/ids.js'
import { configFromEnv } from '../src/config.js'
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

describe('設定（configFromEnv）', () => {
  it('Worker では Secure Cookie、圧縮なし、X-Forwarded を信頼しない', () => {
    const c = configFromEnv({ DATABASE_URL: 'postgres://x', CRON_SECRET: 's' }, { runtime: 'worker' })
    expect(c).toMatchObject({ cookieSecure: true, compressResponses: false, trustProxy: false, autoMigrate: false, databaseUrl: 'postgres://x' })
  })
  it('Node ローカルでは PGlite 自動マイグレーション、圧縮あり、TRUST_PROXY 既定は loopback（D-22 / R5-M-04）', () => {
    const c = configFromEnv({}, { runtime: 'node' })
    expect(c).toMatchObject({ cookieSecure: false, compressResponses: true, trustProxy: 'loopback', autoMigrate: true, databaseUrl: null })
    expect(configFromEnv({ TRUST_PROXY: 'false' }, { runtime: 'node' }).trustProxy).toBe(false)
    expect(configFromEnv({ TRUST_PROXY: 'true' }, { runtime: 'node' }).trustProxy).toBe(true)
    expect(configFromEnv({ TRUST_PROXY: 'loopback' }, { runtime: 'node' }).trustProxy).toBe('loopback')
  })
  it('R5-M-02: 上限超過の文言は種類ごと', () => {
    expect(sizeLimitError('target_image').message).toBe('10 MB 以下の画像にしてください')
    expect(sizeLimitError('target_mind').message).toContain('20 MB')
    expect(sizeLimitError('overlay').message).toContain('動画 50 MB')
  })
})
