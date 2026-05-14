import { useRef, useState } from 'react'
import { FileInput, Plus, Square, Type } from 'lucide-react'
import { useEditor } from '../../store/editorStore'
import {
  INSERTABLE_CATEGORIES,
  TYPEC_INSERTABLE_TYPES,
  consumersOf,
  insertableMeta,
  type InsertableCategory,
} from '../../lib/projectIO'
import { assetSetThumbDataUrl } from '../../lib/assetThumb'
import FontGenerator, { type FontTarget } from './FontGenerator'
import ImportAssetsDialog from './ImportAssetsDialog'
import Popover from '../Popover'
import Tooltip from '../Tooltip'

function AssetLibrary() {
  const project = useEditor((s) => s.project)
  const createAssetSetAction = useEditor((s) => s.createAssetSetAction)
  const openAssetDetail = useEditor((s) => s.openAssetDetail)
  // Tracks which set's detail is currently rendered in PropertyPanel so we
  // can highlight the matching row in the library list.
  const assetDetailId = useEditor((s) => s.assetDetailId)

  const [fontTarget, setFontTarget] = useState<FontTarget | null>(null)
  const [showNewMenu, setShowNewMenu] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [newFilter, setNewFilter] = useState('')
  // Type whose Empty form is currently open. Single-target so the popover
  // never shows two expanded rows at once.
  const [emptyExpandedType, setEmptyExpandedType] = useState<number | null>(
    null,
  )
  const [draftW, setDraftW] = useState('')
  const [draftH, setDraftH] = useState('')
  const newBtnRef = useRef<HTMLButtonElement>(null)

  if (project?.format !== 'typeC') return null

  const onToggleEmpty = (type: number, defaultW: number, defaultH: number) => {
    if (emptyExpandedType === type) {
      setEmptyExpandedType(null)
      return
    }
    // Pre-fill with the corpus-derived defaults for this type — most users
    // accept them as-is; the form is here for the cases that need a custom
    // size (e.g. a smaller BACKGROUND, custom icon sets).
    setEmptyExpandedType(type)
    setDraftW(String(defaultW))
    setDraftH(String(defaultH))
  }

  /** Same idea as LayerList.ensureAnimFrames — animation sets have no
   *  useful slot count without a project-wide frames value. Prompt for
   *  it on the first animation-type create. */
  const ensureAnimFrames = (type: number): boolean => {
    if (type < 0xf6 || type > 0xf8) return true
    if (project.animationFrames >= 2) return true
    const ans = window.prompt(
      'Animation needs a frame count. How many frames?\n(2–250, shared across all animation layers on this face)',
      '10',
    )
    if (ans === null) return false
    const n = parseInt(ans, 10)
    if (!Number.isFinite(n) || n < 2 || n > 250) return false
    return useEditor.getState().setAnimationFramesAction(n) === null
  }

  const onCreateEmpty = (type: number) => {
    const w = parseInt(draftW, 10)
    const h = parseInt(draftH, 10)
    if (!Number.isFinite(w) || w < 1) return
    if (!Number.isFinite(h) || h < 1) return
    if (!ensureAnimFrames(type)) return
    setShowNewMenu(false)
    setEmptyExpandedType(null)
    createAssetSetAction(type, undefined, { size: { w, h } })
  }

  const onCreateFromFont = (
    type: number,
    name: string,
    glyphs: readonly string[],
  ) => {
    if (!ensureAnimFrames(type)) return
    setShowNewMenu(false)
    createAssetSetAction(type)
    const updated = useEditor.getState().project
    if (updated?.format !== 'typeC') return
    const justAdded = updated.assetSets[updated.assetSets.length - 1]
    if (!justAdded) return
    setFontTarget({
      mode: 'replace-typeC-asset-set',
      setId: justAdded.id,
      type,
      name,
      glyphs,
    })
  }

  return (
    <div className="asset-library">
      <div className="asset-library-header">
        <h4>
          Asset library{' '}
          <span className="asset-library-count">{project.assetSets.length}</span>
        </h4>
        <Tooltip content="Import asset sets from another watch face (.bin / .zip)">
          <button
            type="button"
            className="counter ghost icon-only"
            onClick={() => setShowImport(true)}
            aria-label="Import assets from another watch face"
          >
            <FileInput size={12} aria-hidden />
          </button>
        </Tooltip>
        <button
          ref={newBtnRef}
          type="button"
          className="counter ghost"
          onClick={() => setShowNewMenu((v) => !v)}
        >
          <Plus size={12} aria-hidden />
          New
        </button>
        {showNewMenu && (
          <Popover
            anchorRef={newBtnRef}
            onClose={() => setShowNewMenu(false)}
            placement="bottom-end"
            role="menu"
            ariaLabel="Create new asset set"
            className="insert-menu"
          >
            <div className="editor-new-menu insert-menu" role="presentation">
              <input
                type="text"
                className="insert-menu-filter"
                placeholder="Filter types…"
                value={newFilter}
                onChange={(e) => setNewFilter(e.target.value)}
                autoFocus
              />
              {(() => {
                // Walk the full insertable list (not just the font-able
                // subset) so single-image kinds like BACKGROUND, SEPERATOR
                // and the analog hands are reachable from this popover too.
                // The Font button is hidden on rows without glyphs — the
                // Empty button works for every type.
                const filtered = TYPEC_INSERTABLE_TYPES.filter((k) => {
                  if (!newFilter) return true
                  const q = newFilter.toLowerCase()
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
                    ...items.flatMap((k) => {
                      const isExpanded = emptyExpandedType === k.type
                      return [
                        <div
                          key={`row-${k.type}`}
                          className="insert-menu-asset-row"
                        >
                          <span className="insert-menu-asset-name">
                            {k.name}
                            <span className="insert-menu-tag">{k.count}</span>
                          </span>
                          <Tooltip
                            content={
                              isExpanded
                                ? 'Close size form'
                                : 'Create an empty set (fill slots later)'
                            }
                          >
                            <button
                              type="button"
                              className={
                                `insert-menu-asset-action` +
                                (isExpanded ? ' active' : '')
                              }
                              onClick={() =>
                                onToggleEmpty(k.type, k.dim.w, k.dim.h)
                              }
                              aria-label={`Create empty ${k.name} set`}
                              aria-expanded={isExpanded}
                            >
                              <Square size={12} aria-hidden />
                              Empty
                            </button>
                          </Tooltip>
                          {k.glyphs && (
                            <Tooltip content="Generate slots from a font">
                              <button
                                type="button"
                                className="insert-menu-asset-action"
                                onClick={() =>
                                  onCreateFromFont(k.type, k.name, k.glyphs!)
                                }
                                aria-label={`Create ${k.name} set from a font`}
                              >
                                <Type size={12} aria-hidden />
                                Font
                              </button>
                            </Tooltip>
                          )}
                        </div>,
                        isExpanded && (
                          <div
                            key={`size-${k.type}`}
                            className="insert-menu-asset-size"
                          >
                            <label>
                              <span>W</span>
                              <input
                                type="number"
                                min={1}
                                value={draftW}
                                onChange={(e) => setDraftW(e.target.value)}
                                autoFocus
                              />
                            </label>
                            <span className="insert-menu-asset-size-x">×</span>
                            <label>
                              <span>H</span>
                              <input
                                type="number"
                                min={1}
                                value={draftH}
                                onChange={(e) => setDraftH(e.target.value)}
                              />
                            </label>
                            <button
                              type="button"
                              className="insert-menu-asset-action primary"
                              onClick={() => onCreateEmpty(k.type)}
                            >
                              Create
                            </button>
                          </div>
                        ),
                      ]
                    }),
                  ]
                })
              })()}
            </div>
          </Popover>
        )}
      </div>

      {project.assetSets.length === 0 && (
        <p className="hint">
          No sets yet. Use <strong>+ New</strong> above to add one, or insert a
          layer from the Layers panel to seed a set automatically.
        </p>
      )}

      <ul>
        {project.assetSets.map((set) => {
          const consumers = consumersOf(project, set.id)
          const url = assetSetThumbDataUrl(set)
          const isOrphan = consumers.length === 0
          const isCurrent = set.id === assetDetailId
          return (
            <li key={set.id}>
              <Tooltip content={`Open "${set.name}" details`} placement="left">
              <button
                type="button"
                className={
                  `asset-library-row` +
                  (isOrphan ? ' orphan' : '') +
                  (isCurrent ? ' current' : '')
                }
                onClick={() => openAssetDetail(set.id)}
                aria-pressed={isCurrent}
              >
                <span className="asset-library-thumb">
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
                <span className="asset-library-meta">
                  <span className="asset-library-name">{set.name}</span>
                  <span className="asset-library-sub">
                    {set.count}×{set.width}×{set.height} ·{' '}
                    {isOrphan
                      ? 'orphan (not in .bin)'
                      : `${consumers.length} layer${consumers.length === 1 ? '' : 's'}`}
                  </span>
                </span>
              </button>
              </Tooltip>
            </li>
          )
        })}
      </ul>

      <FontGenerator
        target={fontTarget}
        onClose={() => setFontTarget(null)}
      />

      {showImport && (
        <ImportAssetsDialog onClose={() => setShowImport(false)} />
      )}
    </div>
  )
}

export default AssetLibrary
