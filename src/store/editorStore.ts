import { create } from 'zustand'
import { defaultDummy } from '../lib/renderFace'
import { defaultDummyN, type DummyStateN } from '../lib/renderFaceN'
import {
  deleteLayer,
  emptyProject,
  insertFaceNLayer,
  insertTypeCLayer,
  patchFaceNElement,
  patchTypeCFaceData,
  replaceAsset,
  reorderLayer,
  setLayerXY,
  type AssetRef,
  type FaceNInsertableKind,
} from '../lib/projectIO'
import type { EditorProject, WatchFormat } from '../types/face'
import type { FaceDataEntry } from '../lib/dawft'
import type { FaceN } from '../lib/faceN'

type DecodedBitmap = { width: number; height: number; rgba: Uint8ClampedArray }
type FNEl = FaceN['elements'][number]

type EditorState = {
  /** null = no project yet (post-fresh-load, before user picks New or imports). */
  project: EditorProject | null
  selectedIdx: number | null
  dummy: DummyStateN
  /** Last load/save error message (or null). */
  error: string | null

  // top-level actions
  newProject: (format: WatchFormat) => void
  setProject: (project: EditorProject) => void
  clearProject: () => void
  setError: (msg: string | null) => void

  // layer actions
  select: (idx: number | null) => void
  setLayerPosition: (idx: number, x: number, y: number) => void
  reorderLayer: (idx: number, direction: 'up' | 'down') => void
  deleteLayer: (idx: number) => void

  // asset / insert (Phase 2)
  replaceAssetAction: (
    ref: AssetRef,
    bitmap: DecodedBitmap,
    requireDimMatch?: boolean,
  ) => void
  insertTypeC: (type: number, bitmap: DecodedBitmap) => void
  insertFaceN: (kind: FaceNInsertableKind, bitmaps: DecodedBitmap[]) => void
  patchFaceData: (idx: number, patch: Partial<FaceDataEntry>) => void
  patchElement: (idx: number, patch: Partial<FNEl>) => void

  // dummy state
  patchDummy: <K extends keyof DummyStateN>(key: K, value: DummyStateN[K]) => void
  resetDummy: () => void

  // header / project-level mutations
  setFaceNumber: (n: number) => void
}

export const useEditor = create<EditorState>((set) => ({
  project: null,
  selectedIdx: null,
  dummy: defaultDummyN(defaultDummy()),
  error: null,

  newProject: (format) =>
    set({ project: emptyProject(format), selectedIdx: null, error: null }),

  setProject: (project) => set({ project, selectedIdx: null, error: null }),

  clearProject: () => set({ project: null, selectedIdx: null, error: null }),

  setError: (msg) => set({ error: msg }),

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

  replaceAssetAction: (ref, bitmap, requireDimMatch = true) =>
    set((state) => {
      if (!state.project) return state
      try {
        const next = replaceAsset(state.project, ref, bitmap, { requireDimMatch })
        return { project: next, error: null }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }),

  insertTypeC: (type, bitmap) =>
    set((state) => {
      if (!state.project || state.project.format !== 'typeC') return state
      try {
        const next = insertTypeCLayer(state.project, type, bitmap)
        return {
          project: next,
          selectedIdx: next.header.dataCount - 1,
          error: null,
        }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
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
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }),

  patchFaceData: (idx, patch) =>
    set((state) => {
      if (!state.project || state.project.format !== 'typeC') return state
      return { project: patchTypeCFaceData(state.project, idx, patch) }
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
      return {
        project: {
          ...state.project,
          header: { ...state.project.header, faceNumber: n },
        },
      }
    }),
}))
