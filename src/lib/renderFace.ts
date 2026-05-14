// Compose a watch face preview by walking the FaceData entries and drawing
// the right blob (or sequence of digit blobs) for each element using a
// "dummy" snapshot of time/date/health/battery values.

import type { DecodedBlob, FaceDataEntry, FaceHeader } from './dawft'

export type DummyState = {
  hour: number // 0–23
  minute: number // 0–59
  second: number // 0–59
  day: number // 1–31
  month: number // 1–12
  year: number // YYYY
  dow: number // 0 = Sunday … 6 = Saturday
  steps: number
  hr: number
  kcal: number
  battery: number // 0–100
  distance: number // tenths of km — e.g. 52 = 5.2 km, since digits are emitted with no decimal point
  btConnected: boolean
  /** Current animation frame index for the live preview of auto-cycling
   *  animations (0xf7 / 0xf8). Modulo'd against the FaceData entry's blob
   *  count when drawing, so a 14-frame and a 21-frame animation cycle
   *  correctly off the same counter. */
  animFrame: number
  /** Current frame index for TAP_TO_CHANGE (0xf6). Separate from
   *  `animFrame` so the editor preview matches the real watch — on-watch
   *  TAP_TO_CHANGE only advances when the user taps the face, not on a
   *  timer. The editor's "Tap" button bumps this; auto-play does not. */
  tapFrame: number
}

export const defaultDummy = (): DummyState => {
  const now = new Date()
  return {
    hour: now.getHours(),
    minute: now.getMinutes(),
    second: now.getSeconds(),
    day: now.getDate(),
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    dow: now.getDay(),
    steps: 8421,
    hr: 72,
    kcal: 320,
    battery: 85,
    distance: 52,
    btConnected: true,
    animFrame: 0,
    tapFrame: 0,
  }
}

const DIGIT_SPACING = 2

type BlobLookup = (idx: number) => HTMLCanvasElement | null

const drawBlob = (
  ctx: CanvasRenderingContext2D,
  lookup: BlobLookup,
  blobIdx: number,
  x: number,
  y: number,
): void => {
  const c = lookup(blobIdx)
  if (c) ctx.drawImage(c, x, y)
}

type Align = 'L' | 'R' | 'C'

const drawDigits = (
  ctx: CanvasRenderingContext2D,
  lookup: BlobLookup,
  value: number,
  align: Align,
  fd: FaceDataEntry,
  padTo = 1,
): void => {
  const s = String(Math.max(0, Math.floor(value))).padStart(padTo, '0')
  const totalW = s.length * fd.w + (s.length - 1) * DIGIT_SPACING
  let startX: number
  switch (align) {
    case 'L':
      // fd.x is the left edge of the rendered text.
      startX = fd.x
      break
    case 'R':
      // fd.x is the right edge — text grows leftward from it.
      startX = fd.x - totalW
      break
    case 'C':
      // fd.x is the horizontal center of the rendered text. Matches
      // extrathundertool's `drawAlignedNumber` convention used by FaceN.
      startX = fd.x - Math.floor(totalW / 2)
      break
  }
  for (let k = 0; k < s.length; k++) {
    const d = s.charCodeAt(k) - 48
    drawBlob(ctx, lookup, fd.idx + d, Math.round(startX + k * (fd.w + DIGIT_SPACING)), fd.y)
  }
}

const drawProgBar = (
  ctx: CanvasRenderingContext2D,
  lookup: BlobLookup,
  pct: number,
  fd: FaceDataEntry,
): void => {
  const clamped = Math.min(100, Math.max(0, pct))
  const frame = Math.round(clamped / 10) // 11 frames, 0..10
  drawBlob(ctx, lookup, fd.idx + frame, fd.x, fd.y)
}

const drawHand = (
  ctx: CanvasRenderingContext2D,
  lookup: BlobLookup,
  fd: FaceDataEntry,
  /** angle in degrees, 0 = 12 o'clock, increases clockwise */
  angle: number,
  centerX: number,
  centerY: number,
): void => {
  const c = lookup(fd.idx)
  if (!c) return
  // (fd.x, fd.y) is where the bitmap would be drawn at the unrotated "12:00
  // position", so the pivot inside the bitmap is wherever the watch center
  // falls relative to that origin. This handles hands whose pivot is anywhere
  // inside the bitmap (most have a counterweight tail past the pivot).
  const pivotX = centerX - fd.x
  const pivotY = centerY - fd.y
  ctx.save()
  ctx.translate(centerX, centerY)
  ctx.rotate((angle * Math.PI) / 180)
  ctx.drawImage(c, -pivotX, -pivotY)
  ctx.restore()
}

