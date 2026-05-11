// Pure-TS port of the FaceN parts of extrathundertool
// (https://github.com/david47k/extrathundertool). FaceN is the "newer" Mo Young /
// Da Fit watch-face binary format: 16-byte top header, optional digits section
// at `dh_offset`, variable-length element records at `bh_offset` terminated by
// {0, 0}. Image data is ARGB8565 RLE ("RleNew"), distinct from dawft's RGB565
// RLE_LINE format.

export const FACEN_HEADER_SIZE = 16

export type FaceNHeader = {
  apiVer: number
  unknown: number
  previewOffset: number
  previewWidth: number
  previewHeight: number
  digitsHeaderOffset: number
  binaryHeaderOffset: number
}

export type ImgRef = {
  /** File-absolute offset of the compressed image data (start of the row table). 0 = unset. */
  offset: number
  width: number
  height: number
  /** Total compressed size in bytes (row table + RLE pixel data). */
  rawSize: number
  /** RGBA8888 pixels (top-down). null if decode failed. */
  rgba: Uint8ClampedArray | null
}

export type XY = { x: number; y: number }

export type FaceNDigitsSet = {
  digitSet: number
  digits: ImgRef[] // 10 entries
  unknown: number
}

export type Align = 'L' | 'R' | 'C'

const decodeAlign = (a: number): Align => (a === 1 ? 'R' : a === 2 ? 'C' : 'L')

export type FaceNElement =
  | {
      kind: 'Image'
      eType: 0
      x: number
      y: number
      img: ImgRef
    }
  | {
      kind: 'TimeNum'
      eType: 2
      digitSets: [number, number, number, number]
      xys: [XY, XY, XY, XY]
      padding: Uint8Array
    }
  | {
      kind: 'DayName'
      eType: 4
      nType: number
      x: number
      y: number
      imgs: ImgRef[] // 7 entries (Sun..Sat)
    }
  | {
      kind: 'BatteryFill'
      eType: 5
      x: number
      y: number
      bgImg: ImgRef
      x1: number
      y1: number
      x2: number
      y2: number
      unknown0: number
      unknown1: number
      img1: ImgRef
      img2: ImgRef
    }
  | {
      kind: 'HeartRateNum'
      eType: 6
      digitSet: number
      align: Align
      x: number
      y: number
    }
  | {
      kind: 'StepsNum'
      eType: 7
      digitSet: number
      align: Align
      x: number
      y: number
    }
  | {
      kind: 'KCalNum'
      eType: 9
      digitSet: number
      align: Align
      x: number
      y: number
    }
  | {
      kind: 'TimeHand'
      eType: 10
      hType: number // 0=hour 1=minute 2=second
      pivotX: number
      pivotY: number
      img: ImgRef
      x: number
      y: number
    }
  | {
      kind: 'DayNum'
      eType: 13
      digitSet: number
      align: Align
      xys: [XY, XY]
    }
  | {
      kind: 'MonthNum'
      eType: 15
      digitSet: number
      align: Align
      xys: [XY, XY]
    }
  | {
      kind: 'BarDisplay'
      eType: 18
      bType: number // data source: 0=Steps 2=KCal 5=HeartRate 6=Battery
      count: number
      x: number
      y: number
      imgs: ImgRef[]
    }
  | {
      kind: 'Weather'
      eType: 27
      count: number
      x: number
      y: number
      imgs: ImgRef[]
    }
  | { kind: 'Unknown29'; eType: 29; unknown: number }
  | {
      kind: 'Dash'
      eType: 35
      img: ImgRef
    }
  | { kind: 'Unknown'; eType: number; raw: Uint8Array }

export type FaceN = {
  header: FaceNHeader
  preview: ImgRef
  digitSets: FaceNDigitsSet[]
  elements: FaceNElement[]
}

// ---------- format detection ----------

export type DetectedFormat = 'typeC' | 'faceN' | 'unknown'

export const detectFormat = (data: Uint8Array): DetectedFormat => {
  if (data.byteLength < 16) return 'unknown'
  const fileID = data[0]
  if (fileID === 0x81 || fileID === 0x04 || fileID === 0x84) return 'typeC'
  // FaceN has a small api_ver (typically 1) at byte 0, then a sane bh_offset
  // at bytes 14-15 pointing somewhere into the file beyond the 16-byte header.
  const apiVer = data[0] | (data[1] << 8)
  if (apiVer > 0 && apiVer < 0x100) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const bhOffset = view.getUint16(14, true)
    if (bhOffset >= 16 && bhOffset < data.byteLength) return 'faceN'
  }
  return 'unknown'
}

// ---------- RLE decoder ----------

/**
 * Decode an ARGB8565 "RleNew" blob to RGBA8888.
 * Layout per dawft/extrathundertool:
 *   - first `height * 4` bytes are a per-row offset/size table (we don't need
 *     it for sequential decoding, only to compute total blob size — already
 *     done by parseImgRef)
 *   - then a stream of cmd bytes:
 *       cmd & 0x80 → repeat (cmd & 0x7F) copies of the next 3-byte pixel
 *       cmd & 0x80 == 0 → next (cmd) pixels are literal 3-byte values
 *   - each pixel is 3 bytes: [alpha, RGB565_high, RGB565_low]
 */
const decodeRleNew = (
  pixelStream: Uint8Array,
  width: number,
  height: number,
): Uint8ClampedArray | null => {
  const totalPixels = width * height
  const out = new Uint8ClampedArray(totalPixels * 4)
  let s = 0
  let p = 0

  while (p < totalPixels) {
    if (s >= pixelStream.byteLength) return null
    const cmd = pixelStream[s++]
    if (cmd & 0x80) {
      const count = cmd & 0x7f
      if (s + 3 > pixelStream.byteLength) return null
      const a = pixelStream[s]
      const hi = pixelStream[s + 1]
      const lo = pixelStream[s + 2]
      s += 3
      const pixel = (hi << 8) | lo
      const r5 = (pixel >> 11) & 0x1f
      const g6 = (pixel >> 5) & 0x3f
      const b5 = pixel & 0x1f
      const r8 = (r5 << 3) | (r5 >> 2)
      const g8 = (g6 << 2) | (g6 >> 4)
      const b8 = (b5 << 3) | (b5 >> 2)
      for (let k = 0; k < count && p < totalPixels; k++) {
        const o = p * 4
        out[o] = r8
        out[o + 1] = g8
        out[o + 2] = b8
        out[o + 3] = a
        p++
      }
    } else {
      const count = cmd
      if (s + count * 3 > pixelStream.byteLength) return null
      for (let k = 0; k < count && p < totalPixels; k++) {
        const a = pixelStream[s]
        const hi = pixelStream[s + 1]
        const lo = pixelStream[s + 2]
        s += 3
        const pixel = (hi << 8) | lo
        const r5 = (pixel >> 11) & 0x1f
        const g6 = (pixel >> 5) & 0x3f
        const b5 = pixel & 0x1f
        const o = p * 4
        out[o] = (r5 << 3) | (r5 >> 2)
        out[o + 1] = (g6 << 2) | (g6 >> 4)
        out[o + 2] = (b5 << 3) | (b5 >> 2)
        out[o + 3] = a
        p++
      }
    }
  }
  return out
}

