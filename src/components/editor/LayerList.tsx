import {
  Eye,
  EyeOff,
  GripVertical,
  Hash,
  Info,
  Layers,
  Minus,
  Plus,
  RefreshCcw,
  Ruler,
  Trash2,
  Type,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useEditor } from '../../store/editorStore'
import {
  FACEN_INSERTABLE,
  INSERTABLE_CATEGORIES,
  TYPEC_INSERTABLE_TYPES,
  compatibleSetsForType,
  decodeBmpFile,
  insertableMeta,
  listLayers,
  type FaceNDigitDependentKind,
  type FaceNInsertableKind,
  type InsertableCategory,
} from '../../lib/projectIO'
import AssetLibrary from './AssetLibrary'
import FontGenerator, { type FontTarget } from './FontGenerator'
import Popover from '../Popover'
import { assetSetThumbDataUrl } from '../../lib/assetThumb'
import Tooltip from '../Tooltip'

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
  const selectedIdxs = useEditor((s) => s.selectedIdxs)
  const selectedGuideIds = useEditor((s) => s.selectedGuideIds)
  const guidesVisible = useEditor((s) => s.guidesVisible)
  const assetDetailId = useEditor((s) => s.assetDetailId)
  const select = useEditor((s) => s.select)
  const toggleSelected = useEditor((s) => s.toggleSelected)
  const selectMany = useEditor((s) => s.selectMany)
  const moveLayerTo = useEditor((s) => s.moveLayerTo)
  const remove = useEditor((s) => s.deleteLayer)
  const insertTypeC = useEditor((s) => s.insertTypeC)
  const insertTypeCEmpty = useEditor((s) => s.insertTypeCEmpty)
  const insertTypeCShared = useEditor((s) => s.insertTypeCShared)
  const insertFaceN = useEditor((s) => s.insertFaceN)
  const insertFaceNDigitElementAction = useEditor(
    (s) => s.insertFaceNDigitElementAction,
  )
  const setError = useEditor((s) => s.setError)
  const addGuideAction = useEditor((s) => s.addGuideAction)
  const selectGuide = useEditor((s) => s.selectGuide)
  const toggleGuideSelected = useEditor((s) => s.toggleGuideSelected)
  const setGuideVisibleAction = useEditor((s) => s.setGuideVisibleAction)
  const setGuidesVisible = useEditor((s) => s.setGuidesVisible)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const insertBtnRef = useRef<HTMLButtonElement>(null)
  const pendingRef = useRef<
    | { mode: 'typeC'; type: number }
    | { mode: 'faceN'; kind: FaceNInsertableKind; imageCount: number }
    | null
  >(null)
  const [showInsert, setShowInsert] = useState(false)
  const [expandedType, setExpandedType] = useState<number | null>(null)
  const [helpType, setHelpType] = useState<number | null>(null)
  const [insertFilter, setInsertFilter] = useState('')
  const [fontTarget, setFontTarget] = useState<FontTarget | null>(null)
  // Drag-to-reorder state. `dragIdx` is the layer being dragged
  // (project-array index, not row position). `dragOver` is the layer
  // currently being hovered over while dragging — used for the visual
  // drop indicator.
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

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
        <button
          ref={insertBtnRef}
          type="button"
          className="counter ghost"
          onClick={() => setShowInsert((v) => !v)}
          disabled={!project}
          aria-haspopup="menu"
          aria-expanded={showInsert}
        >
          <Plus size={14} aria-hidden />
          Insert
        </button>
        {showInsert && project && (
          <Popover
            anchorRef={insertBtnRef}
            onClose={() => setShowInsert(false)}
            placement="bottom-end"
            role="menu"
            ariaLabel="Insert a layer"
            className="insert-menu"
          >
            <div className="editor-new-menu insert-menu" role="presentation">
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
                  {(() => {
                    // Apply the filter once, then bucket the survivors by
                    // category. Empty categories are skipped so the user
                    // doesn't see a sea of dangling headers when filtering.
                    const filtered = TYPEC_INSERTABLE_TYPES.filter((k) => {
                      if (!insertFilter) return true
                      const q = insertFilter.toLowerCase()
                      return (
                        k.name.toLowerCase().includes(q) ||
                        `0x${k.type.toString(16).padStart(2, '0')}`.includes(q)
                      )
                    })
                    const byCat = new Map<InsertableCategory, typeof filtered>()
                    for (const k of filtered) {
                      const cat = insertableMeta(k.type).category
                      const list = byCat.get(cat)
                      if (list) list.push(k)
                      else byCat.set(cat, [k])
                    }
                    return INSERTABLE_CATEGORIES.flatMap((cat) => {
                      const items = byCat.get(cat.id)
                      if (!items || items.length === 0) return []
                      return [
                        <div
                          key={`cat-${cat.id}`}
                          className="insert-menu-section"
                        >
                          {cat.label}
                        </div>,
                        ...items.map((k) => {
                          const isExpanded = expandedType === k.type
                          const isHelpOpen = helpType === k.type
                          const meta = insertableMeta(k.type)
                          const sharable =
                            k.count > 1
                              ? compatibleSetsForType(project, k.type)
                              : []
                          return (
                            <div
                              key={`row-${k.type}`}
                              className="insert-menu-multi"
                            >
                              <div className="insert-menu-row">
                                <button
                                  type="button"
                                  className={
                                    `insert-menu-name` +
                                    (isExpanded ? ' insert-menu-row-active' : '')
                                  }
                                  onClick={() =>
                                    setExpandedType(isExpanded ? null : k.type)
                                  }
                                >
                                  {k.name}
                                  <span className="insert-menu-tag">
                                    {k.count}
                                  </span>
                                </button>
                                <Tooltip content={`What is ${k.name}?`}>
                                  <button
                                    type="button"
                                    className={
                                      `insert-menu-info` +
                                      (isHelpOpen ? ' active' : '')
                                    }
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setHelpType(isHelpOpen ? null : k.type)
                                    }}
                                    aria-label={`What is ${k.name}?`}
                                  >
                                    <Info size={12} aria-hidden />
                                  </button>
                                </Tooltip>
                              </div>
                              {isHelpOpen && (
                                <div className="insert-menu-help">
                                  {meta.description ? (
                                    <p>{meta.description}</p>
                                  ) : (
                                    <p className="hint">
                                      No description yet for this type.
                                    </p>
                                  )}
                                  <dl className="insert-menu-help-meta">
                                    <dt>Type code</dt>
                                    <dd>
                                      <code>
                                        0x{k.type.toString(16).padStart(2, '0')}
                                      </code>
                                    </dd>
                                    <dt>Slots</dt>
                                    <dd>{k.count}</dd>
                                    <dt>Default size</dt>
                                    <dd>
                                      {k.dim.w}×{k.dim.h}
                                    </dd>
                                    <dt>Seen in</dt>
                                    <dd>
                                      {k.faces} of 387 corpus faces
                                    </dd>
                                  </dl>
                                </div>
                              )}
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
                                  {sharable.map((set) => {
                                    const thumb = assetSetThumbDataUrl(set)
                                    return (
                                      <button
                                        key={`share-${set.id}`}
                                        type="button"
                                        className="insert-menu-sub insert-menu-share"
                                        onClick={() => {
                                          setShowInsert(false)
                                          setExpandedType(null)
                                          insertTypeCShared(k.type, set.id)
                                        }}
                                      >
                                        <span
                                          className="insert-menu-share-thumb"
                                          aria-hidden
                                        >
                                          {thumb ? (
                                            <img
                                              src={thumb}
                                              alt=""
                                              style={{
                                                imageRendering: 'pixelated',
                                              }}
                                            />
                                          ) : (
                                            <span className="asset-empty">
                                              ∅
                                            </span>
                                          )}
                                        </span>
                                        <span className="insert-menu-share-text">
                                          ↳ Use existing:{' '}
                                          <strong>{set.name}</strong>
                                        </span>
                                      </button>
                                    )
                                  })}
                                </>
                              )}
                            </div>
                          )
                        }),
                      ]
                    })
                  })()}
                  <p className="insert-menu-hint">
                    Click a type to choose how to populate it. Use the{' '}
                    <Info size={11} aria-hidden /> button on any row for a
                    description and stats. Multi-blob layers can reuse an
                    existing asset library — fill empty libraries later via{' '}
                    <strong>Generate from font</strong>.
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
          </Popover>
        )}
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
              const isSelected = selectedIdxs.includes(l.index)
              // Visually flag every layer bound to the asset currently open in
              // the right sidebar — so the user can see all consumers at a
              // glance while editing a shared library.
              const isConsumer =
                assetDetailId !== null && l.assetSetId === assetDetailId
              const onRowClick = (e: React.MouseEvent) => {
                // Cmd/Ctrl (+Meta) toggles a single layer. Shift extends the
                // selection to a range from the current anchor (first-selected,
                // i.e. selectedIdxs[0]) to this one. Plain click = single
                // select. The anchor is kept at position 0 so it remains the
                // "first selected" reference for align/distribute Relative-to.
                if (e.metaKey || e.ctrlKey) {
                  toggleSelected(l.index)
                  return
                }
                if (e.shiftKey && selectedIdxs.length > 0) {
                  const anchor = selectedIdxs[0]
                  const [lo, hi] =
                    anchor < l.index ? [anchor, l.index] : [l.index, anchor]
                  const range: number[] = [anchor]
                  for (let i = lo; i <= hi; i++) {
                    if (i !== anchor) range.push(i)
                  }
                  selectMany(range, 'replace')
                  return
                }
                select(l.index)
              }
              // Drop-indicator position relative to this row: a line
              // either above or below it depending on whether the cursor
              // is in the upper or lower half (computed in onDragOver).
              const isDragging = dragIdx === l.index
              const isDropTarget = dragOverIdx === l.index && dragIdx !== null
              return (
                <li
                  key={l.index}
                  className={
                    `layer-row` +
                    (isSelected ? ' selected' : '') +
                    (isConsumer ? ' consumer' : '') +
                    (isDragging ? ' is-dragging' : '') +
                    (isDropTarget ? ' is-drop-target' : '')
                  }
                  draggable
                  onClick={onRowClick}
                  onDragStart={(e) => {
                    setDragIdx(l.index)
                    setDragOverIdx(l.index)
                    e.dataTransfer.effectAllowed = 'move'
                    // Firefox refuses to fire dragover events without any
                    // data payload — set a no-op string.
                    try {
                      e.dataTransfer.setData('text/plain', String(l.index))
                    } catch {
                      /* some browsers throw on plain text; ignore */
                    }
                  }}
                  onDragOver={(e) => {
                    if (dragIdx === null) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (dragOverIdx !== l.index) setDragOverIdx(l.index)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (dragIdx === null || dragIdx === l.index) return
                    moveLayerTo(dragIdx, l.index)
                  }}
                  onDragEnd={() => {
                    setDragIdx(null)
                    setDragOverIdx(null)
                  }}
                >
                  <Tooltip content="Drag to reorder">
                    <span className="layer-drag-handle" aria-hidden>
                      <GripVertical size={14} />
                    </span>
                  </Tooltip>
                  <Layers size={14} aria-hidden />
                  <Tooltip content={l.name} placement="right">
                    <span className="layer-name">{l.name}</span>
                  </Tooltip>
                  <Tooltip content="Delete layer">
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
                  </Tooltip>
                </li>
              )
            })}
          </ul>
        )}

        {/* Design-aid guides — horizontal/vertical lines drawn over the
            canvas. Not layers / not exported to the watch. */}
        {project && (
          <div className="guides-section">
            <div className="guides-header">
              <h4>
                <Ruler size={12} aria-hidden /> Guides
                {project.guides.length > 0 && (
                  <span className="guides-count">
                    {project.guides.length}
                  </span>
                )}
              </h4>
              <div className="guides-actions">
                <Tooltip content="Add horizontal guide at y = 120">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => addGuideAction('H', 120)}
                    aria-label="Add horizontal guide"
                  >
                    <Minus size={12} aria-hidden />
                  </button>
                </Tooltip>
                <Tooltip content="Add vertical guide at x = 120">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => addGuideAction('V', 120)}
                    aria-label="Add vertical guide"
                  >
                    <Minus
                      size={12}
                      aria-hidden
                      style={{ transform: 'rotate(90deg)' }}
                    />
                  </button>
                </Tooltip>
                <Tooltip
                  content={
                    guidesVisible ? 'Hide all guides' : 'Show all guides'
                  }
                >
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setGuidesVisible(!guidesVisible)}
                    aria-label={
                      guidesVisible ? 'Hide all guides' : 'Show all guides'
                    }
                  >
                    {guidesVisible ? (
                      <Eye size={12} aria-hidden />
                    ) : (
                      <EyeOff size={12} aria-hidden />
                    )}
                  </button>
                </Tooltip>
              </div>
            </div>
            {project.guides.length === 0 ? (
              <p className="hint">
                Add a horizontal or vertical guide to assist alignment. Drag
                guides on the canvas to position them.
              </p>
            ) : (
              <ul className="guides-list">
                {project.guides.map((g) => {
                  const selected = selectedGuideIds.includes(g.id)
                  return (
                    <li
                      key={g.id}
                      // The row itself is the click target — matches
                      // .layer-row's pattern where the whole row selects
                      // and the trailing icon-btn delegates a different
                      // action. Using a real button still lives inside so
                      // keyboard navigation reaches it.
                      className={
                        `guide-row` + (selected ? ' guide-row-selected' : '')
                      }
                    >
                      <button
                        type="button"
                        className="guide-row-pick"
                        aria-pressed={selected}
                        // Shift/Cmd/Ctrl-click toggles membership for
                        // multi-guide selection; plain click replaces.
                        onClick={(e) => {
                          if (e.shiftKey || e.metaKey || e.ctrlKey) {
                            toggleGuideSelected(g.id)
                          } else {
                            selectGuide(g.id)
                          }
                        }}
                      >
                        <span className="guide-row-axis" aria-hidden>
                          <span
                            className={`guide-row-axis-icon ${g.axis === 'H' ? 'horizontal' : 'vertical'}`}
                          />
                        </span>
                        <span className="guide-row-label">
                          {g.axis === 'H' ? 'y' : 'x'} = {g.position}
                        </span>
                      </button>
                      <Tooltip
                        content={g.visible ? 'Hide guide' : 'Show guide'}
                      >
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() =>
                            setGuideVisibleAction(g.id, !g.visible)
                          }
                          aria-label={g.visible ? 'Hide guide' : 'Show guide'}
                        >
                          {g.visible ? (
                            <Eye size={11} aria-hidden />
                          ) : (
                            <EyeOff size={11} aria-hidden />
                          )}
                        </button>
                      </Tooltip>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
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
                  <Tooltip content="Regenerate from font">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Regenerate digit set ${i} from font`}
                      onClick={() =>
                        onOpenFontGen({
                          mode: 'replace-faceN-digit-set',
                          setIdx: i,
                        })
                      }
                    >
                      <RefreshCcw size={12} />
                    </button>
                  </Tooltip>
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
