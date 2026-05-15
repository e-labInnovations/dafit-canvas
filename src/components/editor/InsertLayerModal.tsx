import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  File as FileIcon,
  Link2,
  Square,
  Type,
  X,
} from 'lucide-react'
import { useEditor } from '../../store/editorStore'
import { blobCountForType } from '../../lib/dawft'
import {
  compatibleSetsForType,
  decodeBmpFile,
  type InsertableType,
} from '../../lib/projectIO'
import { assetSetThumbDataUrl } from '../../lib/assetThumb'
import type { FontTarget } from './FontGenerator'
import InsertableInfoCard from './InsertableInfoCard'

type Props = {
  k: InsertableType
  onClose: () => void
  onOpenFontTarget: (t: FontTarget) => void
}

/** Modal that creates a new Type C layer. Four create paths:
 *   1. Empty placeholder — fresh AssetSet, layer wired up
 *   2. Use existing asset — bind to a dimension-compatible set already
 *      in the library (no new blobs allocated; firmware reads shared range)
 *   3. From BMP file(s)
 *   4. From font (only when the type has a glyph preset)
 *
 *  The info card sits at the top so the user can re-read what they're
 *  inserting without bouncing back to the picker. */
function InsertLayerModal({ k, onClose, onOpenFontTarget }: Props) {
  const project = useEditor((s) => s.project)
  const insertTypeCEmpty = useEditor((s) => s.insertTypeCEmpty)
  const insertTypeC = useEditor((s) => s.insertTypeC)
  const insertTypeCShared = useEditor((s) => s.insertTypeCShared)
  const setAnimationFramesAction = useEditor(
    (s) => s.setAnimationFramesAction,
  )

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  // Every set in the library whose slot count matches this type — single
  // and multi alike. Single-slot kinds (BACKGROUND, hands, logos) can
  // also be reused across layers: the materializer emits the AssetSet
  // once and multiple FaceData entries point at the same idx, which is
  // exactly the "blob sharing" pattern the firmware supports.
  const sharable = compatibleSetsForType(project, k.type)

  const onCreateEmpty = () => {
    if (!ensureAnimFrames()) return
    insertTypeCEmpty(k.type)
    onClose()
  }

  const onUseExisting = (setId: string) => {
    insertTypeCShared(k.type, setId)
    onClose()
  }

  const onPickBmp = () => {
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
      files.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
      )
      if (expected > 1 && files.length !== expected) {
        setError(
          `${k.name} expects ${expected} bitmap${expected === 1 ? '' : 's'}, ` +
            `got ${files.length}.`,
        )
        return
      }
      setBusy(true)
      try {
        if (expected === 1) {
          const bmp = await decodeBmpFile(files[0])
          insertTypeC(k.type, bmp)
        } else {
          // For multi-slot kinds we mirror NewAssetModal's flow: create
          // the set via createAssetSetAction, then insert a layer that
          // shares it. The store action API is split so callers can pick
          // either step independently, but here we want both.
          const bitmaps = await Promise.all(files.map(decodeBmpFile))
          useEditor.getState().createAssetSetAction(k.type, bitmaps)
          const updated = useEditor.getState().project
          if (updated?.format === 'typeC') {
            const justAdded =
              updated.assetSets[updated.assetSets.length - 1]
            if (justAdded) insertTypeCShared(k.type, justAdded.id)
          }
        }
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
    // Same chain as font-from-asset: empty insert → grab the freshly
    // created set's id → open the font generator pointed at it. The
    // generator commits the slot bitmaps when the user clicks Apply.
    insertTypeCEmpty(k.type)
    const updated = useEditor.getState().project
    if (updated?.format !== 'typeC') return
    const justAddedLayer = updated.layers[updated.layers.length - 1]
    if (!justAddedLayer) return
    onOpenFontTarget({
      mode: 'replace-typeC-asset-set',
      setId: justAddedLayer.assetSetId,
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
        aria-labelledby="insert-layer-title"
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
          <h2 id="insert-layer-title" className="insert-modal-title">
            Insert layer
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
                Create a fresh asset set with placeholder slots and a new
                layer that consumes it. Pixel-fill from the slot list once
                inserted.
              </p>
              <button
                type="button"
                className="counter"
                onClick={onCreateEmpty}
                disabled={busy}
              >
                Insert empty
              </button>
            </article>

            {sharable.length > 0 && (
              <article className="insert-modal-path insert-modal-path-wide">
                <header>
                  <Link2 size={16} aria-hidden />
                  <h3>Use existing asset</h3>
                </header>
                <p className="hint">
                  Bind the new layer to an existing asset set with the same
                  slot count. Firmware reads the shared blob range — no
                  extra bytes in the binary.
                </p>
                <ul className="insert-modal-share-list">
                  {sharable.map((set) => {
                    const thumb = assetSetThumbDataUrl(set)
                    return (
                      <li key={set.id}>
                        <button
                          type="button"
                          className="insert-modal-share-row"
                          onClick={() => onUseExisting(set.id)}
                          disabled={busy}
                        >
                          <span className="insert-modal-share-thumb">
                            {thumb ? (
                              <img
                                src={thumb}
                                alt=""
                                style={{ imageRendering: 'pixelated' }}
                              />
                            ) : (
                              <span className="asset-empty">empty</span>
                            )}
                          </span>
                          <span className="insert-modal-share-meta">
                            <strong>{set.name}</strong>
                            <small>
                              {set.count}×{set.width}×{set.height}
                            </small>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </article>
            )}

            <article className="insert-modal-path">
              <header>
                <FileIcon size={16} aria-hidden />
                <h3>From BMP file{k.count > 1 ? 's' : ''}</h3>
              </header>
              <p className="hint">
                {k.count === 1
                  ? 'Pick a single BMP and the layer adopts its dimensions.'
                  : `Pick ${k.count} BMPs at once — sorted by filename, mapped to slots 0…${k.count - 1}.`}
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
                  Generate the set's slots from a font, then create a layer
                  pointing at it.
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

export default InsertLayerModal
