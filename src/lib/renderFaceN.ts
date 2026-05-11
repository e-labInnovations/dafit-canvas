// Compose a FaceN watch face preview by walking the parsed Element list and
// drawing each element with the right blob(s) for the current dummy state.

import type { ImgRef, FaceN, FaceNElement, Align } from './faceN'
import type { DummyState } from './renderFace'

export type DummyStateN = DummyState & {
  /** Index into the Weather element's images (0..count-1). */
  weatherIcon: number
  /** Index into a TAP_TO_CHANGE / animation BarDisplay if any. */
  animationFrame: number
}

export const defaultDummyN = (base: DummyState): DummyStateN => ({
  ...base,
  weatherIcon: 0,
  animationFrame: 0,
})

type CanvasCache = Map<ImgRef, HTMLCanvasElement>

const getCanvas = (cache: CanvasCache, img: ImgRef): HTMLCanvasElement | null => {
  let c = cache.get(img)
  if (c) return c
  if (!img.rgba || img.width === 0 || img.height === 0) return null
  c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const bctx = c.getContext('2d')
  if (!bctx) return null
  const id = bctx.createImageData(img.width, img.height)
  id.data.set(img.rgba)
  bctx.putImageData(id, 0, 0)
  cache.set(img, c)
  return c
}

const drawImg = (
  ctx: CanvasRenderingContext2D,
  cache: CanvasCache,
  img: ImgRef,
  x: number,
  y: number,
): void => {
  const c = getCanvas(cache, img)
  if (c) ctx.drawImage(c, x, y)
}

const digitWidth = (digits: ImgRef[], digit: number): number =>
  digits[digit]?.width ?? 0

const totalNumberWidth = (digits: ImgRef[], digitChars: string): number => {
  let total = 0
  for (let i = 0; i < digitChars.length; i++) {
    const d = digitChars.charCodeAt(i) - 48
    total += digitWidth(digits, d)
  }
  return total
}

/** Draw a number using the per-digit widths from a digit set. Positions are
 *  laid out left-to-right starting from `startX` with no extra spacing
 *  (FaceN digit bitmaps include their own kerning). */
const drawNumberFromAnchor = (
  ctx: CanvasRenderingContext2D,
  cache: CanvasCache,
  digits: ImgRef[],
  text: string,
  startX: number,
  y: number,
): void => {
  let x = startX
  for (let i = 0; i < text.length; i++) {
    const d = text.charCodeAt(i) - 48
    if (d < 0 || d > 9) continue
    const img = digits[d]
    if (!img) continue
    drawImg(ctx, cache, img, x, y)
    x += img.width
  }
}

const drawAlignedNumber = (
  ctx: CanvasRenderingContext2D,
  cache: CanvasCache,
  digits: ImgRef[],
  value: number,
  x: number,
  y: number,
  align: Align,
): void => {
  const text = String(Math.max(0, Math.floor(value)))
  let startX = x
  if (align !== 'L') {
    const total = totalNumberWidth(digits, text)
    if (align === 'R') startX = x - total
    else startX = x - Math.floor(total / 2)
  }
  drawNumberFromAnchor(ctx, cache, digits, text, startX, y)
}

const drawTwoDigit = (
  ctx: CanvasRenderingContext2D,
  cache: CanvasCache,
  digits: ImgRef[],
  value: number,
  xys: readonly [{ x: number; y: number }, { x: number; y: number }],
  align: Align,
): void => {
  const text = String(Math.max(0, Math.floor(value))).padStart(2, '0')
  // Two explicit digit positions are stored. They typically represent the
  // tens and ones slots; emitting them in order is correct for L/C/R because
  // the watch chooses the layout when authoring the face.
  for (let i = 0; i < 2; i++) {
    const d = text.charCodeAt(i) - 48
    const img = digits[d]
    if (!img) continue
    const slot = xys[i]
    let x = slot.x
    if (align === 'R') x = slot.x - img.width
    else if (align === 'C') x = slot.x - Math.floor(img.width / 2)
    drawImg(ctx, cache, img, x, slot.y)
  }
}

/** BarDisplay frames are typically thresholded into N buckets. Map a percentage
 *  (0..100) into a frame index over `count` images. */
const pickBarFrame = (pct: number, count: number): number => {
  if (count <= 0) return 0
  const clamped = Math.min(100, Math.max(0, pct))
  const idx = Math.round((clamped / 100) * (count - 1))
  return Math.max(0, Math.min(count - 1, idx))
}

