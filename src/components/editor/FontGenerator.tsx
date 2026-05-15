import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Cloud, ExternalLink, Trash2, Type, Upload, X } from 'lucide-react'
import { useEditor } from '../../store/editorStore'
import {
  clearCachedGoogleFonts,
  fontIsAvailable,
  loadCachedGoogleFonts,
  loadFont,
  parseGoogleFontsEmbed,
  saveCachedGoogleFonts,
  type LoadedFont,
  type ParsedGoogleFont,
} from '../../lib/fontLoader'
import {
  rasterizeGlyphs,
  type DecodedBitmap,
} from '../../lib/glyphRasterizer'
import type { FaceNDigitDependentKind } from '../../lib/projectIO'
import FontFamilyPicker from './FontFamilyPicker'

/** What the modal should produce + where to send the result. */
export type FontTarget =
  | {
      /** Replace the bitmaps of an existing Type C asset set. Affects every
       *  layer that consumes the set. */
      mode: 'replace-typeC-asset-set'
      setId: string
      type: number
      name: string
      glyphs: readonly string[]
    }
  | {
      /** Replace the 10 digits of an existing FaceN digit set. All *Num
       *  elements pointing at this set inherit the new pixels. */
      mode: 'replace-faceN-digit-set'
      setIdx: number
    }
  | {
      /** Create a new FaceN digit set (and optionally chain into a digit-
       *  dependent element). Used when a *Num kind is being inserted before
       *  any digit sets exist. */
      mode: 'faceN-new-digit-set'
      chain?: {
        kind: FaceNDigitDependentKind
        position: { x: number; y: number }
        align?: 'L' | 'R' | 'C'
      }
    }

type Props = {
  target: FontTarget | null
  onClose: () => void
}

type FontPick =
  | { kind: 'system'; family: string }
  | { kind: 'upload'; file: File | null; family: string }
  /** `href` is the stylesheet URL the family came from. The loader uses
   *  it verbatim so the user's weight/italic/subset selections from
   *  Google's site are honoured. Empty string → loader builds a default
   *  minimal URL (used by the curated-list fallback). */
  | { kind: 'google'; family: string; href: string }

const DEFAULT_TARGET_FACEN_GLYPHS = ['0','1','2','3','4','5','6','7','8','9']

const rgbaToDataUrl = (bmp: DecodedBitmap): string => {
  const c = document.createElement('canvas')
  c.width = bmp.width
  c.height = bmp.height
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(bmp.width, bmp.height)
  img.data.set(bmp.rgba)
  ctx.putImageData(img, 0, 0)
  return c.toDataURL('image/png')
}

