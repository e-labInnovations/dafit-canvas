import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'
import { COMMON_SYSTEM_FONTS, fontIsAvailable } from '../../lib/fontLoader'

type Props = {
  value: string
  onChange: (family: string) => void
  /** Weight used by the live preview swatch — keeps the menu's previews
   *  consistent with whatever weight the user picked in the parent. */
  previewWeight?: number
}

/** Pick a system font with each name rendered in its own family. Replaces
 *  the bare `<datalist>` so users can actually *see* what they're choosing
 *  before committing. Renders the menu through a portal so it escapes the
 *  modal's scrolling container. */
function FontFamilyPicker({ value, onChange, previewWeight = 500 }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(
    null,
  )
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Position the popover under the trigger via fixed coords. Updates on
  // resize / scroll so the menu tracks if the modal layout shifts.
  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const t = triggerRef.current
      if (!t) return
      const r = t.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  // Close on outside click + Esc.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = triggerRef.current
      const m = menuRef.current
      if (t && t.contains(e.target as Node)) return
      if (m && m.contains(e.target as Node)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Pre-compute installed-vs-fallback once per render — cheap (≤30 fonts).
  // `value` is intentionally not in deps; this is purely advisory UI.
  const availability = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const f of COMMON_SYSTEM_FONTS) map.set(f, fontIsAvailable(f, previewWeight))
    return map
  }, [previewWeight])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return COMMON_SYSTEM_FONTS
    return COMMON_SYSTEM_FONTS.filter((f) => f.toLowerCase().includes(q))
  }, [query])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="font-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className="font-picker-trigger-label"
          style={{ fontFamily: `"${value}", sans-serif` }}
        >
          {value || 'Pick a font…'}
        </span>
        <ChevronDown size={14} aria-hidden />
      </button>

      {open && pos &&
        createPortal(
          <div
            ref={menuRef}
            className="font-picker-menu"
            role="listbox"
            style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
          >
            <div className="font-picker-search">
              <Search size={14} aria-hidden />
              <input
                type="text"
                placeholder="Filter or type a custom family…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && query.trim()) {
                    // Commit whatever the user typed even if it isn't in
                    // the curated list — fonts not in our seed might
                    // still be installed.
                    onChange(query.trim())
                    setOpen(false)
                    setQuery('')
                  }
                }}
                autoFocus
              />
            </div>
            <ul className="font-picker-list">
              {filtered.length === 0 && (
                <li className="font-picker-empty">
                  No matches. Press <kbd>Enter</kbd> to use{' '}
                  <code>{query}</code> anyway.
                </li>
              )}
              {filtered.map((f) => {
                const installed = availability.get(f) ?? false
                const selected = f === value
                return (
                  <li key={f}>
                    <button
                      type="button"
                      className={`font-picker-item${selected ? ' selected' : ''}`}
                      onClick={() => {
                        onChange(f)
                        setOpen(false)
                        setQuery('')
                      }}
                      role="option"
                      aria-selected={selected}
                    >
                      <span
                        className="font-picker-item-name"
                        style={{ fontFamily: `"${f}", sans-serif` }}
                      >
                        {f}
                      </span>
                      {installed ? (
                        <span
                          className="font-picker-item-tag"
                          title="Installed on this system"
                        >
                          ✓
                        </span>
                      ) : (
                        <span
                          className="font-picker-item-tag font-picker-item-fallback"
                          title="Not detected — will fall back to default"
                        >
                          fallback
                        </span>
                      )}
                      {selected && <Check size={12} aria-hidden />}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>,
          document.body,
        )}
    </>
  )
}

export default FontFamilyPicker
