import { useEffect, useRef, useState } from 'react'
import FacePreview from '../dump/FacePreview'
import FacePreviewN from '../dump/FacePreviewN'
import { useEditor } from '../../store/editorStore'
import { computeLayerBbox, materializeTypeC } from '../../lib/projectIO'

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

function EditorCanvas() {
  const project = useEditor((s) => s.project)
  const selectedIdx = useEditor((s) => s.selectedIdx)
  const dummy = useEditor((s) => s.dummy)
  const select = useEditor((s) => s.select)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(MAX_SCALE)

  useEffect(() => {
    const stack = wrapperRef.current
    if (!stack) return
    const recompute = () => {
      // .editor-canvas-stack is now width: 100% (capped by max/min-width in
      // CSS), so its clientWidth reflects the column width and we just need to
      // subtract the inner frame's padding/border to get the canvas room.
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

  // Renderer-accurate bbox: for multi-digit kinds (STEPS_B_CA, DAY_NUM, …)
  // this expands to the full text width based on the current dummy value +
  // alignment, matching what `drawDigits` paints.
  const bbox =
    selectedIdx !== null
      ? computeLayerBbox(project, selectedIdx, dummy)
      : null

  return (
    <div
      ref={wrapperRef}
      className="editor-canvas-stack"
      onClick={() => select(null)}
    >
      <div onClick={(e) => e.stopPropagation()}>
        {project.format === 'typeC' ? (
          (() => {
            // Materialize layers+sets → (header, blobs) on every render. Cheap
            // for typical face sizes (≤250 blobs) and keeps the renderer code
            // path identical to the Dump/Pack pages.
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

      {bbox && (
        <div
          className="editor-selection-overlay"
          style={{
            left: bbox.x * scale + FRAME_INSET,
            top: bbox.y * scale + FRAME_INSET,
            width: bbox.w * scale,
            height: bbox.h * scale,
          }}
        />
      )}
    </div>
  )
}

export default EditorCanvas
