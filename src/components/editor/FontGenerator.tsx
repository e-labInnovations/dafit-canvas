import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Type, Upload, X } from 'lucide-react'
import { useEditor } from '../../store/editorStore'
import {
  COMMON_SYSTEM_FONTS,
  fontIsAvailable,
  loadFont,
  type LoadedFont,
} from '../../lib/fontLoader'
import {
  rasterizeGlyphs,
  type DecodedBitmap,
} from '../../lib/glyphRasterizer'
import type { FaceNDigitDependentKind } from '../../lib/projectIO'

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
  const glyphs =
    target?.mode === 'replace-typeC-asset-set'
      ? target.glyphs
      : DEFAULT_TARGET_FACEN_GLYPHS

  // ----- font picker state -----
  const [pick, setPick] = useState<FontPick>({
    kind: 'system',
    family: 'Arial',
  })
  const [loaded, setLoaded] = useState<LoadedFont | null>(null)
  const [fontError, setFontError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ----- glyph params -----
  const [size, setSize] = useState(28)
  const [weight, setWeight] = useState(700)
  const [color, setColor] = useState('#ffffff')
  const [background, setBackground] = useState('#000000')
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
  }, [pick, target, weight])

  // Live-rasterized preview. Recomputes when any glyph param changes.
  const bitmaps = useMemo<DecodedBitmap[]>(() => {
    if (!loaded || target === null) return []
    return rasterizeGlyphs({
      glyphs: [...glyphs],
      family: loaded.family,
      weight,
      size,
      color,
      background,
      width,
      height,
      preserveAlpha,
    })
  }, [loaded, target, glyphs, weight, size, color, background, width, height, preserveAlpha])

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
                  onChange={() => setPick({ kind: 'system', family: pick.kind === 'system' ? pick.family : 'Arial' })}
                />
                <Type size={14} aria-hidden /> System
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
              <div className="prop-row">
                <label className="prop-field">
                  <span>Family</span>
                  <input
                    type="text"
                    list="fontgen-fonts"
                    value={pick.family}
                    onChange={(e) =>
                      setPick({ kind: 'system', family: e.target.value })
                    }
                  />
                  <datalist id="fontgen-fonts">
                    {COMMON_SYSTEM_FONTS.map((f) => (
                      <option key={f} value={f} />
                    ))}
                  </datalist>
                </label>
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
          </section>

          <section className="fontgen-section">
            <h3>Preview ({bitmaps.length} of {glyphs.length})</h3>
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
                        alt={glyphs[i]}
                        style={{
                          imageRendering: 'pixelated',
                        }}
                      />
                    </div>
                    <code className="fontgen-glyph">{glyphs[i]}</code>
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
