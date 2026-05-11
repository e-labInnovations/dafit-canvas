// Minimal BMP decoder for the formats this app round-trips:
//  - 16-bit RGB565 BI_BITFIELDS (produced by dawft's setBMPHeaderV4)
//  - 32-bit BGRA BI_BITFIELDS or BI_RGB (produced by extrathundertool / our
//    `encodeBmp32` in faceN.ts)
// Returns an RGBA8888 top-down buffer regardless of how the BMP stored rows.

export type DecodedBmp = {
  width: number
  height: number
  rgba: Uint8ClampedArray
}

export const decodeBmp = (bytes: Uint8Array): DecodedBmp => {
  if (bytes.length < 14 + 40) throw new Error('BMP too small')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes[0] !== 0x42 || bytes[1] !== 0x4d) throw new Error('Not a BMP (no "BM" signature)')

  const dataOffset = view.getUint32(10, true)
  const dibSize = view.getUint32(14, true)
  const width = view.getInt32(18, true)
  const heightSigned = view.getInt32(22, true)
  const topDown = heightSigned < 0
  const height = Math.abs(heightSigned)
  const planes = view.getUint16(26, true)
  const bpp = view.getUint16(28, true)
  const compression = view.getUint32(30, true)

  if (planes !== 1) throw new Error('BMP planes must be 1')
  if (bpp !== 16 && bpp !== 24 && bpp !== 32) {
    throw new Error(`Unsupported BMP bpp: ${bpp}`)
  }

  // Bitfield masks: V3 (40-byte DIB) places masks immediately after the
  // BITMAPINFOHEADER (offset 54). V4 (108) and V5 (124) put them inside the
  // DIB header at offset 14+40 = 54 still (since the V4/V5 layout starts with
  // the V3 fields then extends). So either way they live at byte 54 onward.
  const hasBitfields = compression === 3
  let rMask = 0
  let gMask = 0
  let bMask = 0
  let aMask = 0
  if (hasBitfields) {
    rMask = view.getUint32(54, true)
    gMask = view.getUint32(58, true)
    bMask = view.getUint32(62, true)
    if (bpp === 32 && dibSize >= 56 + 4) aMask = view.getUint32(66, true)
  } else if (bpp === 32) {
    // BI_RGB 32-bit: assume BGRA in source bytes
    rMask = 0x00ff0000
    gMask = 0x0000ff00
    bMask = 0x000000ff
    aMask = 0xff000000
  } else if (bpp === 24) {
    rMask = 0x00ff0000
    gMask = 0x0000ff00
    bMask = 0x000000ff
  } else if (bpp === 16) {
    // BI_RGB 16-bit: rare; assume RGB555
    rMask = 0x7c00
    gMask = 0x03e0
    bMask = 0x001f
  }

  const rowBytes = ((width * (bpp / 8) + 3) & ~3) >>> 0
  const rgba = new Uint8ClampedArray(width * height * 4)

  const shiftFor = (mask: number): { shift: number; bits: number } => {
    if (mask === 0) return { shift: 0, bits: 0 }
    let shift = 0
    while ((mask & 1) === 0) {
      mask >>>= 1
      shift++
    }
    let bits = 0
    while (mask) {
      bits++
      mask >>>= 1
    }
    return { shift, bits }
  }
  const rInfo = shiftFor(rMask)
  const gInfo = shiftFor(gMask)
  const bInfo = shiftFor(bMask)
  const aInfo = shiftFor(aMask)

  const expand = (raw: number, info: { shift: number; bits: number }): number => {
    if (info.bits === 0) return 0
    const v = (raw >>> info.shift) & ((1 << info.bits) - 1)
    if (info.bits === 8) return v
    // Replicate top bits into the gap for an unbiased expansion.
    const scaled = (v << (8 - info.bits)) | (v >> (info.bits - (8 - info.bits)))
    return scaled & 0xff
  }

  for (let y = 0; y < height; y++) {
    const srcRow = topDown ? y : height - 1 - y
    const srcStart = dataOffset + srcRow * rowBytes
    const dstStart = y * width * 4
    if (bpp === 32) {
      for (let x = 0; x < width; x++) {
        const raw = view.getUint32(srcStart + x * 4, true)
        rgba[dstStart + x * 4] = expand(raw, rInfo)
        rgba[dstStart + x * 4 + 1] = expand(raw, gInfo)
        rgba[dstStart + x * 4 + 2] = expand(raw, bInfo)
        rgba[dstStart + x * 4 + 3] = aMask ? expand(raw, aInfo) : 0xff
      }
    } else if (bpp === 24) {
      for (let x = 0; x < width; x++) {
        const o = srcStart + x * 3
        rgba[dstStart + x * 4] = bytes[o + 2]
        rgba[dstStart + x * 4 + 1] = bytes[o + 1]
        rgba[dstStart + x * 4 + 2] = bytes[o]
        rgba[dstStart + x * 4 + 3] = 0xff
      }
    } else {
      // 16-bit
      for (let x = 0; x < width; x++) {
        const raw = view.getUint16(srcStart + x * 2, true)
        rgba[dstStart + x * 4] = expand(raw, rInfo)
        rgba[dstStart + x * 4 + 1] = expand(raw, gInfo)
        rgba[dstStart + x * 4 + 2] = expand(raw, bInfo)
        rgba[dstStart + x * 4 + 3] = 0xff
      }
    }
  }

  return { width, height, rgba }
}
