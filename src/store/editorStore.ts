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

/** What we restore on undo: project state + selection state. We deliberately
 *  do NOT capture selection-only changes (those would be noisy in the undo
 *  stack), but every project mutation saves the selection that was active
 *  at the time so undo restores both. */
type Snapshot = {
  project: EditorProject
  selectedIdxs: number[]
}

/** One step on the undo stack. `key` is used by `mutate` to coalesce rapid
 *  follow-up changes of the same kind (e.g. a drag's 100 `setLayerPosition`
 *  calls become a single undo entry). */
type HistoryEntry = {
  snapshot: Snapshot
  key: string
  timestamp: number
}

const HISTORY_LIMIT = 100
const MERGE_WINDOW_MS = 1000

type EditorState = {
  /** null = no project yet (post-fresh-load, before user picks New or imports). */
  project: EditorProject | null
  /** In *insertion* order (oldest first). `[]` = nothing selected;
   *  `[i]` = single (most common); longer = multi-select. Indices are into
   *  `project.layers` (Type C) or `project.face.elements` (FaceN). Order
   *  matters: `selectedIdxs[0]` is the anchor (the "first selected" layer)
   *  used by range-select in LayerList and by the Relative-to selector. */
  selectedIdxs: number[]
  /** Undo stack — past snapshots. Most recent at the end. Cleared when a
   *  fresh project is loaded (a different file has no meaningful history). */
  history: HistoryEntry[]
  /** Redo stack — snapshots that were undone. Cleared by any forward
   *  project mutation. */
  future: Snapshot[]
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

  // History
  /** Pop the most recent snapshot off `history` and apply it, pushing the
   *  current state to `future`. No-op when `history` is empty. */
  undo: () => void
  /** Reverse of undo: pop from `future`, apply, and push current state back
   *  onto `history`. */
  redo: () => void

  // Right-sidebar mode switch (layer ↔ asset detail).
  openAssetDetail: (setId: string) => void
  closeAssetDetail: () => void

  // layer actions
  /** Replace the selection with one layer or clear it (`null`). For
   *  multi-select use `toggleSelected` or `selectMany`. */
  select: (idx: number | null) => void
  /** Add/remove a single layer from the current selection — for shift-click
   *  toggle gestures. */
  toggleSelected: (idx: number) => void
  /** Replace the selection with a specific set. Used by marquee select. If
   *  `mode === 'add'`, the supplied indices are unioned with the current
   *  selection instead of replacing it. */
  selectMany: (idxs: number[], mode?: 'replace' | 'add') => void
  setLayerPosition: (idx: number, x: number, y: number) => void
  reorderLayer: (idx: number, direction: 'up' | 'down') => void
  deleteLayer: (idx: number) => void

  /** Asset slot replace (BMP-driven). Returns the error message on failure
   *  (e.g. dimension mismatch) so the caller can surface it inline — the
   *  store no longer mutates `error` for this action. */
  replaceAssetAction: (
    ref: AssetRef,
    bitmap: DecodedBitmap,
    opts?: { requireDimMatch?: boolean; clearOtherSlots?: boolean },
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

export const useEditor = create<EditorState>((set, get) => {
  /** Wrap `set` with undo-history bookkeeping. The reducer runs *before*
   *  the history push so we capture the project's pre-mutation state.
   *  Successive calls with the same `key` within MERGE_WINDOW_MS replace
   *  the previous entry's timestamp (keeping its older snapshot) so a
   *  drag or keystroke run collapses to one undo step. */
  const mutate = (
    reducer: (state: EditorState) => Partial<EditorState> | EditorState,
    key = '',
  ) => {
    set((state) => {
      const result = reducer(state)
      // If there's no project, there's nothing meaningful to undo. Skip
      // history bookkeeping but still apply the result.
      if (!state.project) return result
      const beforeSnapshot: Snapshot = {
        project: state.project,
        selectedIdxs: state.selectedIdxs,
      }
      const last = state.history[state.history.length - 1]
      const now = Date.now()
      let history: HistoryEntry[]
      if (
        key &&
        last &&
        last.key === key &&
        now - last.timestamp < MERGE_WINDOW_MS
      ) {
        // Merge: keep the older snapshot (the "true before"), just bump the
        // timestamp so subsequent calls keep merging.
        history = state.history.slice()
        history[history.length - 1] = { ...last, timestamp: now }
      } else {
        history = [
          ...state.history,
          { snapshot: beforeSnapshot, key, timestamp: now },
        ]
        if (history.length > HISTORY_LIMIT) history.shift()
      }
      return { ...result, history, future: [] }
    })
  }

  return {
  project: null,
  selectedIdxs: [],
  history: [],
  future: [],
  assetDetailId: null,
  dummy: defaultDummyN(defaultDummy()),
  error: null,

  newProject: (format) =>
    set({
      project: emptyProject(format),
      selectedIdxs: [],
      assetDetailId: null,
      error: null,
      // A new project has no meaningful history relative to its predecessor.
      history: [],
      future: [],
    }),

  setProject: (project) =>
    set({
      project,
      selectedIdxs: [],
      assetDetailId: null,
      error: null,
      history: [],
      future: [],
    }),

  clearProject: () =>
    set({
      project: null,
      selectedIdxs: [],
      assetDetailId: null,
      error: null,
      history: [],
      future: [],
    }),

  setError: (msg) => set({ error: msg }),

  undo: () =>
    set((state) => {
      if (state.history.length === 0 || !state.project) return state
      const history = state.history.slice()
      const entry = history.pop()!
      const future: Snapshot[] = [
        ...state.future,
        { project: state.project, selectedIdxs: state.selectedIdxs },
      ]
      return {
        project: entry.snapshot.project,
        selectedIdxs: entry.snapshot.selectedIdxs,
        history,
        future,
      }
    }),

  redo: () =>
    set((state) => {
      if (state.future.length === 0 || !state.project) return state
      const future = state.future.slice()
      const next = future.pop()!
      // Push the current state back onto history so a subsequent undo
      // re-undoes the redo. Use a sentinel key so nothing merges with it.
      const history: HistoryEntry[] = [
        ...state.history,
        {
          snapshot: {
            project: state.project,
            selectedIdxs: state.selectedIdxs,
          },
          key: '__redo__',
          timestamp: Date.now(),
        },
      ]
      if (history.length > HISTORY_LIMIT) history.shift()
      return {
        project: next.project,
        selectedIdxs: next.selectedIdxs,
        history,
        future,
      }
    }),

  openAssetDetail: (setId) => set({ assetDetailId: setId }),
  closeAssetDetail: () => set({ assetDetailId: null }),

  select: (idx) => set({ selectedIdxs: idx === null ? [] : [idx] }),

  toggleSelected: (idx) =>
    set((state) => {
      const i = state.selectedIdxs.indexOf(idx)
      if (i >= 0) {
        // Remove — keeps insertion order of the survivors.
        const next = state.selectedIdxs.slice()
        next.splice(i, 1)
        return { selectedIdxs: next }
      }
      // Add — append, so the newest selection lands at the end and
      // `selectedIdxs[0]` stays the original anchor.
      return { selectedIdxs: [...state.selectedIdxs, idx] }
    }),

  selectMany: (idxs, mode = 'replace') =>
    set((state) => {
      // Preserve order: dedupe while keeping first occurrence.
      const seen = new Set<number>()
      const dedupe = (xs: number[]) => {
        const out: number[] = []
        for (const v of xs) {
          if (!seen.has(v)) {
            seen.add(v)
            out.push(v)
          }
        }
        return out
      }
      if (mode === 'replace') return { selectedIdxs: dedupe(idxs) }
      return { selectedIdxs: dedupe([...state.selectedIdxs, ...idxs]) }
    }),

  setLayerPosition: (idx, x, y) =>
    mutate(
      (state) => {
        if (!state.project) return state
        return { project: setLayerXY(state.project, idx, x, y) }
      },
      `move:${idx}`,
    ),

  reorderLayer: (idx, direction) =>
    mutate((state) => {
      if (!state.project) return state
      const next = reorderLayer(state.project, idx, direction)
      const target = direction === 'up' ? idx + 1 : idx - 1
      const selectedIdxs = state.selectedIdxs.map((s) =>
        s === idx ? target : s === target ? idx : s,
      )
      return { project: next, selectedIdxs }
    }),

  deleteLayer: (idx) =>
    mutate((state) => {
      if (!state.project) return state
      const next = deleteLayer(state.project, idx)
      const selectedIdxs = state.selectedIdxs
        .filter((s) => s !== idx)
        .map((s) => (s > idx ? s - 1 : s))
      return { project: next, selectedIdxs }
    }),

  replaceAssetAction: (ref, bitmap, opts) => {
    const state = get()
    if (!state.project) return 'No project loaded.'
    try {
      const next = replaceAsset(state.project, ref, bitmap, {
        requireDimMatch: opts?.requireDimMatch ?? true,
        clearOtherSlots: opts?.clearOtherSlots,
      })
      // Use mutate so this counts as one undoable step.
      mutate(() => ({ project: next }))
      return null
    } catch (err) {
      return errMsg(err)
    }
  },

  insertTypeC: (type, bitmap) =>
    mutate((state) => {
      if (!state.project || state.project.format !== 'typeC') return state
      try {
        const next = insertTypeCLayer(state.project, type, { bitmaps: [bitmap] })
        return {
          project: next,
          selectedIdxs: [next.layers.length - 1],
          error: null,
        }
      } catch (err) {
        return { error: errMsg(err) }
      }
    }),

  insertTypeCEmpty: (type) =>
    mutate((state) => {
      if (!state.project || state.project.format !== 'typeC') return state
      try {
        const next = insertTypeCLayer(state.project, type)
        return {
          project: next,
          selectedIdxs: [next.layers.length - 1],
          error: null,
        }
      } catch (err) {
        return { error: errMsg(err) }
      }
    }),

  insertTypeCShared: (type, assetSetId, position) =>
    mutate((state) => {
      if (!state.project || state.project.format !== 'typeC') return state
      try {
        const next = insertTypeCLayer(state.project, type, {
          assetSetId,
          position,
        })
        return {
          project: next,
          selectedIdxs: [next.layers.length - 1],
          error: null,
        }
      } catch (err) {
        return { error: errMsg(err) }
      }
    }),

  createAssetSetAction: (type, bitmaps) =>
    mutate((state) => {
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
    mutate(
      (state) => {
        if (!state.project || state.project.format !== 'typeC') return state
        return { project: renameAssetSet(state.project, setId, name) }
      },
      `rename:${setId}`,
    ),

  deleteAssetSetAction: (setId) =>
    mutate((state) => {
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
    mutate((state) => {
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
    mutate((state) => {
      if (!state.project || state.project.format !== 'typeC') return state
      return { project: detachLayerFromSharedSet(state.project, layerIdx) }
    }),

  regenerateAssetSetFromFont: (setId, bitmaps) =>
    mutate((state) => {
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
    mutate((state) => {
      if (!state.project || state.project.format !== 'faceN') return state
      try {
        const next = insertFaceNLayer(state.project, kind, bitmaps)
        return {
          project: next,
          selectedIdxs: [next.face.elements.length - 1],
          error: null,
        }
      } catch (err) {
        return { error: errMsg(err) }
      }
    }),

  insertFaceNDigitSetAction: (digits, chain) =>
    mutate((state) => {
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
          selectedIdxs: [withElement.face.elements.length - 1],
          error: null,
        }
      } catch (err) {
        return { error: errMsg(err) }
      }
    }),

  insertFaceNDigitElementAction: (kind, digitSetIdx, position, align) =>
    mutate((state) => {
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
          selectedIdxs: [next.face.elements.length - 1],
          error: null,
        }
      } catch (err) {
        return { error: errMsg(err) }
      }
    }),

  regenerateFaceNDigitSetFromFont: (setIdx, digits) =>
    mutate((state) => {
      if (!state.project || state.project.format !== 'faceN') return state
      try {
        const next = regenerateFaceNDigitSet(state.project, setIdx, digits)
        return { project: next, error: null }
      } catch (err) {
        return { error: errMsg(err) }
      }
    }),

  patchLayer: (idx, patch) =>
    mutate(
      (state) => {
        if (!state.project || state.project.format !== 'typeC') return state
        return { project: patchTypeCLayer(state.project, idx, patch) }
      },
      `patchLayer:${idx}`,
    ),

  patchElement: (idx, patch) =>
    mutate(
      (state) => {
        if (!state.project || state.project.format !== 'faceN') return state
        return { project: patchFaceNElement(state.project, idx, patch) }
      },
      `patchElement:${idx}`,
    ),

  patchDummy: (key, value) =>
    set((state) => ({ dummy: { ...state.dummy, [key]: value } })),

  resetDummy: () => set({ dummy: defaultDummyN(defaultDummy()) }),

  setFaceNumber: (n) =>
    mutate(
      (state) => {
        if (!state.project || state.project.format !== 'typeC') return state
        return { project: { ...state.project, faceNumber: n } }
      },
      'faceNumber',
    ),
  }
})
