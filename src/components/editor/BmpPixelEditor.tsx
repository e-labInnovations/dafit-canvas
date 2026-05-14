import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  Eraser,
  Grid3x3,
  PaintBucket,
  Pencil,
  Pipette,
  Redo2,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import Tooltip from '../Tooltip'

type Tool = 'pencil' | 'eraser' | 'bucket' | 'eye'

type Props = {
  /** Initial RGBA buffer (top-down, premultiplied by Canvas conventions —
   *  same shape `replaceAssetAction` consumes). `null` seeds a transparent
   *  canvas at width × height. */
  rgba: Uint8ClampedArray | null
  width: number
  height: number
  /** Displayed in the editor's title bar. */
  name: string
  /** Called with the edited RGBA + dimensions when the user clicks Save. */
  onSave: (rgba: Uint8ClampedArray, width: number, height: number) => void
  onClose: () => void
}

/** Eight starter swatches — black, white, two greys, plus pure-ish primaries.
 *  Watch faces tend to live in this palette plus the user's accent picks. */
const PRESETS = [
  '#000000',
  '#ffffff',
  '#808080',
  '#c0c0c0',
  '#ff3b30',
  '#ff9500',
  '#ffcc00',
  '#34c759',
  '#00c7be',
  '#5ac8fa',
  '#007aff',
  '#af52de',
  '#ff2d92',
  '#a2845e',
] as const

const HISTORY_LIMIT = 50
const MIN_ZOOM = 1
const MAX_ZOOM = 40

const seedPixels = (
  src: Uint8ClampedArray | null,
  w: number,
  h: number,
): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(w * h * 4)
  if (src && src.length === out.length) out.set(src)
  return out
}

/** Initial zoom — scale so the image lands around 480px on its longest
 *  side, but never go below 1× or above the hard cap. */
const initialZoom = (w: number, h: number): number => {
  if (w === 0 || h === 0) return 16
  const fit = Math.floor(Math.min(480 / w, 480 / h))
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fit || 1))
}

const parseHex = (hex: string): [number, number, number] => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return [0, 0, 0]
  const v = parseInt(m[1], 16)
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
}

const toHex = (r: number, g: number, b: number): string =>
  '#' +
  [r, g, b]
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')