const drawElement = (
  ctx: CanvasRenderingContext2D,
  fd: FaceDataEntry,
  lookup: BlobLookup,
  dummy: DummyState,
  centerX: number,
  centerY: number,
  use12h: boolean,
  animationFrames: number,
): void => {
  // For TIME_H1/H2, present 12h hours when the face has AM/PM markers.
  // AM/PM checks themselves still use the raw 24h hour from `dummy`.
  const displayHour = use12h ? ((dummy.hour + 11) % 12) + 1 : dummy.hour
  switch (fd.type) {
    // ----- single-blob statics -----
    case 0x01: // BACKGROUND
    case 0x71: // STEPS_LOGO
    case 0x81: // HR_LOGO
    case 0x91: // KCAL_LOGO
    case 0xa1: // DIST_LOGO
    case 0xa5: // DIST_KM
    case 0xa6: // DIST_MI
    case 0xce: // BATT_IMG
    case 0xd0: // BATT_IMG_B
    case 0xd1: // BATT_IMG_C
    case 0xda: // BATT_IMG_D
    case 0xf0: // SEPERATOR
    case 0xf4: // HAND_PIN_UPPER
    case 0xf5: // HAND_PIN_LOWER
      drawBlob(ctx, lookup, fd.idx, fd.x, fd.y)
      return

    // ----- conditional statics -----
    case 0x45: // TIME_AM
      if (dummy.hour < 12) drawBlob(ctx, lookup, fd.idx, fd.x, fd.y)
      return
    case 0x46: // TIME_PM
      if (dummy.hour >= 12) drawBlob(ctx, lookup, fd.idx, fd.x, fd.y)
      return
    case 0xc0: // BTLINK_UP
      if (dummy.btConnected) drawBlob(ctx, lookup, fd.idx, fd.x, fd.y)
      return
    case 0xc1: // BTLINK_DOWN
      if (!dummy.btConnected) drawBlob(ctx, lookup, fd.idx, fd.x, fd.y)
      return

    // ----- single-digit time slots -----
    case 0x40: // TIME_H1
      drawBlob(ctx, lookup, fd.idx + Math.floor(displayHour / 10), fd.x, fd.y)
      return
    case 0x41: // TIME_H2
      drawBlob(ctx, lookup, fd.idx + (displayHour % 10), fd.x, fd.y)
      return
    case 0x43: // TIME_M1
      drawBlob(ctx, lookup, fd.idx + Math.floor(dummy.minute / 10), fd.x, fd.y)
      return
    case 0x44: // TIME_M2
      drawBlob(ctx, lookup, fd.idx + (dummy.minute % 10), fd.x, fd.y)
      return

    // ----- two-digit date fields -----
    case 0x11: // MONTH_NUM
    case 0x6b: // MONTH_NUM_B
      drawDigits(ctx, lookup, dummy.month, 'L', fd, 2)
      return
    case 0x30: // DAY_NUM
    case 0x6c: // DAY_NUM_B
      drawDigits(ctx, lookup, dummy.day, 'L', fd, 2)
      return
    case 0x12: // YEAR
      drawDigits(ctx, lookup, dummy.year % 100, 'L', fd, 2)
      return

    // ----- name lookups -----
    case 0x60: // DAY_NAME
    case 0x61: // DAY_NAME_CN
      drawBlob(ctx, lookup, fd.idx + dummy.dow, fd.x, fd.y)
      return
    case 0x10: // MONTH_NAME
      drawBlob(ctx, lookup, fd.idx + (dummy.month - 1), fd.x, fd.y)
      return

    // ----- multi-digit values -----
    case 0x62: drawDigits(ctx, lookup, dummy.steps, 'L', fd); return
    case 0x63: drawDigits(ctx, lookup, dummy.steps, 'C', fd); return
    case 0x64: drawDigits(ctx, lookup, dummy.steps, 'R', fd); return
    case 0x72: drawDigits(ctx, lookup, dummy.steps, 'L', fd); return
    case 0x73: drawDigits(ctx, lookup, dummy.steps, 'C', fd); return
    case 0x74: drawDigits(ctx, lookup, dummy.steps, 'R', fd); return
    case 0x76: drawDigits(ctx, lookup, 10000, 'L', fd); return // STEPS_GOAL

    case 0x65: drawDigits(ctx, lookup, dummy.hr, 'L', fd); return
    case 0x66: drawDigits(ctx, lookup, dummy.hr, 'C', fd); return
    case 0x67: drawDigits(ctx, lookup, dummy.hr, 'R', fd); return
    case 0x82: drawDigits(ctx, lookup, dummy.hr, 'L', fd); return
    case 0x83: drawDigits(ctx, lookup, dummy.hr, 'C', fd); return
    case 0x84: drawDigits(ctx, lookup, dummy.hr, 'R', fd); return

    case 0x68: drawDigits(ctx, lookup, dummy.kcal, 'L', fd); return
    case 0x92: drawDigits(ctx, lookup, dummy.kcal, 'L', fd); return
    case 0x93: drawDigits(ctx, lookup, dummy.kcal, 'C', fd); return
    case 0x94: drawDigits(ctx, lookup, dummy.kcal, 'R', fd); return

    case 0xa2: drawDigits(ctx, lookup, dummy.distance, 'L', fd); return
    case 0xa3: drawDigits(ctx, lookup, dummy.distance, 'C', fd); return
    case 0xa4: drawDigits(ctx, lookup, dummy.distance, 'R', fd); return

    case 0xd2: drawDigits(ctx, lookup, dummy.battery, 'L', fd); return
    case 0xd3: drawDigits(ctx, lookup, dummy.battery, 'C', fd); return
    case 0xd4: drawDigits(ctx, lookup, dummy.battery, 'R', fd); return

    // ----- progress bars (11 frames at 0/10/20…/100) -----
    case 0x70: drawProgBar(ctx, lookup, (dummy.steps / 10000) * 100, fd); return
    case 0x80: drawProgBar(ctx, lookup, (dummy.hr / 200) * 100, fd); return
    case 0x90: drawProgBar(ctx, lookup, (dummy.kcal / 500) * 100, fd); return
    case 0xa0: drawProgBar(ctx, lookup, dummy.distance, fd); return // 10 km goal

    // ----- background strips (Type A holdover, occasionally seen on Type C) -----
    case 0x00:
      for (let k = 0; k < 10; k++) drawBlob(ctx, lookup, fd.idx + k, 0, k * 24)
      return

    // ----- analog hands -----
    case 0xf1: // HAND_HOUR
      drawHand(
        ctx,
        lookup,
        fd,
        ((dummy.hour % 12) + dummy.minute / 60) * 30,
        centerX,
        centerY,
      )
      return
    case 0xf2: // HAND_MINUTE
      drawHand(
        ctx,
        lookup,
        fd,
        (dummy.minute + dummy.second / 60) * 6,
        centerX,
        centerY,
      )
      return
    case 0xf3: // HAND_SEC
      drawHand(ctx, lookup, fd, dummy.second * 6, centerX, centerY)
      return

    // ----- animations -----
    // 0xf6 TAP_TO_CHANGE only advances on a user tap on the real watch;
    // the editor's tap button bumps dummy.tapFrame. 0xf7 / 0xf8 auto-
    // cycle in firmware at a fixed (~10 fps) rate which we mirror via
    // dummy.animFrame. `Math.max(1, …)` guards against animationFrames=0
    // — the user may have an animation set in-progress before setting
    // a real frame count.
    case 0xf6: {
      const n = Math.max(1, animationFrames)
      const frame = ((dummy.tapFrame % n) + n) % n
      drawBlob(ctx, lookup, fd.idx + frame, fd.x, fd.y)
      return
    }
    case 0xf7:
    case 0xf8: {
      const n = Math.max(1, animationFrames)
      const frame = ((dummy.animFrame % n) + n) % n
      drawBlob(ctx, lookup, fd.idx + frame, fd.x, fd.y)
      return
    }

    // ----- weather temp: skip (double-width unit chars complicate things) -----
    case 0xd7:
    case 0xd8:
    case 0xd9:
      return

    // ----- unknown: best-effort draw of the first frame -----
    default:
      drawBlob(ctx, lookup, fd.idx, fd.x, fd.y)
  }
}

