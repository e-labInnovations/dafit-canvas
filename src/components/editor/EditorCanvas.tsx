import { useEffect, useRef, useState } from 'react'
import FacePreview from '../dump/FacePreview'
import FacePreviewN from '../dump/FacePreviewN'
import { useEditor } from '../../store/editorStore'
import {
  computeLayerBbox,
  computeSnapCandidates,
  getLayerAnchor,
  hitTestLayer,
  materializeTypeC,
  resolveSnap,
  type SnapCandidate,
} from '../../lib/projectIO'
import type { EditorProject, GuideLine } from '../../types/face'
import type { DummyStateN } from '../../lib/renderFaceN'

// Native watch face is 240×240. We scale up to 2× by default (480px), but
// shrink to fit when the column is narrower. MIN_SCALE = 1 means we never
// render below native pixel size — at that point the stage scrollbar takes
// over rather than the face becoming illegibly small. FRAME_DECORATION
// matches .face-preview-frame's 12px padding + 1px border per side.
const NATIVE = 240
const MAX_SCALE = 2
const MIN_SCALE = 1
const FRAME_DECORATION = 26
// .face-preview-frame's padding (12px) + border (1px). The canvas sits inset
// from the wrapper's top-left by this much, so the selection overlay needs
// the same offset to land on the rendered pixels.
const FRAME_INSET = 13
// Pointer movement (in native px) required before a click turns into a drag
// or marquee. Anything smaller is treated as a plain click.
const DRAG_THRESHOLD = 3
// Snap tolerance in native pixels. Tight (~2 native px) so manual nudges
// stay viable — see Phase 5 design discussion.
const SNAP_THRESHOLD = 2
// Native-pixel hit area around a guide line. The visible line is 1 px, but
// the user needs more slack to actually grab it. 4 px ≈ 8 screen px at 2×.
const GUIDE_HIT_PADDING = 4

type GroupDragMember = {
  idx: number
  startX: number
  startY: number
}

type LayerDragState = {
  kind: 'move-layer'
  members: GroupDragMember[]
  /** Union bbox of the dragged group at drag start. Used by the snap
   *  resolver to probe edges/center on each axis. */
  startGroupBbox: { x: number; y: number; w: number; h: number }
  startClientX: number
  startClientY: number
  moved: boolean
}

type GuideDragState = {
  kind: 'move-guide'
  id: string
  axis: 'H' | 'V'
  startPosition: number
  startClientX: number
  startClientY: number
  moved: boolean
}

type MarqueeState = {
  kind: 'marquee'
  startClientX: number
  startClientY: number
  startNativeX: number
  startNativeY: number
  currentNativeX: number
  currentNativeY: number
  additive: boolean
}

type InteractionRef =
  | LayerDragState
  | GuideDragState
  | MarqueeState
  | null

const rectsIntersect = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) =>
  a.x < b.x + b.w &&
  a.x + a.w > b.x &&
  a.y < b.y + b.h &&
  a.y + a.h > b.y

const layerCount = (project: EditorProject): number =>
  project.format === 'typeC'
    ? project.layers.length
    : project.face.elements.length

const indicesInsideMarquee = (
  project: EditorProject,
  marquee: { x: number; y: number; w: number; h: number },
  dummy: DummyStateN,
): number[] => {
  const hits: number[] = []
  for (let i = 0; i < layerCount(project); i++) {
    const bb = computeLayerBbox(project, i, dummy)
    if (!bb) continue
    if (rectsIntersect(bb, marquee)) hits.push(i)
  }
  return hits
}

/** Union bbox of a layer set. Returns null when none of the layers has a
 *  resolvable bbox (rare — happens with FaceN digit-dependent kinds). */
