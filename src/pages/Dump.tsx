import { useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import {
  AlertTriangle,
  Binary,
  Copy,
  FileUp,
  Package,
} from 'lucide-react'
import FacePreview from '../components/dump/FacePreview'
import FacePreviewN from '../components/dump/FacePreviewN'
import DummyControls from '../components/dump/DummyControls'
import {
  buildWatchfaceTxt,
  decodeFile,
  encodeBmpRgb565,
  type DecodedBlob,
  type FaceHeader,
} from '../lib/dawft'
import {
  buildFaceNJson,
  collectBlobs,
  detectFormat,
  encodeBmp32,
  parseFaceN,
  type FaceN,
} from '../lib/faceN'
import { defaultDummy } from '../lib/renderFace'
import { defaultDummyN, type DummyStateN } from '../lib/renderFaceN'

type ParsedTypeC = {
  format: 'typeC'
  fileName: string
  fileSize: number
  header: FaceHeader
  blobs: DecodedBlob[]
  watchfaceTxt: string
  previews: string[]
}

type ParsedFaceN = {
  format: 'faceN'
  fileName: string
  fileSize: number
  face: FaceN
  watchfaceJson: string
}

type Parsed = ParsedTypeC | ParsedFaceN

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

const padIdx = (n: number) => String(n).padStart(3, '0')

const renderRgbaPreview = (
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

function Dump() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copyOk, setCopyOk] = useState(false)
  const [dummy, setDummy] = useState<DummyStateN>(() =>
    defaultDummyN(defaultDummy()),
  )

  const patchDummy = <K extends keyof DummyStateN>(
    key: K,
    value: DummyStateN[K],
  ) => setDummy((prev) => ({ ...prev, [key]: value }))

  const onResetDummy = () => setDummy(defaultDummyN(defaultDummy()))

  const handlePick = () => fileInputRef.current?.click()

  const handleFile = async (file: File) => {
    setError(null)
    setCopyOk(false)
    try {
      const data = new Uint8Array(await file.arrayBuffer())
      const fmt = detectFormat(data)
      if (fmt === 'typeC') {
        const { header, blobs } = decodeFile(data)
        const watchfaceTxt = buildWatchfaceTxt(header, blobs)
        const previews = blobs.map((b) =>
          b.rgba && b.width !== null && b.height !== null
            ? renderRgbaPreview(b.rgba, b.width, b.height)
            : '',
        )
        setParsed({
          format: 'typeC',
          fileName: file.name,
          fileSize: data.byteLength,
          header,
          blobs,
          watchfaceTxt,
          previews,
        })
      } else if (fmt === 'faceN') {
        const face = parseFaceN(data)
        const { names } = collectBlobs(face)
        const watchfaceJson = buildFaceNJson(face, names)
        setParsed({
          format: 'faceN',
          fileName: file.name,
          fileSize: data.byteLength,
          face,
          watchfaceJson,
        })
      } else {
        throw new Error(
          `Unrecognized format. First byte = 0x${data[0]?.toString(16).padStart(2, '0')}. Expected 0x81/0x04/0x84 (Type C) or a small u16 api_ver (FaceN).`,
        )
      }
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
    const text =
      parsed.format === 'typeC' ? parsed.watchfaceTxt : parsed.watchfaceJson
    try {
      await navigator.clipboard.writeText(text)
      setCopyOk(true)
      window.setTimeout(() => setCopyOk(false), 1500)
    } catch {
      // clipboard can fail in non-secure contexts; ignore
    }
  }

  const onDownloadZip = async () => {
    if (!parsed) return
    const zip = new JSZip()
    if (parsed.format === 'typeC') {
      zip.file('watchface.txt', parsed.watchfaceTxt)
      for (const b of parsed.blobs) {
        const name = padIdx(b.index)
        if (b.rgba && b.width !== null && b.height !== null) {
          zip.file(`${name}.bmp`, encodeBmpRgb565(b.rgba, b.width, b.height))
        } else {
          zip.file(`${name}.raw`, b.raw)
        }
      }
    } else {
      zip.file('watchface.json', parsed.watchfaceJson)
      const { files } = collectBlobs(parsed.face)
      for (const f of files) {
        if (f.rgba && f.width > 0 && f.height > 0) {
          zip.file(f.name, encodeBmp32(f.rgba, f.width, f.height))
        }
      }
    }
    const out = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(out)
    const a = document.createElement('a')
    a.href = url
    const baseName =
      parsed.format === 'typeC'
        ? `face-${parsed.header.faceNumber}`
        : parsed.fileName.replace(/\.[^.]+$/, '') || 'faceN'
    a.download = `${baseName}.zip`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const stats = useMemo(() => {
    if (!parsed) return null
    if (parsed.format === 'typeC') {
      const decoded = parsed.blobs.filter((b) => b.rgba !== null).length
      const compressed = parsed.blobs.filter(
        (b) => b.compression === 'RLE_LINE',
      ).length
      return {
        decoded,
        compressed,
        total: parsed.blobs.length,
      }
    }
    // FaceN: count blobs across digit sets and elements
    let totalImgs = 1 // preview
    let decoded = parsed.face.preview.rgba ? 1 : 0
    for (const set of parsed.face.digitSets) {
      for (const d of set.digits) {
        totalImgs++
        if (d.rgba) decoded++
      }
    }
    for (const el of parsed.face.elements) {
      switch (el.kind) {
        case 'Image':
        case 'Dash':
        case 'TimeHand':
          totalImgs++
          if (el.kind === 'Image' && el.img.rgba) decoded++
          else if (el.kind === 'Dash' && el.img.rgba) decoded++
          else if (el.kind === 'TimeHand' && el.img.rgba) decoded++
          break
        case 'BatteryFill':
          totalImgs += 3
          decoded += [el.bgImg, el.img1, el.img2].filter((i) => i.rgba).length
          break
        case 'DayName':
        case 'BarDisplay':
        case 'Weather':
          totalImgs += el.imgs.length
          decoded += el.imgs.filter((i) => i.rgba).length
          break
      }
    }
    return { decoded, total: totalImgs, compressed: totalImgs }
  }, [parsed])

  const maxWeatherIcon = useMemo(() => {
    if (parsed?.format !== 'faceN') return undefined
    const weather = parsed.face.elements.find((e) => e.kind === 'Weather')
    return weather && weather.kind === 'Weather'
      ? Math.max(0, weather.count - 1)
      : undefined
  }, [parsed])

  const formatLabel = parsed
    ? parsed.format === 'typeC'
      ? 'Type C'
      : 'FaceN'
    : null

  return (
    <section className="dump">
      <header className="faces-header">
        <h1>Dump watch face</h1>
        <p className="faces-endpoint">
          Parse a Mo Young / Da Fit <code>.bin</code> file → preview every blob
          and rebuild its config. Auto-detects Type C (dawft) and FaceN
          (extrathundertool).
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
            {parsed
              ? `${parsed.fileName}`
              : 'Drop a .bin file here, or click to pick'}
          </strong>
          {parsed && (
            <span className="dropzone-meta">
              {' '}· {formatBytes(parsed.fileSize)} ·{' '}
              <span className="format-badge">{formatLabel}</span>
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

      {parsed && parsed.format === 'typeC' && (
        <>
          <dl className="dump-summary">
            <dt>format</dt>
            <dd>Type C (dawft)</dd>
            <dt>fileID</dt>
            <dd>0x{parsed.header.fileID.toString(16).padStart(2, '0')}</dd>
            <dt>faceNumber</dt>
            <dd>{parsed.header.faceNumber}</dd>
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

          <h2 className="section-title">Live preview</h2>
          <div className="preview-row">
            <FacePreview
              header={parsed.header}
              blobs={parsed.blobs}
              dummy={dummy}
            />
            <DummyControls
              dummy={dummy}
              onPatch={patchDummy}
              onReset={onResetDummy}
            />
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

      {parsed && parsed.format === 'faceN' && (
        <>
          <dl className="dump-summary">
            <dt>format</dt>
            <dd>FaceN (extrathundertool)</dd>
            <dt>api_ver</dt>
            <dd>{parsed.face.header.apiVer}</dd>
            <dt>preview</dt>
            <dd>
              {parsed.face.preview.width}×{parsed.face.preview.height}
            </dd>
            <dt>digit sets</dt>
            <dd>{parsed.face.digitSets.length}</dd>
            <dt>elements</dt>
            <dd>{parsed.face.elements.length}</dd>
            <dt>decoded</dt>
            <dd>
              {stats?.decoded} / {stats?.total} images
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

          <h2 className="section-title">Live preview</h2>
          <div className="preview-row">
            <FacePreviewN face={parsed.face} dummy={dummy} />
            <DummyControls
              dummy={dummy}
              onPatch={patchDummy}
              onReset={onResetDummy}
              maxWeatherIcon={maxWeatherIcon}
            />
          </div>

          <h2 className="section-title">
            Digit sets ({parsed.face.digitSets.length})
          </h2>
          {parsed.face.digitSets.map((set, sIdx) => (
            <div key={sIdx} className="digit-set">
              <h3 className="digit-set-title">Set {sIdx}</h3>
              <ul className="blob-grid digits-row">
                {set.digits.map((d, dIdx) => (
                  <li key={dIdx} className="blob-card">
                    <div className="blob-thumb">
                      {d.rgba ? (
                        <img
                          src={renderRgbaPreview(d.rgba, d.width, d.height)}
                          alt={`Set ${sIdx} digit ${dIdx}`}
                          style={{ imageRendering: 'pixelated' }}
                        />
                      ) : (
                        <span className="blob-noimg">raw</span>
                      )}
                    </div>
                    <div className="blob-meta">
                      <code className="blob-name">{dIdx}</code>
                      <span className="blob-dim">
                        {d.width}×{d.height}
                      </span>
                      <span className="blob-size">{formatBytes(d.rawSize)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <h2 className="section-title">
            Elements ({parsed.face.elements.length})
          </h2>
          <ul className="element-list">
            {parsed.face.elements.map((el, idx) => (
              <li key={idx} className="element-card">
                <div className="element-head">
                  <code className="element-kind">{el.kind}</code>
                  <span className="element-etype">e_type {el.eType}</span>
                </div>
                <div className="element-body">
                  {el.kind === 'Image' && (
                    <>
                      <span className="element-pos">
                        ({el.x}, {el.y})
                      </span>
                      <span className="element-dim">
                        {el.img.width}×{el.img.height}
                      </span>
                      {el.img.rgba && (
                        <img
                          className="element-thumb"
                          src={renderRgbaPreview(
                            el.img.rgba,
                            el.img.width,
                            el.img.height,
                          )}
                          alt=""
                          style={{ imageRendering: 'pixelated' }}
                        />
                      )}
                    </>
                  )}
                  {el.kind === 'TimeNum' && (
                    <span className="element-pos">
                      digit_sets [{el.digitSets.join(',')}], xys{' '}
                      {el.xys
                        .map((p) => `(${p.x},${p.y})`)
                        .join(' ')}
                    </span>
                  )}
                  {el.kind === 'DayName' && (
                    <>
                      <span className="element-pos">
                        ({el.x}, {el.y}) n_type {el.nType}
                      </span>
                      <div className="element-thumbs">
                        {el.imgs.map(
                          (img, i) =>
                            img.rgba && (
                              <img
                                key={i}
                                className="element-thumb-sm"
                                src={renderRgbaPreview(
                                  img.rgba,
                                  img.width,
                                  img.height,
                                )}
                                alt=""
                                style={{ imageRendering: 'pixelated' }}
                              />
                            ),
                        )}
                      </div>
                    </>
                  )}
                  {(el.kind === 'HeartRateNum' ||
                    el.kind === 'StepsNum' ||
                    el.kind === 'KCalNum') && (
                    <span className="element-pos">
                      ({el.x}, {el.y}) digit_set {el.digitSet} align{' '}
                      {el.align}
                    </span>
                  )}
                  {el.kind === 'TimeHand' && (
                    <>
                      <span className="element-pos">
                        ({el.x}, {el.y}) h_type {el.hType} pivot ({el.pivotX},{' '}
                        {el.pivotY})
                      </span>
                      <span className="element-dim">
                        {el.img.width}×{el.img.height}
                      </span>
                      {el.img.rgba && (
                        <img
                          className="element-thumb"
                          src={renderRgbaPreview(
                            el.img.rgba,
                            el.img.width,
                            el.img.height,
                          )}
                          alt=""
                          style={{ imageRendering: 'pixelated' }}
                        />
                      )}
                    </>
                  )}
                  {(el.kind === 'DayNum' || el.kind === 'MonthNum') && (
                    <span className="element-pos">
                      digit_set {el.digitSet} align {el.align} xys{' '}
                      {el.xys.map((p) => `(${p.x},${p.y})`).join(' ')}
                    </span>
                  )}
                  {el.kind === 'BarDisplay' && (
                    <>
                      <span className="element-pos">
                        ({el.x}, {el.y}) b_type {el.bType} count {el.count}
                      </span>
                      <div className="element-thumbs">
                        {el.imgs.map(
                          (img, i) =>
                            img.rgba && (
                              <img
                                key={i}
                                className="element-thumb-sm"
                                src={renderRgbaPreview(
                                  img.rgba,
                                  img.width,
                                  img.height,
                                )}
                                alt=""
                                style={{ imageRendering: 'pixelated' }}
                              />
                            ),
                        )}
                      </div>
                    </>
                  )}
                  {el.kind === 'Weather' && (
                    <>
                      <span className="element-pos">
                        ({el.x}, {el.y}) count {el.count}
                      </span>
                      <div className="element-thumbs">
                        {el.imgs.map(
                          (img, i) =>
                            img.rgba && (
                              <img
                                key={i}
                                className="element-thumb-sm"
                                src={renderRgbaPreview(
                                  img.rgba,
                                  img.width,
                                  img.height,
                                )}
                                alt=""
                                style={{ imageRendering: 'pixelated' }}
                              />
                            ),
                        )}
                      </div>
                    </>
                  )}
                  {el.kind === 'BatteryFill' && (
                    <>
                      <span className="element-pos">
                        ({el.x}, {el.y}) fill ({el.x1},{el.y1})–({el.x2},
                        {el.y2})
                      </span>
                      <div className="element-thumbs">
                        {[el.bgImg, el.img1, el.img2].map(
                          (img, i) =>
                            img.rgba && (
                              <img
                                key={i}
                                className="element-thumb-sm"
                                src={renderRgbaPreview(
                                  img.rgba,
                                  img.width,
                                  img.height,
                                )}
                                alt=""
                                style={{ imageRendering: 'pixelated' }}
                              />
                            ),
                        )}
                      </div>
                    </>
                  )}
                  {el.kind === 'Dash' && el.img.rgba && (
                    <img
                      className="element-thumb"
                      src={renderRgbaPreview(
                        el.img.rgba,
                        el.img.width,
                        el.img.height,
                      )}
                      alt=""
                      style={{ imageRendering: 'pixelated' }}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>

          <h2 className="section-title with-action">
            <span>watchface.json</span>
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
            value={parsed.watchfaceJson}
            spellCheck={false}
          />
        </>
      )}

      {!parsed && !error && (
        <p className="hint">
          Tip: drop any Mo Young / Da Fit <code>.bin</code> watch face. We
          auto-detect Type C (dawft) and FaceN (extrathundertool) formats.
        </p>
      )}
    </section>
  )
}

export default Dump
