import { ChevronDown, ChevronUp, Layers, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { useEditor } from '../../store/editorStore'
import { listLayers } from '../../lib/projectIO'

function LayerList() {
  const project = useEditor((s) => s.project)
  const selectedIdx = useEditor((s) => s.selectedIdx)
  const select = useEditor((s) => s.select)
  const reorder = useEditor((s) => s.reorderLayer)
  const remove = useEditor((s) => s.deleteLayer)

  const layers = useMemo(() => (project ? listLayers(project) : []), [project])

  return (
    <aside className="editor-pane editor-layers">
      <h3>Layers</h3>
      {layers.length === 0 ? (
        <p className="hint">
          No layers yet. Import a face or, in a later update, insert an element
          from the toolbar.
        </p>
      ) : (
        <ul className="layer-list">
          {[...layers].reverse().map((l) => {
            const isSelected = l.index === selectedIdx
            return (
              <li
                key={l.index}
                className={`layer-row ${isSelected ? 'selected' : ''}`}
                onClick={() => select(l.index)}
              >
                <Layers size={14} aria-hidden />
                <span className="layer-name" title={l.name}>
                  {l.name}
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    reorder(l.index, 'up')
                  }}
                  aria-label="Bring forward"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    reorder(l.index, 'down')
                  }}
                  aria-label="Send backward"
                >
                  <ChevronDown size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn danger"
                  onClick={(e) => {
                    e.stopPropagation()
                    remove(l.index)
                  }}
                  aria-label="Delete layer"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}

export default LayerList
