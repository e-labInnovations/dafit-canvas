import { useMemo } from 'react'
import { useEditor } from '../../store/editorStore'
import { listLayers } from '../../lib/projectIO'
import { SCREEN_H, SCREEN_W } from '../../types/face'
import AssetSection from './AssetSection'
import type { FaceN } from '../../lib/faceN'

type FNEl = FaceN['elements'][number]

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

const SelectField = ({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: number
  options: { value: number; label: string }[]
  onChange: (n: number) => void
}) => (
  <label className="prop-field">
    <span>{label}</span>
    <select
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value, 10))}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </label>
)

// ---------- FaceN kind-specific subforms ----------

function FaceNFields({ idx, el }: { idx: number; el: FNEl }) {
  const patch = useEditor((s) => s.patchElement)
  const setLayerPosition = useEditor((s) => s.setLayerPosition)

  const alignOptions = [
    { value: 0, label: 'L' },
    { value: 1, label: 'R' },
    { value: 2, label: 'C' },
  ]
  const alignToNum = (a: 'L' | 'R' | 'C') => (a === 'R' ? 1 : a === 'C' ? 2 : 0)
  const numToAlign = (n: number): 'L' | 'R' | 'C' =>
    n === 1 ? 'R' : n === 2 ? 'C' : 'L'

  switch (el.kind) {
    case 'Image':
    case 'TimeHand':
    case 'DayName':
    case 'BatteryFill':
    case 'HeartRateNum':
    case 'StepsNum':
    case 'KCalNum':
    case 'BarDisplay':
    case 'Weather': {
      const xField = (
        <div className="prop-row" key="xy">
          <NumField
            label="x"
            value={el.x}
            onChange={(x) => setLayerPosition(idx, x, el.y)}
            min={-SCREEN_W}
            max={SCREEN_W * 2}
          />
          <NumField
            label="y"
            value={el.y}
            onChange={(y) => setLayerPosition(idx, el.x, y)}
            min={-SCREEN_H}
            max={SCREEN_H * 2}
          />
        </div>
      )
      const rest: React.ReactNode[] = []
      if (el.kind === 'TimeHand') {
        rest.push(
          <SelectField
            key="htype"
            label="h_type"
            value={el.hType}
            options={[
              { value: 0, label: '0 — hour' },
              { value: 1, label: '1 — minute' },
              { value: 2, label: '2 — second' },
            ]}
            onChange={(hType) => patch(idx, { hType } as Partial<FNEl>)}
          />,
          <div className="prop-row" key="pivot">
            <NumField
              label="pivotX"
              value={el.pivotX}
              onChange={(pivotX) => patch(idx, { pivotX } as Partial<FNEl>)}
            />
            <NumField
              label="pivotY"
              value={el.pivotY}
              onChange={(pivotY) => patch(idx, { pivotY } as Partial<FNEl>)}
            />
          </div>,
        )
      }
      if (el.kind === 'DayName') {
        rest.push(
          <NumField
            key="ntype"
            label="n_type"
            value={el.nType}
            onChange={(nType) => patch(idx, { nType } as Partial<FNEl>)}
          />,
        )
      }
      if (el.kind === 'BatteryFill') {
        rest.push(
          <div className="prop-row" key="x1y1">
            <NumField
              label="x1"
              value={el.x1}
              onChange={(x1) => patch(idx, { x1 } as Partial<FNEl>)}
            />
            <NumField
              label="y1"
              value={el.y1}
              onChange={(y1) => patch(idx, { y1 } as Partial<FNEl>)}
            />
          </div>,
          <div className="prop-row" key="x2y2">
            <NumField
              label="x2"
              value={el.x2}
              onChange={(x2) => patch(idx, { x2 } as Partial<FNEl>)}
            />
            <NumField
              label="y2"
              value={el.y2}
              onChange={(y2) => patch(idx, { y2 } as Partial<FNEl>)}
            />
          </div>,
        )
      }
      if (
        el.kind === 'HeartRateNum' ||
        el.kind === 'StepsNum' ||
        el.kind === 'KCalNum'
      ) {
        rest.push(
          <NumField
            key="digitSet"
            label="digit_set"
            value={el.digitSet}
            onChange={(digitSet) => patch(idx, { digitSet } as Partial<FNEl>)}
            min={0}
          />,
          <SelectField
            key="align"
            label="align"
            value={alignToNum(el.align)}
            options={alignOptions}
            onChange={(n) => patch(idx, { align: numToAlign(n) } as Partial<FNEl>)}
          />,
        )
      }
      if (el.kind === 'BarDisplay') {
        rest.push(
          <SelectField
            key="btype"
            label="b_type"
            value={el.bType}
            options={[
              { value: 0, label: '0 — Steps' },
              { value: 2, label: '2 — KCal' },
              { value: 5, label: '5 — HeartRate' },
              { value: 6, label: '6 — Battery' },
            ]}
            onChange={(bType) => patch(idx, { bType } as Partial<FNEl>)}
          />,
          <NumField
            key="count"
            label="count"
            value={el.count}
            onChange={() => {}}
            disabled
          />,
        )
      }
      if (el.kind === 'Weather') {
        rest.push(
          <NumField
            key="count"
            label="count"
            value={el.count}
            onChange={() => {}}
            disabled
          />,
        )
      }
      return (
        <>
          {xField}
          {rest}
        </>
      )
    }
    case 'TimeNum':
      return (
        <p className="hint">
          TimeNum has 4 digit slots (HH:MM). Per-slot positioning + digit-set
          binding lands with the font generator (Phase 3).
        </p>
      )
    case 'DayNum':
    case 'MonthNum':
      return (
        <>
          <NumField
            label="digit_set"
            value={el.digitSet}
            onChange={(digitSet) => patch(idx, { digitSet } as Partial<FNEl>)}
            min={0}
          />
          <SelectField
            label="align"
            value={alignToNum(el.align)}
            options={alignOptions}
            onChange={(n) =>
              patch(idx, { align: numToAlign(n) } as Partial<FNEl>)
            }
          />
        </>
      )
    case 'Dash':
      return (
        <p className="hint">Dash holds a single image; edit it under Assets.</p>
      )
    case 'Unknown29':
    case 'Unknown':
      return <p className="hint">Read-only kind.</p>
  }
}

