import { useEffect, useRef } from 'react'
import type { DecodedBlob, FaceHeader } from '../../lib/dawft'
import { renderFace, type DummyState } from '../../lib/renderFace'

type Props = {
  header: FaceHeader
  blobs: DecodedBlob[]
  dummy: DummyState
  /** CSS-pixel multiplier over native blob resolution. Defaults to 2. */
  scale?: number
}

function FacePreview({ header, blobs, dummy, scale = 2 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { width, height } = renderFace(canvas, header, blobs, dummy)
    // Drive display size from native pixels so non-square watch screens
    // (e.g. 240×280) preview at the correct aspect.
    canvas.style.width = `${width * scale}px`
    canvas.style.height = `${height * scale}px`
  }, [header, blobs, dummy, scale])

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
