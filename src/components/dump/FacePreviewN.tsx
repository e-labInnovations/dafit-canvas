import { useEffect, useRef } from 'react'
import { renderFaceN, type DummyStateN } from '../../lib/renderFaceN'
import type { FaceN } from '../../lib/faceN'

type Props = {
  face: FaceN
  dummy: DummyStateN
}

const DISPLAY_SCALE = 2

function FacePreviewN({ face, dummy }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { width, height } = renderFaceN(canvas, face, dummy)
    canvas.style.width = `${width * DISPLAY_SCALE}px`
    canvas.style.height = `${height * DISPLAY_SCALE}px`
  }, [face, dummy])

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