// ---------- ImgRef parser (decodes blob in place) ----------

const parseImgRef = (
  data: Uint8Array,
  view: DataView,
  owhOffset: number,
): ImgRef => {
  if (owhOffset + 8 > data.byteLength) {
    return { offset: 0, width: 0, height: 0, rawSize: 0, rgba: null }
  }
  const offset = view.getUint32(owhOffset, true)
  const width = view.getUint16(owhOffset + 4, true)
  const height = view.getUint16(owhOffset + 6, true)

  if (offset === 0 || width === 0 || height === 0) {
    return { offset, width, height, rawSize: 0, rgba: null }
  }

  // Compute total blob size from the last row table entry (per
  // ImgData::get_data_size in extrathundertool/img_data.rs).
  const headerSize = height * 4
  const lastEntry = offset + headerSize - 4
  if (lastEntry + 4 > data.byteLength) {
    return { offset, width, height, rawSize: 0, rgba: null }
  }
  const lastOffsetLo = view.getUint16(lastEntry, true)
  const lastSizeRaw = view.getUint16(lastEntry + 2, true)
  const lastOffset = lastOffsetLo + ((lastSizeRaw & 0x1f) << 16)
  const lastSize = lastSizeRaw >> 5
  const totalBlobSize = lastOffset + lastSize // header + data
  if (offset + totalBlobSize > data.byteLength) {
    return { offset, width, height, rawSize: 0, rgba: null }
  }

  const pixelStream = data.subarray(offset + headerSize, offset + totalBlobSize)
  const rgba = decodeRleNew(pixelStream, width, height)

  return { offset, width, height, rawSize: totalBlobSize, rgba }
}

// ---------- header + sections ----------

const parseHeader = (data: Uint8Array, view: DataView): FaceNHeader => {
  if (data.byteLength < FACEN_HEADER_SIZE) {
    throw new Error('File smaller than 16-byte FaceN header.')
  }
  return {
    apiVer: view.getUint16(0, true),
    unknown: view.getUint16(2, true),
    previewOffset: view.getUint32(4, true),
    previewWidth: view.getUint16(8, true),
    previewHeight: view.getUint16(10, true),
    digitsHeaderOffset: view.getUint16(12, true),
    binaryHeaderOffset: view.getUint16(14, true),
  }
}

// 1 byte digitSet index + 10 × 8-byte OWH + 2-byte unknown = 83 bytes
const DIGIT_SET_RECORD_SIZE = 83

const parseDigitSets = (
  data: Uint8Array,
  view: DataView,
  start: number,
  end: number,
): FaceNDigitsSet[] => {
  const sets: FaceNDigitsSet[] = []
  if (start === 0) return sets
  // dawft.face::FaceN::from_bin notes the "0x0101" intro sequence then loops.
  let off = start
  const intro = view.getUint16(off, true)
  if (intro !== 0x0101) {
    console.warn(
      `[FaceN] unexpected digits-section intro: 0x${intro.toString(16)}`,
    )
  }
  off += 2

  let setIdx = 0
  while (off + DIGIT_SET_RECORD_SIZE <= end) {
    const declaredSet = data[off]
    const digits: ImgRef[] = []
    for (let i = 0; i < 10; i++) {
      digits.push(parseImgRef(data, view, off + 1 + i * 8))
    }
    const unknown = view.getUint16(off + 81, true)
    sets.push({ digitSet: declaredSet, digits, unknown })
    if (declaredSet !== setIdx) {
      console.warn(
        `[FaceN] digit set index mismatch at ${off}: file says ${declaredSet}, expected ${setIdx}`,
      )
    }
    setIdx++
    off += DIGIT_SET_RECORD_SIZE
  }
  return sets
}

// ---------- element parser ----------

/** Static sizes for elements whose layout is fixed. Variable-size elements
 *  (BarDisplay, Weather) compute their size from a count field. */
const STATIC_ELEMENT_SIZE: Record<number, number> = {
  0: 14, // Image
  2: 34, // TimeNum
  4: 63, // DayName
  5: 42, // BatteryFill
  6: 26, // HeartRateNum
  7: 26, // StepsNum
  9: 19, // KCalNum
  10: 19, // TimeHand
  13: 12, // DayNum
  15: 12, // MonthNum
  29: 3, // Unknown29
  35: 10, // Dash
}

