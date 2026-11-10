import zlib from 'node:zlib'
import { encode } from '@msgpack/msgpack'

export { zlib }

/** 最小の有効な PNG（1x1、RGBA）。width / height を指定すると IHDR のみその寸法になる（サーバはデコードしない） */
export function tinyPng(width = 1, height = 1): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.from([0, 255, 0, 0, 255])
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** SOF0 を含む JPEG の先頭（寸法だけ読める。画像データは無い） */
export function tinyJpeg(width = 640, height = 480): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])
  const sof = Buffer.alloc(19)
  sof.writeUInt16BE(0xffc0, 0)
  sof.writeUInt16BE(17, 2)
  sof[4] = 8
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  sof[9] = 3
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xda, 0x00, 0x08]), Buffer.alloc(32), Buffer.from([0xff, 0xd9])])
}

/** SOF の無い JPEG 風ヘッダ（寸法が読めない） */
export function tinyJpegHeader(): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)])
}

export function tinyGlb(): Buffer {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' } }).padEnd(32, ' '))
  const header = Buffer.alloc(12)
  header.write('glTF', 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + json.length, 8)
  const c = Buffer.alloc(8)
  c.writeUInt32LE(json.length, 0)
  c.write('JSON', 4)
  return Buffer.concat([header, c, json])
}

export function tinyMp4(brand = 'isom'): Buffer {
  const b = Buffer.alloc(64)
  b.writeUInt32BE(32, 0)
  b.write('ftyp', 4)
  b.write(brand, 8)
  return b
}

export function tinyMind(padding = 0): Buffer {
  const trackingData = Array.from({ length: padding }, (_, i) => i % 7)
  return Buffer.from(encode({ v: 2, dataList: [{ targetImage: { width: 10, height: 10 }, trackingData, matchingData: [] }] }))
}
