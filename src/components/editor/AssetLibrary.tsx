import { useRef, useState } from 'react'
import { FileInput, Plus } from 'lucide-react'
import { useEditor } from '../../store/editorStore'
import { TYPEC_FONT_INSERTABLE, consumersOf } from '../../lib/projectIO'
import { assetSetThumbDataUrl } from '../../lib/assetThumb'
import FontGenerator, { type FontTarget } from './FontGenerator'
import ImportAssetsDialog from './ImportAssetsDialog'
import Popover from '../Popover'

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
  const newBtnRef = useRef<HTMLButtonElement>(null)

  if (project?.format !== 'typeC') return null

  const onCreateEmpty = (type: number) => {
    setShowNewMenu(false)
    createAssetSetAction(type)
  }

  const onCreateFromFont = (
    type: number,
    name: string,
    glyphs: readonly string[],
  ) => {
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
        <button
          type="button"
          className="counter ghost icon-only"
          onClick={() => setShowImport(true)}
          title="Import asset sets from another watch face (.bin / .zip)"
          aria-label="Import assets from another watch face"
        >
          <FileInput size={12} aria-hidden />
        </button>
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
              <div className="insert-menu-section">Empty set</div>
              {TYPEC_FONT_INSERTABLE.map((k) => (
                <button
                  key={`empty-${k.type}`}
                  type="button"
                  onClick={() => onCreateEmpty(k.type)}
                >
                  {k.name}
                  <span className="insert-menu-tag">{k.count}</span>
                </button>
              ))}
              <div className="insert-menu-section">From font</div>
              {TYPEC_FONT_INSERTABLE.map((k) => (
                <button
                  key={`font-${k.type}`}
                  type="button"
                  onClick={() =>
                    onCreateFromFont(k.type, k.name, k.glyphs)
                  }
                >
                  {k.name}
                  <span className="insert-menu-tag">{k.count}</span>
                </button>
              ))}
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
              <button
                type="button"
                className={
                  `asset-library-row` +
                  (isOrphan ? ' orphan' : '') +
                  (isCurrent ? ' current' : '')
                }
                onClick={() => openAssetDetail(set.id)}
                aria-pressed={isCurrent}
                title={`Open "${set.name}" details`}
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
