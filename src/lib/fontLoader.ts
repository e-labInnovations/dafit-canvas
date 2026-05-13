// Thin wrapper around the FontFace API. Two sources:
//  - 'system'  → use the family name as-is in canvas `ctx.font`
//  - 'upload'  → load a .ttf/.otf File into the document via `new FontFace()`
//
// Google Fonts is deferred to Phase 3B. We keep the API shape compatible so
// adding it later is just one more branch.

export type FontSource =
  | { kind: 'system'; family: string }
  | { kind: 'upload'; family: string; file: File }

export type LoadedFont = {
  /** CSS family name to plug into `ctx.font` / `font-family`. */
  family: string
  /** Call to unregister the font (no-op for system fonts). */
  dispose: () => void
}

/** A handful of widely available system fonts. Browsers don't expose font
 *  enumeration without permission, so we hard-code a curated list and let the
 *  user override via a free-text input. */
export const COMMON_SYSTEM_FONTS = [
  // Sans-serif
  'Arial',
  'Arial Black',
  'Helvetica',
  'Helvetica Neue',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Geneva',
  'Lucida Sans Unicode',
  'Impact',
  // Serif
  'Times New Roman',
  'Times',
  'Georgia',
  'Palatino',
  'Garamond',
  'Bookman',
  // Monospace
  'Courier New',
  'Courier',
  'Monaco',
  'Menlo',
  'Consolas',
  'Lucida Console',
  // Display / script
  'Brush Script MT',
  'Comic Sans MS',
  // Generic fallbacks
  'monospace',
  'sans-serif',
  'serif',
] as const

/** Make a CSS-safe identifier from an arbitrary string. Used to namespace
 *  uploaded fonts so two .ttf files with similar names don't collide. */
const safeFamily = (raw: string): string =>
  raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) ||
  `Font_${Date.now().toString(36)}`

export const loadFont = async (source: FontSource): Promise<LoadedFont> => {
  if (source.kind === 'system') {
    return { family: source.family, dispose: () => {} }
  }

  const buffer = await source.file.arrayBuffer()
  const family = safeFamily(`Uploaded_${source.family}`)
  const face = new FontFace(family, buffer)
  await face.load()
  document.fonts.add(face)
  return {
    family,
    dispose: () => {
      try {
        document.fonts.delete(face)
      } catch {
        /* face was already removed — ignore */
      }
    },
  }
}

/** Quick check that a font is actually rendered by the browser. Useful for
 *  catching "system font name doesn't exist on this machine" before we
 *  rasterize a grid of garbage. */
export const fontIsAvailable = (
  family: string,
  weight: number | string = 400,
  testSize = 72,
): boolean => {
  // The web-standard trick: render the same string with a known fallback and
  // with the target family + the same fallback, and compare measured widths.
  const text = 'mwAB0123QWERTY'
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return false

  const measure = (font: string): number => {
    ctx.font = font
    return ctx.measureText(text).width
  }

  const fallback = 'monospace'
  const baseline = measure(`${weight} ${testSize}px ${fallback}`)
  const target = measure(`${weight} ${testSize}px "${family}", ${fallback}`)
  return target !== baseline
}
