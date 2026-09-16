// One-off generator for the tray icon: a 64x64 chat-bubble mark as a
// PNG-in-ICO (Vista+ supports embedded PNG for 64px icons), emitted as the
// base64 constant in packages/bundle/web-app/src/tray-icon.ts.
// Run: node scripts/gen-tray-icon.mjs  — then paste the printed constant.
import { deflateSync } from 'node:zlib'

const S = 64
const px = new Uint8Array(S * S * 4)

function set(x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= S || y >= S) return
  const at = (y * S + x) * 4
  px[at] = r; px[at + 1] = g; px[at + 2] = b; px[at + 3] = a
}

// Rounded-rect membership with a radius, hard edges.
function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || y < y0 || x > x1 || y > y1) return false
  const cx = Math.max(x0 + r, Math.min(x, x1 - r))
  const cy = Math.max(y0 + r, Math.min(y, y1 - r))
  const dx = x - cx, dy = y - cy
  return dx * dx + dy * dy <= r * r
}

const BG = [15, 98, 254, 255]      // brand blue
const FG = [255, 255, 255, 255]    // white bubble
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    if (inRoundedRect(x, y, 4, 4, 59, 59, 14)) set(x, y, BG)
    // Chat bubble body with a tail: body 12..52 x 14..38 (r 6), tail triangle below-left.
    if (inRoundedRect(x, y, 12, 14, 52, 38, 6)) set(x, y, FG)
    const inTail = x >= 18 && x <= 30 && y > 38 && y <= 52 && (y - 38) >= Math.abs(24 - x) * 1.4 - 2
    if (inTail) set(x, y, FG)
    // Three dots punched out of the bubble body.
    for (const dx of [22, 32, 42]) {
      const ddx = x - dx, ddy = y - 26
      if (ddx * ddx + ddy * ddy <= 9) set(x, y, BG)
    }
  }
}

// PNG: filter-0 scanlines, deflate, CRC32-chunked.
function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xFFFFFFFF
  for (const byte of buf) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
const raw = Buffer.alloc(S * (S * 4 + 1))
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1)
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8; ihdr[9] = 6 // 8-bit RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
])

// ICO container wrapping the PNG (single 64px image).
const dir = Buffer.alloc(6); dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(1, 4)
const entry = Buffer.alloc(16)
entry[0] = S; entry[1] = S; entry[2] = 0; entry[3] = 0
entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6)
entry.writeUInt32LE(png.length, 8); entry.writeUInt32LE(22, 12)
const ico = Buffer.concat([dir, entry, png])

console.log(`// Generated 64x64 chat-bubble tray mark (PNG-in-ICO), base64 of ${ico.length} bytes.`)
console.log(`export const TRAY_ICON_BASE64 =`)
console.log(`  '${ico.toString('base64')}'`)
