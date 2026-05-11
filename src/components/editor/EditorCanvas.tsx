import { useMemo } from 'react'
import FacePreview from '../dump/FacePreview'
import FacePreviewN from '../dump/FacePreviewN'
import { useEditor } from '../../store/editorStore'
import { listLayers } from '../../lib/projectIO'

const SCALE = 2

function EditorCanvas() {
  const project = useEditor((s) => s.project)
  const selectedIdx = useEditor((s) => s.selectedIdx)
  const dummy = useEditor((s) => s.dummy)
  const select = useEditor((s) => s.select)

  const layers = useMemo(() => (project ? listLayers(project) : []), [project])

  if (!project) return null

  // Find the selected layer's bounding box for the overlay (if it has one).
  const selected = selectedIdx !== null ? layers[selectedIdx] : undefined

  return (
    <div className="editor-canvas-stack" onClick={() => select(null)}>
      <div onClick={(e) => e.stopPropagation()}>
        {project.format === 'typeC' ? (
          <FacePreview
            header={project.header}
            blobs={project.blobs}
            dummy={dummy}
            scale={SCALE}
          />
        ) : (
          <FacePreviewN face={project.face} dummy={dummy} scale={SCALE} />
        )}
      </div>

      {selected &&
        selected.x !== null &&
        selected.y !== null &&
        selected.w !== null &&
        selected.h !== null && (
          <div
            className="editor-selection-overlay"
            style={{
              left: selected.x * SCALE,
              top: selected.y * SCALE,
              width: selected.w * SCALE,
              height: selected.h * SCALE,
            }}
          />
        )}
    </div>
  )
}

export default EditorCanvas
