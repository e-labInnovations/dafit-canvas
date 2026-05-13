import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileInput, Plus } from 'lucide-react'
import { useEditor } from '../../store/editorStore'
import { TYPEC_FONT_INSERTABLE, consumersOf } from '../../lib/projectIO'
import FontGenerator, { type FontTarget } from './FontGenerator'
import ImportAssetsDialog from './ImportAssetsDialog'
import type { AssetSet } from '../../types/face'

/** Renders children into document.body, positioned just below the anchor.
 *  Used so popovers can escape a scrolling parent (`.editor-pane-scroll`
 *  clips overflow-x even though only overflow-y was set to auto). The
 *  position is recomputed on scroll/resize so the popover tracks its
 *  anchor while open. Click-outside (and Esc) closes via `onClose`. */
function PortalPopover({
  anchorRef,
  onClose,
  children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)

  useLayoutEffect(() => {
    const update = () => {
      const a = anchorRef.current
      if (!a) return
      const r = a.getBoundingClientRect()
      // Align the popover's right edge with the trigger's right edge so it
      // grows leftward — fits naturally next to a right-aligned button.
      setPos({
        top: r.bottom + 4,
        right: window.innerWidth - r.right,
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [anchorRef])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const a = anchorRef.current
      const p = ref.current
      if (!p) return
      // The anchor handles its own click — only outside clicks close.
      if (a && a.contains(e.target as Node)) return
      if (p.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchorRef, onClose])

  if (!pos) return null
  return createPortal(
    <div
      ref={ref}
      className="portal-popover"
      style={{ top: pos.top, right: pos.right }}
    >
      {children}
    </div>,
    document.body,
  )
}

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
          <PortalPopover
            anchorRef={newBtnRef}
            onClose={() => setShowNewMenu(false)}
          >
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
                  onClick={() =>
                    onCreateFromFont(k.type, k.name, k.glyphs)
                  }
                >
                  {k.name}
                  <span className="insert-menu-tag">{k.count}</span>
                </button>
              ))}
            </div>
          </PortalPopover>
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
          const url = thumbDataUrl(set)
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
