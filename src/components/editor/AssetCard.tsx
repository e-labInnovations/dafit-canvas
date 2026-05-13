import { useEffect, useRef, useState } from 'react'
import { ChevronDown, GitFork, Plus, Settings2 } from 'lucide-react'
import { useEditor } from '../../store/editorStore'
import { compatibleSetsForType, consumersOf } from '../../lib/projectIO'
import type { AssetSet, TypeCProject } from '../../types/face'

/** Render an AssetSet's first non-empty slot as a data URL for thumbnails.
 *  Returns '' when the set has no decodable preview (empty multi-slot library,
 *  zero-dim, mismatched rgba — all rendered as the "empty" placeholder). */
const thumbDataUrl = (set: AssetSet): string => {
  const slot = set.slots.find((s) => s.rgba) ?? set.slots[0]
  if (!slot?.rgba || set.width === 0 || set.height === 0) return ''
  if (slot.rgba.length !== set.width * set.height * 4) return ''
  const c = document.createElement('canvas')
  c.width = set.width
  c.height = set.height
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(set.width, set.height)
  img.data.set(slot.rgba)
  ctx.putImageData(img, 0, 0)
  return c.toDataURL('image/png')
}

/** Compatible-asset popover. Mounts under the "Change" button. Renders every
 *  AssetSet whose blob-count matches the layer's type (so a rebind doesn't
 *  desync with the firmware's expected idx range). */
function AssetPicker({
  project,
  currentSetId,
  type,
  onSelect,
  onCreateNew,
  onClose,
}: {
  project: TypeCProject
  currentSetId: string
  type: number
  onSelect: (setId: string) => void
  onCreateNew: () => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  // Click-outside + Escape close. Mouse-down (not click) so we still fire when
  // the user mouses down outside and releases inside, which feels right for a
  // popover dismiss.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const compatible = compatibleSetsForType(project, type).filter((s) => {
    if (!filter) return true
    return s.name.toLowerCase().includes(filter.toLowerCase())
  })

  return (
    <div className="asset-picker" ref={ref} role="dialog" aria-label="Pick asset library">
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
          const url = thumbDataUrl(s)
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

  const consumers = consumersOf(project, set.id)
  const shareCount = consumers.length - 1
  const thumb = thumbDataUrl(set)
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
          <strong className="asset-card-name" title={set.name}>
            {set.name}
          </strong>
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
        <button
          type="button"
          className="counter ghost"
          onClick={() => setPickerOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          title="Swap this layer to a different asset library"
        >
          <ChevronDown size={12} aria-hidden />
          Change
        </button>
        <button
          type="button"
          className="counter ghost"
          onClick={() => openAssetDetail(set.id)}
          title="Open asset details (slots, rename, regenerate)"
        >
          <Settings2 size={12} aria-hidden />
          Open
        </button>
        {shareCount > 0 && (
          <button
            type="button"
            className="counter ghost"
            onClick={() => detachLayer(layerIdx)}
            title="Clone the set so this layer has its own exclusive copy"
          >
            <GitFork size={12} aria-hidden />
            Detach
          </button>
        )}
      </div>
      {pickerOpen && layer && (
        <AssetPicker
          project={project}
          currentSetId={set.id}
          type={layer.type}
          onSelect={onSelect}
          onCreateNew={onCreateNew}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

export default AssetCard
