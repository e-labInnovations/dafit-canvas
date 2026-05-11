import { useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Package,
  Upload,
} from 'lucide-react'
import FacePreview from '../components/dump/FacePreview'
import FacePreviewN from '../components/dump/FacePreviewN'
import { decodeBmp } from '../lib/bmp'
import {
  decodeFile,
  packTypeC,
  parseWatchfaceTxt,
  type DecodedBlob,
  type FaceHeader,
  type PackTypeCBlob,
  type ParsedWatchfaceTxt,
} from '../lib/dawft'
import {
  packFaceN,
  parseFaceN,
  parseWatchfaceJson,
  type FaceN,
  type ParsedWatchfaceJson,
} from '../lib/faceN'
import { defaultDummy } from '../lib/renderFace'
import { defaultDummyN, type DummyStateN } from '../lib/renderFaceN'

type DecodedBitmap = { width: number; height: number; rgba: Uint8ClampedArray }

type PackedTypeC = {
  format: 'typeC'
  config: ParsedWatchfaceTxt
  bmpFiles: { name: string; bitmap: DecodedBitmap }[]
  bin: Uint8Array
  previewHeader: FaceHeader
  previewBlobs: DecodedBlob[]
}

type PackedFaceN = {
  format: 'faceN'
  config: ParsedWatchfaceJson
  bmpFiles: { name: string; bitmap: DecodedBitmap }[]
  bin: Uint8Array
  preview: FaceN
}

type Packed = PackedTypeC | PackedFaceN

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

const padIdx = (n: number) => String(n).padStart(3, '0')