function TypeCFields({ idx }: { idx: number }) {
  const project = useEditor((s) => s.project)
  const setLayerPosition = useEditor((s) => s.setLayerPosition)
  const patch = useEditor((s) => s.patchFaceData)
  if (!project || project.format !== 'typeC') return null
  const fd = project.header.faceData[idx]
  if (!fd) return null
  return (
    <>
      <div className="prop-row">
        <NumField
          label="x"
          value={fd.x}
          onChange={(x) => setLayerPosition(idx, x, fd.y)}
          min={-SCREEN_W}
          max={SCREEN_W * 2}
        />
        <NumField
          label="y"
          value={fd.y}
          onChange={(y) => setLayerPosition(idx, fd.x, y)}
          min={-SCREEN_H}
          max={SCREEN_H * 2}
        />
      </div>
      <div className="prop-row">
        <NumField label="w" value={fd.w} onChange={() => {}} disabled />
        <NumField label="h" value={fd.h} onChange={() => {}} disabled />
      </div>
      <NumField
        label="idx (start blob)"
        value={fd.idx}
        onChange={(blobIdx) => patch(idx, { idx: blobIdx })}
        min={0}
      />
      <p className="hint">
        w/h reflect the bound BMP. Replace a BMP under Assets to change them.
      </p>
    </>
  )
}

function PropertyPanel() {
  const project = useEditor((s) => s.project)
  const selectedIdx = useEditor((s) => s.selectedIdx)
  const setFaceNumber = useEditor((s) => s.setFaceNumber)

  const layers = useMemo(() => (project ? listLayers(project) : []), [project])
  const layer = selectedIdx !== null ? layers[selectedIdx] : undefined

  return (
    <aside className="editor-pane editor-props">
      <div className="editor-pane-scroll">
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

      {layer && project && (
        <>
          <h3>Layer</h3>
          <p className="prop-meta" title={layer.name}>
            {layer.name}
          </p>
          {project.format === 'typeC' ? (
            <TypeCFields idx={layer.index} />
          ) : (
            <FaceNFields
              idx={layer.index}
              el={project.face.elements[layer.index]}
            />
          )}

          <h3>Assets</h3>
          <AssetSection layerIdx={layer.index} />
        </>
      )}
      </div>
    </aside>
  )
}

export default PropertyPanel
