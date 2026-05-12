import { useState } from 'react'
import { Plus, Settings2 } from 'lucide-react'
import { useEditor } from '../../store/editorStore'
import { TYPEC_FONT_INSERTABLE, consumersOf } from '../../lib/projectIO'
import FontGenerator, { type FontTarget } from './FontGenerator'
import AssetDetailModal from './AssetDetailModal'
import type { AssetSet } from '../../types/face'

const thumbDataUrl = (set: AssetSet): string => {
  const slot = set.slots.find((s) => s.rgba)
  if (!slot?.rgba || set.width === 0 || set.height === 0) return ''
  const c = document.createElement('canvas')
  c.width = set.width
  c.height = set.height
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  const expected = set.width * set.height * 4
  if (slot.rgba.length !== expected) return ''
  const img = ctx.createImageData(set.width, set.height)
  img.data.set(slot.rgba)
  ctx.putImageData(img, 0, 0)
  return c.toDataURL('image/png')
}

function AssetLibrary() {
  const project = useEditor((s) => s.project)
  const renameAssetSetAction = useEditor((s) => s.renameAssetSetAction)
  const createAssetSetAction = useEditor((s) => s.createAssetSetAction)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [fontTarget, setFontTarget] = useState<FontTarget | null>(null)
  const [detailSetId, setDetailSetId] = useState<string | null>(null)
  const [showNewMenu, setShowNewMenu] = useState(false)

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
        <h4>Asset library ({project.assetSets.length})</h4>
        <div className="editor-new-wrap">
          <button
            type="button"
            className="counter ghost"
            onClick={() => setShowNewMenu((v) => !v)}
          >
            <Plus size={12} aria-hidden />
            New
          </button>
          {showNewMenu && (
            <div className="editor-new-menu insert-menu" role="menu">
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
                  onClick={() => onCreateFromFont(k.type, k.name, k.glyphs)}
                >
                  {k.name}
                  <span className="insert-menu-tag">{k.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
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
          const url = thumbDataUrl(set)
          const editing = editingId === set.id
          const isOrphan = consumers.length === 0
          return (
            <li
              key={set.id}
              className={`asset-library-row ${isOrphan ? 'orphan' : ''}`}
            >
              <div className="asset-library-thumb">
                {url ? (
                  <img
                    src={url}
                    alt={set.name}
                    style={{ imageRendering: 'pixelated' }}
                  />
                ) : (
                  <span className="asset-empty">empty</span>
                )}
              </div>
              <div className="asset-library-meta">
                {editing ? (
                  <input
                    type="text"
                    value={draftName}
                    autoFocus
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => {
                      if (draftName.trim()) {
                        renameAssetSetAction(set.id, draftName.trim())
                      }
                      setEditingId(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="asset-library-name"
                    onClick={() => {
                      setEditingId(set.id)
                      setDraftName(set.name)
                    }}
                    title="Click to rename"
                  >
                    {set.name}
                  </button>
                )}
                <span className="asset-library-sub">
                  {set.count}×{set.width}×{set.height} ·{' '}
                  {isOrphan
                    ? 'orphan (not in .bin)'
                    : `${consumers.length} layer${consumers.length === 1 ? '' : 's'}`}
                </span>
              </div>
              <div className="asset-library-actions">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Edit ${set.name}`}
                  title="Open details"
                  onClick={() => setDetailSetId(set.id)}
                >
                  <Settings2 size={12} />
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      <FontGenerator
        target={fontTarget}
        onClose={() => setFontTarget(null)}
      />
      <AssetDetailModal
        key={detailSetId ?? 'closed'}
        setId={detailSetId}
        onClose={() => setDetailSetId(null)}
      />
    </div>
  )
}

export default AssetLibrary
