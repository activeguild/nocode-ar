// テスト用フィクスチャを生成する（リポジトリにはバイナリを入れない）。
//   node scripts/gen-fixtures.mjs [outDir]   既定: e2e/.fixtures
// - target.png   : 特徴点の多い「チラシ風」のターゲット画像（512x640）
// - plain.png    : 単色に近い「認識しにくい」画像
// - overlay.png  : オーバーレイ用の小さな画像
// - sample.glb   : 最小の GLB（三角形）
// - camera.y4m   : target.png を中央に置いた 640x480 のフェイクカメラ映像（Chromium の --use-file-for-fake-video-capture 用）
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const outDir = path.resolve(process.argv[2] ?? 'e2e/.fixtures')
fs.mkdirSync(outDir, { recursive: true })

// ---- 疑似乱数（決定的）
let seed = 20261107
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0x100000000
}

class Raster {
  constructor(w, h, fill = [255, 255, 255]) {
    this.w = w
    this.h = h
    this.data = new Uint8Array(w * h * 3)
    for (let i = 0; i < w * h; i++) this.data.set(fill, i * 3)
  }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    this.data.set(c, (y * this.w + x) * 3)
  }
  rect(x0, y0, w, h, c) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c)
  }
  circle(cx, cy, r, c) {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.set(x, y, c)
  }
  tri(x0, y0, size, c) {
    for (let y = 0; y < size; y++) for (let x = -y / 2; x <= y / 2; x++) this.set(Math.round(x0 + x), y0 + y, c)
  }
}

function pngEncode(r) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(r.w, 0)
  ihdr.writeUInt32BE(r.h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  const raw = Buffer.alloc((r.w * 3 + 1) * r.h)
  for (let y = 0; y < r.h; y++) {
    raw[y * (r.w * 3 + 1)] = 0
    Buffer.from(r.data.buffer, y * r.w * 3, r.w * 3).copy(raw, y * (r.w * 3 + 1) + 1)
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))])
}

// ---- ターゲット画像（チラシ風: 色ブロック、写真風ノイズ、図形、文字風の細かい矩形）
const W = 512
const H = 640
const target = new Raster(W, H, [250, 250, 248])
target.rect(0, 0, W, 90, [24, 64, 160]) // ヘッダー帯
for (let i = 0; i < 26; i++) target.rect(20 + i * 18, 30 + Math.round(rand() * 20), 10, 14 + Math.round(rand() * 16), [255, 255, 255]) // 見出し文字風
// 写真風ブロック（ノイズ + 図形）
for (let y = 110; y < 330; y++)
  for (let x = 30; x < W - 30; x++) {
    const v = 90 + Math.floor(rand() * 80)
    target.set(x, y, [v, Math.min(255, v + 40), Math.max(0, v - 30)])
  }
for (let i = 0; i < 40; i++) {
  const c = [Math.floor(rand() * 255), Math.floor(rand() * 255), Math.floor(rand() * 255)]
  const k = rand()
  if (k < 0.4) target.rect(30 + Math.floor(rand() * 420), 110 + Math.floor(rand() * 190), 8 + Math.floor(rand() * 50), 8 + Math.floor(rand() * 50), c)
  else if (k < 0.8) target.circle(40 + Math.floor(rand() * 400), 120 + Math.floor(rand() * 180), 4 + Math.floor(rand() * 22), c)
  else target.tri(60 + Math.floor(rand() * 380), 110 + Math.floor(rand() * 160), 10 + Math.floor(rand() * 40), c)
}
// 本文の文字風
for (let line = 0; line < 12; line++) {
  let x = 30
  const y = 360 + line * 20
  while (x < W - 40) {
    const w = 6 + Math.floor(rand() * 26)
    target.rect(x, y, w, 10, [40, 40, 48])
    x += w + 6 + Math.floor(rand() * 8)
  }
}
// 右下: QR 風の格子（印刷物に QR を入れた想定）
for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) if (rand() < 0.5 || x < 7 && y < 7) target.rect(380 + x * 5, 520 + y * 5, 5, 5, [0, 0, 0])
target.rect(30, 600, 300, 26, [200, 30, 60])
fs.writeFileSync(path.join(outDir, 'target.png'), pngEncode(target))

// ---- 認識しにくい画像（薄いグラデーションのみ）
const plain = new Raster(512, 512)
for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) plain.set(x, y, [240, 240 - (y >> 5), 245])
fs.writeFileSync(path.join(outDir, 'plain.png'), pngEncode(plain))

// ---- オーバーレイ画像（160x90、赤枠に黄色の丸）
const ov = new Raster(160, 90, [220, 40, 40])
ov.circle(80, 45, 30, [255, 220, 40])
fs.writeFileSync(path.join(outDir, 'overlay.png'), pngEncode(ov))

// ---- 最小 GLB（三角形）
{
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const bin = Buffer.from(positions.buffer)
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
    buffers: [{ byteLength: bin.length }],
  }
  let js = JSON.stringify(json)
  while (js.length % 4) js += ' '
  const jb = Buffer.from(js)
  const total = 12 + 8 + jb.length + 8 + bin.length
  const header = Buffer.alloc(12)
  header.write('glTF', 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(total, 8)
  const c1 = Buffer.alloc(8)
  c1.writeUInt32LE(jb.length, 0)
  c1.write('JSON', 4)
  const c2 = Buffer.alloc(8)
  c2.writeUInt32LE(bin.length, 0)
  c2.write('BIN\0', 4)
  fs.writeFileSync(path.join(outDir, 'sample.glb'), Buffer.concat([header, c1, jb, c2, bin]))
}

// ---- フェイクカメラ映像（y4m, 640x480, 2 フレーム）。ターゲットを中央に高さ 400px で配置
{
  const FW = 640
  const FH = 480
  const frame = new Raster(FW, FH, [120, 120, 120])
  const th = 400
  const tw = Math.round((th * W) / H)
  const ox = Math.round((FW - tw) / 2)
  const oy = Math.round((FH - th) / 2)
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++) {
      const sx = Math.floor((x / tw) * W)
      const sy = Math.floor((y / th) * H)
      const i = (sy * W + sx) * 3
      frame.set(ox + x, oy + y, [target.data[i], target.data[i + 1], target.data[i + 2]])
    }
  const Y = Buffer.alloc(FW * FH)
  const U = Buffer.alloc((FW / 2) * (FH / 2))
  const V = Buffer.alloc((FW / 2) * (FH / 2))
  for (let y = 0; y < FH; y++)
    for (let x = 0; x < FW; x++) {
      const i = (y * FW + x) * 3
      const r = frame.data[i]
      const g = frame.data[i + 1]
      const b = frame.data[i + 2]
      Y[y * FW + x] = Math.max(16, Math.min(235, Math.round(0.257 * r + 0.504 * g + 0.098 * b + 16)))
      if (x % 2 === 0 && y % 2 === 0) {
        const j = (y / 2) * (FW / 2) + x / 2
        U[j] = Math.max(16, Math.min(240, Math.round(-0.148 * r - 0.291 * g + 0.439 * b + 128)))
        V[j] = Math.max(16, Math.min(240, Math.round(0.439 * r - 0.368 * g - 0.071 * b + 128)))
      }
    }
  const header = Buffer.from(`YUV4MPEG2 W${FW} H${FH} F30:1 Ip A1:1 C420jpeg\n`)
  const f = Buffer.concat([Buffer.from('FRAME\n'), Y, U, V])
  fs.writeFileSync(path.join(outDir, 'camera.y4m'), Buffer.concat([header, f, f]))
}

console.log(`fixtures written to ${outDir}`)
