// Pure-TS port of the Type C parts of dawft (https://github.com/david47k/dawft).
// Handles: parsing the 1900-byte Type C header, decoding RLE_LINE and uncompressed
// RGB565 blobs, emitting standard 16-bit BI_BITFIELDS BMP files, and reconstructing
// watchface.txt.

export const TYPE_C_HEADER_SIZE = 1900
// RLE identifier is the u16 little-endian value 0x2108, i.e. bytes [0x08, 0x21]
// at the start of a compressed blob. We check the bytes directly inline.

// type → (defaultBlobCount, displayName).
// Synthesized from dawft.c dataTypes[] (see /tmp/dawft.c lines 186-254).
const TYPE_TABLE: Record<number, { count: number; name: string }> = {
  0x00: { count: 10, name: 'BACKGROUNDS' },
  0x01: { count: 1, name: 'BACKGROUND' },
  0x10: { count: 12, name: 'MONTH_NAME' },
  0x11: { count: 10, name: 'MONTH_NUM' },
  0x12: { count: 10, name: 'YEAR' },
  0x30: { count: 10, name: 'DAY_NUM' },
  0x40: { count: 10, name: 'TIME_H1' },
  0x41: { count: 10, name: 'TIME_H2' },
  0x43: { count: 10, name: 'TIME_M1' },
  0x44: { count: 10, name: 'TIME_M2' },
  0x45: { count: 1, name: 'TIME_AM' },
  0x46: { count: 1, name: 'TIME_PM' },
  0x60: { count: 7, name: 'DAY_NAME' },
  0x61: { count: 7, name: 'DAY_NAME_CN' },
  0x62: { count: 10, name: 'STEPS' },
  0x63: { count: 10, name: 'STEPS_CA' },
  0x64: { count: 10, name: 'STEPS_RA' },
  0x65: { count: 10, name: 'HR' },
  0x66: { count: 10, name: 'HR_CA' },
  0x67: { count: 10, name: 'HR_RA' },
  0x68: { count: 10, name: 'KCAL' },
  0x6b: { count: 10, name: 'MONTH_NUM_B' },
  0x6c: { count: 10, name: 'DAY_NUM_B' },
  0x70: { count: 11, name: 'STEPS_PROGBAR' },
  0x71: { count: 1, name: 'STEPS_LOGO' },
  0x72: { count: 10, name: 'STEPS_B' },
  0x73: { count: 10, name: 'STEPS_B_CA' },
  0x74: { count: 10, name: 'STEPS_B_RA' },
  0x76: { count: 10, name: 'STEPS_GOAL' },
  0x80: { count: 11, name: 'HR_PROGBAR' },
  0x81: { count: 1, name: 'HR_LOGO' },
  0x82: { count: 10, name: 'HR_B' },
  0x83: { count: 10, name: 'HR_B_CA' },
  0x84: { count: 10, name: 'HR_B_RA' },
  0x90: { count: 11, name: 'KCAL_PROGBAR' },
  0x91: { count: 1, name: 'KCAL_LOGO' },
  0x92: { count: 10, name: 'KCAL_B' },
  0x93: { count: 10, name: 'KCAL_B_CA' },
  0x94: { count: 10, name: 'KCAL_B_RA' },
  0xa0: { count: 11, name: 'DIST_PROGBAR' },
  0xa1: { count: 1, name: 'DIST_LOGO' },
  0xa2: { count: 10, name: 'DIST' },
  0xa3: { count: 10, name: 'DIST_CA' },
  0xa4: { count: 10, name: 'DIST_RA' },
  0xa5: { count: 1, name: 'DIST_KM' },
  0xa6: { count: 1, name: 'DIST_MI' },
  0xc0: { count: 1, name: 'BTLINK_UP' },
  0xc1: { count: 1, name: 'BTLINK_DOWN' },
  0xce: { count: 1, name: 'BATT_IMG' },
  0xd0: { count: 1, name: 'BATT_IMG_B' },
  0xd1: { count: 1, name: 'BATT_IMG_C' },
  0xd2: { count: 10, name: 'BATT' },
  0xd3: { count: 10, name: 'BATT_CA' },
  0xd4: { count: 10, name: 'BATT_RA' },
  0xd7: { count: 13, name: 'WEATHER_TEMP' },
  0xd8: { count: 13, name: 'WEATHER_TEMP_CA' },
  0xd9: { count: 13, name: 'WEATHER_TEMP_RA' },
  0xda: { count: 1, name: 'BATT_IMG_D' },
  0xf0: { count: 1, name: 'SEPERATOR' },
  0xf1: { count: 1, name: 'HAND_HOUR' },
  0xf2: { count: 1, name: 'HAND_MINUTE' },
  0xf3: { count: 1, name: 'HAND_SEC' },
  0xf4: { count: 1, name: 'HAND_PIN_UPPER' },
  0xf5: { count: 1, name: 'HAND_PIN_LOWER' },
  0xf6: { count: 1, name: 'TAP_TO_CHANGE' }, // overridden by animationFrames at runtime
  0xf7: { count: 1, name: 'ANIMATION' },
  0xf8: { count: 1, name: 'ANIMATION_F8' },
}

