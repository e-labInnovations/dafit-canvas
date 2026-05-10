import { useEffect, useRef, useState } from 'react'
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
import {
  MoyoungWatch,
  isWebBluetoothSupported,
  type DeviceInfo,
  type UploadProgress,
  type UploadResult,
} from '../lib/moyoungBle'

type Status = 'idle' | 'connecting' | 'uploading' | 'done' | 'error'

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

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    setResult(null)
    setError(null)
    if (status === 'done' || status === 'error') setStatus('idle')
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
            {file ? `${file.name} (${formatBytes(file.size)})` : 'No file selected'}
          </span>
        </label>
        <p className="hint">
          Build the <code>.bin</code> with{' '}
          <code>dawft create folder=&lt;extracted&gt; output.bin</code>.
        </p>
      </div>

      <div className="upload-section">
        <h2>3. Upload</h2>
        <button
          type="button"
          className="counter"
          onClick={handleUpload}
          disabled={!connected || !file || uploading}
        >
          <Upload size={16} aria-hidden />
          {uploading ? 'Uploading…' : 'Send to watch'}
        </button>

        {(progress || status === 'done') && (
          <div className="progress-wrap" aria-live="polite">
            <div
              className="progress-bar"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={`progress-fill ${status === 'done' ? 'done' : ''}`}
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="progress-meta">
              {progress
                ? `${percent}% · chunk ${progress.chunkIndex} / ${progress.totalChunks} · ${formatBytes(progress.bytesSent)} of ${formatBytes(progress.totalBytes)}`
                : '100% · finalizing'}
            </p>
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
