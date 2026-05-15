// Thin wrapper around the FontFace API. Three sources:
//  - 'system'  → use the family name as-is in canvas `ctx.font`
//  - 'upload'  → load a .ttf/.otf File into the document via `new FontFace()`
//  - 'google'  → inject a <link rel="stylesheet"> off fonts.googleapis.com,
//                wait for `document.fonts.load(...)` to resolve.

export type FontSource =
  | { kind: 'system'; family: string }
  | { kind: 'upload'; family: string; file: File }
  /** Google Fonts. If `href` is supplied (e.g. a URL extracted from a
   *  user-pasted embed) it's used verbatim; otherwise a default minimal
   *  CSS2 URL is built for the family+weight pair. The latter is fine
   *  for the curated dropdown; the former lets users opt into specific
   *  weights / italic / subsets that Google's website composed for them. */
  | { kind: 'google'; family: string; weight?: number; href?: string }

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

/** Curated list of popular Google Fonts surfaced in the font picker.
 *  Roughly the top of the Google Fonts usage chart, biased toward families
 *  that read well at small sizes (watch faces tend to use 16–30 px glyphs).
 *  Users can still type a custom family name and the loader will fetch it
 *  on demand — this list just seeds the dropdown. */
export const COMMON_GOOGLE_FONTS = [
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Oswald',
  'Source Sans 3',
  'Poppins',
  'Raleway',
  'Inter',
  'Noto Sans',
  'PT Sans',
  'Ubuntu',
  'Nunito',
  'Work Sans',
  'Bebas Neue',
  'Anton',
  'Barlow',
  'DM Sans',
  'Fira Sans',
  'Karla',
  'Manrope',
  'Quicksand',
  'Mulish',
  'Rubik',
  'Asap',
  'Cabin',
  'IBM Plex Sans',
  'Outfit',
  'Saira',
  // Serif
  'Merriweather',
  'Playfair Display',
  'PT Serif',
  'Lora',
  'Source Serif 4',
  // Mono / display
  'Roboto Mono',
  'JetBrains Mono',
  'Fira Code',
  'IBM Plex Mono',
  'Space Mono',
  'Press Start 2P',
  'VT323',
  'Major Mono Display',
  'Black Ops One',
  'Orbitron',
] as const

/** Track in-flight google-font loads so the FontGenerator's quick "tweak
 *  weight, see preview" loop doesn't inject the same stylesheet ten times. */
const googleLinkCache = new Map<string, HTMLLinkElement>()

const buildGoogleHref = (family: string, weight: number): string => {
  const urlFamily = family.trim().replace(/\s+/g, '+')
  // `display=swap` matches the documented pattern — show the fallback
  // immediately, swap to the real font when it lands.
  return `https://fonts.googleapis.com/css2?family=${urlFamily}:wght@${weight}&display=swap`
}

const loadGoogleFont = async (
  family: string,
  weight: number,
  hrefOverride?: string,
): Promise<LoadedFont> => {
  const href = hrefOverride ?? buildGoogleHref(family, weight)
  let link = googleLinkCache.get(href)
  if (!link) {
    link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    document.head.appendChild(link)
    googleLinkCache.set(href, link)
  }
  // `document.fonts.load` resolves once the FontFace finishes loading.
  // We have to specify a numeric weight + a size + the family name,
  // otherwise the matcher may return the placeholder fallback.
  await document.fonts.load(`${weight} 24px "${family}"`)
  return {
    family,
    // Keep the <link> cached — re-using it on the next pick avoids a
    // redundant network round-trip.
    dispose: () => {},
  }
}

/** Parse a Google Fonts embed (link tag, raw URL, or `@import` CSS) into
 *  a structured list of families. Accepts the three forms Google's UI
 *  hands out:
 *    1. `<link href="…fonts.googleapis.com/css2?family=…" rel="stylesheet">`
 *    2. `@import url('…fonts.googleapis.com/css2?family=…');`
 *    3. A bare URL.
 *  Pasting multiple links at once is supported — each `<link>` tag's URL
 *  is parsed independently and the families are flattened.
 *
 *  Returns `null` when the input doesn't contain any valid Google CSS2
 *  URL — the UI uses this to show an error toast. */