const parseElement = (
  data: Uint8Array,
  view: DataView,
  base: number,
): { el: FaceNElement; size: number } | null => {
  if (base + 2 > data.byteLength) return null
  const eType = data[base + 1]
  const offset = base + 2

  switch (eType) {
    case 0: {
      // Image: x u16, y u16, OWH (8)
      return {
        el: {
          kind: 'Image',
          eType: 0,
          x: view.getUint16(offset, true),
          y: view.getUint16(offset + 2, true),
          img: parseImgRef(data, view, offset + 4),
        },
        size: STATIC_ELEMENT_SIZE[0],
      }
    }
    case 2: {
      // TimeNum: digit_sets[4] u8 + xys[4] (4 each = 16) + padding[12]
      const digitSets: [number, number, number, number] = [
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
      ]
      const xys: [XY, XY, XY, XY] = [0, 1, 2, 3].map((i) => ({
        x: view.getUint16(offset + 4 + i * 4, true),
        y: view.getUint16(offset + 4 + i * 4 + 2, true),
      })) as [XY, XY, XY, XY]
      const padding = data.slice(offset + 20, offset + 32)
      return {
        el: { kind: 'TimeNum', eType: 2, digitSets, xys, padding },
        size: STATIC_ELEMENT_SIZE[2],
      }
    }
    case 4: {
      // DayName: nType u8 + x u16 + y u16 + 7 × OWH (56)
      const nType = data[offset]
      const x = view.getUint16(offset + 1, true)
      const y = view.getUint16(offset + 3, true)
      const imgs: ImgRef[] = []
      for (let i = 0; i < 7; i++) {
        imgs.push(parseImgRef(data, view, offset + 5 + i * 8))
      }
      return {
        el: { kind: 'DayName', eType: 4, nType, x, y, imgs },
        size: STATIC_ELEMENT_SIZE[4],
      }
    }
    case 5: {
      // BatteryFill: x u16, y u16, OWH bg, x1 u8, y1 u8, x2 u8, y2 u8,
      //              unknown0 u32, unknown1 u32, OWH img1, OWH img2
      const x = view.getUint16(offset, true)
      const y = view.getUint16(offset + 2, true)
      const bgImg = parseImgRef(data, view, offset + 4)
      const x1 = data[offset + 12]
      const y1 = data[offset + 13]
      const x2 = data[offset + 14]
      const y2 = data[offset + 15]
      const unknown0 = view.getUint32(offset + 16, true)
      const unknown1 = view.getUint32(offset + 20, true)
      const img1 = parseImgRef(data, view, offset + 24)
      const img2 = parseImgRef(data, view, offset + 32)
      return {
        el: {
          kind: 'BatteryFill',
          eType: 5,
          x,
          y,
          bgImg,
          x1,
          y1,
          x2,
          y2,
          unknown0,
          unknown1,
          img1,
          img2,
        },
        size: STATIC_ELEMENT_SIZE[5],
      }
    }
    case 6:
    case 7: {
      // Heart-rate / steps: digitSet, align, x u16, y u16, padding[18]
      const kind = eType === 6 ? 'HeartRateNum' : 'StepsNum'
      return {
        el: {
          kind,
          eType,
          digitSet: data[offset],
          align: decodeAlign(data[offset + 1]),
          x: view.getUint16(offset + 2, true),
          y: view.getUint16(offset + 4, true),
        } as FaceNElement,
        size: STATIC_ELEMENT_SIZE[eType],
      }
    }
    case 9: {
      // KCal: digitSet, align, x u16, y u16, padding[11]
      return {
        el: {
          kind: 'KCalNum',
          eType: 9,
          digitSet: data[offset],
          align: decodeAlign(data[offset + 1]),
          x: view.getUint16(offset + 2, true),
          y: view.getUint16(offset + 4, true),
        },
        size: STATIC_ELEMENT_SIZE[9],
      }
    }
    case 10: {
      // TimeHand: hType u8, pivotX u16, pivotY u16, OWH (8), x u16, y u16
      return {
        el: {
          kind: 'TimeHand',
          eType: 10,
          hType: data[offset],
          pivotX: view.getUint16(offset + 1, true),
          pivotY: view.getUint16(offset + 3, true),
          img: parseImgRef(data, view, offset + 5),
          x: view.getUint16(offset + 13, true),
          y: view.getUint16(offset + 15, true),
        },
        size: STATIC_ELEMENT_SIZE[10],
      }
    }
    case 13:
    case 15: {
      // DayNum / MonthNum: digitSet, align, xy[2]
      const xys: [XY, XY] = [
        {
          x: view.getUint16(offset + 2, true),
          y: view.getUint16(offset + 4, true),
        },
        {
          x: view.getUint16(offset + 6, true),
          y: view.getUint16(offset + 8, true),
        },
      ]
      return {
        el: {
          kind: eType === 13 ? 'DayNum' : 'MonthNum',
          eType,
          digitSet: data[offset],
          align: decodeAlign(data[offset + 1]),
          xys,
        } as FaceNElement,
        size: STATIC_ELEMENT_SIZE[eType],
      }
    }
    case 18: {
      // BarDisplay: bType, count, x u16, y u16, count × OWH
      const bType = data[offset]
      const count = data[offset + 1]
      const x = view.getUint16(offset + 2, true)
      const y = view.getUint16(offset + 4, true)
      const imgs: ImgRef[] = []
      for (let i = 0; i < count; i++) {
        imgs.push(parseImgRef(data, view, offset + 6 + i * 8))
      }
      return {
        el: { kind: 'BarDisplay', eType: 18, bType, count, x, y, imgs },
        size: 8 + count * 8,
      }
    }
    case 27: {
      // Weather: count, x u16, y u16, count × OWH
      const count = data[offset]
      const x = view.getUint16(offset + 1, true)
      const y = view.getUint16(offset + 3, true)
      const imgs: ImgRef[] = []
      for (let i = 0; i < count; i++) {
        imgs.push(parseImgRef(data, view, offset + 5 + i * 8))
      }
      return {
        el: { kind: 'Weather', eType: 27, count, x, y, imgs },
        size: 7 + count * 8,
      }
    }
    case 29: {
      return {
        el: { kind: 'Unknown29', eType: 29, unknown: data[offset] },
        size: STATIC_ELEMENT_SIZE[29],
      }
    }
    case 35: {
      return {
        el: { kind: 'Dash', eType: 35, img: parseImgRef(data, view, offset) },
        size: STATIC_ELEMENT_SIZE[35],
      }
    }
    default:
      // We don't know the size, so we can't safely advance. Caller should bail.
      return null
  }
}

const parseElements = (
  data: Uint8Array,
  view: DataView,
  start: number,
): FaceNElement[] => {
  const elements: FaceNElement[] = []
  let off = start
  while (off + 1 < data.byteLength) {
    const one = data[off]
    if (one === 0) break // {0,0} terminator
    const result = parseElement(data, view, off)
    if (!result) {
      console.warn(
        `[FaceN] unknown element type ${data[off + 1]} at offset ${off}; stopping`,
      )
      elements.push({
        kind: 'Unknown',
        eType: data[off + 1],
        raw: data.slice(off, Math.min(off + 32, data.byteLength)),
      })
      break
    }
    elements.push(result.el)
    off += result.size
  }
  return elements
}

// ---------- top-level entry point ----------

export const parseFaceN = (data: Uint8Array): FaceN => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const header = parseHeader(data, view)

  // Preview image (its OWH sits at bytes 4..12 of the file header)
  const preview = parseImgRef(data, view, 4)

  const digitSets = parseDigitSets(
    data,
    view,
    header.digitsHeaderOffset,
    header.binaryHeaderOffset,
  )

  const elements = parseElements(data, view, header.binaryHeaderOffset)

  return { header, preview, digitSets, elements }
}

// ---------- BMP encoder (32-bit BGRA, BI_BITFIELDS, V4 header) ----------

/**
 * Encode an RGBA8888 buffer to a 32-bit BMP file with alpha. Matches the
 * format extrathundertool produces (compatible with `dawft create` consumers).
 */
export const encodeBmp32 = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array => {
  const rowBytes = width * 4 // already 4-byte aligned
  const pixelDataSize = rowBytes * height
  const fileHeaderSize = 14
  const dibHeaderSize = 108 // BITMAPV4HEADER
  const offsetToPixels = fileHeaderSize + dibHeaderSize
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

  // BITMAPV4HEADER
  view.setUint32(14, dibHeaderSize, true)
  view.setInt32(18, width, true)
  view.setInt32(22, -height, true) // negative = top-down
  view.setUint16(26, 1, true) // planes
  view.setUint16(28, 32, true) // bpp
  view.setUint32(30, 3, true) // BI_BITFIELDS
  view.setUint32(34, pixelDataSize, true)
  view.setUint32(38, 2835, true) // 72 DPI
  view.setUint32(42, 2835, true)
  view.setUint32(46, 0, true) // clrUsed
  view.setUint32(50, 0, true) // clrImportant
  // BGRA8888 channel masks
  view.setUint32(54, 0x00ff0000, true) // R
  view.setUint32(58, 0x0000ff00, true) // G
  view.setUint32(62, 0x000000ff, true) // B
  view.setUint32(66, 0xff000000, true) // A
  // CSType + bV4Endpoints[9] + gammas[3] left zeroed (54 + 4 mask bytes already filled)

  // Pixel data: BGRA per pixel, top-down rows.
  let p = offsetToPixels
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    out[p] = rgba[o + 2] // B
    out[p + 1] = rgba[o + 1] // G
    out[p + 2] = rgba[o] // R
    out[p + 3] = rgba[o + 3] // A
    p += 4
  }

  return out
}