function BmpPixelEditor({
  rgba,
  width,
  height,
  name,
  onSave,
  onClose,
}: Props) {
  // The current image buffer lives in a ref + a render-tick counter so we
  // can mutate in place during a stroke (one allocation per *stroke*, not
  // per pixel). React re-renders / the canvas effect re-runs whenever the
  // tick bumps.
  const pixelsRef = useRef<Uint8ClampedArray>(seedPixels(rgba, width, height))
  const [, setTick] = useState(0)
  const repaint = () => setTick((t) => t + 1)

  const [tool, setTool] = useState<Tool>('pencil')
  const [color, setColor] = useState<string>('#ffffff')
  const [zoom, setZoom] = useState<number>(() => initialZoom(width, height))
  const [showGrid, setShowGrid] = useState<boolean>(true)

  // In-editor undo stacks — separate from the project-level undo. State
  // (not refs) so React re-renders disable Undo/Redo buttons in lockstep.
  // The byte buffers inside each entry are immutable snapshots.
  const [undoStack, setUndoStack] = useState<Uint8ClampedArray[]>([])
  const [redoStack, setRedoStack] = useState<Uint8ClampedArray[]>([])
  const canUndo = undoStack.length > 0
  const canRedo = redoStack.length > 0

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gridRef = useRef<HTMLCanvasElement>(null)
  const pointerRef = useRef<{
    isDown: boolean
    lastX: number
    lastY: number
    activeTool: Tool
  }>({ isDown: false, lastX: -1, lastY: -1, activeTool: 'pencil' })

  /** Snapshot the current buffer onto the undo stack and reset redo. */
  const pushUndo = () => {
    setUndoStack((s) => {
      const next = s.length >= HISTORY_LIMIT ? s.slice(1) : s.slice()
      next.push(new Uint8ClampedArray(pixelsRef.current))
      return next
    })
    setRedoStack([])
  }

  const doUndo = () => {
    setUndoStack((s) => {
      if (s.length === 0) return s
      const prev = s[s.length - 1]
      setRedoStack((r) => [...r, new Uint8ClampedArray(pixelsRef.current)])
      pixelsRef.current = prev
      repaint()
      return s.slice(0, -1)
    })
  }

  const doRedo = () => {
    setRedoStack((s) => {
      if (s.length === 0) return s
      const next = s[s.length - 1]
      setUndoStack((u) => [...u, new Uint8ClampedArray(pixelsRef.current)])
      pixelsRef.current = next
      repaint()
      return s.slice(0, -1)
    })
  }

  // Esc to close, body scroll lock, Cmd/Ctrl-Z stack handlers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) doRedo()
        else doUndo()
      }
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
    // doUndo / doRedo use functional setState + refs internally, so the
    // closure capturing the first-render instances stays correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose])

  // Render the pixel buffer to the canvas at 1:1 — CSS scales it up for
  // display via the rendered width/height. Re-runs on every paint via the
  // dependency on `pixelsRef`'s tick.
  useLayoutEffect(() => {
    const c = canvasRef.current
    if (!c) return
    c.width = width
    c.height = height
    const ctx = c.getContext('2d')
    if (!ctx) return
    const img = ctx.createImageData(width, height)
    img.data.set(pixelsRef.current)
    ctx.putImageData(img, 0, 0)
  })

  // Pixel grid overlay — only drawn when there's enough room per cell
  // (>=8 CSS px) so it doesn't add noise on small zooms.
  useLayoutEffect(() => {
    const c = gridRef.current
    if (!c) return
    const cw = width * zoom
    const ch = height * zoom
    c.width = cw
    c.height = ch
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, cw, ch)
    if (!showGrid || zoom < 8) return
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 0; x <= width; x++) {
      ctx.moveTo(x * zoom + 0.5, 0)
      ctx.lineTo(x * zoom + 0.5, ch)
    }
    for (let y = 0; y <= height; y++) {
      ctx.moveTo(0, y * zoom + 0.5)
      ctx.lineTo(cw, y * zoom + 0.5)
    }
    ctx.stroke()
  }, [width, height, zoom, showGrid])

  /** Translate a pointer event's client coords into pixel coords inside
   *  the image. The canvas's `getBoundingClientRect` reflects its CSS-
   *  scaled size, so we map proportionally. */
  const clientToPixel = (
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | null => {
    const c = canvasRef.current
    if (!c) return null
    const rect = c.getBoundingClientRect()
    const x = Math.floor(((clientX - rect.left) * width) / rect.width)
    const y = Math.floor(((clientY - rect.top) * height) / rect.height)
    if (x < 0 || x >= width || y < 0 || y >= height) return null
    return { x, y }
  }

  /** Set or clear a single pixel without bookkeeping — used by stroke
   *  helpers below. Doesn't trigger a render on its own; caller calls
   *  `repaint()` after a batch. */
  const writePixel = (x: number, y: number, t: Tool, hex: string) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return
    const i = (y * width + x) * 4
    const buf = pixelsRef.current
    if (t === 'eraser') {
      buf[i + 3] = 0
      return
    }
    const [r, g, b] = parseHex(hex)
    buf[i] = r
    buf[i + 1] = g
    buf[i + 2] = b
    buf[i + 3] = 255
  }

  /** Bresenham line — keeps pencil/eraser strokes continuous even when
   *  pointermove samples skip pixels (which happens whenever the user
   *  moves faster than one cell per event). */
  const writeLine = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    t: Tool,
    hex: string,
  ) => {
    let x = x0
    let y = y0
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    for (;;) {
      writePixel(x, y, t, hex)
      if (x === x1 && y === y1) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x += sx
      }
      if (e2 <= dx) {
        err += dx
        y += sy
      }
    }
  }

  /** Flood-fill from (x,y) replacing every connected pixel that matches
   *  the seed's RGBA. Iterative — recursion blows the stack on 240×240. */
  const floodFill = (sx: number, sy: number, hex: string) => {
    const buf = pixelsRef.current
    const idx = (x: number, y: number) => (y * width + x) * 4
    const seedI = idx(sx, sy)
    const target = [buf[seedI], buf[seedI + 1], buf[seedI + 2], buf[seedI + 3]]
    const [r, g, b] = parseHex(hex)
    if (
      target[0] === r &&
      target[1] === g &&
      target[2] === b &&
      target[3] === 255
    ) {
      return
    }
    const visited = new Uint8Array(width * height)
    const stack: [number, number][] = [[sx, sy]]
    while (stack.length) {
      const [x, y] = stack.pop()!
      if (x < 0 || x >= width || y < 0 || y >= height) continue
      if (visited[y * width + x]) continue
      visited[y * width + x] = 1
      const i = idx(x, y)
      if (
        buf[i] !== target[0] ||
        buf[i + 1] !== target[1] ||
        buf[i + 2] !== target[2] ||
        buf[i + 3] !== target[3]
      ) {
        continue
      }
      buf[i] = r
      buf[i + 1] = g
      buf[i + 2] = b
      buf[i + 3] = 255
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
    }
  }

  const pickAt = (x: number, y: number) => {
    const i = (y * width + x) * 4
    const buf = pixelsRef.current
    if (buf[i + 3] === 0) return // skip transparent pixels — nothing to pick
    setColor(toHex(buf[i], buf[i + 1], buf[i + 2]))
    setTool('pencil')
  }

  const clearAll = () => {
    if (
      !window.confirm(
        'Clear all pixels? You can still undo with Cmd/Ctrl+Z afterward.',
      )
    ) {
      return
    }
    pushUndo()
    pixelsRef.current = new Uint8ClampedArray(width * height * 4)
    repaint()
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    const px = clientToPixel(e.clientX, e.clientY)
    if (!px) return
    pushUndo()
    pointerRef.current.activeTool = tool
    if (tool === 'eye') {
      pickAt(px.x, px.y)
      repaint()
      return
    }
    if (tool === 'bucket') {
      floodFill(px.x, px.y, color)
      repaint()
      return
    }
    // Pencil / Eraser: start a stroke.
    writePixel(px.x, px.y, tool, color)
    pointerRef.current.isDown = true
    pointerRef.current.lastX = px.x
    pointerRef.current.lastY = px.y
    repaint()
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointerRef.current.isDown) return
    const t = pointerRef.current.activeTool
    if (t !== 'pencil' && t !== 'eraser') return
    const px = clientToPixel(e.clientX, e.clientY)
    if (!px) return
    if (px.x === pointerRef.current.lastX && px.y === pointerRef.current.lastY) {
      return
    }
    writeLine(
      pointerRef.current.lastX,
      pointerRef.current.lastY,
      px.x,
      px.y,
      t,
      color,
    )
    pointerRef.current.lastX = px.x
    pointerRef.current.lastY = px.y
    repaint()
  }

  const endStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointerRef.current.isDown) return
    pointerRef.current.isDown = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const doSave = () => {
    onSave(new Uint8ClampedArray(pixelsRef.current), width, height)
  }

  const zoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, z + (z < 8 ? 1 : 2)))
  const zoomOut = () =>
    setZoom((z) => Math.max(MIN_ZOOM, z - (z <= 8 ? 1 : 2)))

  const cursorClass = useMemo(() => {
    switch (tool) {
      case 'pencil':
        return 'cursor-pencil'
      case 'eraser':
        return 'cursor-eraser'
      case 'bucket':
        return 'cursor-bucket'
      case 'eye':
        return 'cursor-eye'
    }
  }, [tool])

  const renderedW = width * zoom
  const renderedH = height * zoom

  return createPortal(
    <div className="pixel-editor-wrap">
      <header className="pixel-editor-head">
        <Tooltip content={name} placement="bottom">
          <h2>{name}</h2>
        </Tooltip>
        <span className="pixel-editor-dims">
          {width}×{height}
        </span>
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Close editor"
        >
          <X size={20} />
        </button>
      </header>

      <div className="pixel-editor-body">
        <aside className="pixel-editor-tools" aria-label="Tools">
          <Tooltip content="Pencil (P)" placement="right">
            <button
              type="button"
              className={`pixel-tool${tool === 'pencil' ? ' active' : ''}`}
              onClick={() => setTool('pencil')}
            >
              <Pencil size={16} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip content="Eraser (E)" placement="right">
            <button
              type="button"
              className={`pixel-tool${tool === 'eraser' ? ' active' : ''}`}
              onClick={() => setTool('eraser')}
            >
              <Eraser size={16} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip content="Bucket fill (B)" placement="right">
            <button
              type="button"
              className={`pixel-tool${tool === 'bucket' ? ' active' : ''}`}
              onClick={() => setTool('bucket')}
            >
              <PaintBucket size={16} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip content="Eyedropper (I)" placement="right">
            <button
              type="button"
              className={`pixel-tool${tool === 'eye' ? ' active' : ''}`}
              onClick={() => setTool('eye')}
            >
              <Pipette size={16} aria-hidden />
            </button>
          </Tooltip>

          <span className="pixel-tool-sep" aria-hidden />

          <Tooltip content={"Undo\nCmd/Ctrl+Z"} placement="right">
            <button
              type="button"
              className="pixel-tool"
              onClick={doUndo}
              disabled={!canUndo}
            >
              <Undo2 size={16} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip content={"Redo\nCmd/Ctrl+Shift+Z"} placement="right">
            <button
              type="button"
              className="pixel-tool"
              onClick={doRedo}
              disabled={!canRedo}
            >
              <Redo2 size={16} aria-hidden />
            </button>
          </Tooltip>

          <span className="pixel-tool-sep" aria-hidden />

          <Tooltip content="Clear all" placement="right">
            <button
              type="button"
              className="pixel-tool"
              onClick={clearAll}
            >
              <Trash2 size={16} aria-hidden />
            </button>
          </Tooltip>
        </aside>

        <div className="pixel-editor-canvas">
          <div
            className="pixel-canvas-viewport"
            style={{ '--checker': '10px' } as React.CSSProperties}
          >
            <div
              className={`pixel-canvas-stack ${cursorClass}`}
              style={{ width: renderedW, height: renderedH }}
            >
              <canvas
                ref={canvasRef}
                className="pixel-canvas-image"
                width={width}
                height={height}
                style={{ width: renderedW, height: renderedH }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endStroke}
                onPointerCancel={endStroke}
              />
              <canvas
                ref={gridRef}
                className="pixel-canvas-grid"
                aria-hidden
              />
            </div>
          </div>

          <div className="pixel-canvas-footer">
            <div className="pixel-zoom" role="group" aria-label="Zoom">
              <Tooltip content="Zoom out">
                <button
                  type="button"
                  className="pixel-tool"
                  onClick={zoomOut}
                  disabled={zoom <= MIN_ZOOM}
                >
                  <ZoomOut size={14} aria-hidden />
                </button>
              </Tooltip>
              <span className="pixel-zoom-label">{zoom}×</span>
              <Tooltip content="Zoom in">
                <button
                  type="button"
                  className="pixel-tool"
                  onClick={zoomIn}
                  disabled={zoom >= MAX_ZOOM}
                >
                  <ZoomIn size={14} aria-hidden />
                </button>
              </Tooltip>
              <Tooltip content="Toggle grid">
                <button
                  type="button"
                  className={`pixel-tool${showGrid ? ' active' : ''}`}
                  onClick={() => setShowGrid((v) => !v)}
                  disabled={zoom < 8}
                >
                  <Grid3x3 size={14} aria-hidden />
                </button>
              </Tooltip>
            </div>
          </div>
        </div>

        <aside className="pixel-editor-colors" aria-label="Colors">
          <label className="pixel-color-current">
            <span className="pixel-color-swatch" style={{ background: color }} />
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              aria-label="Pick custom colour"
            />
            <code>{color.toUpperCase()}</code>
          </label>

          <div className="pixel-color-presets">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className={`pixel-color-preset${
                  color.toLowerCase() === p ? ' active' : ''
                }`}
                style={{ background: p }}
                aria-label={`Set colour ${p}`}
                onClick={() => setColor(p)}
              />
            ))}
          </div>
        </aside>
      </div>

      <footer className="pixel-editor-foot">
        <button type="button" className="counter ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="counter" onClick={doSave}>
          <Check size={14} aria-hidden />
          Save
        </button>
      </footer>
    </div>,
    document.body,
  )
}

export default BmpPixelEditor
