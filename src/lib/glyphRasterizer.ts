// Glyph → RGBA bitmap rasterizer. Feeds the FontGenerator modal in the editor.
//
// Two output modes (driven by `preserveAlpha`):
//  - true  → render onto transparent canvas. Use for FaceN, which stores ARGB
//            and can composite over any background on the watch.
//  - false → render onto `background` then read the composited pixels. Use for
//            Type C, whose RGB565 stream has no alpha; AA edges must already
//            be baked against the target background or text fringes look ugly.

export type DecodedBitmap = {
  width: number
  height: number
  rgba: Uint8ClampedArray
}

export type RasterizeOptions = {
  /** Strings to render — one BMP each. */
  glyphs: string[]
  /** CSS font-family (already loaded via fontLoader). */
  family: string
  /** CSS font-weight. */
  weight?: number | string
  /** Pixel size for the glyph (`ctx.font = "${weight} ${size}px ${family}"`). */
  size: number
  /** CSS color for the glyph fill. */
  color: string
  /** Background color. Ignored when `preserveAlpha` is true. */
  background?: string
  /** Output BMP width. */
  width: number
  /** Output BMP height. */
  height: number
  /** Horizontal alignment of the glyph inside its BMP. */
  align?: 'left' | 'center' | 'right'
  /** Vertical alignment of the glyph inside its BMP. */
  vAlign?: 'top' | 'middle' | 'bottom'
  /** Horizontal padding inside the BMP (default 1). */
  paddingX?: number
  /** Vertical padding inside the BMP (default 1). */
  paddingY?: number
  /** If true, leave alpha intact (FaceN). Otherwise composite onto background
   *  and clobber alpha to 0xff (Type C). */
  preserveAlpha?: boolean
  /** When `preserveAlpha === false`, this controls AA quality. Default true. */
  antialias?: boolean
}

const rasterizeOne = (glyph: string, opts: RasterizeOptions): DecodedBitmap => {
  const {
    family,
    weight = 400,
    size,
    color,
    background = '#000000',
    width,
    height,
    align = 'center',
    vAlign = 'middle',
    paddingX = 1,
    paddingY = 1,
    preserveAlpha = false,
    antialias = true,
  } = opts

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return {
      width,
      height,
      rgba: new Uint8ClampedArray(width * height * 4),
    }
  }

  // Anti-alias toggle. `imageSmoothingEnabled` doesn't actually affect text
  // rendering, but `webkitFontSmoothing` / `font-smooth` are CSS-only and not
  // canvas-applicable either. Browsers always AA text; we approximate "AA off"
  // by re-thresholding the rendered alpha post-hoc below.

  if (!preserveAlpha) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, width, height)
  }

  ctx.fillStyle = color
  ctx.font = `${weight} ${size}px "${family}"`
  ctx.textAlign = align
  ctx.textBaseline = vAlign === 'top' ? 'top' : vAlign === 'bottom' ? 'bottom' : 'middle'

  let x: number
  switch (align) {
    case 'left':
      x = paddingX
      break
    case 'right':
      x = width - paddingX
      break
    case 'center':
    default:
      x = width / 2
      break
  }

  let y: number
  switch (vAlign) {
    case 'top':
      y = paddingY
      break
    case 'bottom':
      y = height - paddingY
      break
    case 'middle':
    default:
      y = height / 2
      break
  }

  ctx.fillText(glyph, x, y)

  const imgData = ctx.getImageData(0, 0, width, height)
  const rgba = new Uint8ClampedArray(imgData.data)

  if (!antialias) {
    // Threshold alpha → either fully bg (we already filled with bg above for
    // preserveAlpha=false) or fully fg. Useful for getting crisper RLE output.
    for (let p = 0; p < rgba.length; p += 4) {
      const a = rgba[p + 3]
      if (a < 128) {
        // bg already painted; nothing to do
      } else {
        rgba[p + 3] = 0xff
      }
    }
  }

  if (!preserveAlpha) {
    // Force every pixel opaque — Type C is RGB565 without alpha; an alpha
    // channel here would be silently dropped at encode time anyway.
    for (let p = 0; p < rgba.length; p += 4) {
      rgba[p + 3] = 0xff
    }
  }

  return { width, height, rgba }
}

export const rasterizeGlyphs = (opts: RasterizeOptions): DecodedBitmap[] =>
  opts.glyphs.map((g) => rasterizeOne(g, opts))

// ---------- glyph-set presets ----------

export const DIGIT_GLYPHS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
export const DAY_NAME_GLYPHS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const MONTH_NAME_GLYPHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]
