import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Binary,
  Bluetooth,
  Download,
  Eye,
  EyeOff,
  FilePlus2,
  FolderOpen,
  Magnet,
  Minus,
  Package,
  Redo2,
  Undo2,
  X,
} from "lucide-react";
import EditorCanvas from "../components/editor/EditorCanvas";
import LayerList from "../components/editor/LayerList";
import Popover from "../components/Popover";
import PropertyPanel from "../components/editor/PropertyPanel";
import Tooltip from "../components/Tooltip";
import UploadDialog from "../components/editor/UploadDialog";
import { useEditor } from "../store/editorStore";
import {
  downloadBlob,
  exportBin,
  exportZip,
  importBin,
  importZip,
} from "../lib/projectIO";
import {
  classifyFaceSize,
  faceSizeHint,
  faceSizeWarnSummary,
  formatFaceSize,
} from "../lib/faceSize";
import type { EditorProject, WatchFormat } from "../types/face";

const baseName = (
  project: ReturnType<typeof useEditor.getState>["project"],
): string => {
  if (!project) return "face";
  if (project.fileName) {
    return project.fileName.replace(/\.(bin|zip)$/i, "") || "face";
  }
  if (project.format === "typeC") return `face-${project.faceNumber}`;
  return "face";
};

function Editor() {
  const project = useEditor((s) => s.project);
  const error = useEditor((s) => s.error);
  const newProject = useEditor((s) => s.newProject);
  const setProject = useEditor((s) => s.setProject);
  const setError = useEditor((s) => s.setError);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.history.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const guidesVisible = useEditor((s) => s.guidesVisible);
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const setGuidesVisible = useEditor((s) => s.setGuidesVisible);
  const setSnapEnabled = useEditor((s) => s.setSnapEnabled);
  const addGuideAction = useEditor((s) => s.addGuideAction);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const newBtnRef = useRef<HTMLButtonElement>(null);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [importing, setImporting] = useState(false);
  const [uploadBytes, setUploadBytes] = useState<Uint8Array | null>(null);

  const deleteSelectedGuides = useEditor((s) => s.deleteSelectedGuides);

  // Global Cmd/Ctrl-Z (and Shift-variant / Ctrl-Y) — wired at the page
  // level so the shortcut fires even when focus is on the canvas. We bail
  // out when the user is typing in a text field so native input undo still
  // works inside name/number fields. Backspace/Delete deletes selected
  // guides for parity with the layer-delete affordance.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField =
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        (t && t.isContentEditable);
      if (inField) return;
      const k = e.key.toLowerCase();
      if (e.metaKey || e.ctrlKey) {
        if (k === "z" && e.shiftKey) {
          e.preventDefault();
          redo();
        } else if (k === "z") {
          e.preventDefault();
          undo();
        } else if (k === "y") {
          e.preventDefault();
          redo();
        }
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        const { selectedGuideIds } = useEditor.getState();
        if (selectedGuideIds.length > 0) {
          e.preventDefault();
          deleteSelectedGuides();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [undo, redo, deleteSelectedGuides]);

  // Live projected .bin size for the editor header chip. The pack runs on
  // every project mutation, so we defer the computation — during a drag,
  // React keeps the previous size visible until the user lets go.
  const deferredProject = useDeferredValue(project);
  const projectedSize = useMemo(() => {
    if (!deferredProject) return null;
    try {
      return exportBin(deferredProject).byteLength;
    } catch {
      return null;
    }
  }, [deferredProject]);

  const onNew = (format: WatchFormat) => {
    setShowNewMenu(false);
    newProject(format);
  };

  const onImportClick = () => fileInputRef.current?.click();

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const isBin = /\.bin$/i.test(file.name);
      const isZip = /\.zip$/i.test(file.name);
      let imported: EditorProject;
      if (isBin) imported = await importBin(file);
      else if (isZip) imported = await importZip(file);
      else throw new Error("Pick a .bin or .zip file.");
      setProject(imported);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const onExportBin = () => {
    if (!project) return;
    try {
      const bytes = exportBin(project);
      if (classifyFaceSize(bytes.byteLength) === "danger") {
        const ok = window.confirm(
          `${faceSizeWarnSummary(bytes.byteLength)}\n\nExport anyway?`,
        );
        if (!ok) return;
      }
      downloadBlob(bytes, `${baseName(project)}.bin`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onSendToWatch = () => {
    if (!project) return;
    try {
      const bytes = exportBin(project);
      setUploadBytes(bytes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onExportZip = async () => {
    if (!project) return;
    try {
      const blob = await exportZip(project);
      downloadBlob(blob, `${baseName(project)}.zip`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="editor">
      <header className="editor-header">
        <div>
          <h1>Editor</h1>
          {project && (
            <span className="editor-subtitle">
              <span className="format-badge">
                {project.format === "typeC" ? "Type C" : "FaceN"}
              </span>
              {projectedSize !== null && (
                <Tooltip content={faceSizeHint(projectedSize)}>
                  <span
                    className={`face-size-chip face-size-${classifyFaceSize(projectedSize)}`}
                  >
                    {formatFaceSize(projectedSize)}
                  </span>
                </Tooltip>
              )}
              {project.fileName ? ` · ${project.fileName}` : " · untitled"}
            </span>
          )}
        </div>
        <div className="editor-toolbar">
          <div
            className="editor-undo-group"
            role="group"
            aria-label="Undo / redo"
          >
            <Tooltip content={"Undo\nCmd/Ctrl+Z"}>
              <button
                type="button"
                className="counter ghost"
                onClick={undo}
                disabled={!canUndo}
                aria-label="Undo"
              >
                <Undo2 size={14} aria-hidden />
              </button>
            </Tooltip>
            <Tooltip content={"Redo\nCmd/Ctrl+Shift+Z"}>
              <button
                type="button"
                className="counter ghost"
                onClick={redo}
                disabled={!canRedo}
                aria-label="Redo"
              >
                <Redo2 size={14} aria-hidden />
              </button>
            </Tooltip>
          </div>
          <div
            className="editor-undo-group"
            role="group"
            aria-label="Guides and snapping"
          >
            <Tooltip content="Add horizontal guide at y = 120">
              <button
                type="button"
                className="counter ghost"
                onClick={() => addGuideAction("H", 120)}
                disabled={!project}
                aria-label="Add horizontal guide"
              >
                <Minus size={14} aria-hidden />
              </button>
            </Tooltip>
            <Tooltip content="Add vertical guide at x = 120">
              <button
                type="button"
                className="counter ghost"
                onClick={() => addGuideAction("V", 120)}
                disabled={!project}
                aria-label="Add vertical guide"
              >
                <Minus
                  size={14}
                  aria-hidden
                  style={{ transform: "rotate(90deg)" }}
                />
              </button>
            </Tooltip>
            <Tooltip
              content={
                guidesVisible
                  ? "Hide all guides on the canvas"
                  : "Show all guides on the canvas"
              }
            >
              <button
                type="button"
                className={`counter ghost${guidesVisible ? " active" : ""}`}
                onClick={() => setGuidesVisible(!guidesVisible)}
                disabled={!project}
                aria-pressed={guidesVisible}
                aria-label={
                  guidesVisible ? "Hide guides" : "Show guides"
                }
              >
                {guidesVisible ? (
                  <Eye size={14} aria-hidden />
                ) : (
                  <EyeOff size={14} aria-hidden />
                )}
              </button>
            </Tooltip>
            <Tooltip
              content={
                snapEnabled
                  ? "Disable snapping while dragging"
                  : "Enable snapping while dragging"
              }
            >
              <button
                type="button"
                className={`counter ghost${snapEnabled ? " active" : ""}`}
                onClick={() => setSnapEnabled(!snapEnabled)}
                aria-pressed={snapEnabled}
                aria-label={snapEnabled ? "Disable snapping" : "Enable snapping"}
              >
                <Magnet size={14} aria-hidden />
              </button>
            </Tooltip>
          </div>
          <button
            ref={newBtnRef}
            type="button"
            className="counter ghost"
            onClick={() => setShowNewMenu((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={showNewMenu}
          >
            <FilePlus2 size={14} aria-hidden />
            New
          </button>
          {showNewMenu && (
            <Popover
              anchorRef={newBtnRef}
              onClose={() => setShowNewMenu(false)}
              placement="bottom-start"
              role="menu"
              ariaLabel="New project format"
            >
              <div className="editor-new-menu" role="presentation">
                <button type="button" onClick={() => onNew("typeC")}>
                  Type C
                </button>
                <button type="button" disabled onClick={() => onNew("faceN")}>
                  FaceN (coming soon)
                </button>
              </div>
            </Popover>
          )}
          <button
            type="button"
            className="counter ghost"
            onClick={onImportClick}
            disabled={importing}
          >
            <FolderOpen size={14} aria-hidden />
            {importing ? "Importing…" : "Import"}
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
          <Tooltip content="Pair watch over Bluetooth and flash this face directly">
            <button
              type="button"
              className="counter"
              onClick={onSendToWatch}
              disabled={!project}
            >
              <Bluetooth size={14} aria-hidden />
              Send to watch
            </button>
          </Tooltip>
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
          <Tooltip content="Dismiss">
            <button
              type="button"
              className="banner-dismiss"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              <X size={16} aria-hidden />
            </button>
          </Tooltip>
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

      {uploadBytes && (
        <UploadDialog
          onClose={() => setUploadBytes(null)}
          bytes={uploadBytes}
          filename={project ? `${baseName(project)}.bin` : 'face.bin'}
        />
      )}
    </section>
  );
}

export default Editor;
