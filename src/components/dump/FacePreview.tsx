import { useEffect, useRef } from 'react'
import type { DecodedBlob, FaceHeader } from '../../lib/dawft'
import { renderFace, type DummyState } from '../../lib/renderFace'

type Props = {
  header: FaceHeader
  blobs: DecodedBlob[]
  dummy: DummyState
}

const DISPLAY_SCALE = 2

function FacePreview({ header, blobs, dummy }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { width, height } = renderFace(canvas, header, blobs, dummy)
    // Drive display size from native pixels so non-square watch screens
    // (e.g. 240×280) preview at the correct aspect.
    canvas.style.width = `${width * DISPLAY_SCALE}px`
    canvas.style.height = `${height * DISPLAY_SCALE}px`
  }, [header, blobs, dummy])

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

export default FacePreview
