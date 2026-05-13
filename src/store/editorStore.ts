import { create } from 'zustand'
import { defaultDummy } from '../lib/renderFace'
import { defaultDummyN, type DummyStateN } from '../lib/renderFaceN'
import {
  createTypeCAssetSet,
  deleteAssetSet,
  deleteLayer,
  detachLayerFromSharedSet,
  emptyProject,
  insertFaceNDigitElement,
  insertFaceNDigitSet,
  insertFaceNLayer,
  insertTypeCLayer,
  patchFaceNElement,
  patchTypeCLayer,
  rebindLayer,
  regenerateAssetSet,
  regenerateFaceNDigitSet,
  renameAssetSet,
  replaceAsset,
  reorderLayer,
  setLayerXY,
  type AssetRef,
  type FaceNDigitDependentKind,
  type FaceNInsertableKind,
} from '../lib/projectIO'
import type { EditorProject, TypeCLayer, WatchFormat } from '../types/face'
import type { FaceN } from '../lib/faceN'

type DecodedBitmap = { width: number; height: number; rgba: Uint8ClampedArray }
type FNEl = FaceN['elements'][number]

type EditorState = {
  /** null = no project yet (post-fresh-load, before user picks New or imports). */
  project: EditorProject | null
  selectedIdx: number | null
  /** When non-null, the right sidebar shows the matching AssetSet's detail
   *  view instead of the layer property panel. Cleared automatically when the
   *  project is replaced or the set is deleted. */
  assetDetailId: string | null
  dummy: DummyStateN
  /** Last load/save error message (or null). Asset-detail-scope errors
   *  (dimension mismatches, etc.) go inline in `AssetDetailView` rather than
   *  this global slot to keep banners near the action that produced them. */
  error: string | null

  // top-level actions
  newProject: (format: WatchFormat) => void
  setProject: (project: EditorProject) => void
  clearProject: () => void
  setError: (msg: string | null) => void

  // Right-sidebar mode switch (layer ↔ asset detail).
  openAssetDetail: (setId: string) => void
  closeAssetDetail: () => void

  // layer actions
  select: (idx: number | null) => void
  setLayerPosition: (idx: number, x: number, y: number) => void
  reorderLayer: (idx: number, direction: 'up' | 'down') => void
  deleteLayer: (idx: number) => void

  /** Asset slot replace (BMP-driven). Returns the error message on failure
   *  (e.g. dimension mismatch) so the caller can surface it inline — the
   *  store no longer mutates `error` for this action. */
  replaceAssetAction: (
    ref: AssetRef,
    bitmap: DecodedBitmap,
    requireDimMatch?: boolean,
  ) => string | null

  // Type C inserts
  /** Single-blob kind insert with a user-picked BMP. */
  insertTypeC: (type: number, bitmap: DecodedBitmap) => void
  /** Multi-blob kind insert with placeholder slots. Caller fills via
   *  **Generate from font** in the property panel. */
  insertTypeCEmpty: (type: number) => void
  /** Insert a Type C layer that *shares* an existing AssetSet (no new blobs
   *  allocated; the firmware reads the same range). */
  insertTypeCShared: (
    type: number,
    assetSetId: string,
    position?: { x: number; y: number },
  ) => void

  // Type C AssetSet operations
  /** Add a standalone asset set to the library (no layer references it).
   *  The caller can later bind a layer via the rebind picker. */
  createAssetSetAction: (type: number, bitmaps?: DecodedBitmap[]) => void
  renameAssetSetAction: (setId: string, name: string) => void
  deleteAssetSetAction: (setId: string) => void
  rebindLayerAction: (layerIdx: number, newSetId: string) => void
  detachLayerAction: (layerIdx: number) => void
  /** Regenerate the slots of a Type C asset set from a font. Affects every
   *  layer that consumes the set. */
  regenerateAssetSetFromFont: (
    setId: string,
    bitmaps: DecodedBitmap[],
  ) => void

  // FaceN inserts
  insertFaceN: (kind: FaceNInsertableKind, bitmaps: DecodedBitmap[]) => void
  insertFaceNDigitSetAction: (
    digits: DecodedBitmap[],
    chain?: {
      kind: FaceNDigitDependentKind
      position: { x: number; y: number }
      align?: 'L' | 'R' | 'C'
    },
  ) => void
  insertFaceNDigitElementAction: (
    kind: FaceNDigitDependentKind,
    digitSetIdx: number,
    position: { x: number; y: number },
    align?: 'L' | 'R' | 'C',
  ) => void
  regenerateFaceNDigitSetFromFont: (
    setIdx: number,
    digits: DecodedBitmap[],
  ) => void

  // Element / layer patches
  patchLayer: (idx: number, patch: Partial<TypeCLayer>) => void
  patchElement: (idx: number, patch: Partial<FNEl>) => void

  // Dummy state
  patchDummy: <K extends keyof DummyStateN>(key: K, value: DummyStateN[K]) => void
  resetDummy: () => void

  // Project-level mutations
  setFaceNumber: (n: number) => void
}

