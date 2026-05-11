import { useRef, useState } from 'react'
import {
  AlertTriangle,
  Binary,
  Download,
  FilePlus2,
  FolderOpen,
  Package,
} from 'lucide-react'
import EditorCanvas from '../components/editor/EditorCanvas'
import LayerList from '../components/editor/LayerList'
import PropertyPanel from '../components/editor/PropertyPanel'
import { useEditor } from '../store/editorStore'
import {
  downloadBlob,
  exportBin,
  exportZip,
  importBin,
  importZip,
} from '../lib/projectIO'
import type { EditorProject, WatchFormat } from '../types/face'

const baseName = (project: ReturnType<typeof useEditor.getState>['project']): string => {
  if (!project) return 'face'
  if (project.fileName) {
    return project.fileName.replace(/\.(bin|zip)$/i, '') || 'face'
  }
  if (project.format === 'typeC') return `face-${project.header.faceNumber}`
  return 'face'
}

function Editor() {
  const project = useEditor((s) => s.project)
  const error = useEditor((s) => s.error)
  const newProject = useEditor((s) => s.newProject)
  const setProject = useEditor((s) => s.setProject)
  const setError = useEditor((s) => s.setError)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showNewMenu, setShowNewMenu] = useState(false)
  const [importing, setImporting] = useState(false)

  const onNew = (format: WatchFormat) => {
    setShowNewMenu(false)
    newProject(format)
  }

  const onImportClick = () => fileInputRef.current?.click()

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    setError(null)
    try {
      const isBin = /\.bin$/i.test(file.name)
      const isZip = /\.zip$/i.test(file.name)
      let imported: EditorProject
      if (isBin) imported = await importBin(file)
      else if (isZip) imported = await importZip(file)
      else throw new Error('Pick a .bin or .zip file.')
      setProject(imported)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  const onExportBin = () => {
    if (!project) return
    try {
      const bytes = exportBin(project)
      downloadBlob(bytes, `${baseName(project)}.bin`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const onExportZip = async () => {
    if (!project) return
    try {
      const blob = await exportZip(project)
      downloadBlob(blob, `${baseName(project)}.zip`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="editor">
      <header className="editor-header">
        <div>
          <h1>Editor</h1>
          {project && (
            <span className="editor-subtitle">
              <span className="format-badge">
                {project.format === 'typeC' ? 'Type C' : 'FaceN'}
              </span>
              {project.fileName ? ` · ${project.fileName}` : ' · untitled'}
            </span>
          )}
        </div>
        <div className="editor-toolbar">
          <div className="editor-new-wrap">
            <button
              type="button"
              className="counter ghost"
              onClick={() => setShowNewMenu((v) => !v)}
            >
              <FilePlus2 size={14} aria-hidden />
              New
            </button>
            {showNewMenu && (
              <div className="editor-new-menu" role="menu">
                <button type="button" onClick={() => onNew('typeC')}>
                  Type C (dawft)
                </button>
                <button type="button" onClick={() => onNew('faceN')}>
                  FaceN (extrathundertool)
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className="counter ghost"
            onClick={onImportClick}
            disabled={importing}
          >
            <FolderOpen size={14} aria-hidden />
            {importing ? 'Importing…' : 'Import'}
          </button>
          <button
            type="button"
            className="counter ghost"
            onClick={onExportZip}
            disabled={!project}
          >
            <Package size={14} aria-hidden />
            Export ZIP
          </button>
          <button
            type="button"
            className="counter"
            onClick={onExportBin}
            disabled={!project}
          >
            <Download size={14} aria-hidden />
            Export BIN
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".bin,.zip,application/zip,application/octet-stream"
            hidden
            onChange={onImportFile}
          />
        </div>
      </header>

      {error && (
        <div className="banner banner-error">
          <AlertTriangle size={18} aria-hidden />
          <div>
            <strong>Editor:</strong> {error}
          </div>
        </div>
      )}

      {!project ? (
        <div className="editor-empty">
          <Binary size={48} aria-hidden />
          <h2>No face loaded</h2>
          <p className="hint">
            Start from scratch via <strong>New</strong> (pick Type C or FaceN),
            or import an existing <code>.bin</code> / <code>.zip</code>.
          </p>
        </div>
      ) : (
        <div className="editor-grid">
          <LayerList />
          <div className="editor-stage">
            <EditorCanvas />
          </div>
          <PropertyPanel />
        </div>
      )}
    </section>
  )
}

export default Editor
