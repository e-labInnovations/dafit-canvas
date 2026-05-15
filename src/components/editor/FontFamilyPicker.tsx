import { useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import {
  COMMON_GOOGLE_FONTS,
  COMMON_SYSTEM_FONTS,
  fontIsAvailable,
} from '../../lib/fontLoader'
import Popover from '../Popover'
import Tooltip from '../Tooltip'

type Props = {
  value: string
  onChange: (family: string) => void
  /** Weight used by the live preview swatch — keeps the menu's previews
   *  consistent with whatever weight the user picked in the parent. */
  previewWeight?: number
  /** Which curated list to surface. `system` keeps the original behaviour;
   *  `google` swaps the list to popular Google Fonts. The picker doesn't
   *  load fonts itself — the parent calls `loadFont` separately when the
   *  selection changes. */
  source?: 'system' | 'google'
  /** Optional explicit list of families to show instead of the curated
   *  defaults. Used by the Google-Fonts paste flow to surface families
   *  the user has actually parsed from embed URLs — bypasses the built-in
   *  popular list when the user wants something more specific. */
  families?: readonly string[]
}

/** Pick a system font with each name rendered in its own family. Replaces
 *  the bare `<datalist>` so users can actually *see* what they're choosing
 *  before committing. Uses the shared `Popover` so click-outside / Esc /
 *  focus return / portal escape behave consistently with other menus. */
function FontFamilyPicker({
  value,
  onChange,
  previewWeight = 500,
  source = 'system',
  families,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Explicit list wins; otherwise fall back to the curated dropdown for
  // the chosen source.
  const allFonts: readonly string[] = families
    ? families
    : source === 'google'
      ? COMMON_GOOGLE_FONTS
      : COMMON_SYSTEM_FONTS
  const isSystem = source === 'system'

  // Pre-compute installed-vs-fallback for system fonts — Google fonts
  // are always "available" because the loader injects the stylesheet on
  // demand, so the indicator only fires for the system source.
  const availability = useMemo(() => {
    if (!isSystem) return new Map<string, boolean>()
    const map = new Map<string, boolean>()
    for (const f of allFonts) map.set(f, fontIsAvailable(f, previewWeight))
    return map
  }, [isSystem, allFonts, previewWeight])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allFonts
    return allFonts.filter((f) => f.toLowerCase().includes(q))
  }, [allFonts, query])

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
                    {isSystem && installed && (
                      <Tooltip content="Installed on this system">
                        <span className="font-picker-item-tag">✓</span>
                      </Tooltip>
                    )}
                    {isSystem && !installed && (
                      <Tooltip content="Not detected — will fall back to default">
                        <span className="font-picker-item-tag font-picker-item-fallback">
                          fallback
                        </span>
                      </Tooltip>
                    )}
                    {!isSystem && (
                      <Tooltip content="Fetched from fonts.googleapis.com on demand">
                        <span className="font-picker-item-tag">cloud</span>
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