function FontGenerator({ target, onClose }: Props) {
  const insertFaceNDigitSetAction = useEditor((s) => s.insertFaceNDigitSetAction)
  const regenerateAssetSetFromFont = useEditor(
    (s) => s.regenerateAssetSetFromFont,
  )
  const regenerateFaceNDigitSetFromFont = useEditor(
    (s) => s.regenerateFaceNDigitSetFromFont,
  )
  const setError = useEditor((s) => s.setError)

  // Digit-set modes always render the 10 digits. Type C asset-set replace
  // uses whatever the target declares (digits, day names, AM/PM, etc.).
  const presetGlyphs = useMemo<readonly string[]>(
    () =>
      target?.mode === 'replace-typeC-asset-set'
        ? target.glyphs
        : DEFAULT_TARGET_FACEN_GLYPHS,
    [target],
  )

  // Editable glyph text — seeded from the preset, but user-editable for
  // single-slot kinds (labels like "AM" / ":" / etc.). For multi-slot kinds
  // (digits, day names, month names) the preset is canonical and we keep
  // the inputs read-only so the user can't accidentally desync them from
  // the firmware's blob-index expectations.
  //
  // Re-seed when the parent passes a different preset (component instance
  // is reused across open/close cycles). Using the React-docs prop-sync
  // pattern: two state slots + a self-state-update during render. React
  // skips the in-progress render and re-renders with the synced state.
  const [customGlyphs, setCustomGlyphs] = useState<string[]>(() => [
    ...presetGlyphs,
  ])
  const [trackedPreset, setTrackedPreset] = useState(presetGlyphs)
  if (trackedPreset !== presetGlyphs) {
    setTrackedPreset(presetGlyphs)
    setCustomGlyphs([...presetGlyphs])
  }

  // Every kind is now editable per-slot. Single-slot kinds (SEPERATOR,
  // AM/PM, KM/MI) render one text field; multi-slot kinds (DAY_NAME,
  // MONTH_NAME, digits, …) render N fields so the user can override
  // individual slot labels — e.g. switch "Jan/Feb/…" to "JAN/FEB/…" or
  // translate to another language. A Reset button restores the preset.
  const editableSingleText = presetGlyphs.length === 1
  const onResetGlyphs = () => setCustomGlyphs([...presetGlyphs])
  const onPatchGlyph = (idx: number, value: string) => {
    setCustomGlyphs((prev) => {
      const next = prev.slice()
      next[idx] = value
      return next
    })
  }

  // ----- font picker state -----
  const [pick, setPick] = useState<FontPick>({
    kind: 'system',
    family: 'Arial',
  })
  const [loaded, setLoaded] = useState<LoadedFont | null>(null)
  const [fontError, setFontError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Cached Google Fonts the user has previously parsed via the embed
  // input. Hydrated from localStorage on first mount. Adding new ones
  // (via paste + parse) merges in by family name and persists.
  const [cachedGoogleFonts, setCachedGoogleFonts] = useState<
    ParsedGoogleFont[]
  >(() => loadCachedGoogleFonts())
  const [embedInput, setEmbedInput] = useState('')
  const [embedError, setEmbedError] = useState<string | null>(null)

  // ----- glyph params -----
  const [size, setSize] = useState(28)
  const [weight, setWeight] = useState(700)
  const [color, setColor] = useState('#ffffff')
  const [background, setBackground] = useState('#000000')
  const [strokeWidth, setStrokeWidth] = useState(0)
  const [strokeColor, setStrokeColor] = useState('#000000')
  const [width, setWidth] = useState(24)
  const [height, setHeight] = useState(36)

  // FaceN keeps alpha (ARGB8565). Type C is RGB565 — we composite.
  const preserveAlpha =
    target?.mode === 'replace-faceN-digit-set' ||
    target?.mode === 'faceN-new-digit-set'

  // Dispose loaded fonts as `loaded` changes (the previous reference is the
  // one in the effect closure, so the FontFace from the prior pick gets
  // removed from document.fonts on the way to the new one). Also fires on
  // unmount with the final reference.
  useEffect(() => {
    return () => loaded?.dispose()
  }, [loaded])

  // Load font when the pick changes. All setState happens inside .then/.catch
  // so we don't trigger `react-hooks/set-state-in-effect`. The previous
  // `loaded`/`error` linger briefly during the load window — acceptable since
  // the user just sees the old preview for a frame.
  useEffect(() => {
    if (target === null) return
    let cancelled = false

    if (pick.kind === 'system') {
      const family = pick.family.trim()
      if (!family) return
      const available = fontIsAvailable(family, weight)
      loadFont({ kind: 'system', family })
        .then((lf) => {
          if (cancelled) return
          setLoaded(lf)
          setFontError(
            available
              ? null
              : `"${family}" isn't installed — falling back to default.`,
          )
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setLoaded(null)
          setFontError(err instanceof Error ? err.message : String(err))
        })
      return () => {
        cancelled = true
      }
    }

    if (pick.kind === 'upload' && pick.file) {
      loadFont({
        kind: 'upload',
        family: pick.file.name.replace(/\.[^.]+$/, ''),
        file: pick.file,
      })
        .then((lf) => {
          if (cancelled) return
          setLoaded(lf)
          setFontError(null)
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setLoaded(null)
          setFontError(err instanceof Error ? err.message : String(err))
        })
      return () => {
        cancelled = true
      }
    }

    if (pick.kind === 'google') {
      const family = pick.family.trim()
      if (!family) return
      // Loader injects a <link rel="stylesheet"> for the family + weight
      // and waits for `document.fonts.load(...)` — we just react to the
      // promise resolving / rejecting. When `href` is set (from a parsed
      // embed) we use that URL verbatim so user-chosen weights/italics
      // are preserved; otherwise the loader builds a default minimal URL.
      loadFont({
        kind: 'google',
        family,
        weight,
        href: pick.href || undefined,
      })
        .then((lf) => {
          if (cancelled) return
          setLoaded(lf)
          setFontError(null)
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setLoaded(null)
          setFontError(err instanceof Error ? err.message : String(err))
        })
      return () => {
        cancelled = true
      }
    }
  }, [pick, target, weight])

  // Live-rasterized preview. Recomputes when any glyph param changes.
  const bitmaps = useMemo<DecodedBitmap[]>(() => {
    if (!loaded || target === null) return []
    return rasterizeGlyphs({
      glyphs: [...customGlyphs],
      family: loaded.family,
      weight,
      size,
      color,
      background,
      width,
      height,
      preserveAlpha,
      strokeWidth,
      strokeColor,
    })
  }, [
    loaded,
    target,
    customGlyphs,
    weight,
    size,
    color,
    background,
    width,
    height,
    preserveAlpha,
    strokeWidth,
    strokeColor,
  ])

  // Esc to close + body-scroll lock while the modal is open.
  useEffect(() => {
    if (target === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [target, onClose])

  if (target === null) return null

  const onPickFile = () => fileInputRef.current?.click()
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) {
      setPick({ kind: 'upload', file, family: file.name })
    }
  }

  const onCommit = () => {
    if (bitmaps.length === 0) {
      setError('No glyphs generated — pick a font first.')
      return
    }
    switch (target.mode) {
      case 'replace-typeC-asset-set':
        regenerateAssetSetFromFont(target.setId, bitmaps)
        break
      case 'replace-faceN-digit-set':
        regenerateFaceNDigitSetFromFont(target.setIdx, bitmaps)
        break
      case 'faceN-new-digit-set':
        insertFaceNDigitSetAction(bitmaps, target.chain)
        break
    }
    onClose()
  }

  const title =
    target.mode === 'replace-typeC-asset-set'
      ? `Generate ${target.name} from font (${target.glyphs.length} glyphs)`
      : target.mode === 'replace-faceN-digit-set'
        ? `Regenerate digit set ${target.setIdx}`
        : `New digit set${target.chain ? ` → ${target.chain.kind}` : ''}`

  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal fontgen"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fontgen-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Close font generator"
        >
          <X size={20} />
        </button>

        <div className="fontgen-body">
          <h2 id="fontgen-title">{title}</h2>

          <section className="fontgen-section">
            <h3>Font source</h3>
            <div className="fontgen-source">
              <label className="fontgen-radio">
                <input
                  type="radio"
                  checked={pick.kind === 'system'}
                  onChange={() =>
                    setPick({
                      kind: 'system',
                      family: pick.kind === 'system' ? pick.family : 'Arial',
                    })
                  }
                />
                <Type size={14} aria-hidden /> System
              </label>
              <label className="fontgen-radio">
                <input
                  type="radio"
                  checked={pick.kind === 'google'}
                  onChange={() =>
                    setPick({
                      kind: 'google',
                      family: pick.kind === 'google' ? pick.family : 'Roboto',
                      // Stay on whatever URL was last loaded; "" falls
                      // back to the loader's minimal default.
                      href: pick.kind === 'google' ? pick.href : '',
                    })
                  }
                />
                <Cloud size={14} aria-hidden /> Google Fonts
              </label>
              <label className="fontgen-radio">
                <input
                  type="radio"
                  checked={pick.kind === 'upload'}
                  onChange={() =>
                    setPick({ kind: 'upload', file: null, family: '' })
                  }
                />
                <Upload size={14} aria-hidden /> Upload
              </label>
            </div>

            {pick.kind === 'system' && (
              <label className="prop-field">
                <span>Family</span>
                <FontFamilyPicker
                  value={pick.family}
                  onChange={(family) =>
                    setPick({ kind: 'system', family })
                  }
                  previewWeight={weight}
                />
              </label>
            )}

            {pick.kind === 'google' && (
              <div className="fontgen-google">
                <details className="fontgen-google-help">
                  <summary>How to add a Google Font</summary>
                  <ol>
                    <li>
                      Open{' '}
                      <a
                        href="https://fonts.google.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        fonts.google.com
                        <ExternalLink size={11} aria-hidden />
                      </a>
                      .
                    </li>
                    <li>
                      Pick a font, choose the styles/weights you want, and
                      click <strong>Get embed code</strong>.
                    </li>
                    <li>
                      Copy the <code>&lt;link&gt;</code> tag (or just the
                      URL / <code>@import</code> rule).
                    </li>
                    <li>
                      Paste it below and press <strong>Add</strong>. The
                      families show up in the dropdown for re-use across
                      sessions.
                    </li>
                  </ol>
                </details>

                <label className="prop-field">
                  <span>Google Fonts embed</span>
                  <textarea
                    className="fontgen-google-embed"
                    value={embedInput}
                    onChange={(e) => {
                      setEmbedInput(e.target.value)
                      setEmbedError(null)
                    }}
                    placeholder='Paste <link href="https://fonts.googleapis.com/css2?family=…"> or the URL'
                    rows={3}
                    spellCheck={false}
                  />
                </label>
                <div className="fontgen-google-actions">
                  <button
                    type="button"
                    className="counter"
                    onClick={() => {
                      const parsed = parseGoogleFontsEmbed(embedInput)
                      if (!parsed) {
                        setEmbedError(
                          "Couldn't find a Google Fonts URL in the input. " +
                            'Expected a <link> tag, an @import rule, or a ' +
                            'fonts.googleapis.com/css2 URL.',
                        )
                        return
                      }
                      const merged = saveCachedGoogleFonts(
                        cachedGoogleFonts,
                        parsed,
                      )
                      setCachedGoogleFonts(merged)
                      setEmbedInput('')
                      setEmbedError(null)
                      // Auto-pick the first newly-parsed family so the
                      // preview updates immediately. Subsequent picks
                      // happen via the family dropdown.
                      const first = parsed[0]
                      setPick({
                        kind: 'google',
                        family: first.family,
                        href: first.href,
                      })
                    }}
                    disabled={!embedInput.trim()}
                  >
                    Add
                  </button>
                  <a
                    href="https://fonts.google.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="counter ghost fontgen-google-link"
                  >
                    <ExternalLink size={14} aria-hidden />
                    Open Google Fonts
                  </a>
                  {cachedGoogleFonts.length > 0 && (
                    <button
                      type="button"
                      className="counter ghost fontgen-google-clear"
                      onClick={() => {
                        if (
                          !window.confirm(
                            'Clear all saved Google Fonts? This only removes them from this editor — anything already rasterized stays put.',
                          )
                        ) {
                          return
                        }
                        clearCachedGoogleFonts()
                        setCachedGoogleFonts([])
                      }}
                    >
                      <Trash2 size={14} aria-hidden />
                      Clear saved
                    </button>
                  )}
                </div>
                {embedError && (
                  <p className="hint fontgen-google-error">{embedError}</p>
                )}

                <label className="prop-field">
                  <span>Family</span>
                  <FontFamilyPicker
                    source="google"
                    value={pick.family}
                    onChange={(family) => {
                      // If the picked family matches one in the cache,
                      // use its exact href so user-chosen weights/italics
                      // are preserved; otherwise empty href → loader
                      // builds a default minimal URL.
                      const hit = cachedGoogleFonts.find(
                        (g) => g.family === family,
                      )
                      setPick({
                        kind: 'google',
                        family,
                        href: hit?.href ?? '',
                      })
                    }}
                    previewWeight={weight}
                    // Cached families first (sorted alphabetically) so the
                    // user sees what they've pasted at the top; the
                    // curated popular list still surfaces via Enter on
                    // any unmatched query.
                    families={
                      cachedGoogleFonts.length > 0
                        ? cachedGoogleFonts
                            .map((g) => g.family)
                            .sort((a, b) => a.localeCompare(b))
                        : undefined
                    }
                  />
                </label>
                <p className="hint">
                  Google fetches the stylesheet from{' '}
                  <code>fonts.googleapis.com</code> on demand. Pasting the
                  embed preserves the exact weights/italics you picked on
                  Google's site — the editor's own weight slider below
                  applies on top.
                </p>
              </div>
            )}

            {pick.kind === 'upload' && (
              <div className="fontgen-upload">
                <button
                  type="button"
                  className="counter ghost"
                  onClick={onPickFile}
                >
                  <Upload size={14} aria-hidden />
                  {pick.file ? pick.file.name : 'Pick .ttf or .otf…'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".ttf,.otf,font/ttf,font/otf"
                  hidden
                  onChange={onFile}
                />
              </div>
            )}

            {fontError && <p className="hint">{fontError}</p>}
          </section>

          <section className="fontgen-section">
            <h3>Glyph parameters</h3>
            {editableSingleText && (
              <label className="prop-field fontgen-text-field">
                <span>text</span>
                <input
                  type="text"
                  value={customGlyphs[0] ?? ''}
                  placeholder="e.g. AM, PM, KM, MI, :"
                  onChange={(e) => setCustomGlyphs([e.target.value])}
                  autoFocus
                />
              </label>
            )}
            {!editableSingleText && (
              <div className="fontgen-glyph-grid">
                <header>
                  <span>Slot text</span>
                  <button
                    type="button"
                    className="counter ghost fontgen-reset"
                    onClick={onResetGlyphs}
                  >
                    Reset to defaults
                  </button>
                </header>
                <div className="fontgen-glyph-inputs">
                  {customGlyphs.map((g, i) => (
                    <label key={i} className="fontgen-glyph-input">
                      <span>{presetGlyphs[i] ?? i}</span>
                      <input
                        type="text"
                        value={g}
                        onChange={(e) => onPatchGlyph(i, e.target.value)}
                        spellCheck={false}
                        autoCorrect="off"
                        autoCapitalize="off"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="prop-row">
              <label className="prop-field">
                <span>w</span>
                <input
                  type="number"
                  value={width}
                  min={1}
                  max={240}
                  onChange={(e) => setWidth(Math.max(1, parseInt(e.target.value, 10) || 1))}
                />
              </label>
              <label className="prop-field">
                <span>h</span>
                <input
                  type="number"
                  value={height}
                  min={1}
                  max={240}
                  onChange={(e) => setHeight(Math.max(1, parseInt(e.target.value, 10) || 1))}
                />
              </label>
            </div>
            <div className="prop-row">
              <label className="prop-field">
                <span>size (px)</span>
                <input
                  type="number"
                  value={size}
                  min={4}
                  max={240}
                  onChange={(e) => setSize(Math.max(4, parseInt(e.target.value, 10) || 4))}
                />
              </label>
              <label className="prop-field">
                <span>weight</span>
                <input
                  type="number"
                  value={weight}
                  min={100}
                  max={900}
                  step={100}
                  onChange={(e) => setWeight(parseInt(e.target.value, 10) || 400)}
                />
              </label>
            </div>
            <div className="prop-row">
              <label className="prop-field prop-color">
                <span>color</span>
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
                <input
                  type="text"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
              </label>
              {!preserveAlpha && (
                <label className="prop-field prop-color">
                  <span>background</span>
                  <input
                    type="color"
                    value={background}
                    onChange={(e) => setBackground(e.target.value)}
                  />
                  <input
                    type="text"
                    value={background}
                    onChange={(e) => setBackground(e.target.value)}
                  />
                </label>
              )}
            </div>
            {preserveAlpha && (
              <p className="hint">
                FaceN preserves alpha — glyphs render against a transparent
                background, composited live by the watch.
              </p>
            )}
            <div className="prop-row">
              <label className="prop-field">
                <span>stroke (px)</span>
                <input
                  type="number"
                  value={strokeWidth}
                  min={0}
                  max={20}
                  step={0.5}
                  onChange={(e) =>
                    setStrokeWidth(Math.max(0, parseFloat(e.target.value) || 0))
                  }
                />
              </label>
              {strokeWidth > 0 && (
                <label className="prop-field prop-color">
                  <span>stroke color</span>
                  <input
                    type="color"
                    value={strokeColor}
                    onChange={(e) => setStrokeColor(e.target.value)}
                  />
                  <input
                    type="text"
                    value={strokeColor}
                    onChange={(e) => setStrokeColor(e.target.value)}
                  />
                </label>
              )}
            </div>
          </section>

          <section className="fontgen-section">
            <h3>Preview ({bitmaps.length} of {customGlyphs.length})</h3>
            {bitmaps.length === 0 ? (
              <p className="hint">
                {loaded ? 'Adjust parameters to render the preview.' : 'Pick a font to preview.'}
              </p>
            ) : (
              <ul className="fontgen-preview">
                {bitmaps.map((b, i) => (
                  <li key={i} className="fontgen-cell">
                    <div
                      className="fontgen-thumb"
                      style={{
                        // Show the background color underneath transparent
                        // glyphs (FaceN) so they're not invisible on dark UI.
                        background: preserveAlpha
                          ? 'repeating-conic-gradient(#333 0% 25%, #1a1a22 0% 50%) 50% / 8px 8px'
                          : 'transparent',
                      }}
                    >
                      <img
                        src={rgbaToDataUrl(b)}
                        alt={customGlyphs[i]}
                        style={{
                          imageRendering: 'pixelated',
                        }}
                      />
                    </div>
                    <code className="fontgen-glyph">{customGlyphs[i]}</code>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="modal-actions">
            <button
              type="button"
              className="counter"
              onClick={onCommit}
              disabled={bitmaps.length === 0}
            >
              Insert
            </button>
            <button
              type="button"
              className="counter ghost"
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default FontGenerator
