import { useState } from 'react'
import { AlertTriangle, ArrowLeft, Trash2, Type, Upload, X } from 'lucide-react'
import { useEditor } from '../../store/editorStore'
import {
  TYPEC_FONT_INSERTABLE,
  consumersOf,
  decodeBmpFile,
} from '../../lib/projectIO'
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

  const onPick = async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.bmp,image/bmp'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const bmp = await decodeBmpFile(file)
        const dimsDiffer =
          !isEmpty && (bmp.width !== width || bmp.height !== height)

        // Single-slot or empty set: adopt the new dims silently.
        // Multi-slot non-empty with new dims: confirm and clear siblings.
        let opts: { requireDimMatch?: boolean; clearOtherSlots?: boolean }
        if (isEmpty || setCount === 1) {
          opts = { requireDimMatch: false }
        } else if (dimsDiffer) {
          const others = setCount - 1
          const ok = window.confirm(
            `The selected BMP is ${bmp.width}×${bmp.height} but "${setName}" is ${width}×${height}.\n\n` +
              `Resize the whole set to ${bmp.width}×${bmp.height}? ` +
              `The other ${others} slot${others === 1 ? '' : 's'} will be cleared ` +
              `(pixel art doesn't scale cleanly, so they'd render wrong otherwise).`,
          )
          if (!ok) return
          opts = { requireDimMatch: false, clearOtherSlots: true }
        } else {
          opts = { requireDimMatch: true }
        }

        const err = replace(
          { tag: 'typeC-slot', setId, slotIdx },
          bmp,
          opts,
        )
        if (err) onError(err)
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err))
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
            : setCount === 1
              ? 'Replace BMP (any size)'
              : `Replace BMP (${width}×${height}, or resize the whole set)`
        }
        aria-label={isEmpty ? 'Set BMP' : 'Replace BMP'}
        onClick={onPick}
      >
        <Upload size={12} />
      </button>
    </li>
  )
}

function AssetDetailView({ setId, hasLayerContext, onClose }: Props) {
  const project = useEditor((s) => s.project)
  const renameAssetSetAction = useEditor((s) => s.renameAssetSetAction)
  const deleteAssetSetAction = useEditor((s) => s.deleteAssetSetAction)

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

  const onRegenerate = () => {
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
          <button
            type="button"
            className="banner-dismiss"
            onClick={() => setLocalError(null)}
            aria-label="Dismiss error"
            title="Dismiss"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      )}

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
        <button type="button" className="counter" onClick={onRegenerate}>
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
