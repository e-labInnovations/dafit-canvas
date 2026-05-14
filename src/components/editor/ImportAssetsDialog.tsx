import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  CheckSquare,
  FileInput,
  Square,
  Upload,
  X,
} from 'lucide-react'
import { useEditor } from '../../store/editorStore'
import { importBin, importZip } from '../../lib/projectIO'
import Tooltip from '../Tooltip'
import type { AssetSet } from '../../types/face'

type Props = {
  onClose: () => void
}

type Source = {
  fileName: string
  sets: AssetSet[]
}

const rgbaToDataUrl = (
  rgba: Uint8ClampedArray | null,
  w: number,
  h: number,
): string => {
  if (!rgba || w === 0 || h === 0) return ''
  if (rgba.length !== w * h * 4) return ''
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(w, h)
  img.data.set(rgba)
  ctx.putImageData(img, 0, 0)
  return c.toDataURL('image/png')
}

/** Decode a watch face file and return its (Type C) asset sets. Rejects
 *  FaceN — that format bakes images inside elements; there's no shared
 *  library to copy across. */
const loadSource = async (file: File): Promise<Source> => {
  const isBin = /\.bin$/i.test(file.name)
  const isZip = /\.zip$/i.test(file.name)
  if (!isBin && !isZip) throw new Error('Pick a .bin or .zip file.')
  const project = isBin ? await importBin(file) : await importZip(file)
  if (project.format !== 'typeC') {
    throw new Error(
      'This file is a FaceN watch face. FaceN bakes images into elements, ' +
        'so there’s no shared asset library to import from.',
    )
  }
  return { fileName: file.name, sets: project.assetSets }
}

function ImportAssetsDialog({ onClose }: Props) {
  const project = useEditor((s) => s.project)
  const importAssetSets = useEditor((s) => s.importAssetSetsAction)

  const [source, setSource] = useState<Source | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())

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

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setLoading(true)
    setError(null)
    setSource(null)
    // New file → start with nothing selected. Reset here (not in an effect)
    // so the lint rule against setState-in-effect stays clean.
    setPicked(new Set())
    try {
      const next = await loadSource(f)
      setSource(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const allSelected = useMemo(
    () =>
      source !== null &&
      source.sets.length > 0 &&
      picked.size === source.sets.length,
    [source, picked],
  )
  const toggleAll = () => {
    if (!source) return
    if (allSelected) setPicked(new Set())
    else setPicked(new Set(source.sets.map((s) => s.id)))
  }

  const doImport = () => {
    if (!source) return
    const toImport = source.sets.filter((s) => picked.has(s.id))
    if (toImport.length === 0) return
    importAssetSets(toImport)
    onClose()
  }

  // Disable the open button if the current project isn't Type C.
  const wrongFormat = project !== null && project.format !== 'typeC'

  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal import-assets-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-assets-title"
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

        <div className="import-assets-body">
          <header className="import-assets-head">
            <h2 id="import-assets-title">Import assets from watch face</h2>
            <p>
              Pick a <code>.bin</code> or <code>.zip</code> from another Type C
              watch face. The selected asset sets will be added to your
              current library — no layers are created. Bind them to a layer
              via the asset picker afterward.
            </p>
          </header>

          {wrongFormat && (
            <div className="banner banner-warn">
              <AlertTriangle size={16} aria-hidden />
              <div>
                Asset import is Type C only. Your current project is FaceN.
              </div>
            </div>
          )}

          <label className="import-assets-picker">
            <input
              type="file"
              accept=".bin,.zip,application/zip,application/octet-stream"
              onChange={onPick}
              disabled={wrongFormat || loading}
            />
            <span className="counter ghost">
              <FileInput size={14} aria-hidden />
              {source ? 'Replace source file' : 'Pick source file'}
            </span>
            {source && (
              <span className="import-assets-source">
                <code>{source.fileName}</code>
                <span className="import-assets-meta">
                  {source.sets.length} set{source.sets.length === 1 ? '' : 's'}
                </span>
              </span>
            )}
          </label>

          {error && (
            <div className="banner banner-error">
              <AlertTriangle size={16} aria-hidden />
              <div>{error}</div>
            </div>
          )}

          {loading && <p className="hint">Decoding…</p>}

          {source && source.sets.length === 0 && (
            <p className="hint">This watch face has no asset sets.</p>
          )}

          {source && source.sets.length > 0 && (
            <>
              <div className="import-assets-toolbar">
                <button
                  type="button"
                  className="counter ghost"
                  onClick={toggleAll}
                >
                  {allSelected ? (
                    <CheckSquare size={14} aria-hidden />
                  ) : (
                    <Square size={14} aria-hidden />
                  )}
                  {allSelected ? 'Deselect all' : 'Select all'}
                </button>
                <span className="import-assets-count">
                  {picked.size} of {source.sets.length} selected
                </span>
              </div>

              <ul className="import-assets-grid">
                {source.sets.map((s) => {
                  const checked = picked.has(s.id)
                  // First non-empty slot acts as the asset's "cover" — empty
                  // sets fall back to an `empty` placeholder.
                  const cover = s.slots.find((sl) => sl.rgba)
                  const url = cover
                    ? rgbaToDataUrl(cover.rgba, s.width, s.height)
                    : ''
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        className={`import-asset-card${checked ? ' checked' : ''}`}
                        onClick={() => toggle(s.id)}
                        aria-pressed={checked}
                      >
                        <span
                          className="import-asset-thumb"
                          style={{ aspectRatio: `${s.width} / ${s.height || 1}` }}
                        >
                          {url ? (
                            <img
                              src={url}
                              alt=""
                              style={{ imageRendering: 'pixelated' }}
                            />
                          ) : (
                            <span className="asset-empty">empty</span>
                          )}
                        </span>
                        <Tooltip content={s.name}>
                          <span className="import-asset-name">{s.name}</span>
                        </Tooltip>
                        <span className="import-asset-meta">
                          {s.kind} · {s.width}×{s.height} · {s.count} slot
                          {s.count === 1 ? '' : 's'}
                        </span>
                        <span className="import-asset-tick" aria-hidden>
                          {checked ? (
                            <CheckSquare size={14} />
                          ) : (
                            <Square size={14} />
                          )}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}

          <div className="import-assets-actions">
            <button type="button" className="counter ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="counter"
              onClick={doImport}
              disabled={picked.size === 0}
            >
              <Upload size={14} aria-hidden />
              Import {picked.size > 0 ? picked.size : ''} asset
              {picked.size === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default ImportAssetsDialog
