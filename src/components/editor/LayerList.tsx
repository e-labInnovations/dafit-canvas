import {
  ChevronDown,
  ChevronUp,
  Hash,
  Layers,
  Plus,
  RefreshCcw,
  Trash2,
  Type,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useEditor } from '../../store/editorStore'
import {
  FACEN_INSERTABLE,
  TYPEC_INSERTABLE_TYPES,
  compatibleSetsForType,
  decodeBmpFile,
  listLayers,
  type FaceNDigitDependentKind,
  type FaceNInsertableKind,
} from '../../lib/projectIO'
import AssetLibrary from './AssetLibrary'
import FontGenerator, { type FontTarget } from './FontGenerator'

const FACEN_DEPENDENT_KINDS: FaceNDigitDependentKind[] = [
  'TimeNum',
  'HeartRateNum',
  'StepsNum',
  'KCalNum',
  'DayNum',
  'MonthNum',
]

function LayerList() {
  const project = useEditor((s) => s.project)
  const selectedIdx = useEditor((s) => s.selectedIdx)
  const assetDetailId = useEditor((s) => s.assetDetailId)
  const select = useEditor((s) => s.select)
  const reorder = useEditor((s) => s.reorderLayer)
  const remove = useEditor((s) => s.deleteLayer)
  const insertTypeC = useEditor((s) => s.insertTypeC)
  const insertTypeCEmpty = useEditor((s) => s.insertTypeCEmpty)
  const insertTypeCShared = useEditor((s) => s.insertTypeCShared)
  const insertFaceN = useEditor((s) => s.insertFaceN)
  const insertFaceNDigitElementAction = useEditor(
    (s) => s.insertFaceNDigitElementAction,
  )
  const setError = useEditor((s) => s.setError)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingRef = useRef<
    | { mode: 'typeC'; type: number }
    | { mode: 'faceN'; kind: FaceNInsertableKind; imageCount: number }
    | null
  >(null)
  const [showInsert, setShowInsert] = useState(false)
  const [expandedType, setExpandedType] = useState<number | null>(null)
  const [insertFilter, setInsertFilter] = useState('')
  const [fontTarget, setFontTarget] = useState<FontTarget | null>(null)

  const layers = useMemo(() => (project ? listLayers(project) : []), [project])
  const digitSets =
    project?.format === 'faceN' ? project.face.digitSets : []

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
    triggerPick(imageCount !== 1)
  }

  const onOpenFontGen = (target: FontTarget) => {
    setShowInsert(false)
    setFontTarget(target)
  }

  const onInsertDigitElement = (
    kind: FaceNDigitDependentKind,
    digitSetIdx: number,
  ) => {
    setShowInsert(false)
    insertFaceNDigitElementAction(
      kind,
      digitSetIdx,
      { x: 80, y: 110 },
      'C',
    )
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
              {project.format === 'typeC' && (
                <>
                  <input
                    type="text"
                    className="insert-menu-filter"
                    placeholder="Filter types…"
                    value={insertFilter}
                    onChange={(e) => setInsertFilter(e.target.value)}
                    autoFocus
                  />
                  {TYPEC_INSERTABLE_TYPES.filter((k) => {
                    if (!insertFilter) return true
                    const q = insertFilter.toLowerCase()
                    return (
                      k.name.toLowerCase().includes(q) ||
                      `0x${k.type.toString(16).padStart(2, '0')}`.includes(q)
                    )
                  }).map((k) => {
                    const isExpanded = expandedType === k.type
                    const sharable =
                      k.count > 1 ? compatibleSetsForType(project, k.type) : []
                    return (
                      <div key={`row-${k.type}`} className="insert-menu-multi">
                        <button
                          type="button"
                          className={isExpanded ? 'insert-menu-row-active' : ''}
                          onClick={() =>
                            setExpandedType(isExpanded ? null : k.type)
                          }
                        >
                          {k.name}
                          <span className="insert-menu-tag">{k.count}</span>
                        </button>
                        {isExpanded && k.count === 1 && (
                          <>
                            <button
                              type="button"
                              className="insert-menu-sub"
                              onClick={() => {
                                setShowInsert(false)
                                setExpandedType(null)
                                insertTypeCEmpty(k.type)
                              }}
                            >
                              ↳ Empty placeholder
                            </button>
                            <button
                              type="button"
                              className="insert-menu-sub"
                              onClick={() => {
                                setExpandedType(null)
                                onInsertTypeC(k.type)
                              }}
                            >
                              ↳ Pick BMP file…
                            </button>
                          </>
                        )}
                        {isExpanded && k.count > 1 && (
                          <>
                            <button
                              type="button"
                              className="insert-menu-sub"
                              onClick={() => {
                                setShowInsert(false)
                                setExpandedType(null)
                                insertTypeCEmpty(k.type)
                              }}
                            >
                              ↳ New empty library ({k.count} slots)
                            </button>
                            {sharable.map((set) => (
                              <button
                                key={`share-${set.id}`}
                                type="button"
                                className="insert-menu-sub"
                                onClick={() => {
                                  setShowInsert(false)
                                  setExpandedType(null)
                                  insertTypeCShared(k.type, set.id)
                                }}
                              >
                                ↳ Use existing: <strong>{set.name}</strong>
                              </button>
                            ))}
                          </>
                        )}
                      </div>
                    )
                  })}
                  <p className="insert-menu-hint">
                    Click a type to choose how to populate it. Multi-blob layers
                    can reuse an existing asset library — fill empty libraries
                    later via <strong>Generate from font</strong> in the
                    layer's properties.
                  </p>
                </>
              )}
              {project.format === 'faceN' && (
                <>
                  <div className="insert-menu-section">From BMP</div>
                  {FACEN_INSERTABLE.map((k) => (
                    <button
                      key={`bmp-${k.kind}`}
                      type="button"
                      onClick={() => onInsertFaceN(k.kind, k.imageCount)}
                    >
                      {k.label}
                    </button>
                  ))}
                  <div className="insert-menu-section">Digit sets (font)</div>
                  <button
                    key="digit-set"
                    type="button"
                    onClick={() =>
                      onOpenFontGen({ mode: 'faceN-new-digit-set' })
                    }
                  >
                    <Type size={11} aria-hidden /> New digit set
                  </button>
                  {FACEN_DEPENDENT_KINDS.map((kind) =>
                    digitSets.length > 0 ? (
                      digitSets.map((_set, i) => (
                        <button
                          key={`dep-${kind}-${i}`}
                          type="button"
                          onClick={() => onInsertDigitElement(kind, i)}
                        >
                          <Hash size={11} aria-hidden /> {kind} → set {i}
                        </button>
                      ))
                    ) : (
                      <button
                        key={`dep-${kind}-chain`}
                        type="button"
                        onClick={() =>
                          onOpenFontGen({
                            mode: 'faceN-new-digit-set',
                            chain: {
                              kind,
                              position: { x: 80, y: 110 },
                              align: 'C',
                            },
                          })
                        }
                      >
                        <Type size={11} aria-hidden /> {kind} (new set)
                      </button>
                    ),
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="editor-pane-scroll">
        {layers.length === 0 ? (
          <p className="hint">
            No layers yet. Use <strong>Insert</strong> to add one — BMP for
            single-glyph kinds, <em>From font</em> for multi-blob kinds.
          </p>
        ) : (
          <ul className="layer-list">
            {[...layers].reverse().map((l) => {
              const isSelected = l.index === selectedIdx
              // Visually flag every layer bound to the asset currently open in
              // the right sidebar — so the user can see all consumers at a
              // glance while editing a shared library.
              const isConsumer =
                assetDetailId !== null && l.assetSetId === assetDetailId
              return (
                <li
                  key={l.index}
                  className={`layer-row ${isSelected ? 'selected' : ''} ${isConsumer ? 'consumer' : ''}`}
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

        {/* Type C asset library — reusable sets that one or more layers can
            consume. Hidden on FaceN; that format uses the digit-set summary
            below instead. */}
        <AssetLibrary />

        {project?.format === 'faceN' && digitSets.length > 0 && (
          <div className="digit-set-summary">
            <h4>Digit sets ({digitSets.length})</h4>
            <ul>
              {digitSets.map((set, i) => (
                <li key={i}>
                  <span>
                    set {i} · {set.digits[0]?.width ?? 0}×
                    {set.digits[0]?.height ?? 0}
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Regenerate digit set ${i} from font`}
                    title="Regenerate from font"
                    onClick={() =>
                      onOpenFontGen({
                        mode: 'replace-faceN-digit-set',
                        setIdx: i,
                      })
                    }
                  >
                    <RefreshCcw size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".bmp,image/bmp"
        hidden
        onChange={onFilesChosen}
      />

      <FontGenerator
        target={fontTarget}
        onClose={() => setFontTarget(null)}
      />
    </aside>
  )
}

export default LayerList
