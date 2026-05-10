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

const blobCountForType = (type: number, animationFrames: number): number => {
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
