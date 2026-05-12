import type { FaceN } from '../lib/faceN'

export const SCREEN_W = 240
export const SCREEN_H = 240

export type WatchFormat = 'typeC' | 'faceN'

// ---------- AssetSet (Type C, editor-side model) ----------

/** Hint for what an AssetSet semantically holds. Used by the UI to label sets
 *  in the AssetLibrary and to seed the FontGenerator with the right glyphs.
 *  Doesn't affect the binary format — that's driven entirely by the consuming
 *  layer's `type`. */
export type AssetSetKind =
  | 'digits' // 10 digit glyphs (TIME_H1, DAY_NUM, STEPS_B, BATT, …)
  | 'day-names' // 7 weekday labels
  | 'month-names' // 12 month labels
  | 'label' // single text BMP (AM, PM, KM, MI, …)
  | 'image' // arbitrary single image (BACKGROUND, logos, …)
  | 'hand' // analog hand (HAND_HOUR/MINUTE/SEC + pin caps)
  | 'progbar' // 11-frame progress bar
  | 'animation' // variable-frame animation
  | 'misc' // anything else

/** One slot in an AssetSet — a pixel buffer with metadata. Width/height are
 *  uniform across the whole set (`AssetSet.width`/`height`); this struct only
 *  carries the per-slot pixels. `null` rgba means "placeholder/empty". */
export type AssetSlot = {
  rgba: Uint8ClampedArray | null
}

/** A reusable, named collection of N same-sized bitmaps. Multiple layers can
 *  point at the same AssetSet by id; the binary writer emits the slots once
 *  and writes the shared start-blob index to every consumer layer. */
export type AssetSet = {
  id: string
  name: string
  /** Per-slot width. Type C requires all slots in a set to share dimensions
   *  (the firmware uses one (w, h) pair for the entire kind). */
  width: number
  height: number
  /** Number of slots. Mirrors the kind's expected blob count from
   *  `blobCountForType` for the layer that owns it. */
  count: number
  kind: AssetSetKind
  slots: AssetSlot[]
}

/** A layer in a Type C face. References the AssetSet that paints it by id —
 *  multiple layers with compatible `type`s can point at the same set. */
export type TypeCLayer = {
  id: string
  /** Type code from dawft's TYPE_TABLE (e.g. 0x40 TIME_H1). Determines how
   *  the firmware draws this layer and how many slots its AssetSet has. */
  type: number
  x: number
  y: number
  /** Reference into `TypeCProject.assetSets`. */
  assetSetId: string
}

export type TypeCProject = {
  format: 'typeC'
  fileName: string | null
  /** Header `fileID` (0x81 for Type C). */
  fileID: number
  /** Header `faceNumber` (50001 by convention). */
  faceNumber: number
  /** Animation frame count (held in sizes[0] in the binary). */
  animationFrames: number
  layers: TypeCLayer[]
  assetSets: AssetSet[]
}

// ---------- FaceN (unchanged for this slice) ----------

/** Project state for a FaceN face. FaceN already has digit sets as
 *  first-class shared assets; element-owned images stay inline for now. */
export type FaceNProject = {
  format: 'faceN'
  fileName: string | null
  face: FaceN
}

export type EditorProject = TypeCProject | FaceNProject

/** Currently selected layer (index into the project's layers array for Type C,
 *  or face.elements for FaceN). null = nothing selected. */
export type Selection =
  | { format: 'typeC'; layerIdx: number }
  | { format: 'faceN'; elementIdx: number }
  | null
