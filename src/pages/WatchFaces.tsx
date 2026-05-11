import { useEffect, useState } from 'react'
import axios from 'axios'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ExternalLink,
  RotateCcw,
  Search,
  ZoomIn,
} from 'lucide-react'
import FacePreviewModal from '../components/FacePreviewModal'
import Loader from '../components/Loader'
import {
  DEFAULT_FACES_QUERY,
  type FacesQuery,
  type MoyoungFace,
  type MoyoungFacesResponse,
} from '../types/moyoung'

const MAX_PER_PAGE = 100

type FieldConfig = {
  key: keyof FacesQuery
  label: string
  type?: 'text' | 'number'
  min?: number
  max?: number
}

const FIELDS: FieldConfig[] = [
  { key: 'tpls', label: 'tpls' },
  { key: 'fv', label: 'fv' },
  {
    key: 'per_page',
    label: `per_page (max ${MAX_PER_PAGE})`,
    type: 'number',
    min: 1,
    max: MAX_PER_PAGE,
  },
  { key: 'p', label: 'p', type: 'number', min: 1 },
]

const moyoung = axios.create({
  baseURL: '/api/moyoung',
})

const toPositiveInt = (s: string, fallback: number): number => {
  const n = parseInt(s, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const clampPerPage = (s: string): string => {
  const n = toPositiveInt(s, 1)
  return String(Math.min(MAX_PER_PAGE, n))
}

function WatchFaces() {
  const [draft, setDraft] = useState<FacesQuery>(DEFAULT_FACES_QUERY)
  const [applied, setApplied] = useState<FacesQuery>(DEFAULT_FACES_QUERY)
  const [data, setData] = useState<MoyoungFacesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<MoyoungFace | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    moyoung
      .get<MoyoungFacesResponse>('/v2/faces', {
        params: applied,
        signal: controller.signal,
      })
      .then((res) => {
        setData(res.data)
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (axios.isCancel(err)) return
        const message = axios.isAxiosError(err)
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err)
        setError(message)
        setLoading(false)
      })

    return () => controller.abort()
  }, [applied])

  const requestFetch = (next: FacesQuery) => {
    setLoading(true)
    setError(null)
    setApplied(next)
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const cleaned: FacesQuery = {
      ...draft,
      per_page: clampPerPage(draft.per_page),
      p: String(toPositiveInt(draft.p, 1)),
    }
    setDraft(cleaned)
    requestFetch(cleaned)
  }

  const onReset = () => {
    setDraft(DEFAULT_FACES_QUERY)
    requestFetch(DEFAULT_FACES_QUERY)
  }

  const perPage = toPositiveInt(applied.per_page, 1)
  const currentPage = toPositiveInt(applied.p, 1)
  const total = data?.total ?? 0
  const totalPages = total > 0 ? Math.max(1, Math.ceil(total / perPage)) : 1

  const goToPage = (page: number) => {
    const bounded = Math.max(1, Math.min(totalPages, page))
    if (bounded === currentPage) return
    const next: FacesQuery = { ...applied, p: String(bounded) }
    setDraft(next)
    requestFetch(next)
  }

  const canPrev = currentPage > 1
  const canNext = currentPage < totalPages

  return (
    <section className="faces">
      <header className="faces-header">
        <h1>Watch faces</h1>
        <p className="faces-endpoint">
          GET <code>https://api.moyoung.com/v2/faces</code>
        </p>
      </header>

      <form className="faces-form" onSubmit={onSubmit}>
        {FIELDS.map((field) => (
          <label key={field.key} className="faces-field">
            <span>{field.label}</span>
            <input
              type={field.type ?? 'text'}
              min={field.min}
              max={field.max}
              value={draft[field.key]}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))
              }
            />
          </label>
        ))}
        <div className="faces-actions">
          <button type="submit" className="counter">
            <Search size={16} aria-hidden />
            Fetch
          </button>
          <button type="button" className="counter ghost" onClick={onReset}>
            <RotateCcw size={16} aria-hidden />
            Reset
          </button>
        </div>
      </form>

      {loading && (
        <div className="faces-loading">
          <Loader label="Loading faces…" />
        </div>
      )}
      {error && <p className="faces-error">Error: {error}</p>}

      {data && !loading && (
        <>
          <p className="faces-meta">
            Page {currentPage} of {totalPages} · showing {data.count} of{' '}
            {data.total}
          </p>
          <ul className="faces-grid">
            {data.faces.map((face) => (
              <li key={face.id} className="face-card">
                <button
                  type="button"
                  className="face-thumb"
                  onClick={() => setSelected(face)}
                  aria-label={`Open preview for face ${face.id}`}
                >
                  <img
                    src={face.preview}
                    alt={`Face ${face.id}`}
                    width={120}
                    height={120}
                    loading="lazy"
                  />
                  <span className="face-thumb-overlay" aria-hidden>
                    <ZoomIn size={20} />
                  </span>
                </button>
                <div className="face-meta">
                  <span className="face-id">#{face.id}</span>
                  <a
                    href={face.file}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Download .bin for face ${face.id}`}
                  >
                    <ExternalLink size={14} aria-hidden />
                    .bin
                  </a>
                </div>
              </li>
            ))}
          </ul>
          {totalPages > 1 && (
            <nav className="faces-pagination" aria-label="Pagination">
              <button
                type="button"
                className="counter ghost"
                disabled={!canPrev}
                onClick={() => goToPage(1)}
                aria-label="First page"
              >
                <ChevronsLeft size={16} aria-hidden />
              </button>
              <button
                type="button"
                className="counter ghost"
                disabled={!canPrev}
                onClick={() => goToPage(currentPage - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft size={16} aria-hidden />
                Prev
              </button>
              <span className="faces-pagination-status">
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                className="counter ghost"
                disabled={!canNext}
                onClick={() => goToPage(currentPage + 1)}
                aria-label="Next page"
              >
                Next
                <ChevronRight size={16} aria-hidden />
              </button>
              <button
                type="button"
                className="counter ghost"
                disabled={!canNext}
                onClick={() => goToPage(totalPages)}
                aria-label="Last page"
              >
                <ChevronsRight size={16} aria-hidden />
              </button>
            </nav>
          )}
        </>
      )}

      <FacePreviewModal face={selected} onClose={() => setSelected(null)} />
    </section>
  )
}

export default WatchFaces
