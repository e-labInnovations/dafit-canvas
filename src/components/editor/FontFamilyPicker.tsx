import { useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { COMMON_SYSTEM_FONTS, fontIsAvailable } from '../../lib/fontLoader'
import Popover from '../Popover'
import Tooltip from '../Tooltip'

type Props = {
  value: string
  onChange: (family: string) => void
  /** Weight used by the live preview swatch — keeps the menu's previews
   *  consistent with whatever weight the user picked in the parent. */
  previewWeight?: number
}

/** Pick a system font with each name rendered in its own family. Replaces
 *  the bare `<datalist>` so users can actually *see* what they're choosing
 *  before committing. Uses the shared `Popover` so click-outside / Esc /
 *  focus return / portal escape behave consistently with other menus. */
function FontFamilyPicker({ value, onChange, previewWeight = 500 }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Pre-compute installed-vs-fallback once per render — cheap (≤30 fonts).
  const availability = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const f of COMMON_SYSTEM_FONTS)
      map.set(f, fontIsAvailable(f, previewWeight))
    return map
  }, [previewWeight])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return COMMON_SYSTEM_FONTS
    return COMMON_SYSTEM_FONTS.filter((f) => f.toLowerCase().includes(q))
  }, [query])

  const closeMenu = () => {
    setOpen(false)
    setQuery('')
  }

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

      {open && (
        <Popover
          anchorRef={triggerRef}
          onClose={closeMenu}
          placement="bottom-start"
          role="listbox"
          ariaLabel="Choose a font family"
          matchAnchorWidth
          className="font-picker-menu"
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
                  closeMenu()
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
                      closeMenu()
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
                      <Tooltip content="Installed on this system">
                        <span className="font-picker-item-tag">✓</span>
                      </Tooltip>
                    ) : (
                      <Tooltip content="Not detected — will fall back to default">
                        <span className="font-picker-item-tag font-picker-item-fallback">
                          fallback
                        </span>
                      </Tooltip>
                    )}
                    {selected && <Check size={12} aria-hidden />}
                  </button>
                </li>
              )
            })}
          </ul>
        </Popover>
      )}
    </>
  )
}

export default FontFamilyPicker