// ---------- watchface.json builder (matches extrathundertool output) ----------

/**
 * Produce a JSON document mirroring extrathundertool's `watchface.json` schema
 * (field names from `FaceN` in face.rs and the elements in elements.rs).
 * The image data itself is omitted (#[serde(skip)]) — only file references go
 * into the JSON, with the actual pixel bytes shipped as separate BMP files
 * in the ZIP.
 */
export const buildFaceNJson = (
  face: FaceN,
  fileNames: {
    preview: string
    digits: string[][] // [setIdx][digitIdx]
    elements: (string | string[] | null)[] // index-aligned to face.elements
  },
): string => {
  const json: Record<string, unknown> = {
    type_str: 'extrathunder watchface',
    rev: 0,
    tpls: 0,
    api_ver: face.header.apiVer,
    unknown: face.header.unknown,
    preview_img_data: {
      w: face.preview.width,
      h: face.preview.height,
      file_name: fileNames.preview,
    },
    digits: face.digitSets.map((set, sIdx) => ({
      img_data: set.digits.map((d, dIdx) => ({
        w: d.width,
        h: d.height,
        file_name: fileNames.digits[sIdx]?.[dIdx] ?? null,
      })),
      unknown: set.unknown,
    })),
    elements: face.elements.map((el, eIdx) => {
      const fname = fileNames.elements[eIdx]
      switch (el.kind) {
        case 'Image':
          return {
            e_type: 'image',
            x: el.x,
            y: el.y,
            img_data: { w: el.img.width, h: el.img.height, file_name: fname },
          }
        case 'TimeNum':
          return {
            e_type: 'time_num',
            digit_sets: el.digitSets,
            xys: el.xys,
            unknown: Array.from(el.padding),
          }
        case 'DayName':
          return {
            e_type: 'day_name',
            n_type: el.nType,
            x: el.x,
            y: el.y,
            img_data: el.imgs.map((img, i) => ({
              w: img.width,
              h: img.height,
              file_name: Array.isArray(fname) ? fname[i] : null,
            })),
          }
        case 'BatteryFill': {
          const names = Array.isArray(fname) ? fname : []
          return {
            e_type: 'battery_fill',
            x: el.x,
            y: el.y,
            img_data: {
              w: el.bgImg.width,
              h: el.bgImg.height,
              file_name: names[0] ?? null,
            },
            x1: el.x1,
            y1: el.y1,
            x2: el.x2,
            y2: el.y2,
            unknown0: el.unknown0,
            unknown1: el.unknown1,
            image_data1: {
              w: el.img1.width,
              h: el.img1.height,
              file_name: names[1] ?? null,
            },
            image_data2: {
              w: el.img2.width,
              h: el.img2.height,
              file_name: names[2] ?? null,
            },
          }
        }
        case 'HeartRateNum':
        case 'StepsNum':
        case 'KCalNum':
          return {
            e_type:
              el.kind === 'HeartRateNum'
                ? 'heart_rate_num'
                : el.kind === 'StepsNum'
                  ? 'steps_num'
                  : 'k_cal_num',
            digit_set: el.digitSet,
            align: el.align === 'L' ? 0 : el.align === 'R' ? 1 : 2,
            x: el.x,
            y: el.y,
          }
        case 'TimeHand':
          return {
            e_type: 'time_hand',
            h_type: el.hType,
            unknown_x: el.pivotX,
            unknown_y: el.pivotY,
            img_data: {
              w: el.img.width,
              h: el.img.height,
              file_name: fname,
            },
            x: el.x,
            y: el.y,
          }
        case 'DayNum':
        case 'MonthNum':
          return {
            e_type: el.kind === 'DayNum' ? 'day_num' : 'month_num',
            digit_set: el.digitSet,
            align: el.align === 'L' ? 0 : el.align === 'R' ? 1 : 2,
            xys: el.xys,
          }
        case 'BarDisplay':
          return {
            e_type: 'bar_display',
            b_type: el.bType,
            count: el.count,
            x: el.x,
            y: el.y,
            img_data: el.imgs.map((img, i) => ({
              w: img.width,
              h: img.height,
              file_name: Array.isArray(fname) ? fname[i] : null,
            })),
          }
        case 'Weather':
          return {
            e_type: 'weather',
            count: el.count,
            x: el.x,
            y: el.y,
            img_data: el.imgs.map((img, i) => ({
              w: img.width,
              h: img.height,
              file_name: Array.isArray(fname) ? fname[i] : null,
            })),
          }
        case 'Unknown29':
          return { e_type: 'unknown29', unknown: el.unknown }
        case 'Dash':
          return {
            e_type: 'dash',
            img_data: {
              w: el.img.width,
              h: el.img.height,
              file_name: fname,
            },
          }
        case 'Unknown':
          return { e_type: 'unknown', e_type_byte: el.eType }
      }
    }),
  }
  return JSON.stringify(json, null, 2)
}

// Helper to flatten everything into a list of (filename, blob) pairs for ZIP.
export type BlobFile = {
  name: string
  width: number
  height: number
  rgba: Uint8ClampedArray | null
}