const drawElement = (
  ctx: CanvasRenderingContext2D,
  cache: CanvasCache,
  el: FaceNElement,
  face: FaceN,
  dummy: DummyStateN,
  use12h: boolean,
  centerX: number,
  centerY: number,
): void => {
  switch (el.kind) {
    case 'Image': {
      drawImg(ctx, cache, el.img, el.x, el.y)
      return
    }
    case 'TimeNum': {
      const displayHour = use12h ? ((dummy.hour + 11) % 12) + 1 : dummy.hour
      const text =
        String(displayHour).padStart(2, '0') +
        String(dummy.minute).padStart(2, '0')
      for (let i = 0; i < 4; i++) {
        const d = text.charCodeAt(i) - 48
        const setIdx = el.digitSets[i]
        const set = face.digitSets[setIdx]
        if (!set) continue
        const img = set.digits[d]
        if (!img) continue
        drawImg(ctx, cache, img, el.xys[i].x, el.xys[i].y)
      }
      return
    }
    case 'DayName': {
      const img = el.imgs[dummy.dow]
      if (img) drawImg(ctx, cache, img, el.x, el.y)
      return
    }
    case 'BatteryFill': {
      // Bg image at (x, y); a sub-rectangle (x1,y1)-(x2,y2) is "filled" by
      // overlaying img2 (full) on top of img1 (empty) clipped to the battery
      // level. img1/img2 are typically the same size as the inner gauge.
      drawImg(ctx, cache, el.bgImg, el.x, el.y)
      const fillW = el.x2 - el.x1
      const fillH = el.y2 - el.y1
      if (fillW > 0 && fillH > 0) {
        const empty = getCanvas(cache, el.img1)
        const full = getCanvas(cache, el.img2)
        if (empty) ctx.drawImage(empty, el.x + el.x1, el.y + el.y1)
        if (full) {
          const pct = Math.min(100, Math.max(0, dummy.battery)) / 100
          // Clip to the fill rect, scaled by current battery percentage.
          const clipW = Math.round(fillW * pct)
          if (clipW > 0) {
            ctx.save()
            ctx.beginPath()
            ctx.rect(el.x + el.x1, el.y + el.y1, clipW, fillH)
            ctx.clip()
            ctx.drawImage(full, el.x + el.x1, el.y + el.y1)
            ctx.restore()
          }
        }
      }
      return
    }
    case 'HeartRateNum':
    case 'StepsNum':
    case 'KCalNum': {
      const set = face.digitSets[el.digitSet]
      if (!set) return
      const value =
        el.kind === 'HeartRateNum'
          ? dummy.hr
          : el.kind === 'StepsNum'
            ? dummy.steps
            : dummy.kcal
      drawAlignedNumber(ctx, cache, set.digits, value, el.x, el.y, el.align)
      return
    }
    case 'TimeHand': {
      const c = getCanvas(cache, el.img)
      if (!c) return
      const angle =
        el.hType === 0
          ? ((dummy.hour % 12) + dummy.minute / 60) * 30
          : el.hType === 1
            ? (dummy.minute + dummy.second / 60) * 6
            : dummy.second * 6
      // Pivot inside the bitmap is given by (pivotX, pivotY) in the FaceN
      // header; the (x, y) is where the unrotated bitmap would be drawn.
      // We rotate around the watch center and offset the bitmap so its
      // pivot lands there.
      const drawX = el.x - centerX
      const drawY = el.y - centerY
      ctx.save()
      ctx.translate(centerX, centerY)
      ctx.rotate((angle * Math.PI) / 180)
      // pivotX/pivotY are unused in extrathundertool's render but we expose
      // them in the JSON; for drawing we use el.(x, y) relative to center.
      ctx.drawImage(c, drawX, drawY)
      ctx.restore()
      return
    }
    case 'DayNum': {
      const set = face.digitSets[el.digitSet]
      if (!set) return
      drawTwoDigit(ctx, cache, set.digits, dummy.day, el.xys, el.align)
      return
    }
    case 'MonthNum': {
      const set = face.digitSets[el.digitSet]
      if (!set) return
      drawTwoDigit(ctx, cache, set.digits, dummy.month, el.xys, el.align)
      return
    }
    case 'BarDisplay': {
      // Pick a frame from the set based on the data source the bar is bound to.
      const pct =
        el.bType === 0
          ? (dummy.steps / 10000) * 100 // Steps
          : el.bType === 2
            ? (dummy.kcal / 500) * 100 // KCal
            : el.bType === 5
              ? (dummy.hr / 200) * 100 // HeartRate
              : el.bType === 6
                ? dummy.battery // Battery
                : 0
      const frame = pickBarFrame(pct, el.count)
      const img = el.imgs[frame]
      if (img) drawImg(ctx, cache, img, el.x, el.y)
      return
    }
    case 'Weather': {
      const idx = Math.max(0, Math.min(el.count - 1, dummy.weatherIcon))
      const img = el.imgs[idx]
      if (img) drawImg(ctx, cache, img, el.x, el.y)
      return
    }
    case 'Dash':
    case 'Unknown29':
    case 'Unknown':
      return
  }
}

export type RenderResult = { width: number; height: number }

export const renderFaceN = (
  canvas: HTMLCanvasElement,
  face: FaceN,
  dummy: DummyStateN,
): RenderResult => {
  // The face doesn't store its own screen size. Fall back to the first Image
  // element's size (typically the background), then the preview's size, then
  // 240×240.
  const firstImage = face.elements.find(
    (e): e is Extract<FaceNElement, { kind: 'Image' }> => e.kind === 'Image',
  )
  const width =
    firstImage?.img.width ?? face.preview.width ?? 240
  const height =
    firstImage?.img.height ?? face.preview.height ?? 240

  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return { width, height }
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)

  // FaceN doesn't have explicit AM/PM markers; default to 24h. If a face only
  // designs for 12h, the user can adjust the dummy hour manually.
  const use12h = false

  const cache: CanvasCache = new Map()
  const centerX = width / 2
  const centerY = height / 2

  for (const el of face.elements) {
    drawElement(ctx, cache, el, face, dummy, use12h, centerX, centerY)
  }

  return { width, height }
}
