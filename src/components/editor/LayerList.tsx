import {
  ChevronDown,
  ChevronUp,
  Layers,
  Plus,
  Trash2,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useEditor } from '../../store/editorStore'
import {
  FACEN_INSERTABLE,
  TYPEC_INSERTABLE,
  decodeBmpFile,
  listLayers,
  type FaceNInsertableKind,
} from '../../lib/projectIO'

function LayerList() {
  const project = useEditor((s) => s.project)
  const selectedIdx = useEditor((s) => s.selectedIdx)
  const select = useEditor((s) => s.select)
  const reorder = useEditor((s) => s.reorderLayer)
  const remove = useEditor((s) => s.deleteLayer)
  const insertTypeC = useEditor((s) => s.insertTypeC)
  const insertFaceN = useEditor((s) => s.insertFaceN)
  const setError = useEditor((s) => s.setError)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingRef = useRef<
    | { mode: 'typeC'; type: number }
    | { mode: 'faceN'; kind: FaceNInsertableKind; imageCount: number }
    | null
  >(null)
  const [showInsert, setShowInsert] = useState(false)

  const layers = useMemo(() => (project ? listLayers(project) : []), [project])

  const triggerPick = (multiple: boolean) => {
    const input = fileInputRef.current
    if (!input) return
    input.multiple = multiple
    input.value = ''
    input.click()
  }

  const onInsertTypeC = (type: number) => {
    setShowInsert(false)
    pendingRef.current = { mode: 'typeC', type }
    triggerPick(false)
  }

  const onInsertFaceN = (kind: FaceNInsertableKind, imageCount: number) => {
    setShowInsert(false)
    pendingRef.current = { mode: 'faceN', kind, imageCount }
    // BarDisplay and Weather have variable count; let the user pick any number.
    triggerPick(imageCount !== 1)
  }

  const onFilesChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    const pending = pendingRef.current
    pendingRef.current = null
    if (!pending || files.length === 0) return

    try {
      if (pending.mode === 'typeC') {
        const bmp = await decodeBmpFile(files[0])
        insertTypeC(pending.type, bmp)
      } else {
        const bitmaps = await Promise.all(files.map(decodeBmpFile))
        if (pending.imageCount > 0 && bitmaps.length < pending.imageCount) {
          throw new Error(
            `Pick ${pending.imageCount} BMP(s); got ${bitmaps.length}. The rest will be inserted empty.`,
          )
        }
        insertFaceN(pending.kind, bitmaps)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <aside className="editor-pane editor-layers">
      <div className="layer-add-bar">
        <h3>Layers</h3>
        <div className="editor-new-wrap">
          <button
            type="button"
            className="counter ghost"
            onClick={() => setShowInsert((v) => !v)}
            disabled={!project}
          >
            <Plus size={14} aria-hidden />
            Insert
          </button>
          {showInsert && project && (
            <div className="editor-new-menu insert-menu" role="menu">
              {project.format === 'typeC' &&
                TYPEC_INSERTABLE.map((k) => (
                  <button
                    key={k.type}
                    type="button"
                    onClick={() => onInsertTypeC(k.type)}
                  >
                    {k.name}
                  </button>
                ))}
              {project.format === 'faceN' &&
                FACEN_INSERTABLE.map((k) => (
                  <button
                    key={k.kind}
                    type="button"
                    onClick={() => onInsertFaceN(k.kind, k.imageCount)}
                  >
                    {k.label}
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>

      <div className="editor-pane-scroll">
      {layers.length === 0 ? (
        <p className="hint">
          No layers yet. Use <strong>Insert</strong> to add one (Phase 3 will
          cover digit-set-based kinds).
        </p>
      ) : (
        <ul className="layer-list">
          {[...layers].reverse().map((l) => {
            const isSelected = l.index === selectedIdx
            return (
              <li
                key={l.index}
                className={`layer-row ${isSelected ? 'selected' : ''}`}
                onClick={() => select(l.index)}
              >
                <Layers size={14} aria-hidden />
                <span className="layer-name" title={l.name}>
                  {l.name}
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    reorder(l.index, 'up')
                  }}
                  aria-label="Bring forward"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    reorder(l.index, 'down')
                  }}
                  aria-label="Send backward"
                >
                  <ChevronDown size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn danger"
                  onClick={(e) => {
                    e.stopPropagation()
                    remove(l.index)
                  }}
                  aria-label="Delete layer"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".bmp,image/bmp"
        hidden
        onChange={onFilesChosen}
      />
    </aside>
  )
}

export default LayerList
