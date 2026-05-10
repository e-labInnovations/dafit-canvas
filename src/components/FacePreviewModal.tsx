import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, X } from 'lucide-react'
import type { MoyoungFace } from '../types/moyoung'

type Props = {
  face: MoyoungFace | null
  onClose: () => void
}

function FacePreviewModal({ face, onClose }: Props) {
  useEffect(() => {
    if (!face) return

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
  }, [face, onClose])

  if (!face) return null

  return createPortal(
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="presentation"
    >
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
          <img src={face.preview} alt={`Watch face ${face.id}`} />
        </div>

        <div className="modal-meta">
          <h2 id="face-modal-title">#{face.id}</h2>
          <dl>
            <dt>tpl</dt>
            <dd>{face.tpl}</dd>
            <dt>tpls</dt>
            <dd>{face.tpls.join(', ') || '—'}</dd>
            <dt>firmware</dt>
            <dd>{face.firmware.length ? face.firmware.join(', ') : '—'}</dd>
          </dl>
          <a
            href={face.file}
            target="_blank"
            rel="noreferrer"
            className="counter modal-download"
          >
            <ExternalLink size={16} aria-hidden />
            Download .bin
          </a>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default FacePreviewModal
