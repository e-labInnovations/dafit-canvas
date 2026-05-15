import { useRef, useState } from 'react'
import { FileInput, Plus } from 'lucide-react'
import { useEditor } from '../../store/editorStore'
import { consumersOf, type InsertableType } from '../../lib/projectIO'
import { assetSetThumbDataUrl } from '../../lib/assetThumb'
import FontGenerator, { type FontTarget } from './FontGenerator'
import ImportAssetsDialog from './ImportAssetsDialog'
import InsertablePickerList from './InsertablePickerList'
import NewAssetModal from './NewAssetModal'
import Popover from '../Popover'
import Tooltip from '../Tooltip'

function AssetLibrary() {
  const project = useEditor((s) => s.project)
  const openAssetDetail = useEditor((s) => s.openAssetDetail)
  // Tracks which set's detail is currently rendered in PropertyPanel so we
  // can highlight the matching row in the library list.
  const assetDetailId = useEditor((s) => s.assetDetailId)

  const [fontTarget, setFontTarget] = useState<FontTarget | null>(null)
  const [showNewMenu, setShowNewMenu] = useState(false)
  const [showImport, setShowImport] = useState(false)
  // When non-null, the New Asset modal is open for that type. Picking a
  // row in the popover both closes the popover and sets this — the modal
  // owns the create paths from there.
  const [modalType, setModalType] = useState<InsertableType | null>(null)
  const newBtnRef = useRef<HTMLButtonElement>(null)

  if (project?.format !== 'typeC') return null

  const onPickType = (k: InsertableType) => {
    setShowNewMenu(false)
    setModalType(k)
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
            className="insertable-picker-popover"
          >
            <InsertablePickerList onPick={onPickType} />
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

      {modalType && (
        <NewAssetModal
          k={modalType}
          onClose={() => setModalType(null)}
          onOpenFontTarget={setFontTarget}
        />
      )}

      {showImport && (
        <ImportAssetsDialog onClose={() => setShowImport(false)} />
      )}
    </div>
  )
}

export default AssetLibrary
