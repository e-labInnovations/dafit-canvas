import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react'
import { createPortal } from 'react-dom'

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right'

type Props = {
  /** What appears inside the tooltip. Short strings work best; multi-line
   *  strings render with `white-space: pre-line` so explicit `\n` becomes a
   *  line break. */
  content: ReactNode
  /** Preferred side. Auto-flips to the opposite side when the requested
   *  side would clip against the viewport edge. Default `'top'`. */
  placement?: TooltipPlacement
  /** ms to wait before showing the tooltip after the user hovers/focuses
   *  the trigger. Hide is always instant. Default 350 — matches the
   *  perceptual delay native browser tooltips use. */
  delay?: number
  /** Force the tooltip permanently hidden (useful for conditionally
   *  disabling a tooltip without removing the wrapper). */
  disabled?: boolean
  /** The trigger element. Must be a single React element that accepts
   *  `ref`, `onMouseEnter`, `onMouseLeave`, `onFocus`, `onBlur`, and
   *  `aria-describedby`. DOM elements (button, span, etc.) and React 19
   *  function components all qualify. */
  children: ReactElement
}

type Position = {
  top: number
  left: number
  /** The placement we actually used after auto-flip — drives the arrow
   *  rotation class. */
  resolved: TooltipPlacement
}

const VIEWPORT_MARGIN = 8
const GAP = 6

/** A styled hover/focus tooltip. Portals to `document.body`, auto-flips,
 *  hides on Esc, and links to its trigger via `aria-describedby` so screen
 *  readers announce the content alongside the element's name. */
function Tooltip({
  content,
  placement = 'top',
  delay = 350,
  disabled = false,
  children,
}: Props) {
  const triggerRef = useRef<HTMLElement | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const tipId = useId()
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState<Position | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = () => {
    if (disabled) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setVisible(true), delay)
  }
  const hide = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setVisible(false)
  }

  // Clear pending show timers on unmount so stray tooltips don't pop up
  // after their trigger is gone.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  // Position the tooltip relative to the trigger. Uses a two-pass measure
  // so we can flip when the preferred side overflows. We deliberately
  // don't reset `pos` to null when `visible` flips back to false — the
  // tooltip's render is already gated by `visible`, so a stale `pos`
  // is invisible and gets recomputed on the next open anyway.
  useLayoutEffect(() => {
    if (!visible) return
    const update = () => {
      const a = triggerRef.current
      const t = tipRef.current
      if (!a || !t) return
      const r = a.getBoundingClientRect()
      const tw = t.offsetWidth
      const th = t.offsetHeight

      const compute = (side: TooltipPlacement) => {
        switch (side) {
          case 'top':
            return { top: r.top - th - GAP, left: r.left + (r.width - tw) / 2 }
          case 'bottom':
            return { top: r.bottom + GAP, left: r.left + (r.width - tw) / 2 }
          case 'left':
            return { top: r.top + (r.height - th) / 2, left: r.left - tw - GAP }
          case 'right':
            return { top: r.top + (r.height - th) / 2, left: r.right + GAP }
        }
      }

      const fits = (side: TooltipPlacement) => {
        const c = compute(side)
        if (side === 'top') return c.top >= VIEWPORT_MARGIN
        if (side === 'bottom')
          return c.top + th <= window.innerHeight - VIEWPORT_MARGIN
        if (side === 'left') return c.left >= VIEWPORT_MARGIN
        return c.left + tw <= window.innerWidth - VIEWPORT_MARGIN
      }

      let resolved: TooltipPlacement = placement
      if (!fits(placement)) {
        const opposite: Record<TooltipPlacement, TooltipPlacement> = {
          top: 'bottom',
          bottom: 'top',
          left: 'right',
          right: 'left',
        }
        if (fits(opposite[placement])) resolved = opposite[placement]
      }

      const c = compute(resolved)
      // Clamp on the cross-axis so the tooltip never spills past the viewport
      // edge — keeps long messages readable on narrow screens.
      const left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(c.left, window.innerWidth - tw - VIEWPORT_MARGIN),
      )
      const top = Math.max(
        VIEWPORT_MARGIN,
        Math.min(c.top, window.innerHeight - th - VIEWPORT_MARGIN),
      )
      setPos({ top, left, resolved })
    }

    update()
    // Re-measure on the next frame in case fonts swap in or text reflows.
    const raf = requestAnimationFrame(update)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [visible, placement])

  // Esc dismisses. Useful when a tooltip lingers after dragging away from
  // the trigger and the user wants to clear the screen.
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [visible])

  const child = Children.only(children)
  if (!isValidElement(child)) {
    // Trigger isn't a real element — pass through unchanged. Avoid
    // crashing the render; the parent will see a missing tooltip.
    return <>{children}</>
  }

  // Merge our handlers with whatever the child already has. The child's
  // own listeners run *first* so they can preventDefault or stopPropagate
  // before the tooltip reacts.
  type AnyEventHandler = ((e: React.SyntheticEvent) => void) | undefined
  const childProps = child.props as Record<string, unknown>
  const chain = (existing: AnyEventHandler, mine: () => void) =>
    (e: React.SyntheticEvent) => {
      existing?.(e)
      mine()
    }

  const composedRef = (node: HTMLElement | null) => {
    triggerRef.current = node
    const childRef = (child as { ref?: Ref<HTMLElement> }).ref
    if (typeof childRef === 'function') childRef(node)
    else if (childRef && 'current' in childRef) {
      (childRef as { current: HTMLElement | null }).current = node
    }
  }

  // `show`/`hide` close over `timerRef`. The lint rule (react-hooks/refs)
  // worries that passing those closures as props could lead to a ref read
  // during render — but here the closures are only ever invoked from
  // pointer/focus event handlers, which is the canonical place to read
  // refs. Silencing the rule for this block to keep the API clean.
  /* eslint-disable react-hooks/refs */
  const cloned = cloneElement(child, {
    ref: composedRef,
    onMouseEnter: chain(childProps.onMouseEnter as AnyEventHandler, show),
    onMouseLeave: chain(childProps.onMouseLeave as AnyEventHandler, hide),
    onFocus: chain(childProps.onFocus as AnyEventHandler, show),
    onBlur: chain(childProps.onBlur as AnyEventHandler, hide),
    'aria-describedby': visible
      ? tipId
      : (childProps['aria-describedby'] as string | undefined),
  } as Record<string, unknown>)
  /* eslint-enable react-hooks/refs */

  return (
    <>
      {cloned}
      {visible &&
        !disabled &&
        createPortal(
          <div
            ref={tipRef}
            id={tipId}
            role="tooltip"
            className={`tooltip${pos ? ` tooltip-${pos.resolved}` : ''}`}
            style={
              pos
                ? { top: pos.top, left: pos.left }
                : // First paint, pre-measure: render off-screen so the
                  // user doesn't see a flash at (0, 0).
                  { top: -9999, left: -9999, visibility: 'hidden' }
            }
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  )
}

export default Tooltip
