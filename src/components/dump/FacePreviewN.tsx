import { useEffect, useRef } from 'react'
import { renderFaceN, type DummyStateN } from '../../lib/renderFaceN'
import type { FaceN } from '../../lib/faceN'

type Props = {
  face: FaceN
  dummy: DummyStateN
  /** CSS-pixel multiplier over native blob resolution. Defaults to 2. */
  scale?: number
}

function FacePreviewN({ face, dummy, scale = 2 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { width, height } = renderFaceN(canvas, face, dummy)
    canvas.style.width = `${width * scale}px`
    canvas.style.height = `${height * scale}px`
  }, [face, dummy, scale])

  return (
    <div className="face-preview-frame">
      <canvas
        ref={canvasRef}
        className="face-preview-canvas"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  )
}

export default FacePreviewN