export const collectBlobs = (
  face: FaceN,
): { files: BlobFile[]; names: Parameters<typeof buildFaceNJson>[1] } => {
  const files: BlobFile[] = []
  const previewName = 'preview.bmp'
  files.push({
    name: previewName,
    width: face.preview.width,
    height: face.preview.height,
    rgba: face.preview.rgba,
  })

  const digitNames: string[][] = []
  face.digitSets.forEach((set, sIdx) => {
    const row: string[] = []
    set.digits.forEach((d, dIdx) => {
      const name = `digit_${sIdx}_${dIdx}.bmp`
      files.push({ name, width: d.width, height: d.height, rgba: d.rgba })
      row.push(name)
    })
    digitNames.push(row)
  })

  const counters = {
    image: 0,
    day_name: 0,
    battery_fill: 0,
    bar_display: 0,
  }
  const elementNames: (string | string[] | null)[] = []
  face.elements.forEach((el) => {
    switch (el.kind) {
      case 'Image': {
        const name = `image_${counters.image++}.bmp`
        files.push({
          name,
          width: el.img.width,
          height: el.img.height,
          rgba: el.img.rgba,
        })
        elementNames.push(name)
        break
      }
      case 'DayName': {
        const idx = counters.day_name++
        const names = el.imgs.map((img, i) => {
          const n = `day_name_${idx}_${i}.bmp`
          files.push({ name: n, width: img.width, height: img.height, rgba: img.rgba })
          return n
        })
        elementNames.push(names)
        break
      }
      case 'BatteryFill': {
        const idx = counters.battery_fill++
        const names = [el.bgImg, el.img1, el.img2].map((img, i) => {
          const n = `battery_fill_${idx}_${i}.bmp`
          files.push({ name: n, width: img.width, height: img.height, rgba: img.rgba })
          return n
        })
        elementNames.push(names)
        break
      }
      case 'TimeHand': {
        const n = `time_hand_${el.hType}.bmp`
        files.push({
          name: n,
          width: el.img.width,
          height: el.img.height,
          rgba: el.img.rgba,
        })
        elementNames.push(n)
        break
      }
      case 'BarDisplay': {
        const names = el.imgs.map((img, i) => {
          const n = `bar_display_${el.bType}_${i}.bmp`
          files.push({ name: n, width: img.width, height: img.height, rgba: img.rgba })
          return n
        })
        elementNames.push(names)
        break
      }
      case 'Weather': {
        const names = el.imgs.map((img, i) => {
          const n = `weather_${i}.bmp`
          files.push({ name: n, width: img.width, height: img.height, rgba: img.rgba })
          return n
        })
        elementNames.push(names)
        break
      }
      case 'Dash': {
        const n = `dash.bmp`
        files.push({
          name: n,
          width: el.img.width,
          height: el.img.height,
          rgba: el.img.rgba,
        })
        elementNames.push(n)
        break
      }
      default:
        elementNames.push(null)
    }
  })

  return { files, names: { preview: previewName, digits: digitNames, elements: elementNames } }
}

// ---------- watchface.json parser (pack input) ----------

const alignFromNumber = (n: unknown): Align => (n === 1 ? 'R' : n === 2 ? 'C' : 'L')

/** A parsed `watchface.json` describes layout + per-image filename references.
 *  Pixel data is loaded separately from the matching BMP files. */
export type ParsedWatchfaceJson = {
  apiVer: number
  unknown: number
  previewName: string | null
  previewW: number
  previewH: number
  digitSets: { unknown: number; digits: { w: number; h: number; fileName: string | null }[] }[]
  elements: ParsedElement[]
}

type WH = { w: number; h: number; fileName: string | null }

export type ParsedElement =
  | { kind: 'Image'; x: number; y: number; img: WH }
  | { kind: 'TimeNum'; digitSets: [number, number, number, number]; xys: XY[]; unknown: Uint8Array }
  | { kind: 'DayName'; nType: number; x: number; y: number; imgs: WH[] }
  | {
      kind: 'BatteryFill'
      x: number
      y: number
      bgImg: WH
      x1: number
      y1: number
      x2: number
      y2: number
      unknown0: number
      unknown1: number
      img1: WH
      img2: WH
    }
  | { kind: 'HeartRateNum'; digitSet: number; align: Align; x: number; y: number }
  | { kind: 'StepsNum'; digitSet: number; align: Align; x: number; y: number }
  | { kind: 'KCalNum'; digitSet: number; align: Align; x: number; y: number }
  | { kind: 'TimeHand'; hType: number; pivotX: number; pivotY: number; img: WH; x: number; y: number }
  | { kind: 'DayNum'; digitSet: number; align: Align; xys: [XY, XY] }
  | { kind: 'MonthNum'; digitSet: number; align: Align; xys: [XY, XY] }
  | { kind: 'BarDisplay'; bType: number; count: number; x: number; y: number; imgs: WH[] }
  | { kind: 'Weather'; count: number; x: number; y: number; imgs: WH[] }
  | { kind: 'Unknown29'; unknown: number }
  | { kind: 'Dash'; img: WH }

// Convert an arbitrary JSON img_data shape to our local WH.
const toWH = (v: unknown): WH => {
  if (!v || typeof v !== 'object') return { w: 0, h: 0, fileName: null }
  const o = v as Record<string, unknown>
  return {
    w: typeof o.w === 'number' ? o.w : 0,
    h: typeof o.h === 'number' ? o.h : 0,
    fileName: typeof o.file_name === 'string' ? o.file_name : null,
  }
}

const toXY = (v: unknown): XY => {
  if (!v || typeof v !== 'object') return { x: 0, y: 0 }
  const o = v as Record<string, unknown>
  return {
    x: typeof o.x === 'number' ? o.x : 0,
    y: typeof o.y === 'number' ? o.y : 0,
  }
}

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

