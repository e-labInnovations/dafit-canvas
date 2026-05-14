import { useEffect, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  RotateCcw,
  Search,
  Tag as TagIcon,
  User,
  ZoomIn,
} from 'lucide-react'
import axios from 'axios'
import FacePreviewModal from '../components/FacePreviewModal'
import Loader from '../components/Loader'
import Tooltip from '../components/Tooltip'
import {
  errorMessage,
  fetchLegacyFaces,
  fetchV3List,
  fetchV3Tags,
} from '../lib/moyoung'
import {
  DEFAULT_V3_QUERY,
  type V3ListFace,
  type V3Query,
  type V3Tag,
} from '../types/moyoung'

const MAX_PER_PAGE = 100

/** Unified face row rendered by the grid. `file` may be empty (v3 list does
 *  not return a file URL — the modal hits /v3/face-detail to resolve it). */
type UnifiedFace = {
  id: number
  name: string | null
  preview: string
  file: string | null
  uploader: string | null
  download: number | null
}

type ListState = {
  faces: UnifiedFace[]
  total: number
  /** Source surface — for the small badge above the grid. */
  source: 'v2' | 'v3'
}

type FieldConfig = {
  key: keyof Pick<V3Query, 'tpls' | 'fv' | 'per_page' | 'p'>
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

const toPositiveInt = (s: string, fallback: number): number => {
  const n = parseInt(s, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const clampPerPage = (s: string): string => {
  const n = toPositiveInt(s, 1)
  return String(Math.min(MAX_PER_PAGE, n))
}

const fromV3 = (f: V3ListFace): UnifiedFace => ({
  id: f.id,
  name: f.name ?? null,
  preview: f.preview,
  // v3 list returns "https://qn-hscdn2.moyoung.com/" with no path — treat as missing.
  file: f.file && /\.bin($|\?)/i.test(f.file) ? f.file : null,
  uploader: f.uploader ?? null,
  download: typeof f.download === 'number' ? f.download : null,
})

const fromV2 = (f: { id: number; preview: string; file: string }): UnifiedFace => ({
  id: f.id,
  name: null,
  preview: f.preview,
  file: f.file,
  uploader: null,
  download: null,
})

const formatCount = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

// All-tag sentinel — when selected we fall back to /v2/faces since
// /v3/list refuses tag_id=0 ("Tag is required").
const ALL_TAG_ID = 0

function WatchFaces() {
  const [draft, setDraft] = useState<V3Query>(DEFAULT_V3_QUERY)
  const [applied, setApplied] = useState<V3Query>(DEFAULT_V3_QUERY)
  const [tagId, setTagId] = useState<number>(ALL_TAG_ID)
  const [tags, setTags] = useState<V3Tag[]>([])
  const [tagsError, setTagsError] = useState<string | null>(null)
  const [list, setList] = useState<ListState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  // Fetch tag list once on mount (and on tpls/fv changes — different watches
  // expose different tag sets).
  useEffect(() => {
    const controller = new AbortController()
    fetchV3Tags(
      {
        tpls: applied.tpls,
        fv: applied.fv,
        lang: applied.lang,
        tested: applied.tested,
      },
      controller.signal,
    )
      .then((next) => {
        setTags(next)
        setTagsError(null)
      })
      .catch((err: unknown) => {
        if (axios.isCancel(err)) return
        setTagsError(errorMessage(err))
      })
    return () => controller.abort()
  }, [applied.tpls, applied.fv, applied.lang, applied.tested])

  // Fetch the active face list whenever the applied query or selected tag
  // changes. tag=0 → v2 catalog ("All"); any other tag → v3/list. We don't
  // call setLoading/setError synchronously here — the caller (`requestFetch`)
  // already flips loading=true before changing `applied`, and initial mount
  // uses the useState default of `true`.
  useEffect(() => {
    const controller = new AbortController()

    const run = async () => {
      if (tagId === ALL_TAG_ID) {
        const data = await fetchLegacyFaces(
          {
            tpls: applied.tpls,
            fv: applied.fv,
            per_page: applied.per_page,
            p: applied.p,
          },
          controller.signal,
        )
        return {
          faces: data.faces.map(fromV2),
          total: data.total,
          source: 'v2' as const,
        }
      }
      const data = await fetchV3List(
        { ...applied, tag_id: String(tagId) },
        controller.signal,
      )
      return {
        faces: data.data.faces.map(fromV3),
        total: data.total,
        source: 'v3' as const,
      }
    }

    run()
      .then((next) => {
        setList(next)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (axios.isCancel(err)) return
        setError(errorMessage(err))
        setList(null)
        setLoading(false)
      })

    return () => controller.abort()
  }, [applied, tagId])

  const requestFetch = (next: V3Query) => {
    setLoading(true)
    setError(null)
    setApplied(next)
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const cleaned: V3Query = {
      ...draft,
      per_page: clampPerPage(draft.per_page),
      p: String(toPositiveInt(draft.p, 1)),
    }
    setDraft(cleaned)
    requestFetch(cleaned)
  }

  const onReset = () => {
    setDraft(DEFAULT_V3_QUERY)
    setTagId(ALL_TAG_ID)
    requestFetch(DEFAULT_V3_QUERY)
  }

  const onPickTag = (id: number) => {
    // Reset to page 1 when switching tags.
    setTagId(id)
    const next: V3Query = { ...applied, p: '1' }
    setDraft({ ...draft, p: '1' })
    requestFetch(next)
  }

  const perPage = toPositiveInt(applied.per_page, 1)
  const currentPage = toPositiveInt(applied.p, 1)
  const total = list?.total ?? 0
  const totalPages = total > 0 ? Math.max(1, Math.ceil(total / perPage)) : 1

  const goToPage = (page: number) => {
    const bounded = Math.max(1, Math.min(totalPages, page))
    if (bounded === currentPage) return
    const next: V3Query = { ...applied, p: String(bounded) }
    setDraft(next)
    requestFetch(next)
  }

  const canPrev = currentPage > 1
  const canNext = currentPage < totalPages

  return (
    <section className="faces">
      <header className="faces-header">
        <h1>Watch faces</h1>
      </header>

      <div className="faces-tags" role="tablist" aria-label="Face categories">
        <button
          type="button"
          role="tab"
          aria-selected={tagId === ALL_TAG_ID}
          className={`faces-tag ${tagId === ALL_TAG_ID ? 'active' : ''}`}
          onClick={() => onPickTag(ALL_TAG_ID)}
        >
          <TagIcon size={12} aria-hidden />
          All
        </button>
        {tags.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tagId === t.id}
            className={`faces-tag ${tagId === t.id ? 'active' : ''}`}
            onClick={() => onPickTag(t.id)}
          >
            {t.tag_name}
          </button>
        ))}
        {tagsError && (
          <span className="faces-tags-error">
            tag-list failed: {tagsError}
          </span>
        )}
      </div>

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

      {list && !loading && (
        <>
          <p className="faces-meta">
            Page {currentPage} of {totalPages} · showing {list.faces.length} of{' '}
            {list.total}
          </p>
          <ul className="faces-grid">
            {list.faces.map((face) => (
              <li key={face.id} className="face-card">
                <button
                  type="button"
                  className="face-thumb"
                  onClick={() => setSelectedId(face.id)}
                  aria-label={`Open preview for ${face.name ?? `face ${face.id}`}`}
                >
                  <img
                    src={face.preview}
                    alt={face.name ?? `Face ${face.id}`}
                    width={120}
                    height={120}
                    loading="lazy"
                  />
                  <span className="face-thumb-overlay" aria-hidden>
                    <ZoomIn size={20} />
                  </span>
                </button>
                <div className="face-meta">
                  <Tooltip content={`id ${face.id}`}>
                    <span className="face-id">
                      {face.name ?? `#${face.id}`}
                    </span>
                  </Tooltip>
                  <div className="face-meta-row">
                    {face.uploader && (
                      <Tooltip content={`Uploader: ${face.uploader}`}>
                        <span className="face-uploader">
                          <User size={12} aria-hidden />
                          {face.uploader}
                        </span>
                      </Tooltip>
                    )}
                    {face.download !== null && (
                      <Tooltip content={`${face.download} downloads`}>
                        <span className="face-downloads">
                          <Download size={12} aria-hidden />
                          {formatCount(face.download)}
                        </span>
                      </Tooltip>
                    )}
                  </div>
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

      <FacePreviewModal
        faceId={selectedId}
        fv={applied.fv}
        lang={applied.lang}
        onClose={() => setSelectedId(null)}
        onPickRelated={(id) => setSelectedId(id)}
      />
    </section>
  )
}

export default WatchFaces
