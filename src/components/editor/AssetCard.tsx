import { useRef, useState } from 'react'
import { ChevronDown, GitFork, Plus, Settings2 } from 'lucide-react'
import { useEditor } from '../../store/editorStore'
import { compatibleSetsForType, consumersOf } from '../../lib/projectIO'
import { assetSetThumbDataUrl } from '../../lib/assetThumb'
import Popover from '../Popover'
import Tooltip from '../Tooltip'
import type { AssetSet, TypeCProject } from '../../types/face'

/** Compatible-asset list rendered inside the rebind popover. Click-outside,
 *  Esc, positioning, and ARIA are all handled by the parent `<Popover>` —
 *  this is just the content (filter + list + "New" footer). */
function AssetPickerContent({
  project,
  currentSetId,
  type,
  onSelect,
  onCreateNew,
}: {
  project: TypeCProject
  currentSetId: string
  type: number
  onSelect: (setId: string) => void
  onCreateNew: () => void
}) {
  const [filter, setFilter] = useState('')

  const compatible = compatibleSetsForType(project, type).filter((s) => {
    if (!filter) return true
    return s.name.toLowerCase().includes(filter.toLowerCase())
  })

  return (
    <div className="asset-picker">
      <input
        type="text"
        className="asset-picker-filter"
        placeholder="Filter assets…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoFocus
      />
      <ul className="asset-picker-list">
        {compatible.length === 0 && (
          <li className="asset-picker-empty">No compatible assets.</li>
        )}
        {compatible.map((s) => {
          const url = assetSetThumbDataUrl(s)
          const usage = consumersOf(project, s.id).length
          const isCurrent = s.id === currentSetId
          return (
            <li key={s.id}>
              <button
                type="button"
                className={`asset-picker-row ${isCurrent ? 'is-current' : ''}`}
                onClick={() => onSelect(s.id)}
                aria-current={isCurrent ? 'true' : undefined}
              >
                <div className="asset-picker-thumb">
                  {url ? (
                    <img src={url} alt="" style={{ imageRendering: 'pixelated' }} />
                  ) : (
                    <span className="asset-empty">empty</span>
                  )}
                </div>
                <div className="asset-picker-meta">
                  <strong>{s.name}</strong>
                  <span>
                    {s.width}×{s.height} ·{' '}
                    {usage === 0
                      ? 'orphan'
                      : `${usage} layer${usage === 1 ? '' : 's'}`}
                  </span>
                </div>
                {isCurrent && <span className="asset-picker-current">current</span>}
              </button>
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        className="asset-picker-create"
        onClick={onCreateNew}
      >
        <Plus size={12} aria-hidden />
        New empty asset
      </button>
    </div>
  )
}

/** Compact asset binding control shown in PropertyPanel when a Type C layer
 *  is selected. Replaces the separate "Asset set" `<select>`, "Shared with…"
 *  row, and the AssetSection slot list — they all collapsed into this. */
function AssetCard({
  project,
  layerIdx,
  set,
}: {
  project: TypeCProject
  layerIdx: number
  set: AssetSet
}) {
  const rebindLayer = useEditor((s) => s.rebindLayerAction)
  const detachLayer = useEditor((s) => s.detachLayerAction)
  const createAssetSet = useEditor((s) => s.createAssetSetAction)
  const openAssetDetail = useEditor((s) => s.openAssetDetail)
  const [pickerOpen, setPickerOpen] = useState(false)
  const changeBtnRef = useRef<HTMLButtonElement>(null)

  const consumers = consumersOf(project, set.id)
  const shareCount = consumers.length - 1
  const thumb = assetSetThumbDataUrl(set)
  const layer = project.layers[layerIdx]

  const onSelect = (setId: string) => {
    setPickerOpen(false)
    if (setId !== set.id) rebindLayer(layerIdx, setId)
  }

  const onCreateNew = () => {
    if (!layer) return
    // Create then rebind in one pass. We pull the project from the store
    // *after* the create so we can grab the freshly-appended set's id —
    // createAssetSetAction doesn't return it directly.
    createAssetSet(layer.type)
    const next = useEditor.getState().project
    if (next?.format !== 'typeC') return
    const created = next.assetSets[next.assetSets.length - 1]
    if (created) rebindLayer(layerIdx, created.id)
    setPickerOpen(false)
  }

  return (
    <div className="asset-card-wrap">
      <div className="asset-card">
        <div className="asset-card-thumb">
          {thumb ? (
            <img src={thumb} alt={set.name} style={{ imageRendering: 'pixelated' }} />
          ) : (
            <span className="asset-empty">empty</span>
          )}
        </div>
        <div className="asset-card-meta">
          <Tooltip content={set.name} placement="top">
            <strong className="asset-card-name">{set.name}</strong>
          </Tooltip>
          <span className="asset-card-sub">
            {set.count} × {set.width}×{set.height}
          </span>
          {shareCount > 0 && (
            <span className="asset-card-share">
              Shared with {shareCount} other layer{shareCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>
      <div className="asset-card-actions">
        <Tooltip content="Swap this layer to a different asset library">
          <button
            ref={changeBtnRef}
            type="button"
            className="counter ghost"
            onClick={() => setPickerOpen((v) => !v)}
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
          >
            <ChevronDown size={12} aria-hidden />
            Change
          </button>
        </Tooltip>
        <Tooltip content="Open asset details (slots, rename, regenerate)">
          <button
            type="button"
            className="counter ghost"
            onClick={() => openAssetDetail(set.id)}
          >
            <Settings2 size={12} aria-hidden />
            Open
          </button>
        </Tooltip>
        {shareCount > 0 && (
          <Tooltip content="Clone the set so this layer has its own exclusive copy">
            <button
              type="button"
              className="counter ghost"
              onClick={() => detachLayer(layerIdx)}
            >
              <GitFork size={12} aria-hidden />
              Detach
            </button>
          </Tooltip>
        )}
      </div>
      {pickerOpen && layer && (
        <Popover
          anchorRef={changeBtnRef}
          onClose={() => setPickerOpen(false)}
          placement="bottom-start"
          role="dialog"
          ariaLabel="Pick asset library"
        >
          <AssetPickerContent
            project={project}
            currentSetId={set.id}
            type={layer.type}
            onSelect={onSelect}
            onCreateNew={onCreateNew}
          />
        </Popover>
      )}
    </div>
  )
}

export default AssetCard
