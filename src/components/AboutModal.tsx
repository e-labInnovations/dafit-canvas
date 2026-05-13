import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  ExternalLink,
  User,
  Watch,
  X,
} from 'lucide-react'

type Props = {
  open: boolean
  onClose: () => void
}

const CREDITS: { name: string; url: string }[] = [
  { name: 'dawft', url: 'https://github.com/david47k/dawft' },
  { name: 'extrathundertool', url: 'https://github.com/david47k/extrathundertool' },
  { name: 'dawfu', url: 'https://github.com/david47k/dawfu' },
]

function AboutModal({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return
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
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal about-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={20} />
        </button>

        <div className="about-body">
          <header className="about-header">
            <img
              src="/logo.svg"
              alt=""
              className="about-logo-img"
              width={56}
              height={56}
              aria-hidden
            />
            <div>
              <h2 id="about-title">DaFit Canvas</h2>
              <p className="about-tagline">
                Visual editor for Da Fit / MoYoung smartwatch faces.
              </p>
            </div>
          </header>

          <dl className="about-stats">
            <dt>Target</dt>
            <dd>240×240 · RGB565 · Type C (0x81)</dd>
            <dt>Stack</dt>
            <dd>React · TypeScript · Vite · Zustand</dd>
            <dt>Mode</dt>
            <dd>Offline · browser-only · no telemetry</dd>
          </dl>

          <div className="about-section">
            <h3 className="about-section-title">Author</h3>
            <a
              href="https://github.com/e-labInnovations"
              target="_blank"
              rel="noreferrer"
              className="about-author"
            >
              <span className="about-author-icon" aria-hidden>
                <User size={16} />
              </span>
              <span className="about-author-text">
                <strong>Mohammed Ashad</strong>
                <span>@e-labInnovations</span>
              </span>
              <ExternalLink size={12} aria-hidden />
            </a>
          </div>

          <div className="about-section">
            <h3 className="about-section-title">Credits</h3>
            <p className="about-credit-intro">
              Built on the reverse-engineering work of{' '}
              <strong>David Atkinson</strong>:
            </p>
            <ul className="about-credits">
              {CREDITS.map((c) => (
                <li key={c.name}>
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    className="about-credit-chip"
                  >
                    {c.name}
                    <ExternalLink size={11} aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="about-section about-disclaimer">
            <AlertTriangle size={16} aria-hidden />
            <div>
              <strong>Use at your own risk.</strong> Hobby software, no
              warranty. Try it on a watch you can afford to lose data on.
            </div>
          </div>

          <div className="about-section about-tested">
            <Watch size={16} aria-hidden />
            <div>
              <strong>Tested on:</strong> Porodo <em>Vortex</em> (round) ·
              firmware <code>MOY-GKE5-2.2.7</code>.
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default AboutModal
