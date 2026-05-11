import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { Download, ExternalLink, Tag, User, X } from 'lucide-react'
import Loader from './Loader'
import {
  errorMessage,
  fetchV3FaceDetail,
  pingV3Download,
} from '../lib/moyoung'
import type { V3FaceDetail } from '../types/moyoung'

type Props = {
  faceId: number | null
  fv: string
  lang: string
  onClose: () => void
  onPickRelated?: (id: number) => void
}

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

const formatCount = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function FacePreviewModal({ faceId, fv, lang, onClose, onPickRelated }: Props) {
  // detail/error are only written inside async callbacks (.then/.catch), so
  // we don't trip `react-hooks/set-state-in-effect`. `loading` is derived: if
  // the open faceId differs from the loaded detail's id (and we have no error
  // for it), we're mid-fetch.
  const [detail, setDetail] = useState<V3FaceDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (faceId === null) return
    const controller = new AbortController()
    fetchV3FaceDetail(faceId, { fv, lang }, controller.signal)
      .then((data) => {
        setDetail(data)
        setError(null)
      })
      .catch((err: unknown) => {
        if (axios.isCancel(err)) return
        setDetail(null)
        setError(errorMessage(err))
      })
    return () => controller.abort()
  }, [faceId, fv, lang])

  // Derived: we're loading whenever the modal is open but the loaded detail
  // (or error) doesn't yet correspond to the open faceId.
  const loading =
    faceId !== null && detail?.id !== faceId && error === null

  // Lock body scroll + handle Esc.
  useEffect(() => {
    if (faceId === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [faceId, onClose])

  if (faceId === null) return null

  const onDownload = () => {
    if (!detail) return
    // Fire-and-forget bookkeeping; don't block the actual download.
    pingV3Download(detail.id, fv)
  }

  const remark = detail?.remark_en?.trim() || detail?.remark_cn?.trim() || null
  const tagEntries = detail ? Object.entries(detail.tags) : []
  const related = detail?.face_list ?? []

  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="face-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Close preview"
        >
          <X size={20} />
        </button>

        <div className="modal-preview">
          {detail && detail.id === faceId ? (
            <img src={detail.preview} alt={detail.name ?? `Face ${detail.id}`} />
          ) : (
            <div className="modal-preview-placeholder" />
          )}
        </div>

        <div className="modal-meta">
          {loading && <Loader label="Loading details…" />}
          {error && <p className="faces-error">Error: {error}</p>}

          {detail && detail.id === faceId && (
            <>
              <h2 id="face-modal-title">{detail.name || `#${detail.id}`}</h2>
              <p className="modal-subid">id #{detail.id}</p>

              <dl className="modal-stats">
                <dt>size</dt>
                <dd>{formatBytes(detail.size)}</dd>
                <dt>downloads</dt>
                <dd>{formatCount(detail.download)}</dd>
                {detail.uploader && (
                  <>
                    <dt>uploader</dt>
                    <dd>
                      <User size={12} aria-hidden /> {detail.uploader}
                    </dd>
                  </>
                )}
              </dl>

              {tagEntries.length > 0 && (
                <div className="modal-tags">
                  {tagEntries.map(([id, name]) => (
                    <span key={id} className="modal-tag">
                      <Tag size={11} aria-hidden /> {name}
                    </span>
                  ))}
                </div>
              )}

              {remark && <p className="modal-remark">{remark}</p>}

              <div className="modal-actions">
                <a
                  href={detail.file}
                  target="_blank"
                  rel="noreferrer"
                  className="counter modal-download"
                  onClick={onDownload}
                >
                  <Download size={16} aria-hidden />
                  Download .bin
                </a>
                <a
                  href={detail.file}
                  target="_blank"
                  rel="noreferrer"
                  className="counter ghost"
                  aria-label="Open file URL in a new tab"
                  onClick={onDownload}
                >
                  <ExternalLink size={14} aria-hidden />
                  Raw URL
                </a>
              </div>

              {related.length > 0 && onPickRelated && (
                <>
                  <h3 className="modal-section-title">Related faces</h3>
                  <ul className="modal-related">
                    {related.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          className="modal-related-card"
                          onClick={() => onPickRelated(r.id)}
                          aria-label={`Open related face ${r.name || r.id}`}
                        >
                          <img
                            src={r.preview}
                            alt={r.name ?? `Face ${r.id}`}
                            loading="lazy"
                          />
                          <span className="modal-related-name">
                            {r.name ?? `#${r.id}`}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default FacePreviewModal