const groupBbox = (
  project: EditorProject,
  idxs: number[],
  dummy: DummyStateN,
): { x: number; y: number; w: number; h: number } | null => {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  let count = 0
  for (const i of idxs) {
    const bb = computeLayerBbox(project, i, dummy)
    if (!bb) continue
    minX = Math.min(minX, bb.x)
    minY = Math.min(minY, bb.y)
    maxX = Math.max(maxX, bb.x + bb.w)
    maxY = Math.max(maxY, bb.y + bb.h)
    count++
  }
  if (count === 0) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** Hit-test against visible guides. Returns the guide id if the pointer is
 *  within GUIDE_HIT_PADDING of any guide on the matching axis, else null.
 *  Guides take priority over layers — this is called *before* hitTestLayer
 *  so users can grab a guide that sits over a layer. */
const hitTestGuide = (
  guides: GuideLine[],
  guidesVisible: boolean,
  nx: number,
  ny: number,
): GuideLine | null => {
  if (!guidesVisible) return null
  let best: { g: GuideLine; dist: number } | null = null
  for (const g of guides) {
    if (!g.visible) continue
    const dist =
      g.axis === 'H' ? Math.abs(g.position - ny) : Math.abs(g.position - nx)
    if (dist > GUIDE_HIT_PADDING) continue
    if (!best || dist < best.dist) best = { g, dist }
  }
  return best?.g ?? null
}

function EditorCanvas() {
  const project = useEditor((s) => s.project)
  const selectedIdxs = useEditor((s) => s.selectedIdxs)
  const selectedGuideIds = useEditor((s) => s.selectedGuideIds)
  const guidesVisible = useEditor((s) => s.guidesVisible)
  const snapEnabled = useEditor((s) => s.snapEnabled)
  const dummy = useEditor((s) => s.dummy)
  const select = useEditor((s) => s.select)
  const toggleSelected = useEditor((s) => s.toggleSelected)
  const selectMany = useEditor((s) => s.selectMany)
  const setLayerPosition = useEditor((s) => s.setLayerPosition)
  const selectGuide = useEditor((s) => s.selectGuide)
  const toggleGuideSelected = useEditor((s) => s.toggleGuideSelected)
  const moveGuideAction = useEditor((s) => s.moveGuideAction)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const interactionRef = useRef<InteractionRef>(null)
  const [scale, setScale] = useState(MAX_SCALE)
  const [isGrabbing, setIsGrabbing] = useState(false)
  // Mirror of the in-progress marquee for the visual overlay. Stored as
  // state (not ref) so React re-renders the marquee rectangle each frame.
  const [marquee, setMarquee] = useState<
    { x: number; y: number; w: number; h: number } | null
  >(null)
  // Active smart-guide overlays. Drawn during drag whenever the snap
  // resolver picks a candidate; cleared on drag end.
  const [smartGuides, setSmartGuides] = useState<{
    v: SnapCandidate | null
    h: SnapCandidate | null
  }>({ v: null, h: null })

  useEffect(() => {
    const stack = wrapperRef.current
    if (!stack) return
    const recompute = () => {
      const available = stack.clientWidth - FRAME_DECORATION
      if (available <= 0) return
      const fit = available / NATIVE
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, fit))
      setScale((prev) => (Math.abs(prev - next) < 0.001 ? prev : next))
    }
    recompute()
    const observer = new ResizeObserver(recompute)
    observer.observe(stack)
    return () => observer.disconnect()
  }, [])

  if (!project) return null

  // Per-layer bboxes for everything currently selected. Empty array if
  // nothing is selected. The render below maps these to overlay divs.
  const selectionBboxes: Array<{
    idx: number
    x: number
    y: number
    w: number
    h: number
  }> = []
  for (const idx of selectedIdxs) {
    const bb = computeLayerBbox(project, idx, dummy)
    if (bb) selectionBboxes.push({ idx, ...bb })
  }

  const guideSet = new Set(selectedGuideIds)

  const toNative = (clientX: number, clientY: number) => {
    const frame = frameRef.current
    if (!frame) return null
    const rect = frame.getBoundingClientRect()
    const nx = (clientX - rect.left - FRAME_INSET) / scale
    const ny = (clientY - rect.top - FRAME_INSET) / scale
    if (nx < 0 || nx >= NATIVE || ny < 0 || ny >= NATIVE) return null
    return { nx, ny }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const pt = toNative(e.clientX, e.clientY)
    const additive = e.shiftKey || e.metaKey || e.ctrlKey

    if (!pt) {
      // Clicks in the gutter (between the wrapper and the canvas) clear
      // selection. Don't start a marquee from here — there's no canvas to
      // lasso against.
      if (!additive) {
        select(null)
        selectGuide(null)
      }
      return
    }

    // Guides take hit-test priority so a user can grab a guide that sits
    // on top of a layer.
    const guideHit = hitTestGuide(project.guides, guidesVisible, pt.nx, pt.ny)
    if (guideHit) {
      if (additive) {
        toggleGuideSelected(guideHit.id)
        return
      }
      // Single-select the guide and arm a drag.
      if (!selectedGuideIds.includes(guideHit.id)) {
        selectGuide(guideHit.id)
      }
      interactionRef.current = {
        kind: 'move-guide',
        id: guideHit.id,
        axis: guideHit.axis,
        startPosition: guideHit.position,
        startClientX: e.clientX,
        startClientY: e.clientY,
        moved: false,
      }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }

    const hit = hitTestLayer(project, pt.nx, pt.ny, dummy)

    // Empty canvas pixel → start marquee (or clear on plain click).
    if (hit === null) {
      interactionRef.current = {
        kind: 'marquee',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startNativeX: pt.nx,
        startNativeY: pt.ny,
        currentNativeX: pt.nx,
        currentNativeY: pt.ny,
        additive,
      }
      if (!additive) {
        select(null)
        selectGuide(null)
      }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }

    // Layer hit. Shift = toggle membership (no drag). Plain = single-select
    // (or keep existing selection if the hit was already part of it) and
    // prepare for a group drag.
    if (additive) {
      toggleSelected(hit)
      return
    }

    const alreadySelected = selectedIdxs.includes(hit)
    const dragSet = alreadySelected ? selectedIdxs : [hit]
    if (!alreadySelected) select(hit)

    const members: GroupDragMember[] = dragSet
      .map((i) => {
        const a = getLayerAnchor(project, i)
        return a ? { idx: i, startX: a.x, startY: a.y } : null
      })
      .filter((m): m is GroupDragMember => m !== null)

    if (members.length === 0) return

    const startGroupBbox = groupBbox(project, dragSet, dummy)
    if (!startGroupBbox) return

    interactionRef.current = {
      kind: 'move-layer',
      members,
      startGroupBbox,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const ix = interactionRef.current
    if (!ix) return

    if (ix.kind === 'move-layer') {
      const rawDx = (e.clientX - ix.startClientX) / scale
      const rawDy = (e.clientY - ix.startClientY) / scale
      if (!ix.moved) {
        if (
          Math.abs(rawDx) < DRAG_THRESHOLD &&
          Math.abs(rawDy) < DRAG_THRESHOLD
        ) {
          return
        }
        ix.moved = true
        setIsGrabbing(true)
      }
      let dx = Math.round(rawDx)
      let dy = Math.round(rawDy)
      let matchedV: SnapCandidate | null = null
      let matchedH: SnapCandidate | null = null
      if (snapEnabled) {
        const draggedIdxs = ix.members.map((m) => m.idx)
        const candidates = computeSnapCandidates(
          project,
          dummy,
          draggedIdxs,
          [],
        )
        const snapped = resolveSnap(
          ix.startGroupBbox,
          rawDx,
          rawDy,
          candidates,
          SNAP_THRESHOLD,
        )
        dx = snapped.dx
        dy = snapped.dy
        matchedV = snapped.matchedV
        matchedH = snapped.matchedH
      }
      setSmartGuides({ v: matchedV, h: matchedH })
      for (const m of ix.members) {
        setLayerPosition(m.idx, m.startX + dx, m.startY + dy)
      }
      return
    }

    if (ix.kind === 'move-guide') {
      const rawDx = (e.clientX - ix.startClientX) / scale
      const rawDy = (e.clientY - ix.startClientY) / scale
      const delta = ix.axis === 'H' ? rawDy : rawDx
      if (!ix.moved) {
        if (Math.abs(delta) < DRAG_THRESHOLD) return
        ix.moved = true
        setIsGrabbing(true)
      }
      let pos = ix.startPosition + delta
      let matchedV: SnapCandidate | null = null
      let matchedH: SnapCandidate | null = null
      if (snapEnabled) {
        const candidates = computeSnapCandidates(project, dummy, [], [ix.id])
        // A horizontal guide snaps on the H axis, vertical on V.
        const probe = pos
        let best: { p: number; c: SnapCandidate; d: number } | null = null
        for (const c of candidates) {
          if (c.axis !== ix.axis) continue
          const d = Math.abs(c.position - probe)
          if (d > SNAP_THRESHOLD) continue
          if (!best || d < best.d) best = { p: c.position, c, d }
        }
        if (best) {
          pos = best.p
          if (ix.axis === 'H') matchedH = best.c
          else matchedV = best.c
        }
      }
      setSmartGuides({ v: matchedV, h: matchedH })
      moveGuideAction(ix.id, Math.round(pos))
      return
    }

    // Marquee: update visual rect on every move; native coords clamped to
    // the canvas so the rectangle never extends past the watch face.
    const pt = toNative(e.clientX, e.clientY)
    const cx = pt
      ? pt.nx
      : Math.max(
          0,
          Math.min(
            NATIVE,
            (e.clientX -
              (frameRef.current?.getBoundingClientRect().left ?? 0) -
              FRAME_INSET) /
              scale,
          ),
        )
    const cy = pt
      ? pt.ny
      : Math.max(
          0,
          Math.min(
            NATIVE,
            (e.clientY -
              (frameRef.current?.getBoundingClientRect().top ?? 0) -
              FRAME_INSET) /
              scale,
          ),
        )
    ix.currentNativeX = cx
    ix.currentNativeY = cy
    setMarquee({
      x: Math.min(ix.startNativeX, cx),
      y: Math.min(ix.startNativeY, cy),
      w: Math.abs(cx - ix.startNativeX),
      h: Math.abs(cy - ix.startNativeY),
    })
  }

  const endInteraction = (e: React.PointerEvent<HTMLDivElement>) => {
    const ix = interactionRef.current
    if (!ix) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    if (ix.kind === 'marquee') {
      const rect = {
        x: Math.min(ix.startNativeX, ix.currentNativeX),
        y: Math.min(ix.startNativeY, ix.currentNativeY),
        w: Math.abs(ix.currentNativeX - ix.startNativeX),
        h: Math.abs(ix.currentNativeY - ix.startNativeY),
      }
      // If the user barely moved, treat as a plain click (already handled
      // by `select(null)` at pointerdown). Otherwise commit the hit set.
      if (rect.w >= DRAG_THRESHOLD || rect.h >= DRAG_THRESHOLD) {
        const hits = indicesInsideMarquee(project, rect, dummy)
        selectMany(hits, ix.additive ? 'add' : 'replace')
      }
      setMarquee(null)
    }
    interactionRef.current = null
    setIsGrabbing(false)
    setSmartGuides({ v: null, h: null })
  }

  return (
    <div ref={wrapperRef} className="editor-canvas-stack">
      <div
        ref={frameRef}
        className={`editor-canvas-frame${isGrabbing ? ' is-grabbing' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endInteraction}
        onPointerCancel={endInteraction}
      >
        {project.format === 'typeC' ? (
          (() => {
            const { header, blobs } = materializeTypeC(project)
            return (
              <FacePreview
                header={header}
                blobs={blobs}
                dummy={dummy}
                scale={scale}
              />
            )
          })()
        ) : (
          <FacePreviewN face={project.face} dummy={dummy} scale={scale} />
        )}
      </div>

      {selectionBboxes.map((bb) => (
        <div
          key={bb.idx}
          className="editor-selection-overlay"
          style={{
            left: bb.x * scale + FRAME_INSET,
            top: bb.y * scale + FRAME_INSET,
            width: bb.w * scale,
            height: bb.h * scale,
          }}
        />
      ))}

      {guidesVisible &&
        project.guides
          .filter((g) => g.visible)
          .map((g) => {
            const selected = guideSet.has(g.id)
            const style: React.CSSProperties =
              g.axis === 'H'
                ? {
                    left: FRAME_INSET,
                    top: g.position * scale + FRAME_INSET,
                    width: NATIVE * scale,
                  }
                : {
                    left: g.position * scale + FRAME_INSET,
                    top: FRAME_INSET,
                    height: NATIVE * scale,
                  }
            return (
              <div
                key={g.id}
                className={`editor-guide editor-guide-${g.axis === 'H' ? 'horizontal' : 'vertical'}${selected ? ' selected' : ''}`}
                style={style}
                aria-hidden
              />
            )
          })}

      {smartGuides.v && (
        <div
          className="editor-smart-guide editor-smart-guide-vertical"
          style={{
            left: smartGuides.v.position * scale + FRAME_INSET,
            top: FRAME_INSET,
            height: NATIVE * scale,
          }}
          aria-hidden
        />
      )}
      {smartGuides.h && (
        <div
          className="editor-smart-guide editor-smart-guide-horizontal"
          style={{
            left: FRAME_INSET,
            top: smartGuides.h.position * scale + FRAME_INSET,
            width: NATIVE * scale,
          }}
          aria-hidden
        />
      )}

      {marquee && (
        <div
          className="editor-marquee"
          style={{
            left: marquee.x * scale + FRAME_INSET,
            top: marquee.y * scale + FRAME_INSET,
            width: marquee.w * scale,
            height: marquee.h * scale,
          }}
        />
      )}
    </div>
  )
}

export default EditorCanvas