const errMsg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  selectedIdx: null,
  assetDetailId: null,
  dummy: defaultDummyN(defaultDummy()),
  error: null,

  newProject: (format) =>
    set({
      project: emptyProject(format),
      selectedIdx: null,
      assetDetailId: null,
      error: null,
    }),

  setProject: (project) =>
    set({ project, selectedIdx: null, assetDetailId: null, error: null }),

  clearProject: () =>
    set({ project: null, selectedIdx: null, assetDetailId: null, error: null }),

  setError: (msg) => set({ error: msg }),

  openAssetDetail: (setId) => set({ assetDetailId: setId }),
  closeAssetDetail: () => set({ assetDetailId: null }),

  select: (idx) => set({ selectedIdx: idx }),

  setLayerPosition: (idx, x, y) =>
    set((state) => {
      if (!state.project) return state
      return { project: setLayerXY(state.project, idx, x, y) }
    }),

  reorderLayer: (idx, direction) =>
    set((state) => {
      if (!state.project) return state
      const next = reorderLayer(state.project, idx, direction)
      let newSel = state.selectedIdx
      if (newSel === idx) newSel = direction === 'up' ? idx + 1 : idx - 1
      return { project: next, selectedIdx: newSel }
    }),

  deleteLayer: (idx) =>
    set((state) => {
      if (!state.project) return state
      const next = deleteLayer(state.project, idx)
      let newSel = state.selectedIdx
      if (newSel === idx) newSel = null
      else if (newSel !== null && newSel > idx) newSel = newSel - 1
      return { project: next, selectedIdx: newSel }
    }),

  replaceAssetAction: (ref, bitmap, requireDimMatch = true) => {
    const project = get().project
    if (!project) return 'No project loaded.'
    try {
      const next = replaceAsset(project, ref, bitmap, { requireDimMatch })
      set({ project: next })
      return null
    } catch (err) {
      return errMsg(err)
    }
  },

  insertTypeC: (type, bitmap) =>
    set((state) => {
      if (!state.project || state.project.format !== 'typeC') return state
      try {
        const next = insertTypeCLayer(state.project, type, { bitmaps: [bitmap] })
        return {
          project: next,
          selectedIdx: next.layers.length - 1,
          error: null,
        }
      } catch (err) {
        return { error: errMsg(err) }
      }
    }),

  insertTypeCEmpty: (type) =>
    set((state) => {
      if (!state.project || state.project.format !== 'typeC') return state
      try {
        const next = insertTypeCLayer(state.project, type)
        return {
          project: next,
          selectedIdx: next.layers.length - 1,
          error: null,
        }
      } catch (err) {
        return { error: errMsg(err) }
      }
    }),

  insertTypeCShared: (type, assetSetId, position) =>
    set((state) => {
      if (!state.project || state.project.format !== 'typeC') return state
      try {
        const next = insertTypeCLayer(state.project, type, {
          assetSetId,
          position,
        })
        return {
          project: next,
          selectedIdx: next.layers.length - 1,
          error: null,
        }
      } catch (err) {
        return { error: errMsg(err) }
      }
    }),

  createAssetSetAction: (type, bitmaps) =>
    set((state) => {
      if (!state.project || state.project.format !== 'typeC') return state
      try {
        const { project: next } = createTypeCAssetSet(state.project, type, {
          bitmaps,
        })
        return { project: next, error: null }
      } catch (err) {
        return { error: errMsg(err) }
      }
    }),

  renameAssetSetAction: (setId, name) =>
    set((state) => {
      if (!state.project || state.project.format !== 'typeC') return state
      return { project: renameAssetSet(state.project, setId, name) }
    }),

  deleteAssetSetAction: (setId) =>
    set((state) => {
      if (!state.project || state.project.format !== 'typeC') return state
      try {
        return {
          project: deleteAssetSet(state.project, setId),
          error: null,
          // The detail view targets a set that no longer exists — close it so
          // PropertyPanel doesn't try to render a missing AssetSet.
          assetDetailId:
            state.assetDetailId === setId ? null : state.assetDetailId,
        }
      } catch (err) {
        return { error: errMsg(err) }
      }
    }),

  rebindLayerAction: (layerIdx, newSetId) =>
    set((state) => {
      if (!state.project || state.project.format !== 'typeC') return state
      try {
        return {
          project: rebindLayer(state.project, layerIdx, newSetId),
          error: null,
        }
      } catch (err) {
        return { error: errMsg(err) }
      }
    }),

  detachLayerAction: (layerIdx) =>
    set((state) => {
      if (!state.project || state.project.format !== 'typeC') return state
      return { project: detachLayerFromSharedSet(state.project, layerIdx) }
    }),

  regenerateAssetSetFromFont: (setId, bitmaps) =>
    set((state) => {
      if (!state.project || state.project.format !== 'typeC') return state
      try {
        return {
          project: regenerateAssetSet(state.project, setId, bitmaps),
          error: null,
        }
      } catch (err) {
        return { error: errMsg(err) }
      }
    }),

  insertFaceN: (kind, bitmaps) =>
    set((state) => {
      if (!state.project || state.project.format !== 'faceN') return state
      try {
        const next = insertFaceNLayer(state.project, kind, bitmaps)
        return {
          project: next,
          selectedIdx: next.face.elements.length - 1,
          error: null,
        }
      } catch (err) {
        return { error: errMsg(err) }
      }
    }),

  insertFaceNDigitSetAction: (digits, chain) =>
    set((state) => {
      if (!state.project || state.project.format !== 'faceN') return state
      try {
        const { project: withSet, setIdx } = insertFaceNDigitSet(
          state.project,
          digits,
        )
        if (!chain) {
          return { project: withSet, error: null }
        }
        const withElement = insertFaceNDigitElement(
          withSet,
          chain.kind,
          setIdx,
          chain.position,
          chain.align ?? 'C',
        )
        return {
          project: withElement,
          selectedIdx: withElement.face.elements.length - 1,
          error: null,
        }
      } catch (err) {
        return { error: errMsg(err) }
      }
    }),

  insertFaceNDigitElementAction: (kind, digitSetIdx, position, align) =>
    set((state) => {
      if (!state.project || state.project.format !== 'faceN') return state
      try {
        const next = insertFaceNDigitElement(
          state.project,
          kind,
          digitSetIdx,
          position,
          align ?? 'C',
        )
        return {
          project: next,
          selectedIdx: next.face.elements.length - 1,
          error: null,
        }
      } catch (err) {
        return { error: errMsg(err) }
      }
    }),

  regenerateFaceNDigitSetFromFont: (setIdx, digits) =>
    set((state) => {
      if (!state.project || state.project.format !== 'faceN') return state
      try {
        const next = regenerateFaceNDigitSet(state.project, setIdx, digits)
        return { project: next, error: null }
      } catch (err) {
        return { error: errMsg(err) }
      }
    }),

  patchLayer: (idx, patch) =>
    set((state) => {
      if (!state.project || state.project.format !== 'typeC') return state
      return { project: patchTypeCLayer(state.project, idx, patch) }
    }),

  patchElement: (idx, patch) =>
    set((state) => {
      if (!state.project || state.project.format !== 'faceN') return state
      return { project: patchFaceNElement(state.project, idx, patch) }
    }),

  patchDummy: (key, value) =>
    set((state) => ({ dummy: { ...state.dummy, [key]: value } })),

  resetDummy: () => set({ dummy: defaultDummyN(defaultDummy()) }),

  setFaceNumber: (n) =>
    set((state) => {
      if (!state.project || state.project.format !== 'typeC') return state
      return { project: { ...state.project, faceNumber: n } }
    }),
}))