const downloadBinary = (data: Uint8Array, filename: string, mime: string) => {
  // Copy into a fresh ArrayBuffer-backed view so the Blob constructor accepts
  // it under TS6's stricter `BlobPart` typing (which rejects ArrayBufferLike).
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  const blob = new Blob([copy.buffer], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function Pack() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [packed, setPacked] = useState<Packed | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zipName, setZipName] = useState<string | null>(null)
  const dummy = useMemo<DummyStateN>(() => defaultDummyN(defaultDummy()), [])

  const handlePick = () => fileInputRef.current?.click()

  const handleFile = async (file: File) => {
    setPacked(null)
    setError(null)
    setZipName(file.name)
    try {
      const zip = await JSZip.loadAsync(file)

      // Detect format by which config file is present.
      const txtEntry = zip.file(/watchface\.txt$/i)[0]
      const jsonEntry = zip.file(/watchface\.json$/i)[0]
      if (!txtEntry && !jsonEntry) {
        throw new Error(
          'ZIP must contain a watchface.txt (Type C) or watchface.json (FaceN).',
        )
      }

      if (txtEntry) {
        const txt = await txtEntry.async('string')
        const config = parseWatchfaceTxt(txt)
        const assets = await loadBmpsFromZip(zip)
        const totalAvailable = assets.byNumber.size + assets.rawByNumber.size
        if (config.blobCount > totalAvailable) {
          throw new Error(
            `watchface.txt declares blobCount=${config.blobCount} but the ZIP only has ${totalAvailable} blob asset(s) (${assets.byNumber.size} BMP + ${assets.rawByNumber.size} RAW).`,
          )
        }
        const orderedBlobs: PackTypeCBlob[] = []
        for (let i = 0; i < config.blobCount; i++) {
          const bmp = assets.byNumber.get(i)
          if (bmp) {
            orderedBlobs.push({ kind: 'bitmap', ...bmp })
            continue
          }
          const raw = assets.rawByNumber.get(i)
          if (raw) {
            orderedBlobs.push({ kind: 'raw', data: raw })
            continue
          }
          throw new Error(
            `Missing ${padIdx(i)}.bmp or ${padIdx(i)}.raw for blob index ${i}`,
          )
        }
        const bin = packTypeC({ config, blobs: orderedBlobs })
        const { header, blobs } = decodeFile(bin)
        setPacked({
          format: 'typeC',
          config,
          bmpFiles: assets.list,
          bin,
          previewHeader: header,
          previewBlobs: blobs,
        })
      } else if (jsonEntry) {
        const txt = await jsonEntry.async('string')
        const config = parseWatchfaceJson(txt)
        const { byName, list } = await loadBmpsFromZip(zip)
        const bin = packFaceN({ config, bitmaps: byName })
        const preview = parseFaceN(bin)
        setPacked({
          format: 'faceN',
          config,
          bmpFiles: list,
          bin,
          preview,
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const onFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) await handleFile(file)
    e.target.value = ''
  }

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) await handleFile(file)
  }

  const onDownloadBin = () => {
    if (!packed) return
    const baseName =
      zipName?.replace(/\.(zip|ZIP)$/, '') ??
      (packed.format === 'typeC' ? `face-${packed.config.faceNumber}` : 'faceN')
    downloadBinary(packed.bin, `${baseName}.bin`, 'application/octet-stream')
  }

  return (
    <section className="dump">
      <header className="faces-header">
        <h1>Pack watch face</h1>
        <p className="faces-endpoint">
          Upload a ZIP containing <code>watchface.txt</code> + BMPs (Type C) or{' '}
          <code>watchface.json</code> + BMPs (FaceN). We'll preview the result
          and let you download the compiled <code>.bin</code>.
        </p>
      </header>

      <div
        className="dropzone"
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={handlePick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handlePick()
          }
        }}
      >
        <Upload size={packed ? 18 : 32} aria-hidden />
        <div>
          <strong>
            {packed ? zipName : 'Drop a .zip here, or click to pick'}
          </strong>
          {packed && (
            <span className="dropzone-meta">
              {' '}· {formatBytes(packed.bin.byteLength)} compiled ·{' '}
              <span className="format-badge">
                {packed.format === 'typeC' ? 'Type C' : 'FaceN'}
              </span>
            </span>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={onFileInput}
        />
      </div>

      {error && (
        <div className="banner banner-error">
          <AlertTriangle size={18} aria-hidden />
          <div>
            <strong>Failed to pack:</strong> {error}
          </div>
        </div>
      )}

      {packed && (
        <>
          <div className="banner banner-ok">
            <CheckCircle2 size={18} aria-hidden />
            <div>
              <strong>Packed successfully.</strong> {packed.bmpFiles.length} BMP(s)
              encoded · final binary is {formatBytes(packed.bin.byteLength)}.
            </div>
          </div>

          <div className="dump-actions">
            <button type="button" className="counter" onClick={onDownloadBin}>
              <Download size={14} aria-hidden />
              Download .bin
            </button>
            <button type="button" className="counter ghost" onClick={handlePick}>
              <Package size={14} aria-hidden />
              Open another
            </button>
          </div>

          <h2 className="section-title">Live preview</h2>
          <div className="preview-row">
            {packed.format === 'typeC' ? (
              <FacePreview
                header={packed.previewHeader}
                blobs={packed.previewBlobs}
                dummy={dummy}
              />
            ) : (
              <FacePreviewN face={packed.preview} dummy={dummy} />
            )}
            <div className="dummy-controls">
              <p className="hint">
                Preview uses current local time as dummy state. Switch to{' '}
                <code>/dump</code> for interactive dummy data — same renderer.
              </p>
            </div>
          </div>

          <h2 className="section-title">Assets ({packed.bmpFiles.length})</h2>
          <ul className="blob-grid">
            {packed.bmpFiles.map((b) => (
              <li key={b.name} className="blob-card">
                <div className="blob-thumb">
                  <img
                    src={rgbaToDataUrl(b.bitmap.rgba, b.bitmap.width, b.bitmap.height)}
                    alt={b.name}
                    style={{ imageRendering: 'pixelated' }}
                  />
                </div>
                <div className="blob-meta">
                  <code className="blob-name">{b.name}</code>
                  <span className="blob-dim">
                    {b.bitmap.width}×{b.bitmap.height}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {!packed && !error && (
        <p className="hint">
          Tip: dump a face first via <code>/dump</code> to get a ZIP, then edit
          the BMPs and re-upload here.
        </p>
      )}
    </section>
  )
}

const rgbaToDataUrl = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): string => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const imgData = ctx.createImageData(width, height)
  imgData.data.set(rgba)
  ctx.putImageData(imgData, 0, 0)
  return canvas.toDataURL('image/png')
}

type LoadedBmps = {
  list: { name: string; bitmap: DecodedBitmap }[]
  byNumber: Map<number, DecodedBitmap>
  byName: Map<string, DecodedBitmap>
  /** `.raw` blobs that the dump stage couldn't decode as bitmaps. We pass them
   *  through verbatim during pack. */
  rawByNumber: Map<number, Uint8Array>
}

const loadBmpsFromZip = async (zip: JSZip): Promise<LoadedBmps> => {
  const list: { name: string; bitmap: DecodedBitmap }[] = []
  const byNumber = new Map<number, DecodedBitmap>()
  const byName = new Map<string, DecodedBitmap>()
  const rawByNumber = new Map<number, Uint8Array>()

  const bmpEntries = Object.values(zip.files).filter(
    (f) => !f.dir && /\.bmp$/i.test(f.name),
  )
  for (const entry of bmpEntries) {
    const data = await entry.async('uint8array')
    const bitmap = decodeBmp(data)
    const fileName = entry.name.split('/').pop() ?? entry.name
    list.push({ name: fileName, bitmap })
    byName.set(fileName, bitmap)
    // Capture the trailing number before `.bmp` so `000.bmp`, `db000.bmp`,
    // and `myface_005.bmp` all index correctly.
    const match = fileName.match(/(\d+)\.bmp$/i)
    if (match) byNumber.set(parseInt(match[1], 10), bitmap)
  }

  const rawEntries = Object.values(zip.files).filter(
    (f) => !f.dir && /\.raw$/i.test(f.name),
  )
  for (const entry of rawEntries) {
    const data = await entry.async('uint8array')
    const fileName = entry.name.split('/').pop() ?? entry.name
    const match = fileName.match(/(\d+)\.raw$/i)
    if (match) rawByNumber.set(parseInt(match[1], 10), data)
  }

  list.sort((a, b) => a.name.localeCompare(b.name))
  return { list, byNumber, byName, rawByNumber }
}

export default Pack
