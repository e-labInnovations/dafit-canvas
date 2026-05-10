import { useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import {
  AlertTriangle,
  Binary,
  Copy,
  FileUp,
  Package,
} from 'lucide-react'
import {
  buildWatchfaceTxt,
  decodeFile,
  encodeBmpRgb565,
  type DecodedBlob,
  type FaceHeader,
} from '../lib/dawft'

type Parsed = {
  fileName: string
  fileSize: number
  header: FaceHeader
  blobs: DecodedBlob[]
  watchfaceTxt: string
  previews: string[] // index-aligned data URLs (empty string when not previewable)
}

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

const padIdx = (n: number) => String(n).padStart(3, '0')

const renderPreview = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): string => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0)
  return canvas.toDataURL('image/png')
}

function Dump() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copyOk, setCopyOk] = useState(false)

  const handlePick = () => fileInputRef.current?.click()

  const handleFile = async (file: File) => {
    setError(null)
    setCopyOk(false)
    try {
      const buffer = await file.arrayBuffer()
      const data = new Uint8Array(buffer)
      const { header, blobs } = decodeFile(data)
      const watchfaceTxt = buildWatchfaceTxt(header, blobs)
      const previews = blobs.map((b) =>
        b.rgba && b.width !== null && b.height !== null
          ? renderPreview(b.rgba, b.width, b.height)
          : '',
      )
      setParsed({
        fileName: file.name,
        fileSize: data.byteLength,
        header,
        blobs,
        watchfaceTxt,
        previews,
      })
    } catch (err) {
      setParsed(null)
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

  const onCopy = async () => {
    if (!parsed) return
    try {
      await navigator.clipboard.writeText(parsed.watchfaceTxt)
      setCopyOk(true)
      window.setTimeout(() => setCopyOk(false), 1500)
    } catch {
      // clipboard can fail in non-secure contexts; ignore
    }
  }

  const onDownloadZip = async () => {
    if (!parsed) return
    const zip = new JSZip()
    zip.file('watchface.txt', parsed.watchfaceTxt)
    for (const b of parsed.blobs) {
      const name = padIdx(b.index)
      if (b.rgba && b.width !== null && b.height !== null) {
        const bmp = encodeBmpRgb565(b.rgba, b.width, b.height)
        zip.file(`${name}.bmp`, bmp)
      } else {
        zip.file(`${name}.raw`, b.raw)
      }
    }
    const out = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(out)
    const a = document.createElement('a')
    a.href = url
    a.download = `face-${parsed.header.faceNumber}.zip`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const stats = useMemo(() => {
    if (!parsed) return null
    const decoded = parsed.blobs.filter((b) => b.rgba !== null).length
    const compressed = parsed.blobs.filter(
      (b) => b.compression === 'RLE_LINE',
    ).length
    return { decoded, compressed, total: parsed.blobs.length }
  }, [parsed])

  return (
    <section className="dump">
      <header className="faces-header">
        <h1>Dump watch face</h1>
        <p className="faces-endpoint">
          Parse a Type C <code>.bin</code> file → preview every blob and rebuild{' '}
          <code>watchface.txt</code>.
        </p>
      </header>

      <div
        className={`dropzone ${parsed ? 'compact' : ''}`}
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
        <Binary size={parsed ? 18 : 32} aria-hidden />
        <div>
          <strong>
            {parsed ? `${parsed.fileName}` : 'Drop a .bin file here, or click to pick'}
          </strong>
          {parsed && (
            <span className="dropzone-meta">
              {' '}· {formatBytes(parsed.fileSize)} · faceNumber{' '}
              {parsed.header.faceNumber}
            </span>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".bin,application/octet-stream"
          hidden
          onChange={onFileInput}
        />
      </div>

      {error && (
        <div className="banner banner-error">
          <AlertTriangle size={18} aria-hidden />
          <div>
            <strong>Failed to parse:</strong> {error}
          </div>
        </div>
      )}

      {parsed && (
        <>
          <dl className="dump-summary">
            <dt>fileID</dt>
            <dd>0x{parsed.header.fileID.toString(16).padStart(2, '0')}</dd>
            <dt>dataCount</dt>
            <dd>{parsed.header.dataCount}</dd>
            <dt>blobCount</dt>
            <dd>{parsed.header.blobCount}</dd>
            <dt>animationFrames</dt>
            <dd>{parsed.header.animationFrames}</dd>
            <dt>decoded</dt>
            <dd>
              {stats?.decoded} / {stats?.total} ({stats?.compressed} RLE)
            </dd>
          </dl>

          <div className="dump-actions">
            <button type="button" className="counter" onClick={onDownloadZip}>
              <Package size={14} aria-hidden />
              Download ZIP
            </button>
            <button
              type="button"
              className="counter ghost"
              onClick={handlePick}
            >
              <FileUp size={14} aria-hidden />
              Open another
            </button>
          </div>

          <h2 className="section-title">Blobs ({parsed.blobs.length})</h2>
          <ul className="blob-grid">
            {parsed.blobs.map((b, i) => {
              const previewUrl = parsed.previews[i]
              return (
                <li key={b.index} className="blob-card">
                  <div className="blob-thumb">
                    {previewUrl ? (
                      <img
                        src={previewUrl}
                        alt={`Blob ${b.index}`}
                        style={{ imageRendering: 'pixelated' }}
                      />
                    ) : (
                      <span className="blob-noimg">raw</span>
                    )}
                  </div>
                  <div className="blob-meta">
                    <code className="blob-name">{padIdx(b.index)}.bmp</code>
                    <span className="blob-type">{b.typeName}</span>
                    <span className="blob-dim">
                      {b.width !== null && b.height !== null
                        ? `${b.width}×${b.height}`
                        : '—'}
                    </span>
                    <span
                      className={`blob-comp ${b.compression === 'RLE_LINE' ? 'is-rle' : ''}`}
                    >
                      {b.compression}
                    </span>
                    <span className="blob-size">{formatBytes(b.rawSize)}</span>
                  </div>
                </li>
              )
            })}
          </ul>

          <h2 className="section-title with-action">
            <span>watchface.txt</span>
            <button
              type="button"
              className="counter ghost"
              onClick={onCopy}
              aria-live="polite"
            >
              <Copy size={14} aria-hidden />
              {copyOk ? 'Copied' : 'Copy'}
            </button>
          </h2>
          <textarea
            className="dump-text"
            readOnly
            value={parsed.watchfaceTxt}
            spellCheck={false}
          />
        </>
      )}

      {!parsed && !error && (
        <p className="hint">
          Tip: dump a face from the Watch faces page first, or grab any{' '}
          <code>.bin</code> built with <code>dawft create</code>.{' '}
          <a
            href="https://github.com/david47k/dawft/tree/main/example1"
            target="_blank"
            rel="noreferrer"
          >
            Sample files
          </a>
          .
        </p>
      )}
    </section>
  )
}

export default Dump
