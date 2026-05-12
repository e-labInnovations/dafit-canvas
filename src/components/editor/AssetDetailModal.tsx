import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Trash2, Type, Upload, X } from 'lucide-react'
import { useEditor } from '../../store/editorStore'
import {
  TYPEC_FONT_INSERTABLE,
  consumersOf,
  decodeBmpFile,
} from '../../lib/projectIO'
import FontGenerator, { type FontTarget } from './FontGenerator'
import type { AssetSet, AssetSlot } from '../../types/face'

type Props = {
  setId: string | null
  onClose: () => void
}

const rgbaToDataUrl = (
  rgba: Uint8ClampedArray | null,
  width: number,
  height: number,
): string => {
  if (!rgba || width === 0 || height === 0) return ''
  if (rgba.length !== width * height * 4) return ''
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(width, height)
  img.data.set(rgba)
  ctx.putImageData(img, 0, 0)
  return c.toDataURL('image/png')
}

function SlotRow({
  setId,
  slotIdx,
  width,
  height,
  slot,
}: {
  setId: string
  slotIdx: number
  width: number
  height: number
  slot: AssetSlot
}) {
  const replace = useEditor((s) => s.replaceAssetAction)
  const setError = useEditor((s) => s.setError)
  const url = rgbaToDataUrl(slot.rgba, width, height)
  const isEmpty = width === 0 || height === 0 || !slot.rgba

  const onPick = async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.bmp,image/bmp'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const bmp = await decodeBmpFile(file)
        replace(
          { tag: 'typeC-slot', setId, slotIdx },
          bmp,
          !isEmpty,
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }
    input.click()
  }

  return (
    <li className="asset-detail-slot">
      <div className="asset-detail-thumb">
        {url ? (
          <img src={url} alt={`slot ${slotIdx}`} style={{ imageRendering: 'pixelated' }} />
        ) : (
          <span className="asset-empty">empty</span>
        )}
      </div>
      <code className="asset-detail-slot-label">{slotIdx}</code>
      <button
        type="button"
        className="icon-btn"
        title={
          isEmpty
            ? 'Set BMP'
            : `Replace BMP (must be ${width}×${height})`
        }
        aria-label={isEmpty ? 'Set BMP' : 'Replace BMP'}
        onClick={onPick}
      >
        <Upload size={12} />
      </button>
    </li>
  )
}

function AssetDetailModal({ setId, onClose }: Props) {
  const project = useEditor((s) => s.project)
  const renameAssetSetAction = useEditor((s) => s.renameAssetSetAction)
  const deleteAssetSetAction = useEditor((s) => s.deleteAssetSetAction)
  const setError = useEditor((s) => s.setError)

  const set: AssetSet | undefined =
    project?.format === 'typeC' && setId !== null
      ? project.assetSets.find((s) => s.id === setId)
      : undefined

  // `setId` is part of the parent's render key (see AssetLibrary), so this
  // component remounts whenever a different set is opened — that's why we can
  // safely seed the draft name from props with a lazy initializer instead of
  // resyncing inside an effect.
  const [draftName, setDraftName] = useState(() => set?.name ?? '')
  const [fontTarget, setFontTarget] = useState<FontTarget | null>(null)

  useEffect(() => {
    if (setId === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [setId, onClose])

  if (setId === null || project?.format !== 'typeC' || !set) return null

  const consumers = consumersOf(project, set.id)

  const commitRename = () => {
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== set.name) {
      renameAssetSetAction(set.id, trimmed)
    } else {
      setDraftName(set.name)
    }
  }

  const onRegenerate = () => {
    // Try to match a preset by slot count for sensible glyph defaults; the
    // user can still edit the glyph strings inside the FontGenerator modal.
    const preset = TYPEC_FONT_INSERTABLE.find((k) => k.count === set.count)
    const glyphs =
      preset?.glyphs ??
      Array.from({ length: set.count }, (_, i) => String(i))
    setFontTarget({
      mode: 'replace-typeC-asset-set',
      setId: set.id,
      type: preset?.type ?? 0x00,
      name: set.name,
      glyphs,
    })
  }

  const onDelete = () => {
    if (consumers.length > 0) {
      setError(
        `"${set.name}" is still used by ${consumers.length} layer(s). Rebind or delete them first.`,
      )
      return
    }
    deleteAssetSetAction(set.id)
    onClose()
  }

  return createPortal(
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal asset-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Close asset details"
        >
          <X size={20} />
        </button>

        <div className="asset-detail-body">
          <header className="asset-detail-head">
            <label className="asset-detail-name">
              <span>Name</span>
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') {
                    setDraftName(set.name)
                    ;(e.target as HTMLInputElement).blur()
                  }
                }}
              />
            </label>
            <h2 id="asset-detail-title" className="sr-only">
              {set.name}
            </h2>
          </header>

          <dl className="asset-detail-stats">
            <dt>kind</dt>
            <dd>{set.kind}</dd>
            <dt>slots</dt>
            <dd>{set.count}</dd>
            <dt>size</dt>
            <dd>
              {set.width}×{set.height}
            </dd>
            <dt>consumers</dt>
            <dd>
              {consumers.length === 0
                ? 'none (orphan — excluded from .bin)'
                : `${consumers.length} layer${consumers.length === 1 ? '' : 's'}`}
            </dd>
          </dl>

          <div className="asset-detail-actions">
            <button
              type="button"
              className="counter"
              onClick={onRegenerate}
            >
              <Type size={14} aria-hidden />
              Regenerate from font
            </button>
            <button
              type="button"
              className="counter ghost danger"
              onClick={onDelete}
              disabled={consumers.length > 0}
              title={
                consumers.length > 0
                  ? `Used by ${consumers.length} layer(s); rebind or delete them first`
                  : 'Delete this asset set'
              }
            >
              <Trash2 size={14} aria-hidden />
              Delete
            </button>
          </div>

          <h3 className="asset-detail-section-title">Slots</h3>
          <ul className="asset-detail-slots">
            {set.slots.map((slot, i) => (
              <SlotRow
                key={i}
                setId={set.id}
                slotIdx={i}
                width={set.width}
                height={set.height}
                slot={slot}
              />
            ))}
          </ul>
        </div>

        <FontGenerator
          target={fontTarget}
          onClose={() => setFontTarget(null)}
        />
      </div>
    </div>,
    document.body,
  )
}

export default AssetDetailModal
