import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  Battery,
  Bluetooth,
  BluetoothOff,
  CheckCircle2,
  Plug,
  Unplug,
  Upload,
  X,
} from 'lucide-react'
import Loader from '../Loader'
import {
  MoyoungWatch,
  isWebBluetoothSupported,
  type DeviceInfo,
  type UploadProgress,
  type UploadResult,
} from '../../lib/moyoungBle'
import {
  classifyFaceSize,
  faceSizeHint,
  faceSizeWarnSummary,
  formatFaceSize,
} from '../../lib/faceSize'

type Props = {
  onClose: () => void
  /** Built .bin bytes to flash. */
  bytes: Uint8Array
  /** Display-only filename rendered next to the size chip. */
  filename: string
}

type Status = 'idle' | 'connecting' | 'uploading' | 'done' | 'error'

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function UploadDialog({ onClose, bytes, filename }: Props) {
  const supported = isWebBluetoothSupported()
  const watchRef = useRef<MoyoungWatch | null>(null)
  const [device, setDevice] = useState<DeviceInfo | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The parent only mounts this component when there's a face to flash, so
  // open/close lifecycle === mount/unmount. Disconnect runs in the cleanup;
  // local state resets implicitly on each remount.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      const watch = watchRef.current
      if (watch) {
        watch.disconnect().catch(() => {
          /* best effort */
        })
        watchRef.current = null
      }
    }
  }, [onClose])

  const onPair = async () => {
    setError(null)
    setStatus('connecting')
    try {
      const watch = new MoyoungWatch()
      const info = await watch.connect()
      watch.onDisconnect(() => {
        watchRef.current = null
        setDevice(null)
      })
      watchRef.current = watch
      setDevice(info)
      setStatus('idle')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const onDisconnect = async () => {
    await watchRef.current?.disconnect()
    watchRef.current = null
    setDevice(null)
    setStatus('idle')
  }

  const onFlash = async () => {
    const watch = watchRef.current
    if (!watch || !bytes) return
    if (classifyFaceSize(bytes.byteLength) === 'danger') {
      const ok = window.confirm(
        `${faceSizeWarnSummary(bytes.byteLength)}\n\nFlash anyway?`,
      )
      if (!ok) return
    }
    setError(null)
    setResult(null)
    setProgress(null)
    setStatus('uploading')
    try {
      // Copy into a fresh ArrayBuffer — `bytes.buffer` is typed as
      // ArrayBuffer | SharedArrayBuffer; the BLE writer wants ArrayBuffer.
      const buf = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(buf).set(bytes)
      const res = await watch.uploadWatchFace(buf, setProgress)
      setResult(res)
      setStatus('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const connected = device !== null
  const uploading = status === 'uploading'
  const percent = progress
    ? Math.min(100, Math.round((progress.bytesSent / progress.totalBytes) * 100))
    : status === 'done'
      ? 100
      : 0
  const size = bytes.byteLength

  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal upload-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Close"
          disabled={uploading}
        >
          <X size={20} />
        </button>

        <div className="upload-modal-body">
          <header className="upload-modal-head">
            <h2 id="upload-modal-title">Send to watch</h2>
            <p className="upload-modal-file">
              <code>{filename}</code>
              <span
                className={`face-size-chip face-size-${classifyFaceSize(size)}`}
                title={faceSizeHint(size)}
              >
                {formatFaceSize(size)}
              </span>
            </p>
          </header>

          {!supported && (
            <div className="banner banner-warn">
              <AlertTriangle size={16} aria-hidden />
              <div>
                <strong>Web Bluetooth not available.</strong> Open this app
                in Chrome or Edge on desktop. Safari and Firefox can't pair.
              </div>
            </div>
          )}

          <div className="upload-modal-step">
            <h3>1. Pair watch</h3>
            {!connected ? (
              <button
                type="button"
                className="counter"
                onClick={onPair}
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
                  onClick={onDisconnect}
                  disabled={uploading}
                >
                  <Unplug size={16} aria-hidden />
                  Disconnect
                </button>
              </div>
            )}
          </div>

          <div className="upload-modal-step">
            <h3>2. Flash</h3>
            <button
              type="button"
              className="counter"
              onClick={onFlash}
              disabled={!connected || uploading || status === 'done'}
            >
              <Upload size={16} aria-hidden />
              {uploading ? 'Uploading…' : 'Send to watch'}
            </button>

            {(progress || status === 'done') && (
              <div className="upload-progress-watch" aria-live="polite">
                <Loader
                  size={120}
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
                <CheckCircle2 size={16} aria-hidden />
                <div>
                  <strong>Upload complete.</strong>{' '}
                  {formatBytes(result.totalBytes)} sent · checksum{' '}
                  <code>
                    0x{result.checksum.toString(16).padStart(8, '0')}
                  </code>
                  . Watch switched to gallery face.
                </div>
              </div>
            )}

            {error && (
              <div className="banner banner-error">
                <BluetoothOff size={16} aria-hidden />
                <div>
                  <strong>Error:</strong> {error}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default UploadDialog
