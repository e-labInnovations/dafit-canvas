import { useEditor } from '../../store/editorStore'
import { SCREEN_H, SCREEN_W, type FaceElement } from '../../types/face'

const NumField = ({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
}) => (
  <label className="prop-field">
    <span>{label}</span>
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10)
        if (Number.isFinite(n)) onChange(n)
      }}
    />
  </label>
)

const ColorField = ({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (s: string) => void
}) => (
  <label className="prop-field">
    <span>{label}</span>
    <span className="prop-color">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  </label>
)

const TextField = ({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (s: string) => void
}) => (
  <label className="prop-field">
    <span>{label}</span>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </label>
)

function PropertyPanel() {
  const project = useEditor((s) => s.project)
  const selectedId = useEditor((s) => s.selectedId)
  const updateElement = useEditor((s) => s.updateElement)
  const setFaceNumber = useEditor((s) => s.setFaceNumber)

  const selected: FaceElement | undefined = selectedId
    ? project.elements.find((e) => e.id === selectedId)
    : undefined

  return (
    <aside className="editor-pane editor-props">
      <h3>Project</h3>
      <NumField
        label="faceNumber"
        value={project.faceNumber}
        onChange={(n) => setFaceNumber(n)}
        min={1}
      />

      {!selected && (
        <p className="hint">Select a layer to edit its properties.</p>
      )}

      {selected && (
        <>
          <h3>Element</h3>
          <TextField
            label="name"
            value={selected.name}
            onChange={(name) => updateElement(selected.id, { name })}
          />

          {selected.kind !== 'background' && (
            <div className="prop-row">
              <NumField
                label="x"
                value={selected.x}
                onChange={(x) => updateElement(selected.id, { x })}
                min={-SCREEN_W}
                max={SCREEN_W}
              />
              <NumField
                label="y"
                value={selected.y}
                onChange={(y) => updateElement(selected.id, { y })}
                min={-SCREEN_H}
                max={SCREEN_H}
              />
            </div>
          )}

          {selected.kind === 'background' && (
            <ColorField
              label="color"
              value={selected.color}
              onChange={(color) => updateElement(selected.id, { color })}
            />
          )}

          {selected.kind === 'time' && (
            <>
              <label className="prop-field">
                <span>format</span>
                <select
                  value={selected.format}
                  onChange={(e) =>
                    updateElement(selected.id, {
                      format: e.target.value as 'HH:mm' | 'HH:mm:ss',
                    })
                  }
                >
                  <option value="HH:mm">HH:mm</option>
                  <option value="HH:mm:ss">HH:mm:ss</option>
                </select>
              </label>
              <NumField
                label="font size"
                value={selected.fontSize}
                onChange={(fontSize) =>
                  updateElement(selected.id, { fontSize })
                }
                min={6}
                max={120}
              />
              <ColorField
                label="color"
                value={selected.color}
                onChange={(color) => updateElement(selected.id, { color })}
              />
            </>
          )}

          {selected.kind === 'text' && (
            <>
              <TextField
                label="text"
                value={selected.text}
                onChange={(text) => updateElement(selected.id, { text })}
              />
              <NumField
                label="font size"
                value={selected.fontSize}
                onChange={(fontSize) =>
                  updateElement(selected.id, { fontSize })
                }
                min={6}
                max={120}
              />
              <ColorField
                label="color"
                value={selected.color}
                onChange={(color) => updateElement(selected.id, { color })}
              />
            </>
          )}
        </>
      )}
    </aside>
  )
}

export default PropertyPanel
