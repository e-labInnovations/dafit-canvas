import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { File as FileIcon, Square, Type, X } from 'lucide-react'
import { useEditor } from '../../store/editorStore'
import { blobCountForType } from '../../lib/dawft'
import {
  decodeBmpFile,
  type InsertableType,
} from '../../lib/projectIO'
import type { FontTarget } from './FontGenerator'
import InsertableInfoCard from './InsertableInfoCard'

type Props = {
  k: InsertableType
  onClose: () => void
  /** Called when the user picks "from font" — the host opens the
   *  FontGenerator with the supplied target (parent owns the modal). */
  onOpenFontTarget: (t: FontTarget) => void
}

/** Modal that creates a new asset set. Reached from the AssetLibrary
 *  picker. Three create paths:
 *   1. Empty placeholder (with editable w/h)
 *   2. Pick BMP file(s) — file picker
 *   3. From font — hands off to FontGenerator
 *  The info card lives at the top of the modal so the user can re-read
 *  what the type does without going back to the picker. */
function NewAssetModal({ k, onClose, onOpenFontTarget }: Props) {
  const project = useEditor((s) => s.project)
  const createAssetSetAction = useEditor((s) => s.createAssetSetAction)
  const setAnimationFramesAction = useEditor(
    (s) => s.setAnimationFramesAction,
  )

  const [draftW, setDraftW] = useState(String(k.dim.w))
  const [draftH, setDraftH] = useState(String(k.dim.h))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Lock body scroll while open + Esc to close.
  useEffect(() => {
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
  }, [onClose])

  if (!project || project.format !== 'typeC') return null

  /** Animation sets need a project-wide frame count > 1 to be meaningful
   *  — prompt before the create paths fire so the new set lands with the
   *  right slot count instead of 1. */
  const ensureAnimFrames = (): boolean => {
    if (k.type < 0xf6 || k.type > 0xf8) return true
    if (project.animationFrames >= 2) return true
    const ans = window.prompt(
      'Animation needs a frame count. How many frames?\n(2–250, shared across all animation layers on this face)',
      '10',
    )
    if (ans === null) return false
    const n = parseInt(ans, 10)
    if (!Number.isFinite(n) || n < 2 || n > 250) return false
    return setAnimationFramesAction(n) === null
  }

  const onCreateEmpty = () => {
    if (!ensureAnimFrames()) return
    const w = parseInt(draftW, 10)
    const h = parseInt(draftH, 10)
    if (!Number.isFinite(w) || w < 1 || !Number.isFinite(h) || h < 1) {
      setError('Width and height must be positive integers.')
      return
    }
    createAssetSetAction(k.type, undefined, { size: { w, h } })
    onClose()
  }

  const onPickBmp = async () => {
    if (!ensureAnimFrames()) return
    const expected = blobCountForType(
      k.type,
      useEditor.getState().project?.format === 'typeC'
        ? (useEditor.getState().project as { animationFrames: number })
            .animationFrames
        : 0,
    )
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.bmp,image/bmp'
    input.multiple = expected > 1
    input.onchange = async () => {
      const files = Array.from(input.files ?? [])
      if (files.length === 0) return
      // Sort numerically by filename so 01.bmp, 02.bmp, … land in order.
      files.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
      )
      if (expected > 1 && files.length !== expected) {
        setError(
          `${k.name} expects ${expected} bitmap${expected === 1 ? '' : 's'}, ` +
            `got ${files.length}. Pick the right number and try again.`,
        )
        return
      }
      setBusy(true)
      try {
        const bitmaps = await Promise.all(files.map(decodeBmpFile))
        createAssetSetAction(k.type, bitmaps)
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    }
    input.click()
  }

  const onPickFont = () => {
    if (!ensureAnimFrames()) return
    if (!k.glyphs) return
    // Create an empty set first, then point the font generator at it.
    createAssetSetAction(k.type, undefined, {
      size: {
        w: parseInt(draftW, 10) || k.dim.w,
        h: parseInt(draftH, 10) || k.dim.h,
      },
    })
    const updated = useEditor.getState().project
    if (updated?.format !== 'typeC') return
    const justAdded = updated.assetSets[updated.assetSets.length - 1]
    if (!justAdded) return
    onOpenFontTarget({
      mode: 'replace-typeC-asset-set',
      setId: justAdded.id,
      type: k.type,
      name: k.name,
      glyphs: k.glyphs,
    })
    onClose()
  }

  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal insert-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-asset-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={20} />
        </button>
        <div className="insert-modal-body">
          <h2 id="new-asset-title" className="insert-modal-title">
            New asset set
          </h2>
          <InsertableInfoCard k={k} variant="expanded" />

          {error && (
            <div className="banner banner-error">
              <div>{error}</div>
            </div>
          )}

          <div className="insert-modal-paths">
            <article className="insert-modal-path">
              <header>
                <Square size={16} aria-hidden />
                <h3>Empty placeholder</h3>
              </header>
              <p className="hint">
                Create a blank set with placeholder slots. Pick dimensions
                up-front; you can fill bitmaps later from the slot list.
              </p>
              <div className="insert-modal-size">
                <label>
                  <span>W</span>
                  <input
                    type="number"
                    min={1}
                    value={draftW}
                    onChange={(e) => setDraftW(e.target.value)}
                  />
                </label>
                <span aria-hidden>×</span>
                <label>
                  <span>H</span>
                  <input
                    type="number"
                    min={1}
                    value={draftH}
                    onChange={(e) => setDraftH(e.target.value)}
                  />
                </label>
              </div>
              <button
                type="button"
                className="counter"
                onClick={onCreateEmpty}
                disabled={busy}
              >
                Create empty
              </button>
            </article>

            <article className="insert-modal-path">
              <header>
                <FileIcon size={16} aria-hidden />
                <h3>From BMP file{k.count > 1 ? 's' : ''}</h3>
              </header>
              <p className="hint">
                {k.count === 1
                  ? 'Pick a single BMP and the set adopts its dimensions.'
                  : `Pick ${k.count} BMPs at once — sorted by filename and mapped to slots 0…${k.count - 1}.`}
              </p>
              <button
                type="button"
                className="counter"
                onClick={onPickBmp}
                disabled={busy}
              >
                {busy ? 'Loading…' : 'Pick file…'}
              </button>
            </article>

            {k.glyphs && (
              <article className="insert-modal-path">
                <header>
                  <Type size={16} aria-hidden />
                  <h3>From font</h3>
                </header>
                <p className="hint">
                  Generate slots from a font. Useful for digit / day-name /
                  month-name sets — you pick a typeface and we rasterize the
                  glyphs at the cell size.
                </p>
                <button
                  type="button"
                  className="counter"
                  onClick={onPickFont}
                  disabled={busy}
                >
                  Open font generator
                </button>
              </article>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default NewAssetModal