export const parseWatchfaceJson = (text: string): ParsedWatchfaceJson => {
  const data = JSON.parse(text) as Record<string, unknown>

  const preview = (data.preview_img_data ?? {}) as Record<string, unknown>
  const digitsRaw = Array.isArray(data.digits) ? data.digits : []
  const elementsRaw = Array.isArray(data.elements) ? data.elements : []

  const digitSets = digitsRaw.map((set) => {
    const s = set as Record<string, unknown>
    const list = Array.isArray(s.img_data) ? s.img_data : []
    return {
      unknown: num(s.unknown),
      digits: list.slice(0, 10).map(toWH),
    }
  })

  const elements: ParsedElement[] = elementsRaw.map((el) => {
    const e = el as Record<string, unknown>
    const eType = e.e_type
    switch (eType) {
      case 'image':
        return { kind: 'Image', x: num(e.x), y: num(e.y), img: toWH(e.img_data) }
      case 'time_num': {
        const sets = Array.isArray(e.digit_sets) ? e.digit_sets : [0, 0, 0, 0]
        const xys = Array.isArray(e.xys) ? e.xys.map(toXY) : []
        const unkArr = Array.isArray(e.unknown) ? e.unknown : []
        return {
          kind: 'TimeNum',
          digitSets: [num(sets[0]), num(sets[1]), num(sets[2]), num(sets[3])],
          xys: [xys[0] ?? { x: 0, y: 0 }, xys[1] ?? { x: 0, y: 0 }, xys[2] ?? { x: 0, y: 0 }, xys[3] ?? { x: 0, y: 0 }],
          unknown: new Uint8Array(unkArr.slice(0, 12).map((v) => num(v))),
        }
      }
      case 'day_name': {
        const list = Array.isArray(e.img_data) ? e.img_data : []
        return {
          kind: 'DayName',
          nType: num(e.n_type),
          x: num(e.x),
          y: num(e.y),
          imgs: list.slice(0, 7).map(toWH),
        }
      }
      case 'battery_fill':
        return {
          kind: 'BatteryFill',
          x: num(e.x),
          y: num(e.y),
          bgImg: toWH(e.img_data),
          x1: num(e.x1),
          y1: num(e.y1),
          x2: num(e.x2),
          y2: num(e.y2),
          unknown0: num(e.unknown0),
          unknown1: num(e.unknown1),
          img1: toWH(e.image_data1),
          img2: toWH(e.image_data2),
        }
      case 'heart_rate_num':
        return { kind: 'HeartRateNum', digitSet: num(e.digit_set), align: alignFromNumber(e.align), x: num(e.x), y: num(e.y) }
      case 'steps_num':
        return { kind: 'StepsNum', digitSet: num(e.digit_set), align: alignFromNumber(e.align), x: num(e.x), y: num(e.y) }
      case 'k_cal_num':
        return { kind: 'KCalNum', digitSet: num(e.digit_set), align: alignFromNumber(e.align), x: num(e.x), y: num(e.y) }
      case 'time_hand':
        return {
          kind: 'TimeHand',
          hType: num(e.h_type),
          pivotX: num(e.unknown_x),
          pivotY: num(e.unknown_y),
          img: toWH(e.img_data),
          x: num(e.x),
          y: num(e.y),
        }
      case 'day_num':
      case 'month_num': {
        const xys = Array.isArray(e.xys) ? e.xys.map(toXY) : []
        return {
          kind: eType === 'day_num' ? 'DayNum' : 'MonthNum',
          digitSet: num(e.digit_set),
          align: alignFromNumber(e.align),
          xys: [xys[0] ?? { x: 0, y: 0 }, xys[1] ?? { x: 0, y: 0 }],
        }
      }
      case 'bar_display': {
        const list = Array.isArray(e.img_data) ? e.img_data : []
        return {
          kind: 'BarDisplay',
          bType: num(e.b_type),
          count: num(e.count, list.length),
          x: num(e.x),
          y: num(e.y),
          imgs: list.map(toWH),
        }
      }
      case 'weather': {
        const list = Array.isArray(e.img_data) ? e.img_data : []
        return {
          kind: 'Weather',
          count: num(e.count, list.length),
          x: num(e.x),
          y: num(e.y),
          imgs: list.map(toWH),
        }
      }
      case 'unknown29':
        return { kind: 'Unknown29', unknown: num(e.unknown) }
      case 'dash':
        return { kind: 'Dash', img: toWH(e.img_data) }
      default:
        // Skip unknown e_type — caller will see fewer elements but pack continues.
        return { kind: 'Unknown29', unknown: 0 }
    }
  })

  return {
    apiVer: num(data.api_ver, 1),
    unknown: num(data.unknown, 0),
    previewName: typeof preview.file_name === 'string' ? preview.file_name : null,
    previewW: num(preview.w),
    previewH: num(preview.h),
    digitSets,
    elements,
  }
}

// ---------- RleNew encoder (pack) ----------

/** Convert an RGBA8888 buffer to a contiguous ARGB8565 byte stream
 *  (3 bytes per pixel, top-down). Alpha first, then RGB565 high, then low. */
const rgbaToArgb8565 = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array => {
  const out = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4]
    const g = rgba[i * 4 + 1]
    const b = rgba[i * 4 + 2]
    const a = rgba[i * 4 + 3]
    const r5 = (r >> 3) & 0x1f
    const g6 = (g >> 2) & 0x3f
    const b5 = (b >> 3) & 0x1f
    const rgb565 = (r5 << 11) | (g6 << 5) | b5
    out[i * 3] = a
    out[i * 3 + 1] = (rgb565 >> 8) & 0xff
    out[i * 3 + 2] = rgb565 & 0xff
  }
  return out
}

const pixelsEqual = (buf: Uint8Array, a: number, b: number): boolean =>
  buf[a] === buf[b] && buf[a + 1] === buf[b + 1] && buf[a + 2] === buf[b + 2]

/**
 * Port of extrathundertool's `argb8565_to_rle_new`. Per row, emits cmd bytes
 * where `cmd & 0x80` means run-length-(cmd&0x7F) of the following pixel and
 * otherwise means a literal-N stretch. Returns `{ header, data }` where the
 * 4-byte-per-row header packs `(offset << 0, size << 5)` into a u32.
 */
export const encodeRleNew = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): { header: Uint8Array; data: Uint8Array } => {
  if (width === 0 || height === 0) {
    return { header: new Uint8Array(0), data: new Uint8Array(0) }
  }
  const argb = rgbaToArgb8565(rgba, width, height)
  const rowWidth = width * 3
  const dataParts: number[] = []
  const header = new Uint8Array(height * 4)
  let destOffset = height * 4

  for (let y = 0; y < height; y++) {
    const rowStart = y * rowWidth
    const rowBefore = dataParts.length
    let offset = 0

    while (offset <= rowWidth - 9) {
      const pA = rowStart + offset
      const pB = pA + 3
      const pC = pB + 3
      if (pixelsEqual(argb, pA, pB) && pixelsEqual(argb, pB, pC)) {
        // Repeating block
        let count = 2
        offset += 6
        while (count < 127 && offset <= rowWidth - 3) {
          if (!pixelsEqual(argb, rowStart + offset, pA)) break
          count++
          offset += 3
        }
        dataParts.push(0x80 | count, argb[pA], argb[pA + 1], argb[pA + 2])
      } else {
        // Non-repeating block
        let nrStart = offset
        let nrCount = 0
        while (nrCount < 127) {
          const a = rowStart + offset
          const b = a + 3
          const c = b + 3
          if (offset <= rowWidth - 9 && pixelsEqual(argb, a, b) && pixelsEqual(argb, b, c)) {
            break
          }
          nrCount++
          offset += 3
          if (offset > rowWidth - 9) {
            while (offset < rowWidth) {
              if (nrCount === 127) {
                dataParts.push(nrCount)
                for (let k = rowStart + nrStart; k < rowStart + offset; k++) dataParts.push(argb[k])
                nrCount = 0
                nrStart = offset
              }
              nrCount++
              offset += 3
            }
            break
          }
        }
        dataParts.push(nrCount)
        for (let k = rowStart + nrStart; k < rowStart + offset; k++) dataParts.push(argb[k])
      }
    }

    // Tail: whatever's left as a literal stretch.
    const remaining = (rowWidth - offset) / 3
    if (remaining > 0) {
      dataParts.push(remaining)
      for (let k = rowStart + offset; k < rowStart + rowWidth; k++) dataParts.push(argb[k])
    }

    const rowSize = dataParts.length - rowBefore
    if (rowSize > 0x7ff) {
      throw new Error(
        `Row ${y} compressed to ${rowSize} bytes which exceeds the 11-bit size field`,
      )
    }
    if (destOffset > 0x1fffff) {
      throw new Error(
        `Compressed image too large (${destOffset} bytes) for 21-bit row offset`,
      )
    }
    const rowSizeShifted = rowSize * 32
    header[y * 4] = destOffset & 0xff
    header[y * 4 + 1] = (destOffset >> 8) & 0xff
    header[y * 4 + 2] = ((destOffset >> 16) & 0x1f) | (rowSizeShifted & 0xff)
    header[y * 4 + 3] = (rowSizeShifted >> 8) & 0xff

    destOffset += rowSize
  }

  return { header, data: new Uint8Array(dataParts) }
}