export const typeName = (type: number): string =>
  TYPE_TABLE[type]?.name ?? 'UNKNOWN'

export type FaceDataEntry = {
  type: number
  idx: number
  x: number
  y: number
  w: number
  h: number
}

export type FaceHeader = {
  fileID: number
  dataCount: number
  blobCount: number
  faceNumber: number
  faceData: FaceDataEntry[]
  offsets: number[]
  sizes: number[]
  animationFrames: number
}

export type Compression = 'RLE_LINE' | 'NONE'

export type DecodedBlob = {
  index: number
  faceDataIdx: number | null
  type: number | null
  typeName: string
  width: number | null
  height: number | null
  compression: Compression
  rawSize: number
  /** RGBA8888 preview buffer; null when the blob can't be decoded as a bitmap */
  rgba: Uint8ClampedArray | null
  raw: Uint8Array
}

export const parseHeader = (data: Uint8Array): FaceHeader => {
  if (data.byteLength < TYPE_C_HEADER_SIZE) {
    throw new Error(
      `File is ${data.byteLength} bytes, smaller than the 1900-byte Type C header.`,
    )
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  const fileID = view.getUint8(0)
  const dataCount = view.getUint8(1)
  const blobCount = view.getUint8(2)
  const faceNumber = view.getUint16(3, true)

  const faceData: FaceDataEntry[] = []
  for (let i = 0; i < 39; i++) {
    const base = 5 + i * 10
    faceData.push({
      type: view.getUint8(base),
      idx: view.getUint8(base + 1),
      x: view.getUint16(base + 2, true),
      y: view.getUint16(base + 4, true),
      w: view.getUint16(base + 6, true),
      h: view.getUint16(base + 8, true),
    })
  }

  const offsets: number[] = []
  for (let i = 0; i < 250; i++) offsets.push(view.getUint32(400 + i * 4, true))

  const sizes: number[] = []
  for (let i = 0; i < 250; i++) sizes.push(view.getUint16(1400 + i * 2, true))

  return {
    fileID,
    dataCount,
    blobCount,
    faceNumber,
    faceData,
    offsets,
    sizes,
    animationFrames: sizes[0],
  }
}

export const blobCountForType = (type: number, animationFrames: number): number => {
  if (type >= 0xf6 && type <= 0xf8) return Math.max(1, animationFrames)
  return TYPE_TABLE[type]?.count ?? 1
}

const findFaceDataIdx = (
  blobIdx: number,
  h: FaceHeader,
): number | null => {
  for (let i = 0; i < h.dataCount; i++) {
    const fd = h.faceData[i]
    const count = blobCountForType(fd.type, h.animationFrames)
    if (blobIdx >= fd.idx && blobIdx < fd.idx + count) return i
  }
  return null
}

const blobByteRange = (
  i: number,
  h: FaceHeader,
  fileSize: number,
): { start: number; end: number } => {
  const start = TYPE_C_HEADER_SIZE + h.offsets[i]
  let end: number
  if (i + 1 < h.blobCount && h.offsets[i + 1] !== 0) {
    end = TYPE_C_HEADER_SIZE + h.offsets[i + 1]
  } else {
    end = fileSize
  }
  return { start, end }
}

const rgb565ToRgba = (
  pixel: number,
  out: Uint8ClampedArray,
  outIdx: number,
): void => {
  // dawft stores pixels big-endian within each blob. Caller passes the assembled
  // value; the channel extraction matches RGB565to888 in dawft/bmp.c.
  const r5 = (pixel >> 11) & 0x1f
  const g6 = (pixel >> 5) & 0x3f
  const b5 = pixel & 0x1f
  out[outIdx] = (r5 << 3) | (r5 >> 2)
  out[outIdx + 1] = (g6 << 2) | (g6 >> 4)
  out[outIdx + 2] = (b5 << 3) | (b5 >> 2)
  out[outIdx + 3] = 0xff
}

/** Decode an uncompressed RGB565 (big-endian per pixel) blob to RGBA8888. */
const decodeUncompressed = (
  src: Uint8Array,
  width: number,
  height: number,
): Uint8ClampedArray | null => {
  if (src.byteLength < width * height * 2) return null
  const out = new Uint8ClampedArray(width * height * 4)
  let s = 0
  for (let p = 0; p < width * height; p++) {
    const pixel = (src[s] << 8) | src[s + 1]
    rgb565ToRgba(pixel, out, p * 4)
    s += 2
  }
  return out
}

/** Decode RLE_LINE-encoded blob (Type C default) to RGBA8888. */
const decodeRleLine = (
  src: Uint8Array,
  width: number,
  height: number,
): Uint8ClampedArray | null => {
  // 0x2108 identifier, then height u16 LE entries giving each row's exclusive
  // end offset (measured from the start of the blob), then the RLE triplet
  // stream itself (high, low, count).
  const tableEnd = 2 + height * 2
  if (src.byteLength < tableEnd) return null

  const lineEnds: number[] = []
  for (let y = 0; y < height; y++) {
    lineEnds.push(src[2 + y * 2] | (src[2 + y * 2 + 1] << 8))
  }

  const out = new Uint8ClampedArray(width * height * 4)
  let s = tableEnd
  for (let y = 0; y < height; y++) {
    const rowEnd = lineEnds[y]
    let written = 0
    while (s < rowEnd) {
      if (s + 2 >= src.byteLength) return null
      const high = src[s]
      const low = src[s + 1]
      const count = src[s + 2]
      const pixel = (high << 8) | low
      for (let k = 0; k < count && written < width; k++) {
        rgb565ToRgba(pixel, out, (y * width + written) * 4)
        written += 1
      }
      s += 3
    }
    // pad any leftover row width with the last seen pixel's transparent black
    while (written < width) {
      out[(y * width + written) * 4 + 3] = 0xff
      written += 1
    }
  }
  return out
}

const decodeBlobPixels = (
  src: Uint8Array,
  width: number,
  height: number,
): { compression: Compression; rgba: Uint8ClampedArray | null } => {
  if (src.byteLength >= 2 && src[0] === 0x08 && src[1] === 0x21) {
    return { compression: 'RLE_LINE', rgba: decodeRleLine(src, width, height) }
  }
  return { compression: 'NONE', rgba: decodeUncompressed(src, width, height) }
}

export const decodeFile = (data: Uint8Array): {
  header: FaceHeader
  blobs: DecodedBlob[]
} => {
  const header = parseHeader(data)
  const blobs: DecodedBlob[] = []

  for (let i = 0; i < header.blobCount; i++) {
    const range = blobByteRange(i, header, data.byteLength)
    const raw = data.subarray(range.start, range.end)
    const fdIdx = findFaceDataIdx(i, header)
    let width: number | null = null
    let height: number | null = null
    let type: number | null = null
    let name = 'UNKNOWN'

    if (fdIdx !== null) {
      const fd = header.faceData[fdIdx]
      type = fd.type
      name = typeName(fd.type)
      width = fd.w
      height = fd.h
    } else if (i === header.blobCount - 1) {
      // dawft assumes the trailing blob with no faceData entry is a 140x163
      // preview thumbnail used by the watch's face picker.
      width = 140
      height = 163
      name = 'PREVIEW'
    }

    let compression: Compression = 'NONE'
    let rgba: Uint8ClampedArray | null = null
    if (width !== null && height !== null) {
      const decoded = decodeBlobPixels(raw, width, height)
      compression = decoded.compression
      rgba = decoded.rgba
    } else if (raw.length >= 2 && raw[0] === 0x08 && raw[1] === 0x21) {
      compression = 'RLE_LINE'
    }

    blobs.push({
      index: i,
      faceDataIdx: fdIdx,
      type,
      typeName: name,
      width,
      height,
      compression,
      rawSize: raw.byteLength,
      rgba,
      raw,
    })
  }

  return { header, blobs }
}

// ---------- BMP encoder ----------

/**
 * Encode an RGBA8888 buffer to a 16-bit BI_BITFIELDS BMP file (RGB565 LE).
 * This matches the format dawft produces (and consumes via newImgFromFile),
 * so the resulting files round-trip through `dawft create`.
 */
export const encodeBmpRgb565 = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array => {
  const rowBytes = ((width * 2 + 3) & ~3) >>> 0
  const pixelDataSize = rowBytes * height
  const fileHeaderSize = 14
  const dibHeaderSize = 40
  const masksSize = 12
  const offsetToPixels = fileHeaderSize + dibHeaderSize + masksSize
  const fileSize = offsetToPixels + pixelDataSize

  const out = new Uint8Array(fileSize)
  const view = new DataView(out.buffer)

  // BITMAPFILEHEADER
  out[0] = 0x42 // 'B'
  out[1] = 0x4d // 'M'
  view.setUint32(2, fileSize, true)
  view.setUint16(6, 0, true)
  view.setUint16(8, 0, true)
  view.setUint32(10, offsetToPixels, true)

  // BITMAPINFOHEADER
  view.setUint32(14, dibHeaderSize, true)
  view.setInt32(18, width, true)
  view.setInt32(22, -height, true) // negative = top-down rows
  view.setUint16(26, 1, true) // planes
  view.setUint16(28, 16, true) // bpp
  view.setUint32(30, 3, true) // BI_BITFIELDS
  view.setUint32(34, pixelDataSize, true)
  view.setUint32(38, 2835, true) // 72 DPI
  view.setUint32(42, 2835, true)
  view.setUint32(46, 0, true)
  view.setUint32(50, 0, true)

  // RGB565 bitfield masks
  view.setUint32(54, 0xf800, true) // R
  view.setUint32(58, 0x07e0, true) // G
  view.setUint32(62, 0x001f, true) // B

  // pixel data, RGB565 little-endian, top-down
  let p = offsetToPixels
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const r5 = (rgba[i] >> 3) & 0x1f
      const g6 = (rgba[i + 1] >> 2) & 0x3f
      const b5 = (rgba[i + 2] >> 3) & 0x1f
      const pixel = (r5 << 11) | (g6 << 5) | b5
      out[p] = pixel & 0xff
      out[p + 1] = (pixel >> 8) & 0xff
      p += 2
    }
    // pad to 4-byte row alignment
    p += rowBytes - width * 2
  }

  return out
}

