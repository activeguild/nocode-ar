import { describe, expect, it } from 'vitest'
import { emptyScene, isAllowedButtonUrl, judgeTargetQuality, publishBlockers, sceneSchema, toDayJst } from '../../shared/src/index.ts'
import { detectFileType, looksLikeMind } from '../src/assets.ts'
import { hashPassword, verifyPassword } from '../src/auth.ts'
import { newSlug, newToken } from '../src/ids.ts'
import { tinyGlb, tinyMind, tinyMp4, tinyPng } from './fixtures.ts'

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
  it('ボタン URL の許容（FR-5-2, R10）', () => {
    expect(isAllowedButtonUrl('https://example.com/form')).toBe(true)
    expect(isAllowedButtonUrl('https://line.me/R/ti/p/@abc')).toBe(true)
    expect(isAllowedButtonUrl('https://lin.ee/abc')).toBe(true)
    expect(isAllowedButtonUrl('line://ti/p/@abc')).toBe(true)
    expect(isAllowedButtonUrl('http://example.com')).toBe(false)
    expect(isAllowedButtonUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedButtonUrl('')).toBe(false)
  })
  it('認識しやすさの 3 段階（FR-3-4）', () => {
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
    expect(detectFileType(Buffer.from('<html><body>x</body></html>'))).toBeNull()
    expect(looksLikeMind(tinyMind())).toBe(true)
    expect(looksLikeMind(tinyPng())).toBe(false)
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
