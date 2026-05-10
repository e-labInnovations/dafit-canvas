import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../../store/editorStore'
import {
  SCREEN_H,
  SCREEN_W,
  type FaceElement,
  type TextElement,
  type TimeElement,
} from '../../types/face'

const DISPLAY_SCALE = 2 // 240 * 2 = 480px on screen

const previewTime = (format: 'HH:mm' | 'HH:mm:ss'): string => {
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  if (format === 'HH:mm:ss') {
    const ss = String(now.getSeconds()).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  }
  return `${hh}:${mm}`
}

const renderText = (
  ctx: CanvasRenderingContext2D,
  el: TextElement | TimeElement,
  text: string,
) => {
  ctx.fillStyle = el.color
  ctx.font = `${el.fontSize}px system-ui, sans-serif`
  ctx.textBaseline = 'top'
  ctx.fillText(text, el.x, el.y)
}

const measureBounds = (
  ctx: CanvasRenderingContext2D,
  el: FaceElement,
): { x: number; y: number; w: number; h: number } => {
  if (el.kind === 'background') {
    return { x: 0, y: 0, w: SCREEN_W, h: SCREEN_H }
  }
  const text = el.kind === 'time' ? previewTime(el.format) : el.text
  ctx.font = `${el.fontSize}px system-ui, sans-serif`
  const metrics = ctx.measureText(text)
  return {
    x: el.x,
    y: el.y,
    w: Math.ceil(metrics.width),
    h: Math.ceil(el.fontSize * 1.1),
  }
}

const drawElement = (ctx: CanvasRenderingContext2D, el: FaceElement) => {
  if (!el.visible) return
  switch (el.kind) {
    case 'background':
      ctx.fillStyle = el.color
      ctx.fillRect(0, 0, SCREEN_W, SCREEN_H)
      return
    case 'time':
      renderText(ctx, el, previewTime(el.format))
      return
    case 'text':
      renderText(ctx, el, el.text)
      return
  }
}

function EditorCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const project = useEditor((s) => s.project)
  const selectedId = useEditor((s) => s.selectedId)
  const select = useEditor((s) => s.select)
  const updateElement = useEditor((s) => s.updateElement)

  const [now, setNow] = useState(() => Date.now())
  const dragRef = useRef<{
    id: string
    startX: number
    startY: number
    elX: number
    elY: number
  } | null>(null)

  // tick the preview clock once a second so the time placeholder updates live
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, SCREEN_W, SCREEN_H)
    for (const el of project.elements) drawElement(ctx, el)

    const selected = project.elements.find((e) => e.id === selectedId)
    if (selected && selected.kind !== 'background') {
      const b = measureBounds(ctx, selected)
      ctx.strokeStyle = '#aa3bff'
      ctx.lineWidth = 1
      ctx.setLineDash([3, 2])
      ctx.strokeRect(b.x - 0.5, b.y - 0.5, b.w + 1, b.h + 1)
      ctx.setLineDash([])
    }
  }, [project, selectedId, now])

  const toCanvasCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: (clientX - rect.left) / DISPLAY_SCALE,
      y: (clientY - rect.top) / DISPLAY_SCALE,
    }
  }

  const hitTest = (x: number, y: number): FaceElement | null => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return null
    for (let i = project.elements.length - 1; i >= 0; i--) {
      const el = project.elements[i]
      if (!el.visible) continue
      if (el.kind === 'background') continue
      const b = measureBounds(ctx, el)
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        return el
      }
    }
    return null
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toCanvasCoords(e.clientX, e.clientY)
    const hit = hitTest(x, y)
    if (!hit) {
      select(null)
      return
    }
    select(hit.id)
    if (hit.kind === 'background') return
    dragRef.current = {
      id: hit.id,
      startX: e.clientX,
      startY: e.clientY,
      elX: hit.x,
      elY: hit.y,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = (e.clientX - drag.startX) / DISPLAY_SCALE
    const dy = (e.clientY - drag.startY) / DISPLAY_SCALE
    updateElement(drag.id, {
      x: Math.round(drag.elX + dx),
      y: Math.round(drag.elY + dy),
    })
  }

  const endDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) {
      e.currentTarget.releasePointerCapture(e.pointerId)
      dragRef.current = null
    }
  }

  return (
    <div
      className="editor-canvas-wrap"
      style={{ width: SCREEN_W * DISPLAY_SCALE, height: SCREEN_H * DISPLAY_SCALE }}
    >
      <canvas
        ref={canvasRef}
        width={SCREEN_W}
        height={SCREEN_H}
        style={{
          width: SCREEN_W * DISPLAY_SCALE,
          height: SCREEN_H * DISPLAY_SCALE,
          imageRendering: 'pixelated',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
    </div>
  )
}

export default EditorCanvas