// ---------- watchface.txt builder ----------

const padNum = (n: number, w: number): string => String(n).padStart(w, '0')
const padRight = (s: string, w: number): string =>
  s.length >= w ? s : s + ' '.repeat(w - s.length)
const padLeft = (s: string, w: number): string =>
  s.length >= w ? s : ' '.repeat(w - s.length) + s

/** Emit the same watchface.txt format that `dawft dump` writes. */
export const buildWatchfaceTxt = (
  header: FaceHeader,
  blobs: DecodedBlob[],
): string => {
  const lines: string[] = []
  lines.push(`fileType        C`)
  lines.push(`fileID          0x${header.fileID.toString(16).padStart(2, '0')}`)
  lines.push(`dataCount       ${header.dataCount}`)
  lines.push(`blobCount       ${header.blobCount}`)
  lines.push(`faceNumber      ${header.faceNumber}`)
  lines.push('')
  lines.push('#               TYPE  INDEX      X    Y    W    H')

  for (let i = 0; i < header.dataCount; i++) {
    const fd = header.faceData[i]
    const type = `0x${fd.type.toString(16).padStart(2, '0')}`
    const idx = padNum(fd.idx, 3)
    const x = padLeft(String(fd.x), 4)
    const y = padLeft(String(fd.y), 4)
    const w = padLeft(String(fd.w), 4)
    const h = padLeft(String(fd.h), 4)
    const name = padRight(typeName(fd.type), 15)
    lines.push(`faceData        ${type}    ${idx}   ${x} ${y} ${w} ${h}          # ${name}`)
  }

  if (header.animationFrames > 0) {
    lines.push(`animationFrames ${header.animationFrames}`)
  }

  lines.push('')
  lines.push('#             INDEX  CTYPE')
  for (const b of blobs) {
    lines.push(
      `blobCompression ${padNum(b.index, 3)}  ${padRight(b.compression, 9)}`,
    )
  }
  lines.push('')
  return lines.join('\n')
}

