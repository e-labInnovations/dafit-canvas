import type { DecodedBlob, FaceHeader } from '../lib/dawft'
import type { FaceN } from '../lib/faceN'

export const SCREEN_W = 240
export const SCREEN_H = 240

export type WatchFormat = 'typeC' | 'faceN'

/** Project state for a Type C face. We keep the rich parsed structure so the
 *  editor can mutate fields in-place and the canvas can render directly via
 *  the existing `renderFace` path. */
export type TypeCProject = {
  format: 'typeC'
  fileName: string | null
  header: FaceHeader
  blobs: DecodedBlob[]
}

/** Project state for a FaceN face. Same trick: store the binary-parsed shape
 *  and let the renderer consume it directly; converters in projectIO.ts handle
 *  bin/zip export. */
export type FaceNProject = {
  format: 'faceN'
  fileName: string | null
  face: FaceN
}

export type EditorProject = TypeCProject | FaceNProject

/** Currently selected layer (index into the project's element array; meaning
 *  depends on format). null = nothing selected. */
export type Selection =
  | { format: 'typeC'; faceDataIdx: number }
  | { format: 'faceN'; elementIdx: number }
  | null