// ---------- FaceN .bin writer ----------

const padToAlign4 = (n: number): number => (n % 4 === 0 ? 0 : 4 - (n % 4))

type EncodedBlob = { header: Uint8Array; data: Uint8Array; w: number; h: number }

const encodeOrEmpty = (
  bitmaps: Map<string, { width: number; height: number; rgba: Uint8ClampedArray }>,
  ref: WH,
): EncodedBlob => {
  if (!ref.fileName) {
    return { header: new Uint8Array(0), data: new Uint8Array(0), w: ref.w, h: ref.h }
  }
  const bmp = bitmaps.get(ref.fileName)
  if (!bmp) {
    throw new Error(`Missing bitmap '${ref.fileName}'`)
  }
  const { header, data } = encodeRleNew(bmp.rgba, bmp.width, bmp.height)
  return { header, data, w: bmp.width, h: bmp.height }
}

const blobBytes = (b: EncodedBlob): number => {
  const total = b.header.byteLength + b.data.byteLength
  return total + padToAlign4(total)
}

/** A WH plus the encoded data that will live in the blob payload. */
type LinkedBlob = WH & { encoded: EncodedBlob; placedOffset: number }

const link = (
  bitmaps: Map<string, { width: number; height: number; rgba: Uint8ClampedArray }>,
  ref: WH,
): LinkedBlob => ({
  ...ref,
  encoded: encodeOrEmpty(bitmaps, ref),
  placedOffset: 0,
})

export type PackFaceNInput = {
  config: ParsedWatchfaceJson
  /** filename → decoded BMP. */
  bitmaps: Map<string, { width: number; height: number; rgba: Uint8ClampedArray }>
}

/** Total binary size per element kind (INCLUDING the leading `{1, e_type}`
 *  prefix). Mirrors STATIC_ELEMENT_SIZE in the parser. */
const ELEMENT_TOTAL_SIZE: Record<string, number> = {
  Image: 14,
  TimeNum: 34,
  DayName: 63,
  BatteryFill: 42,
  HeartRateNum: 26,
  StepsNum: 26,
  KCalNum: 19,
  TimeHand: 19,
  DayNum: 12,
  MonthNum: 12,
  Unknown29: 3,
  Dash: 10,
}

const computeElementSize = (el: ParsedElement): number => {
  if (el.kind === 'BarDisplay') return 8 + el.count * 8
  if (el.kind === 'Weather') return 7 + el.count * 8
  return ELEMENT_TOTAL_SIZE[el.kind] ?? 0
}

const ELEMENT_E_TYPE: Record<string, number> = {
  Image: 0,
  TimeNum: 2,
  DayName: 4,
  BatteryFill: 5,
  HeartRateNum: 6,
  StepsNum: 7,
  KCalNum: 9,
  TimeHand: 10,
  DayNum: 13,
  MonthNum: 15,
  BarDisplay: 18,
  Weather: 27,
  Unknown29: 29,
  Dash: 35,
}