// ---------- watchface.txt parser (pack input) ----------

const parseNumericToken = (s: string): number => {
  if (s.startsWith('0x') || s.startsWith('0X')) return parseInt(s.substring(2), 16)
  return parseInt(s, 10)
}

const typeCodeByName: Record<string, number> = (() => {
  const m: Record<string, number> = {}
  for (const [code, info] of Object.entries(TYPE_TABLE)) {
    m[info.name] = parseInt(code, 10)
  }
  return m
})()

const parseFaceDataTypeToken = (s: string): number => {
  if (/^0x/i.test(s)) return parseInt(s.substring(2), 16)
  if (s in typeCodeByName) return typeCodeByName[s]
  return parseInt(s, 10)
}

export type ParsedWatchfaceTxt = {
  fileType: string
  fileID: number
  faceNumber: number
  blobCount: number
  animationFrames: number
  faceData: (FaceDataEntry & { blobFileName?: string })[]
  compressions: Map<number, Compression>
}

/** Parse a dawft-style `watchface.txt` back into a structured config. */
export const parseWatchfaceTxt = (text: string): ParsedWatchfaceTxt => {
  const result: ParsedWatchfaceTxt = {
    fileType: 'C',
    fileID: 0x81,
    faceNumber: 0,
    blobCount: 0,
    animationFrames: 0,
    faceData: [],
    compressions: new Map(),
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const tokens = line.split(/\s+/)
    const key = tokens[0]

    switch (key) {
      case 'fileType':
        result.fileType = tokens[1] ?? 'C'
        break
      case 'fileID':
        result.fileID = parseNumericToken(tokens[1])
        break
      case 'faceNumber':
        result.faceNumber = parseNumericToken(tokens[1])
        break
      case 'blobCount':
        result.blobCount = parseNumericToken(tokens[1])
        break
      case 'dataCount':
        // recomputed from faceData.length, ignore the file's number
        break
      case 'animationFrames':
        result.animationFrames = parseNumericToken(tokens[1])
        break
      case 'faceData': {
        if (tokens.length < 7) continue
        const entry: FaceDataEntry & { blobFileName?: string } = {
          type: parseFaceDataTypeToken(tokens[1]),
          idx: parseNumericToken(tokens[2]),
          x: parseNumericToken(tokens[3]),
          y: parseNumericToken(tokens[4]),
          w: parseNumericToken(tokens[5]),
          h: parseNumericToken(tokens[6]),
        }
        // Optional 8th token is a filename (not a comment).
        if (tokens.length >= 8 && !tokens[7].startsWith('#')) {
          entry.blobFileName = tokens[7]
        }
        result.faceData.push(entry)
        break
      }
      case 'blobCompression': {
        if (tokens.length < 3) continue
        const idx = parseNumericToken(tokens[1])
        const mode = tokens[2]
        if (mode === 'RLE_LINE' || mode === 'TRY_RLE' || mode === 'RLE_BASIC') {
          result.compressions.set(idx, 'RLE_LINE')
        } else {
          result.compressions.set(idx, 'NONE')
        }
        break
      }
    }
  }

  return result
}

