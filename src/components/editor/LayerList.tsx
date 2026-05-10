import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Image,
  Trash2,
  Type,
  Watch,
} from 'lucide-react'
import { useEditor } from '../../store/editorStore'
import type { FaceElement } from '../../types/face'

const ICONS: Record<FaceElement['kind'], typeof Type> = {
  background: Image,
  time: Watch,
  text: Type,
}

function LayerList() {
  const elements = useEditor((s) => s.project.elements)
  const selectedId = useEditor((s) => s.selectedId)
  const select = useEditor((s) => s.select)
  const addElement = useEditor((s) => s.addElement)
  const deleteElement = useEditor((s) => s.deleteElement)
  const toggleVisible = useEditor((s) => s.toggleVisible)
  const moveLayer = useEditor((s) => s.moveLayer)

  // render top-of-stack first (visually most on top at the top of the list)
  const ordered = [...elements].reverse()

  return (
    <aside className="editor-pane editor-layers">
      <h3>Layers</h3>
      <ul className="layer-list">
        {ordered.map((el) => {
          const Icon = ICONS[el.kind]
          const isSelected = el.id === selectedId
          return (
            <li
              key={el.id}
              className={`layer-row ${isSelected ? 'selected' : ''}`}
              onClick={() => select(el.id)}
            >
              <Icon size={14} aria-hidden />
              <span className="layer-name">{el.name}</span>
              <button
                type="button"
                className="icon-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleVisible(el.id)
                }}
                aria-label={el.visible ? 'Hide layer' : 'Show layer'}
              >
                {el.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  moveLayer(el.id, 'up')
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
                  moveLayer(el.id, 'down')
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
                  deleteElement(el.id)
                }}
                aria-label="Delete layer"
              >
                <Trash2 size={14} />
              </button>
            </li>
          )
        })}
      </ul>

      <h3 className="layer-add-title">Add</h3>
      <div className="layer-add">
        <button
          type="button"
          className="counter ghost"
          onClick={() => addElement('background')}
        >
          <Image size={14} aria-hidden />
          Background
        </button>
        <button
          type="button"
          className="counter ghost"
          onClick={() => addElement('time')}
        >
          <Watch size={14} aria-hidden />
          Time
        </button>
        <button
          type="button"
          className="counter ghost"
          onClick={() => addElement('text')}
        >
          <Type size={14} aria-hidden />
          Text
        </button>
      </div>
    </aside>
  )
}

export default LayerList
