import { create } from 'zustand'
import { defaultDummy } from '../lib/renderFace'
import { defaultDummyN, type DummyStateN } from '../lib/renderFaceN'
import {
  deleteLayer,
  emptyProject,
  reorderLayer,
  setLayerXY,
} from '../lib/projectIO'
import type { EditorProject, WatchFormat } from '../types/face'

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
      // selection follows the moved layer to its new slot
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
