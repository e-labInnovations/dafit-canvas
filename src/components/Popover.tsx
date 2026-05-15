import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'

export type PopoverPlacement =
  | 'bottom-start'
  | 'bottom-end'
  | 'top-start'
  | 'top-end'

type Props = {
  /** The trigger element. Used both for positioning and for excluding from
   *  click-outside dismissal. Pass the same ref you wired to your toggle
   *  button. */
  anchorRef: RefObject<HTMLElement | null>
  /** Called on click-outside, Esc, or whatever else this component decides
   *  should close the popover. The parent owns the visibility state. */
  onClose: () => void
  /** Which corner of the popover aligns to which corner of the anchor.
   *  `bottom-start` (default) drops down aligned to the trigger's left
   *  edge — the typical menu placement. */
  placement?: PopoverPlacement
  /** Pixel gap between anchor and popover. Default 4. */
  offset?: number
  /** ARIA role for the popover container. `'menu'` for command lists,
   *  `'listbox'` for selectable options, `'dialog'` for free-form content
   *  (default). */
  role?: 'dialog' | 'menu' | 'listbox'
  /** Accessible name when the popover's content doesn't have its own
   *  visible heading. */
  ariaLabel?: string
  /** Force the popover to at least the trigger's width — useful for menu
   *  drop-downs that should match their button. */
  matchAnchorWidth?: boolean
  /** Extra class on the popover container, on top of `.popover`. */
  className?: string
  children: ReactNode
}

/** A reusable portal-rendered popover.
 *
 *  - Mounts into `document.body` so it escapes scrolling/overflow-hidden
 *    parents.
 *  - Positions itself relative to `anchorRef` via `position: fixed`, with
 *    automatic vertical flip when the requested placement would clip
 *    against the viewport edge.
 *  - Dismisses on click-outside (mousedown, so a drag-out-and-release
 *    behaves naturally) and on Esc.
 *  - Restores focus to the anchor when it unmounts — keeps keyboard users
 *    grounded.
 *  - Parent owns visibility: render `<Popover />` only while open.
 */
function Popover({
  anchorRef,
  onClose,
  placement = 'bottom-start',
  offset = 4,
  role = 'dialog',
  ariaLabel,
  matchAnchorWidth = false,
  className,
  children,
}: Props) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<React.CSSProperties | null>(null)

  useLayoutEffect(() => {
    const update = () => {
      const a = anchorRef.current
      const p = popoverRef.current
      if (!a) return
      const r = a.getBoundingClientRect()
      const pRect = p?.getBoundingClientRect()
      // Use `scrollHeight` for the flip decision — that's the popover's
      // *intrinsic* content height, ignoring any `max-height` clamp we
      // may have already applied on a previous tick. Going off the
      // clamped `getBoundingClientRect().height` makes the placement
      // bistable: once we flip and clamp, the other side now "fits", so
      // the next update flips back, ad infinitum.
      const popH = p?.scrollHeight ?? pRect?.height ?? 0
      const popW = pRect?.width ?? 0

      // Vertical placement — flip below↔above when the requested side
      // would overflow the viewport.
      let vertical: 'top' | 'bottom' = placement.startsWith('top')
        ? 'top'
        : 'bottom'
      if (vertical === 'bottom' && r.bottom + offset + popH > window.innerHeight && r.top - offset - popH >= 0) {
        vertical = 'top'
      } else if (vertical === 'top' && r.top - offset - popH < 0 && r.bottom + offset + popH <= window.innerHeight) {
        vertical = 'bottom'
      }

      const align: 'start' | 'end' = placement.endsWith('end') ? 'end' : 'start'

      const next: React.CSSProperties = {
        position: 'fixed',
        zIndex: 220,
      }
      // Viewport gutter — leaves room for the page chrome (nav) and a small
      // breathing margin so the popover never butts against an edge.
      const GUTTER = 8
      if (vertical === 'bottom') {
        next.top = r.bottom + offset
        // Cap height to whatever's left below the anchor. Combined with
        // the popover root's `overflow-y: auto` (set below), this turns
        // the popover into a scrolling pane when content exceeds the
        // available space — never overflows the viewport.
        next.maxHeight = Math.max(
          120,
          window.innerHeight - r.bottom - offset - GUTTER,
        )
      } else {
        next.bottom = window.innerHeight - r.top + offset
        next.maxHeight = Math.max(120, r.top - offset - GUTTER)
      }
      // Always allow internal scroll; the consuming popover's own CSS
      // can override `maxHeight` via `min(...)` if it wants a tighter cap.
      next.overflowY = 'auto'
      if (align === 'start') {
        // Keep the popover on-screen — clamp left to a small viewport gutter.
        const left = Math.max(
          GUTTER,
          Math.min(r.left, window.innerWidth - popW - GUTTER),
        )
        next.left = left
      } else {
        const right = Math.max(
          GUTTER,
          Math.min(
            window.innerWidth - r.right,
            window.innerWidth - popW - GUTTER,
          ),
        )
        next.right = right
      }
      if (matchAnchorWidth) {
        next.minWidth = r.width
      }
      setStyle(next)
    }
    update()
    // Re-measure after layout settles (popover's own size affects flip
    // decision). One animation frame is enough for the typical case.
    const raf = requestAnimationFrame(update)
    window.addEventListener('resize', update)
    // Capture-phase scroll listener catches scroll on every ancestor +
    // descendant of the document. We *want* it to fire when an ancestor
    // (page, sidebar) scrolls — anchor moves with the layout. We do NOT
    // want it firing when the user scrolls inside the popover itself —
    // that doesn't move the anchor, and re-running `update` flickers the
    // placement when content scrolls underneath.
    const onScrollCapture = (e: Event) => {
      const target = e.target as Node | null
      const pop = popoverRef.current
      if (target && pop && pop.contains(target)) return
      update()
    }
    window.addEventListener('scroll', onScrollCapture, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', onScrollCapture, true)
    }
  }, [anchorRef, placement, offset, matchAnchorWidth])

  // Click-outside and Esc to dismiss.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const a = anchorRef.current
      const p = popoverRef.current
      // Inside the anchor → let the anchor's own click handler manage the
      // toggle (so re-clicking the trigger closes us cleanly).
      if (a && a.contains(e.target as Node)) return
      // Inside the popover → user is interacting with our content.
      if (p && p.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchorRef, onClose])

  // Restore focus to the anchor when the popover unmounts. We deliberately
  // read `anchorRef.current` in cleanup (not at effect setup) so the focus
  // lands on whatever element the anchor ref points to *at close time* —
  // the parent may have re-rendered the trigger meanwhile.
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const a = anchorRef.current
      if (a && typeof (a as HTMLElement).focus === 'function') {
        try {
          ;(a as HTMLElement).focus({ preventScroll: true })
        } catch {
          /* some elements (e.g. SVGElement) don't support options */
          ;(a as HTMLElement).focus()
        }
      }
    }
  }, [anchorRef])

  return createPortal(
    <div
      ref={popoverRef}
      className={`popover${className ? ` ${className}` : ''}`}
      style={style ?? { position: 'fixed', visibility: 'hidden' }}
      role={role}
      aria-label={ariaLabel}
    >
      {children}
    </div>,
    document.body,
  )
}

export default Popover
