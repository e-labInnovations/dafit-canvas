import { useRef } from 'react'
import { Download, FilePlus2, FolderOpen } from 'lucide-react'
import EditorCanvas from '../components/editor/EditorCanvas'
import LayerList from '../components/editor/LayerList'
import PropertyPanel from '../components/editor/PropertyPanel'
import { useEditor } from '../store/editorStore'
import {
  PROJECT_VERSION,
  type FaceProject,
} from '../types/face'

const isFaceProject = (val: unknown): val is FaceProject => {
  if (!val || typeof val !== 'object') return false
  const v = val as Record<string, unknown>
  return (
    v.version === PROJECT_VERSION &&
    typeof v.faceNumber === 'number' &&
    Array.isArray(v.elements)
  )
}

function Editor() {
  const project = useEditor((s) => s.project)
  const loadProject = useEditor((s) => s.loadProject)
  const resetProject = useEditor((s) => s.resetProject)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const onSave = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `face-${project.faceNumber}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const onLoadClick = () => fileInputRef.current?.click()

  const onLoadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const parsed: unknown = JSON.parse(text)
      if (!isFaceProject(parsed)) {
        alert('Not a valid face project file.')
        return
      }
      loadProject(parsed)
    } catch (err) {
      alert(`Failed to load: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      e.target.value = ''
    }
  }

  return (
    <section className="editor">
      <header className="editor-header">
        <h1>Editor</h1>
        <div className="editor-toolbar">
          <button type="button" className="counter ghost" onClick={resetProject}>
            <FilePlus2 size={14} aria-hidden />
            New
          </button>
          <button type="button" className="counter ghost" onClick={onLoadClick}>
            <FolderOpen size={14} aria-hidden />
            Load
          </button>
          <button type="button" className="counter" onClick={onSave}>
            <Download size={14} aria-hidden />
            Save JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={onLoadFile}
          />
        </div>
      </header>

      <div className="editor-grid">
        <LayerList />
        <div className="editor-stage">
          <EditorCanvas />
        </div>
        <PropertyPanel />
      </div>
    </section>
  )
}

export default Editor