export type ParsedGoogleFont = {
  family: string
  /** Default weight from the URL's `wght@…` spec. `400` if the user didn't
   *  specify one (matches Google's own default). */
  weight: number
  /** Full URL of the stylesheet this family was extracted from. The
   *  loader fetches *this* URL when the user picks this family — keeps
   *  any italic / weight / subset selections the user made on Google's
   *  site. */
  href: string
}

export const parseGoogleFontsEmbed = (
  input: string,
): ParsedGoogleFont[] | null => {
  if (!input.trim()) return null
  // Pull every URL pointing at fonts.googleapis.com out of the blob,
  // regardless of which framing it came in (href="…", url(…), bare).
  // Both `https` and `//` (protocol-relative) hosts are accepted.
  const urlRe =
    /(?:https?:)?\/\/fonts\.googleapis\.com\/css2\?[^\s"'<>)]+/g
  const matches = input.match(urlRe)
  if (!matches || matches.length === 0) return null

  const out: ParsedGoogleFont[] = []
  for (const rawUrl of matches) {
    const normalised = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl
    let url: URL
    try {
      url = new URL(normalised)
    } catch {
      continue
    }
    // CSS2 URLs use repeated `family` params — `URL.searchParams.getAll`
    // returns them in source order.
    const families = url.searchParams.getAll('family')
    for (const f of families) {
      const [namePart, axisPart] = f.split(':')
      const family = decodeURIComponent(namePart.replace(/\+/g, ' ')).trim()
      if (!family) continue
      // `wght@400;700` → take the first weight as the default; we don't
      // need every variant — the picker exposes its own weight slider.
      let weight = 400
      const wghtMatch = axisPart?.match(/wght@([^&]+)/)
      if (wghtMatch) {
        // Strip italic prefix if present (`0,400;1,400` → `400,400`).
        const first = wghtMatch[1]
          .split(';')[0]
          .split(',')
          .pop()
        const n = parseInt(first ?? '', 10)
        if (Number.isFinite(n) && n > 0) weight = n
      }
      out.push({ family, weight, href: normalised })
    }
  }
  return out.length > 0 ? out : null
}

export const loadFont = async (source: FontSource): Promise<LoadedFont> => {
  if (source.kind === 'system') {
    return { family: source.family, dispose: () => {} }
  }

  if (source.kind === 'google') {
    return loadGoogleFont(source.family, source.weight ?? 400, source.href)
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

/** localStorage-backed cache of Google Fonts the user has parsed via the
 *  embed input. Survives page reloads so the user doesn't re-paste the
 *  same URL each time they open the font generator. The cache stores
 *  `(family, weight, href)` tuples so we can rehydrate the FontFamilyPicker
 *  with the exact URLs that produced those families — preserving any
 *  weight / italic / subset selections from Google's site. */
const GOOGLE_FONT_CACHE_KEY = 'dafit-canvas/google-fonts/v1'

export const loadCachedGoogleFonts = (): ParsedGoogleFont[] => {
  try {
    const raw = localStorage.getItem(GOOGLE_FONT_CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is ParsedGoogleFont =>
        e !== null &&
        typeof e === 'object' &&
        typeof (e as ParsedGoogleFont).family === 'string' &&
        typeof (e as ParsedGoogleFont).href === 'string' &&
        typeof (e as ParsedGoogleFont).weight === 'number',
    )
  } catch {
    // localStorage may throw in private browsing or with quota
    // exhaustion — degrade silently to "no cached fonts".
    return []
  }
}

/** Merge new families into the cache, deduplicating by family name (latest
 *  href + weight wins). Returns the merged list so callers can update UI
 *  state from one source. */
export const saveCachedGoogleFonts = (
  existing: ParsedGoogleFont[],
  incoming: ParsedGoogleFont[],
): ParsedGoogleFont[] => {
  const byFamily = new Map<string, ParsedGoogleFont>()
  for (const e of existing) byFamily.set(e.family, e)
  for (const e of incoming) byFamily.set(e.family, e)
  const merged = Array.from(byFamily.values())
  try {
    localStorage.setItem(GOOGLE_FONT_CACHE_KEY, JSON.stringify(merged))
  } catch {
    /* silently fall back to in-memory only */
  }
  return merged
}

export const clearCachedGoogleFonts = (): void => {
  try {
    localStorage.removeItem(GOOGLE_FONT_CACHE_KEY)
  } catch {
    /* ignore */
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
