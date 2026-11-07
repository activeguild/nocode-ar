import zlib from 'node:zlib'
import { encode } from '@msgpack/msgpack'

export { zlib }

/** 最小の有効な PNG（1x1、RGBA） */
export function tinyPng(): Buffer {
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
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.from([0, 255, 0, 0, 255])
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

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

export function tinyMind(): Buffer {
  return Buffer.from(encode({ v: 2, dataList: [{ targetImage: { width: 10, height: 10 }, trackingData: [], matchingData: [] }] }))
}