export type RenderResult = {
  width: number
  height: number
}

export const renderFace = (
  canvas: HTMLCanvasElement,
  header: FaceHeader,
  blobs: DecodedBlob[],
  dummy: DummyState,
): RenderResult => {
  const activeData = header.faceData.slice(0, header.dataCount)
  const bg = activeData.find((fd) => fd.type === 0x01)
  const width = bg?.w ?? 240
  const height = bg?.h ?? 240

  // If the face has AM/PM elements it's a 12-hour layout, so the H1/H2 digits
  // need to render 1–12 rather than the raw 0–23.
  const use12h = activeData.some(
    (fd) => fd.type === 0x45 || fd.type === 0x46,
  )

  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return { width, height }
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)

  // Cache one offscreen canvas per blob so we can drawImage cheaply when the
  // same blob is referenced by multiple FaceData entries (and on re-renders).
  const blobCanvases = new Map<number, HTMLCanvasElement>()
  const lookup: BlobLookup = (idx) => {
    let c = blobCanvases.get(idx)
    if (c) return c
    const blob = blobs[idx]
    if (
      !blob ||
      !blob.rgba ||
      blob.width === null ||
      blob.height === null ||
      blob.width === 0 ||
      blob.height === 0
    ) {
      return null
    }
    c = document.createElement('canvas')
    c.width = blob.width
    c.height = blob.height
    const bctx = c.getContext('2d')
    if (!bctx) return null
    const imgData = bctx.createImageData(blob.width, blob.height)
    imgData.data.set(blob.rgba)
    bctx.putImageData(imgData, 0, 0)
    blobCanvases.set(idx, c)
    return c
  }

  const centerX = width / 2
  const centerY = height / 2

  for (let i = 0; i < header.dataCount; i++) {
    drawElement(
      ctx,
      header.faceData[i],
      lookup,
      dummy,
      centerX,
      centerY,
      use12h,
      header.animationFrames,
    )
  }

  return { width, height }
}