/** Assemble a FaceN .bin file from a parsed watchface.json and decoded BMPs. */
export const packFaceN = ({ config, bitmaps }: PackFaceNInput): Uint8Array => {
  // ---------- step 1: link every img_data to its encoded blob ----------
  const previewBlob: EncodedBlob = config.previewName
    ? (() => {
        const bmp = bitmaps.get(config.previewName!)
        if (!bmp) throw new Error(`Missing preview bitmap '${config.previewName}'`)
        const { header, data } = encodeRleNew(bmp.rgba, bmp.width, bmp.height)
        return { header, data, w: bmp.width, h: bmp.height }
      })()
    : { header: new Uint8Array(0), data: new Uint8Array(0), w: config.previewW, h: config.previewH }

  const linkedDigits = config.digitSets.map((set) =>
    set.digits.map((d) => link(bitmaps, d)),
  )

  type LinkedElement = { el: ParsedElement; refs: LinkedBlob[] }
  const linkedElements: LinkedElement[] = config.elements.map((el): LinkedElement => {
    switch (el.kind) {
      case 'Image':
        return { el, refs: [link(bitmaps, el.img)] }
      case 'TimeNum':
      case 'HeartRateNum':
      case 'StepsNum':
      case 'KCalNum':
      case 'DayNum':
      case 'MonthNum':
      case 'Unknown29':
        return { el, refs: [] }
      case 'DayName':
        return { el, refs: el.imgs.map((i) => link(bitmaps, i)) }
      case 'BatteryFill':
        return {
          el,
          refs: [link(bitmaps, el.bgImg), link(bitmaps, el.img1), link(bitmaps, el.img2)],
        }
      case 'TimeHand':
        return { el, refs: [link(bitmaps, el.img)] }
      case 'BarDisplay':
      case 'Weather':
        return { el, refs: el.imgs.map((i) => link(bitmaps, i)) }
      case 'Dash':
        return { el, refs: [link(bitmaps, el.img)] }
    }
  })

  // ---------- step 2: compute header layout ----------
  const fileHeaderSize = 16
  const digitsSectionSize =
    linkedDigits.length > 0 ? 2 + linkedDigits.length * DIGIT_SET_RECORD_SIZE : 0
  const dhOffset = linkedDigits.length > 0 ? 16 : 0
  const bhOffset = 16 + digitsSectionSize

  // computeElementSize already includes the leading `{1, e_type}` 2 bytes.
  const elementsHeaderSize = linkedElements.reduce(
    (sum, le) => sum + computeElementSize(le.el),
    0,
  )
  const totalHeaderSize = fileHeaderSize + digitsSectionSize + elementsHeaderSize + 2 // +2 terminator
  const headerAlign = padToAlign4(totalHeaderSize)
  let blobOffset = totalHeaderSize + headerAlign

  // ---------- step 3: assign blob offsets to each LinkedBlob ----------
  const assignBlob = (lb: LinkedBlob) => {
    if (lb.encoded.header.byteLength === 0 && lb.encoded.data.byteLength === 0) {
      lb.placedOffset = 0
      return
    }
    lb.placedOffset = blobOffset
    blobOffset += blobBytes(lb.encoded)
  }

  for (const set of linkedDigits) for (const d of set) assignBlob(d)
  for (const le of linkedElements) for (const r of le.refs) assignBlob(r)
  // preview goes last (matches extrathundertool's order)
  let previewOffset = 0
  if (previewBlob.header.byteLength > 0 || previewBlob.data.byteLength > 0) {
    previewOffset = blobOffset
    blobOffset += blobBytes(previewBlob)
  }

  // ---------- step 4: serialize header + sections ----------
  const fileSize = blobOffset
  const out = new Uint8Array(fileSize)
  const view = new DataView(out.buffer)
  let p = 0

  // FaceNHeader
  view.setUint16(0, config.apiVer, true)
  view.setUint16(2, config.unknown, true)
  view.setUint32(4, previewOffset, true)
  view.setUint16(8, previewBlob.w, true)
  view.setUint16(10, previewBlob.h, true)
  view.setUint16(12, dhOffset, true)
  view.setUint16(14, bhOffset, true)
  p = 16

  // Digits section: 2-byte intro then each 83-byte digit set record.
  if (linkedDigits.length > 0) {
    view.setUint16(p, 0x0101, true)
    p += 2
    for (let sIdx = 0; sIdx < linkedDigits.length; sIdx++) {
      const set = linkedDigits[sIdx]
      const setRec = config.digitSets[sIdx]
      out[p] = sIdx
      let off = p + 1
      for (let dIdx = 0; dIdx < 10; dIdx++) {
        const d = set[dIdx] ?? { placedOffset: 0, w: 0, h: 0 } as LinkedBlob
        view.setUint32(off, d.placedOffset, true)
        view.setUint16(off + 4, d.w, true)
        view.setUint16(off + 6, d.h, true)
        off += 8
      }
      view.setUint16(off, setRec?.unknown ?? 0, true)
      p += DIGIT_SET_RECORD_SIZE
    }
  }

  // Elements
  const writeOWH = (offsetByte: number, lb: LinkedBlob) => {
    view.setUint32(offsetByte, lb.placedOffset, true)
    view.setUint16(offsetByte + 4, lb.w, true)
    view.setUint16(offsetByte + 6, lb.h, true)
  }

  for (const { el, refs } of linkedElements) {
    const elStart = p
    out[p] = 1
    out[p + 1] = ELEMENT_E_TYPE[el.kind] ?? 0
    p += 2

    switch (el.kind) {
      case 'Image':
        view.setUint16(p, el.x, true)
        view.setUint16(p + 2, el.y, true)
        writeOWH(p + 4, refs[0])
        p += 12
        break
      case 'TimeNum':
        out[p] = el.digitSets[0]
        out[p + 1] = el.digitSets[1]
        out[p + 2] = el.digitSets[2]
        out[p + 3] = el.digitSets[3]
        for (let i = 0; i < 4; i++) {
          view.setUint16(p + 4 + i * 4, el.xys[i].x, true)
          view.setUint16(p + 4 + i * 4 + 2, el.xys[i].y, true)
        }
        for (let i = 0; i < 12; i++) out[p + 20 + i] = el.unknown[i] ?? 0
        p += 32
        break
      case 'DayName':
        out[p] = el.nType
        view.setUint16(p + 1, el.x, true)
        view.setUint16(p + 3, el.y, true)
        for (let i = 0; i < 7; i++) writeOWH(p + 5 + i * 8, refs[i])
        p += 61
        break
      case 'BatteryFill':
        view.setUint16(p, el.x, true)
        view.setUint16(p + 2, el.y, true)
        writeOWH(p + 4, refs[0])
        out[p + 12] = el.x1
        out[p + 13] = el.y1
        out[p + 14] = el.x2
        out[p + 15] = el.y2
        view.setUint32(p + 16, el.unknown0, true)
        view.setUint32(p + 20, el.unknown1, true)
        writeOWH(p + 24, refs[1])
        writeOWH(p + 32, refs[2])
        p += 40
        break
      case 'HeartRateNum':
      case 'StepsNum': {
        out[p] = el.digitSet
        out[p + 1] = el.align === 'R' ? 1 : el.align === 'C' ? 2 : 0
        view.setUint16(p + 2, el.x, true)
        view.setUint16(p + 4, el.y, true)
        // padding[18] left zero
        p += 24
        break
      }
      case 'KCalNum':
        out[p] = el.digitSet
        out[p + 1] = el.align === 'R' ? 1 : el.align === 'C' ? 2 : 0
        view.setUint16(p + 2, el.x, true)
        view.setUint16(p + 4, el.y, true)
        p += 17
        break
      case 'TimeHand':
        out[p] = el.hType
        view.setUint16(p + 1, el.pivotX, true)
        view.setUint16(p + 3, el.pivotY, true)
        writeOWH(p + 5, refs[0])
        view.setUint16(p + 13, el.x, true)
        view.setUint16(p + 15, el.y, true)
        p += 17
        break
      case 'DayNum':
      case 'MonthNum':
        out[p] = el.digitSet
        out[p + 1] = el.align === 'R' ? 1 : el.align === 'C' ? 2 : 0
        view.setUint16(p + 2, el.xys[0].x, true)
        view.setUint16(p + 4, el.xys[0].y, true)
        view.setUint16(p + 6, el.xys[1].x, true)
        view.setUint16(p + 8, el.xys[1].y, true)
        p += 10
        break
      case 'BarDisplay':
        out[p] = el.bType
        out[p + 1] = el.count
        view.setUint16(p + 2, el.x, true)
        view.setUint16(p + 4, el.y, true)
        for (let i = 0; i < el.count; i++) writeOWH(p + 6 + i * 8, refs[i])
        p += 6 + el.count * 8
        break
      case 'Weather':
        out[p] = el.count
        view.setUint16(p + 1, el.x, true)
        view.setUint16(p + 3, el.y, true)
        for (let i = 0; i < el.count; i++) writeOWH(p + 5 + i * 8, refs[i])
        p += 5 + el.count * 8
        break
      case 'Unknown29':
        out[p] = el.unknown
        p += 1
        break
      case 'Dash':
        writeOWH(p, refs[0])
        p += 8
        break
    }

    const expected = computeElementSize(el)
    if (p - elStart !== expected) {
      throw new Error(
        `Element ${el.kind} wrote ${p - elStart} bytes, expected ${expected}`,
      )
    }
  }

  // Terminator
  out[p++] = 0
  out[p++] = 0

  // Align before blob payload (fill with 0xFF per extrathundertool's pad_it)
  for (let i = 0; i < headerAlign; i++) out[p + i] = 0xff
  p += headerAlign

  // ---------- step 5: write blob payloads ----------
  const writeBlob = (lb: EncodedBlob) => {
    if (lb.header.byteLength === 0 && lb.data.byteLength === 0) return
    out.set(lb.header, p)
    p += lb.header.byteLength
    out.set(lb.data, p)
    p += lb.data.byteLength
    const pad = padToAlign4(lb.header.byteLength + lb.data.byteLength)
    for (let i = 0; i < pad; i++) out[p + i] = 0xff
    p += pad
  }

  for (const set of linkedDigits) for (const d of set) writeBlob(d.encoded)
  for (const le of linkedElements) for (const r of le.refs) writeBlob(r.encoded)
  writeBlob(previewBlob)

  return out
}
