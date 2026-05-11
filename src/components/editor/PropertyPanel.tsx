import { useMemo } from 'react'
import { useEditor } from '../../store/editorStore'
import { listLayers } from '../../lib/projectIO'
import { SCREEN_H, SCREEN_W } from '../../types/face'

const NumField = ({
  label,
  value,
  onChange,
  min,
  max,
  disabled,
}: {
  label: string
  value: number | null
  onChange: (n: number) => void
  min?: number
  max?: number
  disabled?: boolean
}) => (
  <label className="prop-field">
    <span>{label}</span>
    <input
      type="number"
      value={value ?? ''}
      min={min}
      max={max}
      disabled={disabled || value === null}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10)
        if (Number.isFinite(n)) onChange(n)
      }}
    />
  </label>
)

function PropertyPanel() {
  const project = useEditor((s) => s.project)
  const selectedIdx = useEditor((s) => s.selectedIdx)
  const setLayerPosition = useEditor((s) => s.setLayerPosition)
  const setFaceNumber = useEditor((s) => s.setFaceNumber)

  const layers = useMemo(() => (project ? listLayers(project) : []), [project])
  const layer = selectedIdx !== null ? layers[selectedIdx] : undefined

  return (
    <aside className="editor-pane editor-props">
      <h3>Project</h3>
      {project?.format === 'typeC' && (
        <NumField
          label="faceNumber"
          value={project.header.faceNumber}
          onChange={(n) => setFaceNumber(n)}
          min={1}
        />
      )}
      {project?.format === 'faceN' && (
        <p className="hint">
          FaceN binaries don't carry a faceNumber — the device slot is decided
          at upload time.
        </p>
      )}

      {!layer && (
        <p className="hint">Select a layer to edit its properties.</p>
      )}

      {layer && (
        <>
          <h3>Layer</h3>
          <p className="prop-meta" title={layer.name}>
            {layer.name}
          </p>
          <div className="prop-row">
            <NumField
              label="x"
              value={layer.x}
              onChange={(x) =>
                setLayerPosition(layer.index, x, layer.y ?? 0)
              }
              min={-SCREEN_W}
              max={SCREEN_W * 2}
            />
            <NumField
              label="y"
              value={layer.y}
              onChange={(y) =>
                setLayerPosition(layer.index, layer.x ?? 0, y)
              }
              min={-SCREEN_H}
              max={SCREEN_H * 2}
            />
          </div>
          <div className="prop-row">
            <NumField
              label="w"
              value={layer.w}
              onChange={() => {}}
              disabled
            />
            <NumField
              label="h"
              value={layer.h}
              onChange={() => {}}
              disabled
            />
          </div>
          <p className="hint">
            Width/height are derived from the bound asset(s). Phase 2 will let
            you swap assets to change them.
          </p>
        </>
      )}
    </aside>
  )
}

export default PropertyPanel
