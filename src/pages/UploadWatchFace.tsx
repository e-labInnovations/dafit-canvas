import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Battery,
  Bluetooth,
  BluetoothOff,
  CheckCircle2,
  FileUp,
  Plug,
  Unplug,
  Upload,
} from 'lucide-react'
import FacePreview from '../components/dump/FacePreview'
import FacePreviewN from '../components/dump/FacePreviewN'
import Loader from '../components/Loader'
import Tooltip from '../components/Tooltip'
import {
  MoyoungWatch,
  isWebBluetoothSupported,
  type DeviceInfo,
  type UploadProgress,
  type UploadResult,
} from '../lib/moyoungBle'
import {
  decodeFile,
  type DecodedBlob,
  type FaceHeader,
} from '../lib/dawft'
import { detectFormat, parseFaceN, type FaceN } from '../lib/faceN'
import {
  classifyFaceSize,
  faceSizeHint,
  faceSizeWarnSummary,
  formatFaceSize,
} from '../lib/faceSize'
import { defaultDummy } from '../lib/renderFace'
import { defaultDummyN, type DummyStateN } from '../lib/renderFaceN'

type Status = 'idle' | 'connecting' | 'uploading' | 'done' | 'error'

type ParsedFile =
  | { format: 'typeC'; header: FaceHeader; blobs: DecodedBlob[] }
  | { format: 'faceN'; face: FaceN }

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function UploadWatchFace() {
  const supported = isWebBluetoothSupported()
  const watchRef = useRef<MoyoungWatch | null>(null)
  const [device, setDevice] = useState<DeviceInfo | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [parsedFile, setParsedFile] = useState<ParsedFile | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  // Static dummy state for the preview (current local time). Live controls
  // belong on /dump; here we just need a recognizable rendering for visual
  // confirmation.
  const dummy = useMemo<DummyStateN>(() => defaultDummyN(defaultDummy()), [])

  useEffect(() => {
    return () => {
      watchRef.current?.disconnect().catch(() => {})
      watchRef.current = null
    }
  }, [])

  const handleConnect = async () => {
    if (!supported) return
    setError(null)
    setStatus('connecting')
    try {
      const watch = new MoyoungWatch()
      watch.onDisconnect(() => {
        watchRef.current = null
        setDevice(null)
        setStatus('idle')
      })
      const info = await watch.connect()
      watchRef.current = watch
      setDevice(info)
      setStatus('idle')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // User cancelling the picker is not really an error worth surfacing.
      if (/user cancelled|user canceled|no device selected/i.test(message)) {
        setStatus('idle')
        return
      }
      setError(message)
      setStatus('error')
    }
  }

  const handleDisconnect = async () => {
    await watchRef.current?.disconnect()
    watchRef.current = null
    setDevice(null)
    setStatus('idle')
    setProgress(null)
    setResult(null)
  }

  const handleUpload = async () => {
    const watch = watchRef.current
    if (!watch || !file) return
    if (classifyFaceSize(file.size) === 'danger') {
      const ok = window.confirm(
        `${faceSizeWarnSummary(file.size)}\n\nFlash anyway?`,
      )
      if (!ok) return
    }
    setError(null)
    setResult(null)
    setProgress(null)
    setStatus('uploading')
    try {
      const buffer = await file.arrayBuffer()
      const res = await watch.uploadWatchFace(buffer, setProgress)
      setResult(res)
      setStatus('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    setResult(null)
    setError(null)
    setParsedFile(null)
    setParseError(null)
    if (status === 'done' || status === 'error') setStatus('idle')
    if (!f) return

    try {
      const data = new Uint8Array(await f.arrayBuffer())
      const fmt = detectFormat(data)
      if (fmt === 'typeC') {
        const { header, blobs } = decodeFile(data)
        setParsedFile({ format: 'typeC', header, blobs })
      } else if (fmt === 'faceN') {
        const face = parseFaceN(data)
        setParsedFile({ format: 'faceN', face })
      } else {
        setParseError(
          `Unrecognized .bin format. First byte = 0x${data[0]?.toString(16).padStart(2, '0')}. Expected 0x81/0x04/0x84 (Type C) or a small u16 api_ver (FaceN).`,
        )
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err))
    }
  }

  const percent = progress
    ? Math.min(100, Math.round((progress.bytesSent / progress.totalBytes) * 100))
    : status === 'done'
      ? 100
      : 0

  const connected = device !== null
  const uploading = status === 'uploading'

  return (
    <section className="upload">
      <header className="faces-header">
        <h1>Upload watch face</h1>
        <p className="faces-endpoint">
          BLE upload over MOYOUNG-V2 protocol (slot 13 — Watch Gallery).
        </p>
      </header>

      {!supported && (
        <div className="banner banner-warn">
          <AlertTriangle size={18} aria-hidden />
          <div>
            <strong>Web Bluetooth is not available.</strong> Open this page in
            Chrome or Edge on desktop. Safari and Firefox do not support
            <code> navigator.bluetooth</code>. In a production Tauri build this
            page will use a native BLE plugin instead.
          </div>
        </div>
      )}

      <div className="upload-section">
        <h2>1. Connect to watch</h2>
        {!connected ? (
          <button
            type="button"
            className="counter"
            onClick={handleConnect}
            disabled={!supported || status === 'connecting'}
          >
            <Bluetooth size={16} aria-hidden />
            {status === 'connecting' ? 'Connecting…' : 'Pair watch'}
          </button>
        ) : (
          <div className="device-card">
            <div className="device-row">
              <Plug size={16} aria-hidden />
              <strong>{device.name}</strong>
              <span className="device-tag">{device.manufacturer}</span>
            </div>
            <dl className="device-details">
              <dt>Software</dt>
              <dd>{device.software || '—'}</dd>
              <dt>
                <Battery size={14} aria-hidden /> Battery
              </dt>
              <dd>{device.battery}%</dd>
            </dl>
            <button
              type="button"
              className="counter ghost"
              onClick={handleDisconnect}
              disabled={uploading}
            >
              <Unplug size={16} aria-hidden />
              Disconnect
            </button>
          </div>
        )}
      </div>

      <div className="upload-section">
        <h2>2. Choose .bin file</h2>
        <label className="file-picker">
          <input
            type="file"
            accept=".bin,application/octet-stream"
            onChange={onFile}
            disabled={uploading}
          />
          <span className="file-picker-button">
            <FileUp size={16} aria-hidden />
            {file ? 'Replace file' : 'Choose file'}
          </span>
          <span className="file-picker-name">
            {file ? (
              <>
                {file.name}{' '}
                <Tooltip content={faceSizeHint(file.size)}>
                  <span
                    className={`face-size-chip face-size-${classifyFaceSize(file.size)}`}
                  >
                    {formatFaceSize(file.size)}
                  </span>
                </Tooltip>
              </>
            ) : (
              'No file selected'
            )}
          </span>
        </label>
        <p className="hint">
          Already designing a face? You can flash it straight from the{' '}
          <strong>Editor</strong> — no need to download here first.
        </p>

        {parseError && (
          <div className="banner banner-error">
            <AlertTriangle size={18} aria-hidden />
            <div>
              <strong>Can't preview this file:</strong> {parseError}
              <br />
              Upload is disabled to avoid pushing an invalid file to the watch.
            </div>
          </div>
        )}

        {parsedFile && (
          <div className="upload-preview">
            <div className="upload-preview-info">
              <span className="format-badge">
                {parsedFile.format === 'typeC' ? 'Type C' : 'FaceN'}
              </span>
              {parsedFile.format === 'typeC' && (
                <dl className="device-details">
                  <dt>faceNumber</dt>
                  <dd>{parsedFile.header.faceNumber}</dd>
                  <dt>dataCount</dt>
                  <dd>{parsedFile.header.dataCount}</dd>
                  <dt>blobCount</dt>
                  <dd>{parsedFile.header.blobCount}</dd>
                </dl>
              )}
              {parsedFile.format === 'faceN' && (
                <dl className="device-details">
                  <dt>api_ver</dt>
                  <dd>{parsedFile.face.header.apiVer}</dd>
                  <dt>digit sets</dt>
                  <dd>{parsedFile.face.digitSets.length}</dd>
                  <dt>elements</dt>
                  <dd>{parsedFile.face.elements.length}</dd>
                </dl>
              )}
            </div>
            {parsedFile.format === 'typeC' ? (
              <FacePreview
                header={parsedFile.header}
                blobs={parsedFile.blobs}
                dummy={dummy}
                scale={1}
              />
            ) : (
              <FacePreviewN face={parsedFile.face} dummy={dummy} scale={1} />
            )}
          </div>
        )}
      </div>

      <div className="upload-section">
        <h2>3. Upload</h2>
        <button
          type="button"
          className="counter"
          onClick={handleUpload}
          disabled={!connected || !parsedFile || uploading}
        >
          <Upload size={16} aria-hidden />
          {uploading ? 'Uploading…' : 'Send to watch'}
        </button>

        {(progress || status === 'done') && (
          <div className="upload-progress-watch" aria-live="polite">
            <Loader
              size={140}
              progress={percent}
              done={status === 'done'}
              label={
                progress
                  ? `chunk ${progress.chunkIndex} / ${progress.totalChunks} · ${formatBytes(progress.bytesSent)} of ${formatBytes(progress.totalBytes)}`
                  : 'finalizing…'
              }
            />
          </div>
        )}

        {status === 'done' && result && (
          <div className="banner banner-ok">
            <CheckCircle2 size={18} aria-hidden />
            <div>
              <strong>Upload complete.</strong> {formatBytes(result.totalBytes)}{' '}
              sent. Watch checksum:{' '}
              <code>0x{result.checksum.toString(16).padStart(8, '0')}</code>.
              Switched watch to gallery face (slot 13).
            </div>
          </div>
        )}

        {error && (
          <div className="banner banner-error">
            <BluetoothOff size={18} aria-hidden />
            <div>
              <strong>Error:</strong> {error}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

export default UploadWatchFace
