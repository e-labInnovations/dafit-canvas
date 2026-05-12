import { useRef } from 'react'
import { Upload } from 'lucide-react'
import { useEditor } from '../../store/editorStore'
import {
  decodeBmpFile,
  listLayerAssets,
  type AssetRef,
  type AssetView,
} from '../../lib/projectIO'

const rgbaToDataUrl = (
  rgba: Uint8ClampedArray | null,
  width: number,
  height: number,
): string => {
  if (!rgba || width === 0 || height === 0) return ''
  // A blob's decoded `rgba` length should equal `width * height * 4`. If it
  // doesn't (e.g., a buffer that survived a re-encode/decode with different
  // dims) `imgData.data.set(rgba)` throws RangeError and React unmounts the
  // whole AssetSection — which looks like "assets section is silently empty".
  // Guard so we degrade to the "empty" placeholder instead.
  const expected = width * height * 4
  if (rgba.length !== expected) {
    console.warn(
      `[AssetSection] rgba length ${rgba.length} ≠ ${width}×${height}×4 (${expected}); rendering placeholder`,
    )
    return ''
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    const imgData = ctx.createImageData(width, height)
    imgData.data.set(rgba)
    ctx.putImageData(imgData, 0, 0)
    return canvas.toDataURL('image/png')
  } catch (err) {
    console.warn('[AssetSection] thumbnail render failed:', err)
    return ''
  }
}

function AssetRow({ asset }: { asset: AssetView }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const replace = useEditor((s) => s.replaceAssetAction)
  const setError = useEditor((s) => s.setError)

  const url = rgbaToDataUrl(asset.rgba, asset.width, asset.height)
  const isEmpty = asset.width === 0 || asset.height === 0

  const onPick = () => inputRef.current?.click()
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const bmp = await decodeBmpFile(file)
      replace(asset.ref, bmp, !isEmpty)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <li className="asset-row">
      <div className="asset-thumb">
        {url ? (
          <img src={url} alt={asset.label} style={{ imageRendering: 'pixelated' }} />
        ) : (
          <span className="asset-empty">empty</span>
        )}
      </div>
      <div className="asset-meta">
        <code className="asset-label">{asset.label}</code>
        <span className="asset-dim">
          {asset.width}×{asset.height}
        </span>
      </div>
      <button
        type="button"
        className="icon-btn"
        onClick={onPick}
        aria-label={isEmpty ? 'Set BMP' : 'Replace BMP'}
        title={isEmpty ? 'Set BMP' : `Replace BMP (must be ${asset.width}×${asset.height})`}
      >
        <Upload size={14} />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".bmp,image/bmp"
        hidden
        onChange={onFile}
      />
    </li>
  )
}

function AssetSection({ layerIdx }: { layerIdx: number }) {
  const project = useEditor((s) => s.project)
  if (!project) return null
  const assets = listLayerAssets(project, layerIdx)
  if (assets.length === 0) {
    return (
      <p className="hint">
        This kind references a shared digit set rather than per-layer assets.
        Edit digits via the font generator (Phase 3).
      </p>
    )
  }
  return (
    <ul className="asset-list">
      {assets.map((a, i) => (
        <AssetRow key={`${i}-${assetRefKey(a.ref)}`} asset={a} />
      ))}
    </ul>
  )
}

const assetRefKey = (ref: AssetRef): string => {
  switch (ref.tag) {
    case 'typeC-blob':
      return `tc-${ref.blobIdx}`
    case 'faceN-preview':
      return 'fn-preview'
    case 'faceN-digit':
      return `fn-d-${ref.setIdx}-${ref.digitIdx}`
    case 'faceN-elem':
      return `fn-e-${ref.elementIdx}-${ref.slotIdx}`
  }
}

export default AssetSection