// ---------- RLE_LINE encoder (pack) ----------

/**
 * Port of dawft's `compressImg` (RLE_LINE). Returns null if the image is too
 * large for 16-bit row-end offsets — caller should fall back to uncompressed.
 */
export const encodeRleLine = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array | null => {
  const minSize = 2 + height * 2 + Math.ceil(width / 255) * 3 * height
  if (minSize > 65535) return null

  const maxSize = 2 + height * 2 + width * height * 3
  const buf = new Uint8Array(maxSize)

  buf[0] = 0x08
  buf[1] = 0x21

  let offset = 2 + 2 * height

  for (let y = 0; y < height; y++) {
    let prevHi = 0
    let prevLo = 0
    let runLength = 0

    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const r5 = (rgba[i] >> 3) & 0x1f
      const g6 = (rgba[i + 1] >> 2) & 0x3f
      const b5 = (rgba[i + 2] >> 3) & 0x1f
      const pixel = (r5 << 11) | (g6 << 5) | b5
      const hi = (pixel >> 8) & 0xff
      const lo = pixel & 0xff

      if (x === 0) {
        prevHi = hi
        prevLo = lo
        runLength = 1
        continue
      }
      if (hi !== prevHi || lo !== prevLo) {
        buf[offset] = prevHi
        buf[offset + 1] = prevLo
        buf[offset + 2] = runLength
        offset += 3
        prevHi = hi
        prevLo = lo
        runLength = 1
      } else {
        runLength++
        if (runLength === 255) {
          buf[offset] = prevHi
          buf[offset + 1] = prevLo
          buf[offset + 2] = runLength
          offset += 3
          runLength = 0
        }
      }
    }

    if (runLength > 0) {
      buf[offset] = prevHi
      buf[offset + 1] = prevLo
      buf[offset + 2] = runLength
      offset += 3
    }

    if (offset > 65535) return null
    // line-end offset (exclusive byte index past this row's last triplet)
    buf[2 + y * 2] = offset & 0xff
    buf[2 + y * 2 + 1] = (offset >> 8) & 0xff
  }

  return buf.subarray(0, offset)
}

