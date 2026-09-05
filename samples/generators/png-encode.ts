/**
 * Minimal pure-TypeScript PNG encoder — no native deps.
 * Encodes an RGBA pixel buffer into a valid PNG binary (Node Buffer).
 *
 * Supports: 8-bit RGBA, filter type 0 (None) for all rows.
 * Uses Node's built-in zlib for DEFLATE compression.
 */
import { deflateSync } from "zlib";

// ── CRC32 lookup table ─────────────────────────────────────────────────────
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Uint8Array | Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (CRC_TABLE[(crc ^ (buf[i]!)) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Uint8Array | Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBytes, data, crcBuf]);
}

/**
 * Encode an RGBA pixel array to a PNG Buffer.
 * @param rgba  Uint8ClampedArray of length width * height * 4
 * @param width  image width in pixels
 * @param height image height in pixels
 */
export function encodePng(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): Buffer {
  // ── PNG signature ─────────────────────────────────────────────────────────
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // ── IHDR ──────────────────────────────────────────────────────────────────
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8);   // bit depth
  ihdrData.writeUInt8(2, 9);   // color type: RGB (no alpha in output, keeps file smaller)
  ihdrData.writeUInt8(0, 10);  // compression
  ihdrData.writeUInt8(0, 11);  // filter method
  ihdrData.writeUInt8(0, 12);  // interlace: none

  // ── IDAT (raw image data → filter byte per row → deflate) ─────────────────
  // For color type 2 (RGB), each pixel is 3 bytes; filter byte 0 (None) per row
  const rawSize = height * (1 + width * 3);
  const raw = Buffer.alloc(rawSize);
  let pos = 0;
  for (let row = 0; row < height; row++) {
    raw[pos++] = 0; // filter byte: None
    for (let col = 0; col < width; col++) {
      const srcIdx = (row * width + col) * 4;
      raw[pos++] = rgba[srcIdx]!;     // R
      raw[pos++] = rgba[srcIdx + 1]!; // G
      raw[pos++] = rgba[srcIdx + 2]!; // B
      // alpha channel dropped — output is RGB
    }
  }

  const compressed = deflateSync(raw, { level: 6 });

  // ── IEND ──────────────────────────────────────────────────────────────────
  return Buffer.concat([
    signature,
    makeChunk("IHDR", ihdrData),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}
