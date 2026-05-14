import { create } from 'zustand'
import { defaultDummy } from '../lib/renderFace'
import { defaultDummyN, type DummyStateN } from '../lib/renderFaceN'
import {
  addGuide,
  appendAssetSets,
  createTypeCAssetSet,
  deleteAssetSet,
  deleteLayer,
  detachLayerFromSharedSet,
  emptyProject,
  insertFaceNDigitElement,
  insertFaceNDigitSet,
  insertFaceNLayer,
  insertTypeCLayer,
  moveGuide,
  moveLayer,
  patchFaceNElement,
  patchTypeCLayer,
  rebindLayer,
  regenerateAssetSet,
  regenerateFaceNDigitSet,
  removeGuides,
  renameAssetSet,
  replaceAsset,
  reorderLayer,
  resizeAssetSet,
  setAnimationFrames,
  setAllGuidesVisible,
  setGuideVisible,
  setLayerXY,
  type AssetRef,
  type FaceNDigitDependentKind,
  type FaceNInsertableKind,
} from '../lib/projectIO'
import type {
  AssetSet,
  EditorProject,
  TypeCLayer,
  WatchFormat,
} from '../types/face'
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
  selectedGuideIds: string[]
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
  /** Guide selection runs in a parallel slot to `selectedIdxs` — clicking a
   *  guide swaps to guide-selection mode, clicking a layer swaps back.
   *  Multi-select inside the guide bucket via shift-click is supported.
   *  Both arrays feed the multi-arrange property panel together. */
  selectedGuideIds: string[]
  /** Master toggle for guide visibility. Independent from each guide's own
   *  `visible` flag — hiding all here doesn't *forget* the per-guide state.
   *  Lives outside the project so toggling it doesn't poison undo. */
  guidesVisible: boolean
  /** Whether dragging snaps to guides/edges/centers/other layers. Same
   *  rationale as `guidesVisible` — session-only, not undoable. */
  snapEnabled: boolean
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

  // guide actions
  addGuideAction: (axis: 'H' | 'V', position?: number) => void
  moveGuideAction: (id: string, position: number) => void
  setGuideVisibleAction: (id: string, visible: boolean) => void
  /** Toggle the master visibility flag (session-only, not undoable). */
  setGuidesVisible: (visible: boolean) => void
  /** Toggle snapping on/off (session-only, not undoable). */
  setSnapEnabled: (enabled: boolean) => void
  /** Replace guide selection with one guide or clear (`null`). Also clears
   *  the layer selection so the property panel switches modes cleanly. */
  selectGuide: (id: string | null) => void
  /** Add/remove a guide from the current guide selection for shift-click. */
  toggleGuideSelected: (id: string) => void
  /** Delete every guide currently in `selectedGuideIds` in one undo step. */
  deleteSelectedGuides: () => void

  setLayerPosition: (idx: number, x: number, y: number) => void
  reorderLayer: (idx: number, direction: 'up' | 'down') => void
  /** Move a layer to a specific index (post-removal slot). Used by the
   *  drag-to-reorder gesture in LayerList. Selection follows the moved
   *  layer so the user keeps editing the same one. */
  moveLayerTo: (from: number, to: number) => void
  deleteLayer: (idx: number) => void
  /** Delete every layer in the current selection in one undo step.
   *  Iterates highest-index-first so the underlying array stays stable
   *  while indices shrink. */
  deleteSelectedLayers: () => void

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
  createAssetSetAction: (
    type: number,
    bitmaps?: DecodedBitmap[],
    options?: { size?: { w: number; h: number } },
  ) => void
  /** Append asset sets imported from another watch face's project (Type C
   *  only). Each set gets a fresh id so the library stays unambiguous.
   *  No layers are created — the user binds via the rebind picker. */
  importAssetSetsAction: (sets: AssetSet[]) => void
  renameAssetSetAction: (setId: string, name: string) => void
  /** Change an asset set's dimensions. Clears every slot's `rgba` since
   *  pixel art doesn't scale cleanly — the `compression` hint per slot
   *  is preserved so re-export keeps the firmware-correct encoding.
   *  Returns the error message on failure (e.g. zero / invalid w/h) so
   *  the caller can surface it inline. */
  resizeAssetSetAction: (
    setId: string,
    width: number,
    height: number,
  ) => string | null
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
  /** Set the project's `animationFrames` and resize every animation
   *  asset set (0xf6/0xf7/0xf8) to the new slot count. Pads with empty
   *  slots on grow; truncates higher-index slots on shrink. Returns the
   *  error message on failure (e.g. out-of-range value). */
  setAnimationFramesAction: (frames: number) => string | null
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
        selectedGuideIds: state.selectedGuideIds,
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
  selectedGuideIds: [],
  guidesVisible: true,
  snapEnabled: true,
  history: [],
  future: [],
  assetDetailId: null,
  dummy: defaultDummyN(defaultDummy()),
  error: null,

  newProject: (format) =>
    set({
      project: emptyProject(format),
      selectedIdxs: [],
      selectedGuideIds: [],
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
      selectedGuideIds: [],
      assetDetailId: null,
      error: null,
      history: [],
      future: [],
    }),

  clearProject: () =>
    set({
      project: null,
      selectedIdxs: [],
      selectedGuideIds: [],
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
        {
          project: state.project,
          selectedIdxs: state.selectedIdxs,
          selectedGuideIds: state.selectedGuideIds,
        },
      ]
      return {
        project: entry.snapshot.project,
        selectedIdxs: entry.snapshot.selectedIdxs,
        selectedGuideIds: entry.snapshot.selectedGuideIds,
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
            selectedGuideIds: state.selectedGuideIds,
          },
          key: '__redo__',
          timestamp: Date.now(),
        },
      ]
      if (history.length > HISTORY_LIMIT) history.shift()
      return {
        project: next.project,
        selectedIdxs: next.selectedIdxs,
        selectedGuideIds: next.selectedGuideIds,
        history,
        future,
      }
    }),

  openAssetDetail: (setId) => set({ assetDetailId: setId }),
  closeAssetDetail: () => set({ assetDetailId: null }),

  // Selecting a layer hands the right pane to the layer-properties view.
  // The asset-detail view stays open only when the user lands on an empty
  // selection (so they can still browse the library after deselecting).
  // Picking a layer also clears any guide selection — the two buckets are
  // mutually exclusive at single-select time so PropertyPanel knows which
  // mode to render.
  select: (idx) =>
    set(
      idx === null
        ? { selectedIdxs: [], selectedGuideIds: [] }
        : {
            selectedIdxs: [idx],
            selectedGuideIds: [],
            assetDetailId: null,
          },
    ),

  toggleSelected: (idx) =>
    set((state) => {
      const i = state.selectedIdxs.indexOf(idx)
      if (i >= 0) {
        // Remove — keeps insertion order of the survivors. No panel
        // switch: the user is shrinking the selection, not picking a
        // new layer to inspect.
        const next = state.selectedIdxs.slice()
        next.splice(i, 1)
        return { selectedIdxs: next }
      }
      // Add — append so the newest selection lands at the end and
      // `selectedIdxs[0]` stays the original anchor. Switch panes since
      // a new layer is now in the selection.
      return {
        selectedIdxs: [...state.selectedIdxs, idx],
        assetDetailId: null,
      }
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
      if (mode === 'replace') {
        const next = dedupe(idxs)
        return next.length > 0
          ? { selectedIdxs: next, selectedGuideIds: [], assetDetailId: null }
          : { selectedIdxs: next }
      }
      return { selectedIdxs: dedupe([...state.selectedIdxs, ...idxs]) }
    }),

  addGuideAction: (axis, position) =>
    mutate(
      (state) => {
        if (!state.project) return state
        const pos = position ?? 120
        const { project: next, id } = addGuide(state.project, axis, pos)
        return {
          project: next,
          // Select the new guide so the user can immediately tune it.
          selectedGuideIds: [id],
          selectedIdxs: [],
          assetDetailId: null,
        }
      },
      // Each insert is its own undo step — no coalescing.
    ),

  moveGuideAction: (id, position) =>
    mutate(
      (state) => {
        if (!state.project) return state
        return { project: moveGuide(state.project, id, position) }
      },
      // Coalesce a drag's many move calls (matches setLayerPosition's
      // per-target key pattern).
      `moveGuide:${id}`,
    ),

  setGuideVisibleAction: (id, visible) =>
    mutate((state) => {
      if (!state.project) return state
      return { project: setGuideVisible(state.project, id, visible) }
    }),

  setGuidesVisible: (visible) =>
    set((state) => {
      if (!state.project) return { guidesVisible: visible }
      // The master toggle also flips every per-guide flag. That way the
      // sidebar list visibly reflects the state — no "all guides on but
      // none shown" hidden mode. Project mutation goes through `mutate`
      // so this *is* undoable when a project exists.
      const next = setAllGuidesVisible(state.project, visible)
      return { project: next, guidesVisible: visible }
    }),

  setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),

  selectGuide: (id) =>
    set(
      id === null
        ? { selectedGuideIds: [] }
        : {
            selectedGuideIds: [id],
            selectedIdxs: [],
            assetDetailId: null,
          },
    ),

  toggleGuideSelected: (id) =>
    set((state) => {
      const i = state.selectedGuideIds.indexOf(id)
      if (i >= 0) {
        const next = state.selectedGuideIds.slice()
        next.splice(i, 1)
        return { selectedGuideIds: next }
      }
      // Append; leave layer selection intact so shift-clicking a guide
      // after a layer can build a mixed selection for align/distribute.
      return {
        selectedGuideIds: [...state.selectedGuideIds, id],
        assetDetailId: null,
      }
    }),

  deleteSelectedGuides: () =>
    mutate((state) => {
      if (!state.project || state.selectedGuideIds.length === 0) return state
      return {
        project: removeGuides(state.project, state.selectedGuideIds),
        selectedGuideIds: [],
      }
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

  moveLayerTo: (from, to) =>
    mutate((state) => {
      if (!state.project) return state
      const next = moveLayer(state.project, from, to)
      if (next === state.project) return state
      // Re-index selection: the moved item goes to `to`; items between
      // from and to shift one slot to fill the gap.
      const remap = (s: number): number => {
        if (s === from) return to
        if (from < to) {
          // Moving forward: items strictly between (from, to] shift left.
          if (s > from && s <= to) return s - 1
        } else {
          // Moving backward: items in [to, from) shift right.
          if (s >= to && s < from) return s + 1
        }
        return s
      }
      const selectedIdxs = state.selectedIdxs.map(remap)
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

  deleteSelectedLayers: () =>
    mutate((state) => {
      if (!state.project || state.selectedIdxs.length === 0) return state
      // Delete from highest index to lowest so later splices don't shift
      // the indices we still need to remove.
      const targets = state.selectedIdxs.slice().sort((a, b) => b - a)
      let project = state.project
      for (const idx of targets) {
        project = deleteLayer(project, idx)
      }
      return { project, selectedIdxs: [] }
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

  createAssetSetAction: (type, bitmaps, options) =>
    mutate((state) => {
      if (!state.project || state.project.format !== 'typeC') return state
      try {
        const { project: next } = createTypeCAssetSet(state.project, type, {
          bitmaps,
          size: options?.size,
        })
        return { project: next, error: null }
      } catch (err) {
        return { error: errMsg(err) }
      }
    }),

  importAssetSetsAction: (sets) =>
    mutate((state) => {
      if (!state.project || state.project.format !== 'typeC') return state
      if (sets.length === 0) return state
      try {
        const { project: next } = appendAssetSets(state.project, sets)
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

  resizeAssetSetAction: (setId, width, height) => {
    const state = get()
    if (!state.project || state.project.format !== 'typeC') {
      return 'No Type C project loaded.'
    }
    try {
      const next = resizeAssetSet(state.project, setId, width, height)
      // One undo step per resize (no coalescing key — distinct intent).
      mutate(() => ({ project: next }))
      return null
    } catch (err) {
      return errMsg(err)
    }
  },

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

  setAnimationFramesAction: (frames) => {
    const state = get()
    if (!state.project || state.project.format !== 'typeC') {
      return 'No Type C project loaded.'
    }
    try {
      const next = setAnimationFrames(state.project, frames)
      // One undo step — animation-frames changes are a project-wide
      // structural edit, not a quick keystroke run, so no coalescing key.
      mutate(() => ({ project: next }))
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  },
  }
})
