import { useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Pencil,
  Trash2,
  Type,
  Upload,
  X,
} from 'lucide-react'
import { useEditor } from '../../store/editorStore'
import {
  TYPEC_FONT_INSERTABLE,
  consumersOf,
  decodeBmpFile,
  defaultGlyphTextForType,
} from '../../lib/projectIO'
import BmpPixelEditor from './BmpPixelEditor'
import Tooltip from '../Tooltip'
import FontGenerator, { type FontTarget } from './FontGenerator'
import type { AssetSet, AssetSlot } from '../../types/face'

type Props = {
  setId: string
  /** When true the view renders a "Back to layer" affordance, otherwise just a
   *  close-X. Driven by whether a layer is selected in the editor. */
  hasLayerContext: boolean
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
  setName,
  setCount,
  slotIdx,
  width,
  height,
  slot,
  onError,
}: {
  setId: string
  setName: string
  setCount: number
  slotIdx: number
  width: number
  height: number
  slot: AssetSlot
  onError: (msg: string) => void
}) {
  const replace = useEditor((s) => s.replaceAssetAction)
  const url = rgbaToDataUrl(slot.rgba, width, height)
  const isEmpty = width === 0 || height === 0 || !slot.rgba
  const [editorOpen, setEditorOpen] = useState(false)

  /** Shared by the file-picker and the BMP editor — applies the new pixels
   *  to the slot with the right size-handling policy:
   *    - empty set or count=1 → adopt new dims silently
   *    - multi-slot, dim mismatch → confirm + clear siblings
   *    - otherwise → strict dim match (the same-size happy path) */
  const commitBitmap = (bmp: {
    width: number
    height: number
    rgba: Uint8ClampedArray
  }) => {
    const dimsDiffer =
      !isEmpty && (bmp.width !== width || bmp.height !== height)
    let opts: { requireDimMatch?: boolean; clearOtherSlots?: boolean }
    if (isEmpty || setCount === 1) {
      opts = { requireDimMatch: false }
    } else if (dimsDiffer) {
      const others = setCount - 1
      const ok = window.confirm(
        `The new image is ${bmp.width}×${bmp.height} but "${setName}" is ${width}×${height}.\n\n` +
          `Resize the whole set to ${bmp.width}×${bmp.height}? ` +
          `The other ${others} slot${others === 1 ? '' : 's'} will be cleared ` +
          `(pixel art doesn't scale cleanly, so they'd render wrong otherwise).`,
      )
      if (!ok) return
      opts = { requireDimMatch: false, clearOtherSlots: true }
    } else {
      opts = { requireDimMatch: true }
    }
    const err = replace({ tag: 'typeC-slot', setId, slotIdx }, bmp, opts)
    if (err) onError(err)
  }

  const onPick = async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.bmp,image/bmp'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const bmp = await decodeBmpFile(file)
        commitBitmap(bmp)
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err))
      }
    }
    input.click()
  }

  const onEdit = () => {
    setEditorOpen(true)
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
      <div className="asset-detail-slot-actions">
        <Tooltip content="Edit BMP (crop, draw, filters, resize)">
          <button
            type="button"
            className="icon-btn"
            aria-label="Edit BMP"
            onClick={onEdit}
          >
            <Pencil size={12} />
          </button>
        </Tooltip>
        <Tooltip
          content={
            isEmpty
              ? 'Set BMP from file'
              : setCount === 1
                ? 'Replace from file (any size)'
                : `Replace from file (${width}×${height}, or resize the whole set)`
          }
        >
          <button
            type="button"
            className="icon-btn"
            aria-label={isEmpty ? 'Set BMP from file' : 'Replace BMP from file'}
            onClick={onPick}
          >
            <Upload size={12} />
          </button>
        </Tooltip>
      </div>

      {editorOpen && (
        <BmpPixelEditor
          rgba={slot.rgba}
          width={width > 0 ? width : 32}
          height={height > 0 ? height : 32}
          name={`${setName} · slot ${slotIdx}`}
          onSave={(rgba, w, h) => {
            commitBitmap({ width: w, height: h, rgba })
            setEditorOpen(false)
          }}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </li>
  )
}

function AssetDetailView({ setId, hasLayerContext, onClose }: Props) {
  const project = useEditor((s) => s.project)
  const renameAssetSetAction = useEditor((s) => s.renameAssetSetAction)
  const deleteAssetSetAction = useEditor((s) => s.deleteAssetSetAction)
  const resizeAssetSetAction = useEditor((s) => s.resizeAssetSetAction)

  const set: AssetSet | undefined =
    project?.format === 'typeC'
      ? project.assetSets.find((s) => s.id === setId)
      : undefined

  // Local — replaces the global error banner that the modal used to trigger
  // via `setError`. Dimension mismatches and delete-blocked-by-consumers land
  // here so the message stays adjacent to the action that caused it.
  const [localError, setLocalError] = useState<string | null>(null)
  // setId is the parent's render key, so a fresh AssetDetailView is mounted
  // per set — initial draftName seeded from props is safe.
  const [draftName, setDraftName] = useState(() => set?.name ?? '')
  const [draftW, setDraftW] = useState(() => String(set?.width ?? 0))
  const [draftH, setDraftH] = useState(() => String(set?.height ?? 0))
  const [fontTarget, setFontTarget] = useState<FontTarget | null>(null)

  if (!set || !project || project.format !== 'typeC') return null

  const consumers = consumersOf(project, set.id)

  const commitRename = () => {
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== set.name) {
      renameAssetSetAction(set.id, trimmed)
    } else {
      setDraftName(set.name)
    }
  }

  const widthDraftChanged = parseInt(draftW, 10) !== set.width
  const heightDraftChanged = parseInt(draftH, 10) !== set.height
  const sizeDraftChanged = widthDraftChanged || heightDraftChanged

  const commitResize = () => {
    const w = parseInt(draftW, 10)
    const h = parseInt(draftH, 10)
    if (!Number.isFinite(w) || w < 1 || !Number.isFinite(h) || h < 1) {
      setLocalError('Width and height must be positive integers.')
      return
    }
    if (w === set.width && h === set.height) return
    // Pixel art can't scale cleanly — warn the user if slots actually have
    // bitmaps to lose. Empty sets resize silently.
    const hasBitmaps = set.slots.some((s) => s.rgba !== null)
    if (
      hasBitmaps &&
      !window.confirm(
        `Resize "${set.name}" to ${w}×${h}?\n\n` +
          `All ${set.count} slot${set.count === 1 ? '' : 's'} will be cleared — pixel art doesn't scale cleanly. ` +
          `You can undo with Cmd/Ctrl+Z.`,
      )
    ) {
      // Revert the draft to current size so the inputs stay in sync.
      setDraftW(String(set.width))
      setDraftH(String(set.height))
      return
    }
    const err = resizeAssetSetAction(set.id, w, h)
    if (err) setLocalError(err)
  }

  const onSizeKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitResize()
    } else if (e.key === 'Escape') {
      setDraftW(String(set.width))
      setDraftH(String(set.height))
    }
  }

  const onRegenerate = () => {
    // Prefer the consuming layer's type — that's the truth for what the
    // set actually paints, and lets us pre-fill text like "AM" / "PM" / ":"
    // for single-slot label kinds. Falls back to "first match by slot
    // count" so orphan sets still get a reasonable preset.
    const consumer = project.layers.find((l) => l.assetSetId === set.id)
    const layerType = consumer?.type
    const presetByType =
      layerType !== undefined
        ? TYPEC_FONT_INSERTABLE.find((k) => k.type === layerType)
        : undefined
    const presetByCount = TYPEC_FONT_INSERTABLE.find(
      (k) => k.count === set.count,
    )
    const preset = presetByType ?? presetByCount
    const glyphs =
      preset?.glyphs ??
      (set.count === 1
        ? [defaultGlyphTextForType(layerType ?? 0)]
        : Array.from({ length: set.count }, (_, i) => String(i)))
    setFontTarget({
      mode: 'replace-typeC-asset-set',
      setId: set.id,
      type: layerType ?? preset?.type ?? 0x00,
      name: set.name,
      glyphs,
    })
  }

  const onDelete = () => {
    if (consumers.length > 0) {
      setLocalError(
        `"${set.name}" is still used by ${consumers.length} layer${consumers.length === 1 ? '' : 's'}. Rebind or delete them first.`,
      )
      return
    }
    deleteAssetSetAction(set.id)
    onClose()
  }

  return (
    <div className="asset-detail asset-detail-inline">
      <button
        type="button"
        className="asset-detail-back"
        onClick={onClose}
        aria-label={hasLayerContext ? 'Back to layer' : 'Close asset detail'}
      >
        {hasLayerContext ? <ArrowLeft size={14} /> : <X size={14} />}
        <span>{hasLayerContext ? 'Back to layer' : 'Close'}</span>
      </button>

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

      {localError && (
        <div className="banner banner-error asset-detail-error">
          <AlertTriangle size={16} aria-hidden />
          <div>{localError}</div>
          <Tooltip content="Dismiss">
            <button
              type="button"
              className="banner-dismiss"
              onClick={() => setLocalError(null)}
              aria-label="Dismiss error"
            >
              <X size={14} aria-hidden />
            </button>
          </Tooltip>
        </div>
      )}

      <dl className="asset-detail-stats">
        <dt>kind</dt>
        <dd>{set.kind}</dd>
        <dt>slots</dt>
        <dd>{set.count}</dd>
        <dt>size</dt>
        <dd className="asset-detail-size">
          <input
            type="number"
            min={1}
            value={draftW}
            onChange={(e) => setDraftW(e.target.value)}
            onKeyDown={onSizeKey}
            aria-label="Width"
          />
          <span className="asset-detail-size-x" aria-hidden>
            ×
          </span>
          <input
            type="number"
            min={1}
            value={draftH}
            onChange={(e) => setDraftH(e.target.value)}
            onKeyDown={onSizeKey}
            aria-label="Height"
          />
          {sizeDraftChanged && (
            <Tooltip content="Apply new size (clears all slot bitmaps)">
              <button
                type="button"
                className="counter ghost asset-detail-resize"
                onClick={commitResize}
              >
                Resize
              </button>
            </Tooltip>
          )}
        </dd>
        <dt>consumers</dt>
        <dd>
          {consumers.length === 0
            ? 'none (orphan — excluded from .bin)'
            : `${consumers.length} layer${consumers.length === 1 ? '' : 's'}`}
        </dd>
      </dl>

      <div className="asset-detail-actions">
        <button type="button" className="counter" onClick={onRegenerate}>
          <Type size={14} aria-hidden />
          Regenerate from font
        </button>
        <Tooltip
          content={
            consumers.length > 0
              ? `Used by ${consumers.length} layer(s); rebind or delete them first`
              : 'Delete this asset set'
          }
        >
          <button
            type="button"
            className="counter ghost danger"
            onClick={onDelete}
            disabled={consumers.length > 0}
          >
            <Trash2 size={14} aria-hidden />
            Delete
          </button>
        </Tooltip>
      </div>

      <h3 className="asset-detail-section-title">Slots</h3>
      <ul className="asset-detail-slots">
        {set.slots.map((slot, i) => (
          <SlotRow
            key={i}
            setId={set.id}
            setName={set.name}
            setCount={set.count}
            slotIdx={i}
            width={set.width}
            height={set.height}
            slot={slot}
            onError={setLocalError}
          />
        ))}
      </ul>

      <FontGenerator
        target={fontTarget}
        onClose={() => setFontTarget(null)}
      />
    </div>
  )
}

export default AssetDetailView