/** Uncompressed RGB565 BE pixel stream (no header), row by row. */
export const encodeRgb565Raw = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array => {
  const out = new Uint8Array(width * height * 2)
  let p = 0
  for (let i = 0; i < width * height; i++) {
    const r5 = (rgba[i * 4] >> 3) & 0x1f
    const g6 = (rgba[i * 4 + 1] >> 2) & 0x3f
    const b5 = (rgba[i * 4 + 2] >> 3) & 0x1f
    const pixel = (r5 << 11) | (g6 << 5) | b5
    out[p++] = (pixel >> 8) & 0xff
    out[p++] = pixel & 0xff
  }
  return out
}

// ---------- Type C .bin writer ----------

export type PackTypeCBlob =
  | { kind: 'bitmap'; width: number; height: number; rgba: Uint8ClampedArray }
  /** Pre-formed blob bytes — written into the output unchanged. Used when the
   *  dump produced a `.raw` for an undecodable blob (e.g. trailing previews). */
  | { kind: 'raw'; data: Uint8Array }

export type PackTypeCInput = {
  config: ParsedWatchfaceTxt
  /** One entry per blob index (0..blobCount-1). */
  blobs: PackTypeCBlob[]
}

/** Assemble a Type C .bin file from a parsed watchface.txt and decoded BMPs. */
export const packTypeC = ({ config, blobs }: PackTypeCInput): Uint8Array => {
  const blobCount = config.blobCount || blobs.length
  if (blobs.length < blobCount) {
    throw new Error(
      `Need ${blobCount} blobs but only ${blobs.length} were supplied.`,
    )
  }

  // Encode every blob, choosing RLE if it shrinks the data (dawft's behaviour).
  const compressedBlobs: Uint8Array[] = []
  for (let i = 0; i < blobCount; i++) {
    const input = blobs[i]
    if (input.kind === 'raw') {
      compressedBlobs.push(input.data)
      continue
    }
    const { width, height, rgba } = input
    const requested = config.compressions.get(i) ?? 'RLE_LINE'
    if (requested === 'NONE') {
      compressedBlobs.push(encodeRgb565Raw(rgba, width, height))
      continue
    }
    const rle = encodeRleLine(rgba, width, height)
    const raw = encodeRgb565Raw(rgba, width, height)
    // dawft falls back to raw if RLE didn't actually save space.
    if (!rle || rle.byteLength >= raw.byteLength) {
      compressedBlobs.push(raw)
    } else {
      compressedBlobs.push(rle)
    }
  }

  // Compute offsets table (relative to end of 1900-byte header).
  const offsets: number[] = []
  const sizes: number[] = []
  let running = 0
  for (let i = 0; i < blobCount; i++) {
    offsets.push(running)
    sizes.push(compressedBlobs[i].byteLength)
    running += compressedBlobs[i].byteLength
  }

  const totalSize = TYPE_C_HEADER_SIZE + running
  const out = new Uint8Array(totalSize)
  const view = new DataView(out.buffer)

  // ----- header -----
  out[0] = config.fileID
  out[1] = config.faceData.length
  out[2] = blobCount
  view.setUint16(3, config.faceNumber, true)

  // FaceData[39] — 10 bytes each, starting at offset 5
  for (let i = 0; i < 39; i++) {
    const base = 5 + i * 10
    if (i < config.faceData.length) {
      const fd = config.faceData[i]
      out[base] = fd.type
      out[base + 1] = fd.idx
      view.setUint16(base + 2, fd.x, true)
      view.setUint16(base + 4, fd.y, true)
      view.setUint16(base + 6, fd.w, true)
      view.setUint16(base + 8, fd.h, true)
    }
    // remaining entries left as zero
  }
  // padding[5] at offset 395 stays zero

  // offsets[250] at offset 400, u32 each
  for (let i = 0; i < 250; i++) {
    if (i < offsets.length) view.setUint32(400 + i * 4, offsets[i], true)
  }
  // sizes[250] at offset 1400, u16 each
  for (let i = 0; i < 250; i++) {
    if (i < sizes.length) view.setUint16(1400 + i * 2, sizes[i], true)
  }
  // Type C convention: sizes[0] holds the animation frame count
  if (config.animationFrames > 0) {
    view.setUint16(1400, config.animationFrames, true)
  }

  // ----- blob payload -----
  let p = TYPE_C_HEADER_SIZE
  for (const blob of compressedBlobs) {
    out.set(blob, p)
    p += blob.byteLength
  }

  return out
}
