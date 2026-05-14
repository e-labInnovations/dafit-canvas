// Project ↔ binary/zip plumbing for the editor.
//
// Type C uses an "AssetSet" model (editor-side): layers reference reusable
// asset sets by id, multiple layers can share one set. The binary on disk
// stays exactly as dawft expects — we materialize layers + sets into
// (FaceHeader, DecodedBlob[]) at render/export time.
//
// FaceN stays on the binary-parsed `FaceN` shape; digit sets are already
// shared first-class assets there, and element-owned images stay inline.

import JSZip from 'jszip'
import { decodeBmp } from './bmp'
import {
  blobCountForType,
  buildWatchfaceTxt,
  decodeFile,
  encodeBmpRgb565,
  packTypeC,
  parseWatchfaceTxt,
  typeName,
  TYPE_C_HEADER_SIZE,
  type DecodedBlob,
  type FaceDataEntry,
  type FaceHeader,
  type PackTypeCBlob,
  type ParsedWatchfaceTxt,
} from './dawft'
import {
  buildFaceNJson,
  collectBlobs,
  detectFormat,
  encodeBmp32,
  packFaceN,
  parseFaceN,
  parseWatchfaceJson,
  type FaceN,
  type ParsedElement,
  type ParsedWatchfaceJson,
} from './faceN'
import type { DummyState } from './renderFace'
import type { DummyStateN } from './renderFaceN'
import type {
  AssetSet,
  AssetSetKind,
  AssetSlot,
  EditorProject,
  FaceNProject,
  GuideLine,
  TypeCLayer,
  TypeCProject,
  WatchFormat,
} from '../types/face'

type DecodedBitmap = { width: number; height: number; rgba: Uint8ClampedArray }

// ---------- id helpers ----------

let idCounter = 0
const nextId = (prefix: string): string => {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`
}

// ---------- type semantics ----------

/** Map a Type C type code to its semantic asset-set kind. Used to label sets
 *  in the AssetLibrary and pick FontGenerator presets. */
export const kindForType = (type: number): AssetSetKind => {
  if (type === 0x01) return 'image' // BACKGROUND
  if (type >= 0xf1 && type <= 0xf5) return 'hand' // HAND_*
  if (type === 0xf0) return 'image' // SEPERATOR
  if (type === 0x10) return 'month-names'
  if (type === 0x60 || type === 0x61) return 'day-names'
  if (type === 0x45 || type === 0x46) return 'label' // AM/PM
  if (type === 0xa5 || type === 0xa6) return 'label' // DIST_KM/MI
  if (type === 0xc0 || type === 0xc1) return 'image' // BTLINK_*
  if (
    type === 0x71 ||
    type === 0x81 ||
    type === 0x91 ||
    type === 0xa1 ||
    type === 0xce ||
    type === 0xd0 ||
    type === 0xd1 ||
    type === 0xda
  )
    return 'image' // logos / battery icons
  if (type === 0x70 || type === 0x80 || type === 0x90 || type === 0xa0)
    return 'progbar'
  if (type >= 0xf6 && type <= 0xf8) return 'animation'
  if (type === 0x00) return 'image' // BACKGROUNDS strip
  // Everything else with TYPE_TABLE entry = digit-ish set.
  return 'digits'
}

const defaultSetName = (type: number): string => {
  const name = typeName(type)
  return name === 'UNKNOWN' ? `Type 0x${type.toString(16)}` : name
}

// ---------- empty / starter projects ----------

export const emptyTypeCProject = (faceNumber = 50001): TypeCProject => ({
  format: 'typeC',
  fileName: null,
  fileID: 0x81,
  faceNumber,
  animationFrames: 0,
  layers: [],
  assetSets: [],
  guides: [],
})

export const emptyFaceNProject = (): FaceNProject => ({
  format: 'faceN',
  fileName: null,
  face: {
    header: {
      apiVer: 1,
      unknown: 0,
      previewOffset: 0,
      previewWidth: 0,
      previewHeight: 0,
      digitsHeaderOffset: 0,
      binaryHeaderOffset: 16,
    },
    preview: { offset: 0, width: 0, height: 0, rawSize: 0, rgba: null },
    digitSets: [],
    elements: [],
  },
  guides: [],
})

export const emptyProject = (format: WatchFormat): EditorProject =>
  format === 'typeC' ? emptyTypeCProject() : emptyFaceNProject()

// ---------- materialize TypeC → renderer-compatible shape ----------

type Materialized = {
  header: FaceHeader
  blobs: DecodedBlob[]
  /** assetSetId → starting blob index in the materialized array. */
  setStartIdx: Map<string, number>
}

const blankFaceData = (): FaceDataEntry => ({
  type: 0,
  idx: 0,
  x: 0,
  y: 0,
  w: 0,
  h: 0,
})

/** Flatten a TypeCProject into the (FaceHeader, DecodedBlob[]) pair the
 *  binary renderer + packer expect. Only **consumed** asset sets (sets that
 *  at least one layer references) are emitted into the blob array — orphan
 *  sets remain in `project.assetSets` for the user's library but are
 *  excluded from the .bin so the firmware doesn't ship dead pixels. ZIP
 *  exports include orphans via the side-file path (see `exportTypeCZip`). */
export const materializeTypeC = (project: TypeCProject): Materialized => {
  const setStartIdx = new Map<string, number>()
  const blobs: DecodedBlob[] = []
  let cursor = 0

  // Consumed = sets referenced by at least one layer. Orphans skip the .bin
  // entirely (see ZIP side-file path).
  const consumedRaw = project.assetSets.filter((set) =>
    project.layers.some((l) => l.assetSetId === set.id),
  )

  // Blob-order matters for firmware compatibility. Comparing the user's
  // broken My-Blue.bin against the working `new (1).bin` showed identical
  // FaceData but completely different blob layouts — and the working file
  // clusters all count-11 progress bars (HR/KCAL/STEPS_PROGBAR) at idx 0–32.
  // The editor's old order ("walk assetSets in insertion order") scattered
  // them across the file (idx 0, 64, 86), which left STEPS/KCAL_PROGBAR stuck
  // on frame 0 on the watch.
  //
  // Sort priority that matches the reference's pattern:
  //   1. PROGBAR types first (0x70 STEPS_PROGBAR, 0x80 HR_PROGBAR,
  //      0x90 KCAL_PROGBAR, 0xa0 DIST_PROGBAR) — these are the "showing wrong
  //      frame" candidates, and the reference always places them at low idx.
  //   2. Then sets with count ≥ 2 (digit sets, name strings) by descending
  //      count so count-12 MONTH_NAME and count-10 digit sets cluster.
  //   3. Single-blob items (SEPs, hands, logos, count = 1) last.
  // Original asset-library order breaks ties so the user's "first/second TIME
  // set" choice is preserved when two sets have the same priority + count.
  const PROGBAR_TYPES = new Set([0x70, 0x80, 0x90, 0xa0])
  const firstConsumerType = (setId: string): number | null =>
    project.layers.find((l) => l.assetSetId === setId)?.type ?? null
  const categoryFor = (count: number, type: number | null): number => {
    if (type !== null && PROGBAR_TYPES.has(type)) return 0
    if (count > 1) return 1
    return 2
  }
  const consumed = [...consumedRaw]
    .map((set, originalIdx) => ({
      set,
      originalIdx,
      category: categoryFor(set.count, firstConsumerType(set.id)),
    }))
    .sort((a, b) => {
      if (a.category !== b.category) return a.category - b.category
      if (a.set.count !== b.set.count) return b.set.count - a.set.count
      return a.originalIdx - b.originalIdx
    })
    .map((e) => e.set)

  for (const set of consumed) {
    setStartIdx.set(set.id, cursor)
    // Find a representative consumer to label this set's blobs with `type`.
    const firstConsumer = project.layers.find((l) => l.assetSetId === set.id)
    const type = firstConsumer?.type ?? null
    const tName = type !== null ? typeName(type) : 'UNKNOWN'
    for (let i = 0; i < set.count; i++) {
      const slot = set.slots[i]
      const rgba = slot?.rgba ?? null
      blobs.push({
        index: cursor,
        faceDataIdx: null, // filled below once layer order is decided
        type,
        typeName: tName,
        width: set.width,
        height: set.height,
        // Round-trip the encoding the slot was imported with. Falls back to
        // RLE_LINE for freshly-created slots; packTypeC's raw-fallback still
        // applies when RLE wouldn't shrink the blob.
        compression: slot?.compression ?? 'RLE_LINE',
        rawSize: set.width * set.height * 2,
        rgba,
        raw: new Uint8Array(0),
      })
      cursor++
    }
  }

  // Build faceData (39 entries, first N from layers, rest blank).
  const faceData: FaceDataEntry[] = Array.from({ length: 39 }, blankFaceData)
  project.layers.forEach((layer, layerIdx) => {
    const set = project.assetSets.find((s) => s.id === layer.assetSetId)
    if (!set) return
    const start = setStartIdx.get(layer.assetSetId) ?? 0
    faceData[layerIdx] = {
      type: layer.type,
      idx: start,
      x: layer.x,
      y: layer.y,
      w: set.width,
      h: set.height,
    }
    // Stamp the first consumer's index onto its blobs (helpful for the asset
    // section / `findFaceDataIdx`-style logic in callers).
    for (let i = 0; i < set.count; i++) {
      const b = blobs[start + i]
      if (b && b.faceDataIdx === null) b.faceDataIdx = layerIdx
    }
  })

  const header: FaceHeader = {
    fileID: project.fileID,
    dataCount: project.layers.length,
    blobCount: blobs.length,
    faceNumber: project.faceNumber,
    faceData,
    offsets: Array.from({ length: 250 }, () => 0),
    sizes: Array.from({ length: 250 }, () => 0),
    animationFrames: project.animationFrames,
  }

  return { header, blobs, setStartIdx }
}

// ---------- import: binary → TypeCProject ----------

/** Heuristic: two faceData entries point at the same AssetSet iff they have
 *  the same (idx, blobCount) pair. Anything else (overlap without exact
 *  match) gets its own set. */
const decodeTypeCBin = (data: Uint8Array, fileName: string): TypeCProject => {
  const { header, blobs } = decodeFile(data)

  // Group faceData entries by (idx, count).
  const setKey = (idx: number, count: number): string => `${idx}:${count}`
  const groupForKey = new Map<string, AssetSet>()
  const layerToKey: { layer: TypeCLayer; key: string }[] = []

  for (let i = 0; i < header.dataCount; i++) {
    const fd = header.faceData[i]
    const count = blobCountForType(fd.type, header.animationFrames)
    const key = setKey(fd.idx, count)

    if (!groupForKey.has(key)) {
      const slots: AssetSlot[] = []
      // Pick blob-recorded w/h if available (covers blobs whose `type` was
      // overridden by `findFaceDataIdx`'s first match).
      const firstBlob = blobs[fd.idx]
      const w = firstBlob?.width ?? fd.w
      const h = firstBlob?.height ?? fd.h
      for (let j = 0; j < count; j++) {
        const blob = blobs[fd.idx + j]
        // Preserve the per-slot compression observed in the source .bin so
        // round-tripping doesn't silently switch RLE→raw or vice versa.
        // The firmware doesn't always tolerate that swap (see AssetSlot doc).
        slots.push({
          rgba: blob?.rgba ?? null,
          compression: blob?.compression,
        })
      }
      groupForKey.set(key, {
        id: nextId('asset'),
        name: defaultSetName(fd.type),
        width: w ?? 0,
        height: h ?? 0,
        count,
        kind: kindForType(fd.type),
        slots,
      })
    }
    const set = groupForKey.get(key)!
    layerToKey.push({
      layer: {
        id: nextId('layer'),
        type: fd.type,
        x: fd.x,
        y: fd.y,
        assetSetId: set.id,
      },
      key,
    })
  }

  return {
    format: 'typeC',
    fileName,
    fileID: header.fileID,
    faceNumber: header.faceNumber,
    animationFrames: header.animationFrames,
    layers: layerToKey.map((e) => e.layer),
    assetSets: Array.from(groupForKey.values()),
    guides: [],
  }
}

// ---------- import: file → EditorProject ----------

export const importBin = async (file: File): Promise<EditorProject> => {
  const data = new Uint8Array(await file.arrayBuffer())
  const fmt = detectFormat(data)
  if (fmt === 'typeC') return decodeTypeCBin(data, file.name)
  if (fmt === 'faceN') {
    const face = parseFaceN(data)
    return { format: 'faceN', fileName: file.name, face, guides: [] }
  }
  throw new Error(
    `Unrecognized .bin format. First byte 0x${data[0]?.toString(16).padStart(2, '0')}.`,
  )
}

// ---------- import: ZIP ----------

type LoadedAssets = {
  byName: Map<string, DecodedBitmap>
  byNumber: Map<number, DecodedBitmap>
  rawByNumber: Map<number, Uint8Array>
}

const loadZipAssets = async (zip: JSZip): Promise<LoadedAssets> => {
  const byName = new Map<string, DecodedBitmap>()
  const byNumber = new Map<number, DecodedBitmap>()
  const rawByNumber = new Map<number, Uint8Array>()

  const bmpEntries = Object.values(zip.files).filter(
    (f) => !f.dir && /\.bmp$/i.test(f.name),
  )
  for (const entry of bmpEntries) {
    const data = await entry.async('uint8array')
    const bitmap = decodeBmp(data)
    const fileName = entry.name.split('/').pop() ?? entry.name
    byName.set(fileName, bitmap)
    const match = fileName.match(/(\d+)\.bmp$/i)
    if (match) byNumber.set(parseInt(match[1], 10), bitmap)
  }
  const rawEntries = Object.values(zip.files).filter(
    (f) => !f.dir && /\.raw$/i.test(f.name),
  )
  for (const entry of rawEntries) {
    const data = await entry.async('uint8array')
    const fileName = entry.name.split('/').pop() ?? entry.name
    const match = fileName.match(/(\d+)\.raw$/i)
    if (match) rawByNumber.set(parseInt(match[1], 10), data)
  }
  return { byName, byNumber, rawByNumber }
}

const padIdx = (n: number) => String(n).padStart(3, '0')

export const importZip = async (file: File): Promise<EditorProject> => {
  const zip = await JSZip.loadAsync(file)
  // Prefer the editor's own side-file when present — it carries orphan asset
  // sets and exact layer/set wiring that watchface.txt can't represent.
  const projectEntry = zip.file(/project\.json$/i)[0]
  if (projectEntry) {
    return restoreFromProjectJson(zip, file.name)
  }
  const txtEntry = zip.file(/watchface\.txt$/i)[0]
  const jsonEntry = zip.file(/watchface\.json$/i)[0]
  if (!txtEntry && !jsonEntry) {
    throw new Error(
      'ZIP must contain watchface.txt (Type C) or watchface.json (FaceN).',
    )
  }
  const assets = await loadZipAssets(zip)

  if (txtEntry) {
    const txt = await txtEntry.async('string')
    const config = parseWatchfaceTxt(txt)
    const total = assets.byNumber.size + assets.rawByNumber.size
    if (config.blobCount > total) {
      throw new Error(
        `watchface.txt declares blobCount=${config.blobCount} but ZIP only has ${total} blob asset(s).`,
      )
    }
    const ordered: PackTypeCBlob[] = []
    for (let i = 0; i < config.blobCount; i++) {
      const bmp = assets.byNumber.get(i)
      if (bmp) {
        ordered.push({ kind: 'bitmap', ...bmp })
        continue
      }
      const raw = assets.rawByNumber.get(i)
      if (raw) {
        ordered.push({ kind: 'raw', data: raw })
        continue
      }
      throw new Error(`Missing ${padIdx(i)}.bmp or ${padIdx(i)}.raw for blob ${i}`)
    }
    const bin = packTypeC({ config, blobs: ordered })
    return decodeTypeCBin(bin, file.name)
  }

  const txt = await jsonEntry!.async('string')
  const config = parseWatchfaceJson(txt)
  const bin = packFaceN({ config, bitmaps: assets.byName })
  const face = parseFaceN(bin)
  return { format: 'faceN', fileName: file.name, face, guides: [] }
}

// ---------- export: TypeC project → bin ----------

/** Re-pack a Type C project. Materializes the project (layers + assetSets →
 *  blob array) and feeds the dawft encoder. */
export const exportTypeCBin = (project: TypeCProject): Uint8Array => {
  const { header, blobs } = materializeTypeC(project)
  const activeFaceData = header.faceData
    .slice(0, header.dataCount)
    .map((fd) => ({ ...fd }))
  const config: ParsedWatchfaceTxt = {
    fileType: 'C',
    fileID: header.fileID,
    faceNumber: header.faceNumber,
    blobCount: header.blobCount,
    animationFrames: header.animationFrames,
    faceData: activeFaceData,
    compressions: new Map(blobs.map((b) => [b.index, b.compression])),
  }
  const packBlobs: PackTypeCBlob[] = blobs.map((b) =>
    b.rgba && b.width !== null && b.height !== null
      ? { kind: 'bitmap', width: b.width, height: b.height, rgba: b.rgba }
      : { kind: 'raw', data: b.raw },
  )
  return packTypeC({ config, blobs: packBlobs })
}

/** Side-file schema that lives next to watchface.txt in the ZIP, capturing
 *  the full editor state — including orphan asset sets that the .bin doesn't
 *  carry. Re-imported on `importZip`, otherwise gracefully ignored by dawft. */
type ProjectJsonV1 = {
  version: 1
  format: 'typeC'
  fileID: number
  faceNumber: number
  animationFrames: number
  fileName: string | null
  layers: TypeCLayer[]
  assetSets: {
    id: string
    name: string
    width: number
    height: number
    count: number
    kind: AssetSetKind
    /** Filename per slot. Consumed slots map to `dbNNN.bmp`; orphans map to
     *  `orphan_<setId>_<slotIdx>.bmp`. null means empty/no bitmap. */
    slotFiles: (string | null)[]
    /** Per-slot blob encoding observed at import time. Preserved across the
     *  ZIP round-trip so re-export emits the firmware-correct compression
     *  (some MoYoung firmwares mis-decode RLE for certain blobs). Undefined
     *  entries fall back to the encoder default. */
    slotCompressions?: ('RLE_LINE' | 'NONE' | null)[]
  }[]
  /** Editor-only design overlay. Watch firmware ignores extra JSON fields,
   *  so guides survive the dawft ZIP round-trip safely. Optional for
   *  forward-compat: older project.json predates this field. */
  guides?: GuideLine[]
}

const orphanSlotName = (setId: string, slotIdx: number): string =>
  `orphan_${setId}_${slotIdx}.bmp`

export const exportTypeCZip = async (project: TypeCProject): Promise<Blob> => {
  const { header, blobs, setStartIdx } = materializeTypeC(project)
  const zip = new JSZip()

  // dawft-compatible payload: only consumed sets land in watchface.txt and
  // the dbNNN.bmp sequence. Anything orphaned in the editor is excluded so
  // the .bin (and the ZIP-derived .bin via dawft create) stays compact.
  zip.file('watchface.txt', buildWatchfaceTxt(header, blobs))
  for (const b of blobs) {
    const name = padIdx(b.index)
    if (b.rgba && b.width !== null && b.height !== null) {
      zip.file(`${name}.bmp`, encodeBmpRgb565(b.rgba, b.width, b.height))
    } else {
      zip.file(`${name}.raw`, b.raw)
    }
  }

  // Orphan slots travel in separately-named BMPs so dawft/firmware ignores
  // them (no faceData entry references them) but the editor can recover them
  // on re-import via project.json.
  for (const set of project.assetSets) {
    if (setStartIdx.has(set.id)) continue
    for (let i = 0; i < set.count; i++) {
      const slot = set.slots[i]
      if (!slot.rgba || set.width === 0 || set.height === 0) continue
      zip.file(
        orphanSlotName(set.id, i),
        encodeBmpRgb565(slot.rgba, set.width, set.height),
      )
    }
  }

  const projectJson: ProjectJsonV1 = {
    version: 1,
    format: 'typeC',
    fileID: project.fileID,
    faceNumber: project.faceNumber,
    animationFrames: project.animationFrames,
    fileName: project.fileName,
    layers: project.layers,
    assetSets: project.assetSets.map((set) => {
      const start = setStartIdx.get(set.id)
      const slotFiles = set.slots.map((slot, i): string | null => {
        if (!slot.rgba) return null
        if (start !== undefined) return `${padIdx(start + i)}.bmp`
        return orphanSlotName(set.id, i)
      })
      const slotCompressions = set.slots.map(
        (slot): 'RLE_LINE' | 'NONE' | null => slot.compression ?? null,
      )
      return {
        id: set.id,
        name: set.name,
        width: set.width,
        height: set.height,
        count: set.count,
        kind: set.kind,
        slotFiles,
        slotCompressions,
      }
    }),
    guides: project.guides,
  }
  zip.file('project.json', JSON.stringify(projectJson, null, 2))

  return zip.generateAsync({ type: 'blob' })
}

/** Reconstitute a TypeCProject from a `project.json` + BMP collection inside
 *  a ZIP. Used by `importZip` when the side-file is present — it carries the
 *  orphan asset sets that watchface.txt alone can't represent. */
const restoreFromProjectJson = async (
  zip: JSZip,
  fileName: string,
): Promise<TypeCProject> => {
  const entry = zip.file(/project\.json$/i)[0]
  if (!entry) throw new Error('project.json missing from ZIP')
  const raw: unknown = JSON.parse(await entry.async('string'))
  if (
    !raw ||
    typeof raw !== 'object' ||
    (raw as { version?: unknown }).version !== 1 ||
    (raw as { format?: unknown }).format !== 'typeC'
  ) {
    throw new Error('Unsupported project.json (version/format mismatch).')
  }
  const json = raw as ProjectJsonV1

  const assetSets: AssetSet[] = []
  for (const setJson of json.assetSets) {
    const slots: AssetSlot[] = []
    for (let i = 0; i < setJson.count; i++) {
      const fn = setJson.slotFiles[i]
      // Restore per-slot compression hint when the side-file carried one
      // (older project.json files won't, hence the optional field).
      const compressionRaw = setJson.slotCompressions?.[i] ?? null
      const compression: 'RLE_LINE' | 'NONE' | undefined =
        compressionRaw === 'RLE_LINE' || compressionRaw === 'NONE'
          ? compressionRaw
          : undefined
      if (!fn) {
        slots.push({ rgba: null, compression })
        continue
      }
      const file = zip.file(fn)
      if (!file) {
        slots.push({ rgba: null, compression })
        continue
      }
      try {
        const bytes = await file.async('uint8array')
        const bmp = decodeBmp(bytes)
        slots.push({ rgba: bmp.rgba, compression })
      } catch {
        slots.push({ rgba: null, compression })
      }
    }
    assetSets.push({
      id: setJson.id,
      name: setJson.name,
      width: setJson.width,
      height: setJson.height,
      count: setJson.count,
      kind: setJson.kind,
      slots,
    })
  }

  return {
    format: 'typeC',
    fileName,
    fileID: json.fileID,
    faceNumber: json.faceNumber,
    animationFrames: json.animationFrames,
    layers: json.layers,
    assetSets,
    guides: sanitizeGuides(json.guides),
  }
}

/** Defensive parse for guides coming off project.json — discards malformed
 *  entries instead of throwing, so a corrupt side-file still opens. */
const sanitizeGuides = (raw: unknown): GuideLine[] => {
  if (!Array.isArray(raw)) return []
  const out: GuideLine[] = []
  for (const g of raw) {
    if (!g || typeof g !== 'object') continue
    const r = g as Record<string, unknown>
    if (typeof r.id !== 'string') continue
    if (r.axis !== 'H' && r.axis !== 'V') continue
    if (typeof r.position !== 'number' || !Number.isFinite(r.position)) continue
    out.push({
      id: r.id,
      axis: r.axis,
      position: r.position,
      visible: r.visible !== false,
    })
  }
  return out
}

// ---------- export: FaceN ----------

const faceNToPackInput = (
  face: FaceN,
): { config: ParsedWatchfaceJson; bitmaps: Map<string, DecodedBitmap> } => {
  const { files, names } = collectBlobs(face)
  const bitmaps = new Map<string, DecodedBitmap>()
  for (const f of files) {
    if (f.rgba && f.width > 0 && f.height > 0) {
      bitmaps.set(f.name, { width: f.width, height: f.height, rgba: f.rgba })
    }
  }
  const digitSets = face.digitSets.map((set, sIdx) => ({
    unknown: set.unknown,
    digits: set.digits.map((d, dIdx) => ({
      w: d.width,
      h: d.height,
      fileName: names.digits[sIdx]?.[dIdx] ?? null,
    })),
  }))
  const wh = (img: { width: number; height: number }, fileName: string | null) => ({
    w: img.width,
    h: img.height,
    fileName,
  })
  const pickFirst = (v: string | string[] | null | undefined, i: number): string | null => {
    if (Array.isArray(v)) return v[i] ?? null
    if (typeof v === 'string' && i === 0) return v
    return null
  }
  const elements: ParsedElement[] = face.elements.map((el, eIdx) => {
    const fname = names.elements[eIdx]
    switch (el.kind) {
      case 'Image':
        return { kind: 'Image', x: el.x, y: el.y, img: wh(el.img, pickFirst(fname, 0)) }
      case 'TimeNum':
        return {
          kind: 'TimeNum',
          digitSets: [...el.digitSets],
          xys: el.xys.map((p) => ({ x: p.x, y: p.y })),
          unknown: new Uint8Array(el.padding),
        }
      case 'DayName':
        return {
          kind: 'DayName',
          nType: el.nType,
          x: el.x,
          y: el.y,
          imgs: el.imgs.map((img, i) => wh(img, pickFirst(fname, i))),
        }
      case 'BatteryFill':
        return {
          kind: 'BatteryFill',
          x: el.x,
          y: el.y,
          bgImg: wh(el.bgImg, pickFirst(fname, 0)),
          x1: el.x1,
          y1: el.y1,
          x2: el.x2,
          y2: el.y2,
          unknown0: el.unknown0,
          unknown1: el.unknown1,
          img1: wh(el.img1, pickFirst(fname, 1)),
          img2: wh(el.img2, pickFirst(fname, 2)),
        }
      case 'HeartRateNum':
      case 'StepsNum':
      case 'KCalNum':
        return { kind: el.kind, digitSet: el.digitSet, align: el.align, x: el.x, y: el.y }
      case 'TimeHand':
        return {
          kind: 'TimeHand',
          hType: el.hType,
          pivotX: el.pivotX,
          pivotY: el.pivotY,
          img: wh(el.img, pickFirst(fname, 0)),
          x: el.x,
          y: el.y,
        }
      case 'DayNum':
      case 'MonthNum':
        return {
          kind: el.kind,
          digitSet: el.digitSet,
          align: el.align,
          xys: [
            { x: el.xys[0].x, y: el.xys[0].y },
            { x: el.xys[1].x, y: el.xys[1].y },
          ],
        }
      case 'BarDisplay':
        return {
          kind: 'BarDisplay',
          bType: el.bType,
          count: el.count,
          x: el.x,
          y: el.y,
          imgs: el.imgs.map((img, i) => wh(img, pickFirst(fname, i))),
        }
      case 'Weather':
        return {
          kind: 'Weather',
          count: el.count,
          x: el.x,
          y: el.y,
          imgs: el.imgs.map((img, i) => wh(img, pickFirst(fname, i))),
        }
      case 'Unknown29':
        return { kind: 'Unknown29', unknown: el.unknown }
      case 'Dash':
        return { kind: 'Dash', img: wh(el.img, pickFirst(fname, 0)) }
      case 'Unknown':
        return { kind: 'Unknown29', unknown: 0 }
    }
  })
  const config: ParsedWatchfaceJson = {
    apiVer: face.header.apiVer,
    unknown: face.header.unknown,
    previewName: face.preview.rgba ? 'preview.bmp' : null,
    previewW: face.preview.width,
    previewH: face.preview.height,
    digitSets,
    elements,
  }
  return { config, bitmaps }
}

export const exportFaceNBin = (project: FaceNProject): Uint8Array => {
  const { config, bitmaps } = faceNToPackInput(project.face)
  return packFaceN({ config, bitmaps })
}

export const exportFaceNZip = async (project: FaceNProject): Promise<Blob> => {
  const zip = new JSZip()
  const { files, names } = collectBlobs(project.face)
  zip.file('watchface.json', buildFaceNJson(project.face, names))
  for (const f of files) {
    if (f.rgba && f.width > 0 && f.height > 0) {
      zip.file(f.name, encodeBmp32(f.rgba, f.width, f.height))
    }
  }
  return zip.generateAsync({ type: 'blob' })
}

// ---------- unified export ----------

export const exportBin = (project: EditorProject): Uint8Array =>
  project.format === 'typeC' ? exportTypeCBin(project) : exportFaceNBin(project)

export const exportZip = (project: EditorProject): Promise<Blob> =>
  project.format === 'typeC' ? exportTypeCZip(project) : exportFaceNZip(project)

// ---------- file-save helper ----------

export const downloadBlob = (data: Blob | Uint8Array, filename: string, mime?: string) => {
  let blob: Blob
  if (data instanceof Blob) {
    blob = data
  } else {
    const copy = new Uint8Array(data.byteLength)
    copy.set(data)
    blob = new Blob([copy.buffer], { type: mime ?? 'application/octet-stream' })
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ---------- layer helpers ----------

export type LayerView = {
  /** Index into the project's layers array (Type C) or face.elements (FaceN). */
  index: number
  name: string
  x: number | null
  y: number | null
  w: number | null
  h: number | null
  /** Type C only: the AssetSet this layer paints from. null for FaceN. */
  assetSetId?: string
  /** Type C only: how many other layers share this set. 0 means exclusive. */
  shareCount?: number
}

export const listLayers = (project: EditorProject): LayerView[] => {
  if (project.format === 'typeC') {
    const consumerCount = new Map<string, number>()
    for (const l of project.layers) {
      consumerCount.set(l.assetSetId, (consumerCount.get(l.assetSetId) ?? 0) + 1)
    }
    return project.layers.map((layer, i) => {
      const set = project.assetSets.find((s) => s.id === layer.assetSetId)
      const hex = layer.type.toString(16).padStart(2, '0')
      return {
        index: i,
        name: `${typeName(layer.type)} (0x${hex})`,
        x: layer.x,
        y: layer.y,
        w: set?.width ?? null,
        h: set?.height ?? null,
        assetSetId: layer.assetSetId,
        shareCount: (consumerCount.get(layer.assetSetId) ?? 1) - 1,
      }
    })
  }
  return project.face.elements.map((el, i) => {
    const pos = elementPosition(el)
    return { index: i, name: faceNElementLabel(el, i), x: pos.x, y: pos.y, w: pos.w, h: pos.h }
  })
}

const elementPosition = (
  el: FaceN['elements'][number],
): { x: number | null; y: number | null; w: number | null; h: number | null } => {
  switch (el.kind) {
    case 'Image':
      return { x: el.x, y: el.y, w: el.img.width, h: el.img.height }
    case 'TimeNum':
      return { x: el.xys[0].x, y: el.xys[0].y, w: null, h: null }
    case 'DayName':
      return { x: el.x, y: el.y, w: null, h: null }
    case 'BatteryFill':
      return { x: el.x, y: el.y, w: el.bgImg.width, h: el.bgImg.height }
    case 'HeartRateNum':
    case 'StepsNum':
    case 'KCalNum':
      return { x: el.x, y: el.y, w: null, h: null }
    case 'TimeHand':
      return { x: el.x, y: el.y, w: el.img.width, h: el.img.height }
    case 'DayNum':
    case 'MonthNum':
      return { x: el.xys[0].x, y: el.xys[0].y, w: null, h: null }
    case 'BarDisplay':
    case 'Weather':
      return { x: el.x, y: el.y, w: null, h: null }
    case 'Dash':
      return { x: null, y: null, w: el.img.width, h: el.img.height }
    case 'Unknown29':
    case 'Unknown':
      return { x: null, y: null, w: null, h: null }
  }
}

const faceNElementLabel = (el: FaceN['elements'][number], i: number): string =>
  `${i}. ${el.kind}`

// ---------- position helpers ----------

export const setLayerXY = (
  project: EditorProject,
  index: number,
  x: number,
  y: number,
): EditorProject => {
  if (project.format === 'typeC') {
    const layers = project.layers.map((l, i) => (i === index ? { ...l, x, y } : l))
    return { ...project, layers }
  }
  const elements = project.face.elements.map((el, i) => {
    if (i !== index) return el
    return setElementXY(el, x, y)
  })
  return { ...project, face: { ...project.face, elements } }
}

type FNEl = FaceN['elements'][number]

const shiftElement = (el: FNEl, dx: number, dy: number): FNEl => {
  switch (el.kind) {
    case 'Image':
    case 'DayName':
    case 'BatteryFill':
    case 'HeartRateNum':
    case 'StepsNum':
    case 'KCalNum':
    case 'TimeHand':
    case 'BarDisplay':
    case 'Weather':
      return { ...el, x: el.x + dx, y: el.y + dy }
    case 'TimeNum': {
      const xys = el.xys.map((p) => ({ x: p.x + dx, y: p.y + dy }))
      return { ...el, xys: [xys[0], xys[1], xys[2], xys[3]] }
    }
    case 'DayNum':
    case 'MonthNum':
      return {
        ...el,
        xys: [
          { x: el.xys[0].x + dx, y: el.xys[0].y + dy },
          { x: el.xys[1].x + dx, y: el.xys[1].y + dy },
        ],
      }
    case 'Dash':
    case 'Unknown29':
    case 'Unknown':
      return el
  }
}

const setElementXY = (el: FNEl, x: number, y: number): FNEl => {
  switch (el.kind) {
    case 'Image':
    case 'DayName':
    case 'BatteryFill':
    case 'HeartRateNum':
    case 'StepsNum':
    case 'KCalNum':
    case 'TimeHand':
    case 'BarDisplay':
    case 'Weather':
      return { ...el, x, y }
    case 'TimeNum':
    case 'DayNum':
    case 'MonthNum': {
      const dx = x - el.xys[0].x
      const dy = y - el.xys[0].y
      return shiftElement(el, dx, dy)
    }
    case 'Dash':
    case 'Unknown29':
    case 'Unknown':
      return el
  }
}

// ---------- reorder / delete ----------

export const reorderLayer = (
  project: EditorProject,
  index: number,
  direction: 'up' | 'down',
): EditorProject => {
  if (project.format === 'typeC') {
    const list = [...project.layers]
    const target = direction === 'up' ? index + 1 : index - 1
    if (target < 0 || target >= list.length) return project
    ;[list[index], list[target]] = [list[target], list[index]]
    return { ...project, layers: list }
  }
  const list = [...project.face.elements]
  const target = direction === 'up' ? index + 1 : index - 1
  if (target < 0 || target >= list.length) return project
  ;[list[index], list[target]] = [list[target], list[index]]
  return { ...project, face: { ...project.face, elements: list } }
}

/** Move a layer from `from` to `to` in the array — drag-to-reorder.
 *  `to` is the post-removal index (i.e. the slot the layer should occupy
 *  after the move). Clamps out-of-range values and is a no-op when the
 *  positions are equal. */
export const moveLayer = (
  project: EditorProject,
  from: number,
  to: number,
): EditorProject => {
  const reorder = <T>(arr: T[]): T[] => {
    const out = arr.slice()
    if (from < 0 || from >= out.length) return arr
    const clampedTo = Math.max(0, Math.min(out.length - 1, to))
    if (clampedTo === from) return arr
    const [item] = out.splice(from, 1)
    out.splice(clampedTo, 0, item)
    return out
  }
  if (project.format === 'typeC') {
    const layers = reorder(project.layers)
    return layers === project.layers ? project : { ...project, layers }
  }
  const elements = reorder(project.face.elements)
  return elements === project.face.elements
    ? project
    : { ...project, face: { ...project.face, elements } }
}

/** Remove a layer. Asset sets stay in the library regardless of consumer
 *  count — orphan sets are excluded from the .bin at pack time (see
 *  `materializeTypeC`) but preserved in editor state and ZIP exports. */
export const deleteLayer = (
  project: EditorProject,
  index: number,
): EditorProject => {
  if (project.format === 'typeC') {
    const layer = project.layers[index]
    if (!layer) return project
    const layers = project.layers.filter((_, i) => i !== index)
    return { ...project, layers }
  }
  const elements = [...project.face.elements]
  elements.splice(index, 1)
  return { ...project, face: { ...project.face, elements } }
}

// ---------- preview rebuilder (used by /pack & legacy callers) ----------

export const rebuildTypeCPreview = (
  project: TypeCProject,
): { header: FaceHeader; blobs: DecodedBlob[] } | null => {
  if (project.layers.length === 0) return null
  try {
    const bin = exportTypeCBin(project)
    if (bin.byteLength <= TYPE_C_HEADER_SIZE) return null
    return decodeFile(bin)
  } catch {
    return null
  }
}

export const rebuildFaceNPreview = (project: FaceNProject): FaceN | null => {
  if (project.face.elements.length === 0 && project.face.digitSets.length === 0) {
    return null
  }
  try {
    const bin = exportFaceNBin(project)
    return parseFaceN(bin)
  } catch {
    return null
  }
}

// ===================================================================
// Asset model: enumeration + replace + insert + share + regenerate
// ===================================================================

export type AssetRef =
  | { tag: 'typeC-slot'; setId: string; slotIdx: number }
  | { tag: 'faceN-preview' }
  | { tag: 'faceN-digit'; setIdx: number; digitIdx: number }
  | { tag: 'faceN-elem'; elementIdx: number; slotIdx: number }

export type AssetView = {
  ref: AssetRef
  label: string
  width: number
  height: number
  rgba: Uint8ClampedArray | null
}

const dayNameLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const batteryFillLabels = ['bg', 'fill', 'mask']

export const listLayerAssets = (
  project: EditorProject,
  layerIdx: number,
): AssetView[] => {
  if (project.format === 'typeC') {
    const layer = project.layers[layerIdx]
    if (!layer) return []
    const set = project.assetSets.find((s) => s.id === layer.assetSetId)
    if (!set) return []
    return set.slots.map((slot, i) => ({
      ref: { tag: 'typeC-slot', setId: set.id, slotIdx: i },
      label: `${i}`,
      width: set.width,
      height: set.height,
      rgba: slot.rgba,
    }))
  }

  const el = project.face.elements[layerIdx]
  if (!el) return []
  const mkRef = (slotIdx: number): AssetRef => ({
    tag: 'faceN-elem',
    elementIdx: layerIdx,
    slotIdx,
  })
  switch (el.kind) {
    case 'Image':
      return [
        {
          ref: mkRef(0),
          label: 'image',
          width: el.img.width,
          height: el.img.height,
          rgba: el.img.rgba,
        },
      ]
    case 'DayName':
      return el.imgs.map((img, i) => ({
        ref: mkRef(i),
        label: dayNameLabels[i] ?? String(i),
        width: img.width,
        height: img.height,
        rgba: img.rgba,
      }))
    case 'BatteryFill':
      return [el.bgImg, el.img1, el.img2].map((img, i) => ({
        ref: mkRef(i),
        label: batteryFillLabels[i] ?? String(i),
        width: img.width,
        height: img.height,
        rgba: img.rgba,
      }))
    case 'TimeHand':
      return [
        {
          ref: mkRef(0),
          label: 'hand',
          width: el.img.width,
          height: el.img.height,
          rgba: el.img.rgba,
        },
      ]
    case 'BarDisplay':
    case 'Weather':
      return el.imgs.map((img, i) => ({
        ref: mkRef(i),
        label: String(i),
        width: img.width,
        height: img.height,
        rgba: img.rgba,
      }))
    case 'Dash':
      return [
        {
          ref: mkRef(0),
          label: 'dash',
          width: el.img.width,
          height: el.img.height,
          rgba: el.img.rgba,
        },
      ]
    case 'TimeNum':
    case 'HeartRateNum':
    case 'StepsNum':
    case 'KCalNum':
    case 'DayNum':
    case 'MonthNum':
    case 'Unknown29':
    case 'Unknown':
      return []
  }
}

// ---------- BMP file → DecodedBitmap ----------

export const decodeBmpFile = async (file: File): Promise<DecodedBitmap> => {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const bmp = decodeBmp(bytes)
  return { width: bmp.width, height: bmp.height, rgba: bmp.rgba }
}

// ---------- replace asset ----------

export type ReplaceOpts = {
  requireDimMatch: boolean
  /** When the new BMP changes dims of a multi-slot AssetSet, clear the
   *  other slots' rgba (preserving each slot's `compression`). Without this
   *  the set ends up with mixed dimensions, which the firmware can't render.
   *  Only meaningful for Type C. */
  clearOtherSlots?: boolean
}

const requireMatch = (
  existing: { width: number; height: number },
  next: DecodedBitmap,
  label: string,
): void => {
  if (existing.width === 0 || existing.height === 0) return
  if (existing.width !== next.width || existing.height !== next.height) {
    throw new Error(
      `${label}: dimensions must match. Slot is ${existing.width}×${existing.height} but BMP is ${next.width}×${next.height}.`,
    )
  }
}

export const replaceAsset = (
  project: EditorProject,
  ref: AssetRef,
  bitmap: DecodedBitmap,
  opts: ReplaceOpts = { requireDimMatch: true },
): EditorProject => {
  if (project.format === 'typeC' && ref.tag === 'typeC-slot') {
    const set = project.assetSets.find((s) => s.id === ref.setId)
    if (!set) return project
    // Type C requires uniform dims across a set; if any slot is non-empty,
    // the new BMP must match.
    if (opts.requireDimMatch && set.width > 0 && set.height > 0) {
      requireMatch({ width: set.width, height: set.height }, bitmap, `slot ${ref.slotIdx}`)
    }
    const slots = set.slots.map((s, i) => {
      // Keep the imported-from-bin compression hint when only the pixels are
      // being replaced — same firmware-round-trip concern as elsewhere.
      if (i === ref.slotIdx) return { ...s, rgba: bitmap.rgba }
      return opts.clearOtherSlots ? { ...s, rgba: null } : s
    })
    const assetSets = project.assetSets.map((s) =>
      s.id === ref.setId
        ? { ...s, width: bitmap.width, height: bitmap.height, slots }
        : s,
    )
    return { ...project, assetSets }
  }

  if (project.format === 'faceN') {
    if (ref.tag === 'faceN-preview') {
      const cur = project.face.preview
      if (opts.requireDimMatch)
        requireMatch({ width: cur.width, height: cur.height }, bitmap, 'preview')
      return {
        ...project,
        face: {
          ...project.face,
          preview: { ...cur, width: bitmap.width, height: bitmap.height, rgba: bitmap.rgba },
        },
      }
    }
    if (ref.tag === 'faceN-digit') {
      const set = project.face.digitSets[ref.setIdx]
      if (!set) return project
      const slot = set.digits[ref.digitIdx]
      if (slot && opts.requireDimMatch)
        requireMatch(
          { width: slot.width, height: slot.height },
          bitmap,
          `digit ${ref.setIdx}/${ref.digitIdx}`,
        )
      const digits = set.digits.map((d, i) =>
        i === ref.digitIdx
          ? { ...d, width: bitmap.width, height: bitmap.height, rgba: bitmap.rgba }
          : d,
      )
      const digitSets = project.face.digitSets.map((s, i) =>
        i === ref.setIdx ? { ...s, digits } : s,
      )
      return { ...project, face: { ...project.face, digitSets } }
    }
    if (ref.tag === 'faceN-elem') {
      const elements = project.face.elements.map((el, i) =>
        i === ref.elementIdx ? patchElementAsset(el, ref.slotIdx, bitmap, opts) : el,
      )
      return { ...project, face: { ...project.face, elements } }
    }
  }
  return project
}

const swapImgRef = (
  cur: FaceN['preview'],
  bmp: DecodedBitmap,
  opts: ReplaceOpts,
  label: string,
): FaceN['preview'] => {
  if (opts.requireDimMatch)
    requireMatch({ width: cur.width, height: cur.height }, bmp, label)
  return { ...cur, width: bmp.width, height: bmp.height, rgba: bmp.rgba }
}

const patchElementAsset = (
  el: FNEl,
  slotIdx: number,
  bmp: DecodedBitmap,
  opts: ReplaceOpts,
): FNEl => {
  switch (el.kind) {
    case 'Image':
      return slotIdx === 0 ? { ...el, img: swapImgRef(el.img, bmp, opts, 'image') } : el
    case 'DayName': {
      const imgs = el.imgs.map((img, i) =>
        i === slotIdx ? swapImgRef(img, bmp, opts, dayNameLabels[i] ?? `${i}`) : img,
      )
      return { ...el, imgs }
    }
    case 'BatteryFill': {
      const labels = batteryFillLabels
      if (slotIdx === 0) return { ...el, bgImg: swapImgRef(el.bgImg, bmp, opts, labels[0]) }
      if (slotIdx === 1) return { ...el, img1: swapImgRef(el.img1, bmp, opts, labels[1]) }
      if (slotIdx === 2) return { ...el, img2: swapImgRef(el.img2, bmp, opts, labels[2]) }
      return el
    }
    case 'TimeHand':
      return slotIdx === 0 ? { ...el, img: swapImgRef(el.img, bmp, opts, 'hand') } : el
    case 'BarDisplay':
    case 'Weather': {
      const imgs = el.imgs.map((img, i) =>
        i === slotIdx ? swapImgRef(img, bmp, opts, String(i)) : img,
      )
      return { ...el, imgs }
    }
    case 'Dash':
      return slotIdx === 0 ? { ...el, img: swapImgRef(el.img, bmp, opts, 'dash') } : el
    case 'TimeNum':
    case 'HeartRateNum':
    case 'StepsNum':
    case 'KCalNum':
    case 'DayNum':
    case 'MonthNum':
    case 'Unknown29':
    case 'Unknown':
      return el
  }
}

// ---------- insert (Type C) ----------

const DIGITS = ['0','1','2','3','4','5','6','7','8','9'] as const
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] as const
const MONTHS = [
  'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec',
] as const

/** Unified Insert catalogue for Type C. Single source of truth — replaces the
 *  separate single-blob and multi-blob arrays. The `count`, `dim`, and `pos`
 *  defaults are corpus-derived (see `scripts/analyze-corpus.ts` /
 *  `faces-corpus/_type-defaults.json`); regenerating the corpus stats and
 *  refreshing this table is the right way to add a new type. `faces` is the
 *  prevalence in the 387-face corpus and drives display order. */
export type InsertableType = {
  type: number
  name: string
  count: number
  dim: { w: number; h: number }
  pos: { x: number; y: number }
  faces: number
  glyphs?: readonly string[]
}

export const TYPEC_INSERTABLE_TYPES: InsertableType[] = [
  // Time digits (count=10, the most popular types in the corpus)
  { type: 0x40, name: 'TIME_H1', count: 10, dim: { w: 21, h: 30 }, pos: { x: 53, y: 54 }, faces: 337, glyphs: DIGITS },
  { type: 0x41, name: 'TIME_H2', count: 10, dim: { w: 21, h: 30 }, pos: { x: 86, y: 54 }, faces: 337, glyphs: DIGITS },
  { type: 0x43, name: 'TIME_M1', count: 10, dim: { w: 21, h: 30 }, pos: { x: 129, y: 89 }, faces: 336, glyphs: DIGITS },
  { type: 0x44, name: 'TIME_M2', count: 10, dim: { w: 21, h: 30 }, pos: { x: 161, y: 89 }, faces: 336, glyphs: DIGITS },
  { type: 0x01, name: 'BACKGROUND', count: 1, dim: { w: 240, h: 240 }, pos: { x: 0, y: 0 }, faces: 311 },
  { type: 0x60, name: 'DAY_NAME', count: 7, dim: { w: 43, h: 16 }, pos: { x: 89, y: 96 }, faces: 200, glyphs: DAYS },
  { type: 0x30, name: 'DAY_NUM', count: 10, dim: { w: 8, h: 12 }, pos: { x: 133, y: 96 }, faces: 147, glyphs: DIGITS },
  { type: 0x00, name: 'BACKGROUNDS', count: 10, dim: { w: 240, h: 24 }, pos: { x: 0, y: 0 }, faces: 71 },
  { type: 0xf1, name: 'HAND_HOUR', count: 1, dim: { w: 14, h: 92 }, pos: { x: 113, y: 56 }, faces: 57 },
  { type: 0xf2, name: 'HAND_MINUTE', count: 1, dim: { w: 12, h: 120 }, pos: { x: 114, y: 27 }, faces: 57 },
  { type: 0x73, name: 'STEPS_B_CA', count: 10, dim: { w: 8, h: 13 }, pos: { x: 121, y: 170 }, faces: 50, glyphs: DIGITS },
  { type: 0xf3, name: 'HAND_SEC', count: 1, dim: { w: 7, h: 121 }, pos: { x: 117, y: 16 }, faces: 49 },
  { type: 0xda, name: 'BATT_IMG_D', count: 11, dim: { w: 42, h: 21 }, pos: { x: 73, y: 111 }, faces: 43 },
  { type: 0xf4, name: 'HAND_PIN_UPPER', count: 1, dim: { w: 13, h: 7 }, pos: { x: 115, y: 115 }, faces: 40 },
  { type: 0xf5, name: 'HAND_PIN_LOWER', count: 2, dim: { w: 8, h: 4 }, pos: { x: 115, y: 120 }, faces: 39 },
  { type: 0x83, name: 'HR_B_CA', count: 10, dim: { w: 7, h: 11 }, pos: { x: 135, y: 158 }, faces: 34, glyphs: DIGITS },
  { type: 0x11, name: 'MONTH_NUM', count: 10, dim: { w: 8, h: 12 }, pos: { x: 90, y: 80 }, faces: 33, glyphs: DIGITS },
  { type: 0x45, name: 'TIME_AM', count: 1, dim: { w: 23, h: 18 }, pos: { x: 109, y: 83 }, faces: 32 },
  { type: 0x46, name: 'TIME_PM', count: 1, dim: { w: 23, h: 18 }, pos: { x: 109, y: 83 }, faces: 32 },
  { type: 0x70, name: 'STEPS_PROGBAR', count: 11, dim: { w: 56, h: 56 }, pos: { x: 38, y: 128 }, faces: 29 },
  { type: 0x93, name: 'KCAL_B_CA', count: 10, dim: { w: 7, h: 11 }, pos: { x: 131, y: 128 }, faces: 27, glyphs: DIGITS },
  { type: 0xf0, name: 'SEPERATOR', count: 1, dim: { w: 7, h: 45 }, pos: { x: 115, y: 95 }, faces: 26 },
  { type: 0xd6, name: 'ICON_SET_D6', count: 9, dim: { w: 32, h: 32 }, pos: { x: 104, y: 51 }, faces: 22 },
  { type: 0x72, name: 'STEPS_B', count: 10, dim: { w: 10, h: 17 }, pos: { x: 89, y: 130 }, faces: 19, glyphs: DIGITS },
  { type: 0x10, name: 'MONTH_NAME', count: 12, dim: { w: 40, h: 16 }, pos: { x: 108, y: 69 }, faces: 19, glyphs: MONTHS },
  { type: 0x6c, name: 'DAY_NUM_B', count: 10, dim: { w: 11, h: 16 }, pos: { x: 113, y: 125 }, faces: 19, glyphs: DIGITS },
  { type: 0xd1, name: 'BATT_IMG_C', count: 1, dim: { w: 32, h: 16 }, pos: { x: 105, y: 113 }, faces: 15 },
  { type: 0xc0, name: 'BTLINK_UP', count: 1, dim: { w: 31, h: 12 }, pos: { x: 112, y: 49 }, faces: 14 },
  { type: 0x74, name: 'STEPS_B_RA', count: 10, dim: { w: 11, h: 16 }, pos: { x: 141, y: 156 }, faces: 13, glyphs: DIGITS },
  { type: 0x80, name: 'HR_PROGBAR', count: 11, dim: { w: 66, h: 66 }, pos: { x: 87, y: 86 }, faces: 11 },
  { type: 0xa5, name: 'DIST_KM', count: 1, dim: { w: 17, h: 12 }, pos: { x: 184, y: 140 }, faces: 11 },
  { type: 0xa6, name: 'DIST_MI', count: 1, dim: { w: 17, h: 12 }, pos: { x: 184, y: 140 }, faces: 11 },
  { type: 0x90, name: 'KCAL_PROGBAR', count: 11, dim: { w: 52, h: 52 }, pos: { x: 119, y: 153 }, faces: 10 },
  { type: 0x6b, name: 'MONTH_NUM_B', count: 10, dim: { w: 11, h: 16 }, pos: { x: 65, y: 206 }, faces: 10, glyphs: DIGITS },
  { type: 0x92, name: 'KCAL_B', count: 10, dim: { w: 7, h: 17 }, pos: { x: 116, y: 170 }, faces: 9, glyphs: DIGITS },
  { type: 0xc1, name: 'BTLINK_DOWN', count: 1, dim: { w: 20, h: 20 }, pos: { x: 110, y: 30 }, faces: 9 },
  { type: 0xa3, name: 'DIST_CA', count: 10, dim: { w: 11, h: 18 }, pos: { x: 121, y: 166 }, faces: 8, glyphs: DIGITS },
  { type: 0x47, name: 'DIGIT_PAIR1_47', count: 10, dim: { w: 9, h: 14 }, pos: { x: 183, y: 96 }, faces: 8, glyphs: DIGITS },
  { type: 0x48, name: 'DIGIT_PAIR2_48', count: 10, dim: { w: 9, h: 14 }, pos: { x: 198, y: 96 }, faces: 8, glyphs: DIGITS },
  { type: 0xd8, name: 'WEATHER_TEMP_CA', count: 13, dim: { w: 7, h: 10 }, pos: { x: 76, y: 112 }, faces: 7 },
  { type: 0x66, name: 'HR_CA', count: 10, dim: { w: 10, h: 16 }, pos: { x: 122, y: 160 }, faces: 7, glyphs: DIGITS },
  { type: 0x84, name: 'HR_B_RA', count: 10, dim: { w: 8, h: 13 }, pos: { x: 133, y: 180 }, faces: 7, glyphs: DIGITS },
  { type: 0xd4, name: 'BATT_RA', count: 10, dim: { w: 11, h: 16 }, pos: { x: 185, y: 55 }, faces: 7, glyphs: DIGITS },
  { type: 0x94, name: 'KCAL_B_RA', count: 10, dim: { w: 11, h: 16 }, pos: { x: 115, y: 180 }, faces: 7, glyphs: DIGITS },
  { type: 0xa4, name: 'DIST_RA', count: 10, dim: { w: 11, h: 16 }, pos: { x: 224, y: 131 }, faces: 6, glyphs: DIGITS },
  { type: 0x63, name: 'STEPS_CA', count: 10, dim: { w: 8, h: 14 }, pos: { x: 125, y: 177 }, faces: 5, glyphs: DIGITS },
  { type: 0x82, name: 'HR_B', count: 10, dim: { w: 9, h: 13 }, pos: { x: 135, y: 187 }, faces: 5, glyphs: DIGITS },
  { type: 0x69, name: 'DIGIT_69', count: 10, dim: { w: 10, h: 10 }, pos: { x: 121, y: 79 }, faces: 5, glyphs: DIGITS },
  { type: 0x12, name: 'YEAR', count: 10, dim: { w: 9, h: 16 }, pos: { x: 58, y: 148 }, faces: 4, glyphs: DIGITS },
  { type: 0xd3, name: 'BATT_CA', count: 10, dim: { w: 7, h: 10 }, pos: { x: 113, y: 190 }, faces: 4, glyphs: DIGITS },
  { type: 0xd2, name: 'BATT', count: 10, dim: { w: 12, h: 16 }, pos: { x: 113, y: 190 }, faces: 0, glyphs: DIGITS },
  { type: 0x71, name: 'STEPS_LOGO', count: 1, dim: { w: 22, h: 18 }, pos: { x: 107, y: 141 }, faces: 2 },
  { type: 0x91, name: 'KCAL_LOGO', count: 1, dim: { w: 13, h: 18 }, pos: { x: 196, y: 141 }, faces: 2 },
  { type: 0xa1, name: 'DIST_LOGO', count: 1, dim: { w: 14, h: 18 }, pos: { x: 110, y: 140 }, faces: 1 },
  { type: 0x81, name: 'HR_LOGO', count: 1, dim: { w: 16, h: 16 }, pos: { x: 110, y: 140 }, faces: 0 },
  { type: 0xce, name: 'BATT_IMG', count: 1, dim: { w: 32, h: 16 }, pos: { x: 105, y: 113 }, faces: 0 },
]

/** Legacy view: types listed as "Single BMP" in the old Insert menu. Kept for
 *  any external consumer (e.g., FontGenerator preset lookup). Prefer the
 *  unified [TYPEC_INSERTABLE_TYPES] for new code. */
export const TYPEC_INSERTABLE = TYPEC_INSERTABLE_TYPES.filter((k) => k.count === 1).map(
  (k) => ({ type: k.type, name: k.name }),
)

/** Grouping for the Insert menu — purely UI metadata; the firmware doesn't
 *  care about these labels. Order here is the order the sections render in
 *  the popover (frequently-used first). */
export type InsertableCategory =
  | 'background'
  | 'time-digits'
  | 'time-other'
  | 'date'
  | 'hands'
  | 'steps'
  | 'heart-rate'
  | 'calories'
  | 'distance'
  | 'battery'
  | 'weather'
  | 'connectivity'
  | 'other'

export const INSERTABLE_CATEGORIES: {
  id: InsertableCategory
  label: string
}[] = [
  { id: 'background', label: 'Background' },
  { id: 'time-digits', label: 'Time digits' },
  { id: 'time-other', label: 'Time labels' },
  { id: 'date', label: 'Date' },
  { id: 'hands', label: 'Analog hands' },
  { id: 'steps', label: 'Steps' },
  { id: 'heart-rate', label: 'Heart rate' },
  { id: 'calories', label: 'Calories' },
  { id: 'distance', label: 'Distance' },
  { id: 'battery', label: 'Battery' },
  { id: 'weather', label: 'Weather' },
  { id: 'connectivity', label: 'Connectivity' },
  { id: 'other', label: 'Other' },
]

/** Per-type UI metadata: which category section to render under and a
 *  short description for the help popover. Keep descriptions to 1–2
 *  sentences — the help panel also shows the slot count and type-code
 *  separately, so the prose is just the "what does this do" hint. */
const INSERTABLE_META: Record<
  number,
  { category: InsertableCategory; description: string }
> = {
  // Background / canvas
  0x01: {
    category: 'background',
    description:
      'Full-screen 240×240 wallpaper, painted before every other layer. Most faces have exactly one.',
  },
  0x00: {
    category: 'background',
    description:
      'Ten horizontal 240×24 strips that some firmware stitches together as a tall background. Rarely used.',
  },

  // Time — digits
  0x40: {
    category: 'time-digits',
    description:
      'Tens digit of the hour (the "1" in "12:34"). One of four digital-clock slots — usually shares its asset library with the other time digits.',
  },
  0x41: {
    category: 'time-digits',
    description:
      'Units digit of the hour (the "2" in "12:34"). Usually shares its asset library with the other time digits.',
  },
  0x43: {
    category: 'time-digits',
    description:
      'Tens digit of the minute (the "3" in "12:34").',
  },
  0x44: {
    category: 'time-digits',
    description:
      'Units digit of the minute (the "4" in "12:34").',
  },
  0x47: {
    category: 'time-digits',
    description:
      'First pair of generic clock digits, used by some firmware layouts as an alternative to 0x40/0x41.',
  },
  0x48: {
    category: 'time-digits',
    description:
      'Second pair of generic clock digits, alternative to 0x43/0x44.',
  },

  // Time — labels
  0x45: {
    category: 'time-other',
    description:
      'The "AM" label, shown only before noon. Single bitmap — typically the text "AM".',
  },
  0x46: {
    category: 'time-other',
    description:
      'The "PM" label, shown only at or after noon.',
  },
  0xf0: {
    category: 'time-other',
    description:
      'Colon (or other separator) between hours and minutes. Single bitmap.',
  },

  // Date
  0x10: {
    category: 'date',
    description:
      'Twelve month-name bitmaps (Jan, Feb, …, Dec). One slot per month.',
  },
  0x11: {
    category: 'date',
    description:
      'Numeric month as 10 digit bitmaps. Two cells are rendered for values 1–12.',
  },
  0x12: {
    category: 'date',
    description:
      'Four-digit year as 10 digit bitmaps. Some firmware only renders the last two digits.',
  },
  0x30: {
    category: 'date',
    description:
      'Day of the month as 10 digit bitmaps (1–31). Two cells.',
  },
  0x60: {
    category: 'date',
    description:
      'Seven day-of-week bitmaps (Sun, Mon, …, Sat).',
  },
  0x6b: {
    category: 'date',
    description:
      'Alternate "month number" digit set, used when 0x11 isn’t available.',
  },
  0x6c: {
    category: 'date',
    description:
      'Alternate "day of month" digit set, used when 0x30 isn’t available.',
  },

  // Hands — analog
  0xf1: {
    category: 'hands',
    description:
      'Analog hour hand. Single bitmap rotated by firmware based on the current hour.',
  },
  0xf2: {
    category: 'hands',
    description:
      'Analog minute hand. Single bitmap rotated by firmware.',
  },
  0xf3: {
    category: 'hands',
    description:
      'Analog seconds hand. Single bitmap rotated by firmware.',
  },
  0xf4: {
    category: 'hands',
    description:
      'Upper pin cap painted on top of the hour/minute hands at the dial center.',
  },
  0xf5: {
    category: 'hands',
    description:
      'Lower pin cap (2 frames). Sits beneath the seconds hand at the dial center.',
  },

  // Steps
  0x63: {
    category: 'steps',
    description: 'Step counter, center-aligned digit set.',
  },
  0x72: {
    category: 'steps',
    description: 'Step counter, basic left-aligned digit set.',
  },
  0x73: {
    category: 'steps',
    description: 'Step counter, basic center-aligned digit set.',
  },
  0x74: {
    category: 'steps',
    description: 'Step counter, basic right-aligned digit set.',
  },
  0x70: {
    category: 'steps',
    description:
      'Step-goal progress bar — 11 frames from 0% to 100% in 10% increments.',
  },
  0x71: {
    category: 'steps',
    description: 'Static steps icon (logo).',
  },

  // Heart rate
  0x66: {
    category: 'heart-rate',
    description: 'Heart-rate digits, center-aligned.',
  },
  0x82: {
    category: 'heart-rate',
    description: 'Heart-rate digits, basic left-aligned.',
  },
  0x83: {
    category: 'heart-rate',
    description: 'Heart-rate digits, basic center-aligned.',
  },
  0x84: {
    category: 'heart-rate',
    description: 'Heart-rate digits, basic right-aligned.',
  },
  0x80: {
    category: 'heart-rate',
    description:
      'Heart-rate zone progress bar — 11 frames from low to high zone.',
  },
  0x81: {
    category: 'heart-rate',
    description: 'Static heart icon (logo).',
  },

  // Calories
  0x92: {
    category: 'calories',
    description: 'Calorie digits, basic left-aligned.',
  },
  0x93: {
    category: 'calories',
    description: 'Calorie digits, basic center-aligned.',
  },
  0x94: {
    category: 'calories',
    description: 'Calorie digits, basic right-aligned.',
  },
  0x90: {
    category: 'calories',
    description: 'Calorie-goal progress bar — 11 frames.',
  },
  0x91: {
    category: 'calories',
    description: 'Static calorie icon (logo).',
  },

  // Distance
  0xa1: {
    category: 'distance',
    description: 'Static distance icon (logo).',
  },
  0xa3: {
    category: 'distance',
    description: 'Distance digits, center-aligned.',
  },
  0xa4: {
    category: 'distance',
    description: 'Distance digits, right-aligned.',
  },
  0xa5: {
    category: 'distance',
    description:
      '"KM" unit label, shown when the watch is set to metric distance.',
  },
  0xa6: {
    category: 'distance',
    description:
      '"MI" unit label, shown when the watch is set to imperial distance.',
  },

  // Battery
  0xce: {
    category: 'battery',
    description: 'Single battery image (legacy variant).',
  },
  0xd1: {
    category: 'battery',
    description: 'Single battery image, variant C.',
  },
  0xda: {
    category: 'battery',
    description:
      'Battery fill animation — 11 frames from empty (0%) to full (100%).',
  },
  0xd2: {
    category: 'battery',
    description: 'Battery-percentage digits, left-aligned.',
  },
  0xd3: {
    category: 'battery',
    description: 'Battery-percentage digits, center-aligned.',
  },
  0xd4: {
    category: 'battery',
    description: 'Battery-percentage digits, right-aligned.',
  },

  // Weather
  0xd6: {
    category: 'weather',
    description:
      'Weather icon set — 9 frames for sun, cloud, rain, snow, etc.',
  },
  0xd8: {
    category: 'weather',
    description:
      'Weather temperature, 13 digit slots (includes "-", digits, and a "°" / unit glyph).',
  },

  // Connectivity
  0xc0: {
    category: 'connectivity',
    description: 'Bluetooth-connected icon — shown when paired.',
  },
  0xc1: {
    category: 'connectivity',
    description: 'Bluetooth-disconnected icon — shown when unpaired.',
  },

  // Other
  0x69: {
    category: 'other',
    description:
      'Generic 10-digit set used by a handful of niche layouts. Purpose varies between firmware versions.',
  },
}

/** Look up the category + description for an insertable type. Returns
 *  `'other'` and an empty description for types not in the meta table. */
export const insertableMeta = (
  type: number,
): { category: InsertableCategory; description: string } =>
  INSERTABLE_META[type] ?? { category: 'other', description: '' }

/** Legacy view: same data, filtered to multi-blob font-able types (count > 1
 *  and a `glyphs` array). FontGenerator and AssetDetailModal still consume
 *  this shape. */
export const TYPEC_FONT_INSERTABLE: {
  type: number
  name: string
  count: number
  glyphs: readonly string[]
}[] = TYPEC_INSERTABLE_TYPES.filter((k) => !!k.glyphs).map((k) => ({
  type: k.type,
  name: k.name,
  count: k.count,
  glyphs: k.glyphs!,
}))

export const glyphsForTypeCType = (type: number): readonly string[] | null => {
  return TYPEC_INSERTABLE_TYPES.find((k) => k.type === type)?.glyphs ?? null
}

/** Sensible default text for single-slot kinds that the font generator
 *  paints into. Returns `''` for kinds where text doesn't fit (logos,
 *  hands, battery icons, animations) so the user is prompted to type
 *  something — and not nudged toward nonsense like "0" for SEPERATOR. */
export const defaultGlyphTextForType = (type: number): string => {
  switch (type) {
    case 0xf0:
      return ':' // SEPERATOR — colon between hours and minutes
    case 0x45:
      return 'AM' // TIME_AM
    case 0x46:
      return 'PM' // TIME_PM
    case 0xa5:
      return 'KM' // DIST_KM
    case 0xa6:
      return 'MI' // DIST_MI
    default:
      return ''
  }
}

const DEFAULT_GLYPH_CELL: Record<number, { w: number; h: number }> = (() => {
  const out: Record<number, { w: number; h: number }> = {}
  for (const k of TYPEC_INSERTABLE_TYPES) out[k.type] = k.dim
  return out
})()

const DEFAULT_POSITION: Record<number, { x: number; y: number }> = (() => {
  const out: Record<number, { x: number; y: number }> = {}
  for (const k of TYPEC_INSERTABLE_TYPES) out[k.type] = k.pos
  return out
})()

const placeholderSlot = (): AssetSlot => ({ rgba: null })

/** Create a new AssetSet sized for the given type. All slots start empty. */
const createAssetSetForType = (
  type: number,
  size?: { w: number; h: number },
): AssetSet => {
  const count = blobCountForType(type, 0)
  const cell = size ?? DEFAULT_GLYPH_CELL[type] ?? { w: 0, h: 0 }
  return {
    id: nextId('asset'),
    name: defaultSetName(type),
    width: cell.w,
    height: cell.h,
    count,
    kind: kindForType(type),
    slots: Array.from({ length: count }, placeholderSlot),
  }
}

/** Insert a Type C layer. If `assetSetId` is supplied, the new layer shares
 *  that existing set; otherwise a fresh set is created (and seeded from
 *  `bitmaps` if provided). */
export const insertTypeCLayer = (
  project: TypeCProject,
  type: number,
  options: {
    assetSetId?: string
    bitmaps?: DecodedBitmap[]
    position?: { x: number; y: number }
    name?: string
  } = {},
): TypeCProject => {
  const {
    assetSetId,
    bitmaps,
    position = DEFAULT_POSITION[type] ?? { x: 120, y: 120 },
    name,
  } = options

  let setId: string
  let assetSets = project.assetSets

  if (assetSetId) {
    const existing = project.assetSets.find((s) => s.id === assetSetId)
    if (!existing) {
      throw new Error(`Asset set ${assetSetId} doesn't exist.`)
    }
    const expectedCount = blobCountForType(type, project.animationFrames)
    if (existing.count !== expectedCount) {
      throw new Error(
        `Type 0x${type.toString(16)} expects ${expectedCount} slots but set has ${existing.count}.`,
      )
    }
    setId = existing.id
  } else {
    let newSet = createAssetSetForType(type)
    if (name) newSet = { ...newSet, name }
    if (bitmaps && bitmaps.length > 0) {
      const expectedCount = blobCountForType(type, project.animationFrames)
      if (bitmaps.length !== expectedCount) {
        throw new Error(
          `Type 0x${type.toString(16)} expects ${expectedCount} bitmap(s); got ${bitmaps.length}.`,
        )
      }
      newSet = {
        ...newSet,
        width: bitmaps[0].width,
        height: bitmaps[0].height,
        slots: bitmaps.map((b) => ({ rgba: b.rgba })),
      }
    }
    assetSets = [...assetSets, newSet]
    setId = newSet.id
  }

  const layer: TypeCLayer = {
    id: nextId('layer'),
    type,
    x: position.x,
    y: position.y,
    assetSetId: setId,
  }
  return { ...project, layers: [...project.layers, layer], assetSets }
}

// ---------- AssetSet helpers ----------

/** All layers that consume a given set. */
export const consumersOf = (
  project: TypeCProject,
  setId: string,
): TypeCLayer[] => project.layers.filter((l) => l.assetSetId === setId)

/** Existing sets that are dimension-compatible with the given type (same
 *  count). Used to populate "Share with…" pickers. */
export const compatibleSetsForType = (
  project: TypeCProject,
  type: number,
): AssetSet[] => {
  const count = blobCountForType(type, project.animationFrames)
  return project.assetSets.filter((s) => s.count === count)
}

/** Create a standalone AssetSet — no layer references it yet. The caller is
 *  expected to either rebind a layer to the new set or insert a layer
 *  pointing at it. Used by the AssetLibrary "+ New" flow so users can build
 *  a reusable asset before placing it on the canvas. */
/** Change an asset set's per-slot dimensions. Pixel art doesn't scale
 *  cleanly, so every slot's `rgba` is cleared in the process — only the
 *  `compression` hint is preserved (the firmware-correctness contract on
 *  round-trip). Throws when the set isn't found or the requested
 *  dimensions are non-positive. */
export const resizeAssetSet = (
  project: TypeCProject,
  setId: string,
  width: number,
  height: number,
): TypeCProject => {
  if (!Number.isFinite(width) || width < 1) {
    throw new Error(`Width must be a positive integer, got ${width}.`)
  }
  if (!Number.isFinite(height) || height < 1) {
    throw new Error(`Height must be a positive integer, got ${height}.`)
  }
  const set = project.assetSets.find((s) => s.id === setId)
  if (!set) throw new Error(`Asset set ${setId} not found.`)
  if (set.width === width && set.height === height) return project
  const nextSets = project.assetSets.map((s) =>
    s.id === setId
      ? {
          ...s,
          width,
          height,
          slots: s.slots.map((slot) => ({ ...slot, rgba: null })),
        }
      : s,
  )
  return { ...project, assetSets: nextSets }
}

export const createTypeCAssetSet = (
  project: TypeCProject,
  type: number,
  options: {
    bitmaps?: DecodedBitmap[]
    name?: string
    /** Override the per-type default cell size. When bitmaps are also
     *  supplied this is ignored — the bitmap dimensions win. */
    size?: { w: number; h: number }
  } = {},
): { project: TypeCProject; setId: string } => {
  let newSet = createAssetSetForType(type, options.size)
  if (options.name) newSet = { ...newSet, name: options.name }
  if (options.bitmaps && options.bitmaps.length > 0) {
    const expected = blobCountForType(type, project.animationFrames)
    if (options.bitmaps.length !== expected) {
      throw new Error(
        `Type 0x${type.toString(16)} expects ${expected} bitmap(s); got ${options.bitmaps.length}.`,
      )
    }
    newSet = {
      ...newSet,
      width: options.bitmaps[0].width,
      height: options.bitmaps[0].height,
      slots: options.bitmaps.map((b) => ({ rgba: b.rgba })),
    }
  }
  return {
    project: { ...project, assetSets: [...project.assetSets, newSet] },
    setId: newSet.id,
  }
}

/** Append asset sets imported from another project. Each gets a fresh id
 *  to avoid collisions with sets already in the library. Slot buffers are
 *  shared by reference — the buffers in our model are immutable per-slot,
 *  so no copy is needed and we save a few MB on large imports. */
export const appendAssetSets = (
  project: TypeCProject,
  sets: AssetSet[],
): { project: TypeCProject; newIds: string[] } => {
  const newIds: string[] = []
  const fresh = sets.map((s) => {
    const id = nextId('asset')
    newIds.push(id)
    return { ...s, id }
  })
  return {
    project: { ...project, assetSets: [...project.assetSets, ...fresh] },
    newIds,
  }
}

/** Replace the slots of an AssetSet. Counts must match. */
export const regenerateAssetSet = (
  project: TypeCProject,
  setId: string,
  bitmaps: DecodedBitmap[],
): TypeCProject => {
  const set = project.assetSets.find((s) => s.id === setId)
  if (!set) throw new Error(`Asset set ${setId} doesn't exist.`)
  if (bitmaps.length !== set.count) {
    throw new Error(
      `Set "${set.name}" expects ${set.count} bitmap(s); got ${bitmaps.length}.`,
    )
  }
  const next: AssetSet = {
    ...set,
    width: bitmaps[0].width,
    height: bitmaps[0].height,
    slots: bitmaps.map((b) => ({ rgba: b.rgba })),
  }
  return {
    ...project,
    assetSets: project.assetSets.map((s) => (s.id === setId ? next : s)),
  }
}

export const renameAssetSet = (
  project: TypeCProject,
  setId: string,
  name: string,
): TypeCProject => ({
  ...project,
  assetSets: project.assetSets.map((s) => (s.id === setId ? { ...s, name } : s)),
})

/** Delete a set. Refuses if any layer still consumes it — caller must unlink
 *  consumers first. */
export const deleteAssetSet = (
  project: TypeCProject,
  setId: string,
): TypeCProject => {
  const cs = consumersOf(project, setId)
  if (cs.length > 0) {
    throw new Error(
      `Set is still used by ${cs.length} layer(s); remove or rebind them first.`,
    )
  }
  return {
    ...project,
    assetSets: project.assetSets.filter((s) => s.id !== setId),
  }
}

/** Detach a layer from a shared set — clones the set so the layer has its own
 *  exclusive copy. No-op if the set already has only this consumer. */
export const detachLayerFromSharedSet = (
  project: TypeCProject,
  layerIdx: number,
): TypeCProject => {
  const layer = project.layers[layerIdx]
  if (!layer) return project
  const cs = consumersOf(project, layer.assetSetId)
  if (cs.length <= 1) return project
  const source = project.assetSets.find((s) => s.id === layer.assetSetId)
  if (!source) return project
  const clone: AssetSet = {
    ...source,
    id: nextId('asset'),
    name: `${source.name} (copy)`,
    slots: source.slots.map((s) => ({ rgba: s.rgba })),
  }
  const layers = project.layers.map((l, i) =>
    i === layerIdx ? { ...l, assetSetId: clone.id } : l,
  )
  return { ...project, layers, assetSets: [...project.assetSets, clone] }
}

/** Rebind a layer to a different (compatible) set. Previous binding is left
 *  in the library even if it becomes orphan — the user might want to bind
 *  another layer to it later, or restore it via undo. Orphan sets are
 *  excluded from the .bin at pack time (see `materializeTypeC`). */
export const rebindLayer = (
  project: TypeCProject,
  layerIdx: number,
  newSetId: string,
): TypeCProject => {
  const layer = project.layers[layerIdx]
  if (!layer) return project
  const target = project.assetSets.find((s) => s.id === newSetId)
  if (!target) throw new Error(`Asset set ${newSetId} doesn't exist.`)
  const expected = blobCountForType(layer.type, project.animationFrames)
  if (target.count !== expected) {
    throw new Error(
      `Layer expects ${expected} slots; "${target.name}" has ${target.count}.`,
    )
  }
  const layers = project.layers.map((l, i) =>
    i === layerIdx ? { ...l, assetSetId: newSetId } : l,
  )
  return { ...project, layers }
}

// ---------- FaceN insert (unchanged) ----------

export type FaceNInsertableKind =
  | 'Image'
  | 'TimeHand-Hour'
  | 'TimeHand-Minute'
  | 'TimeHand-Second'
  | 'Dash'
  | 'DayName'
  | 'BatteryFill'
  | 'BarDisplay'
  | 'Weather'

export type FaceNDigitDependentKind =
  | 'TimeNum'
  | 'HeartRateNum'
  | 'StepsNum'
  | 'KCalNum'
  | 'DayNum'
  | 'MonthNum'

export const FACEN_INSERTABLE: {
  kind: FaceNInsertableKind
  label: string
  imageCount: number
}[] = [
  { kind: 'Image', label: 'Image', imageCount: 1 },
  { kind: 'TimeHand-Hour', label: 'Time hand (hour)', imageCount: 1 },
  { kind: 'TimeHand-Minute', label: 'Time hand (minute)', imageCount: 1 },
  { kind: 'TimeHand-Second', label: 'Time hand (second)', imageCount: 1 },
  { kind: 'Dash', label: 'Dash', imageCount: 1 },
  { kind: 'DayName', label: 'Day name (7 imgs)', imageCount: 7 },
  { kind: 'BatteryFill', label: 'Battery fill (bg + fill + mask)', imageCount: 3 },
  { kind: 'BarDisplay', label: 'Bar display', imageCount: 0 },
  { kind: 'Weather', label: 'Weather', imageCount: 0 },
]

const emptyFaceNImgRef = (bmp?: DecodedBitmap): FaceN['preview'] => ({
  offset: 0,
  width: bmp?.width ?? 0,
  height: bmp?.height ?? 0,
  rawSize: bmp ? bmp.width * bmp.height * 3 : 0,
  rgba: bmp?.rgba ?? null,
})

export const insertFaceNLayer = (
  project: FaceNProject,
  kind: FaceNInsertableKind,
  bitmaps: DecodedBitmap[],
  position: { x: number; y: number } = { x: 0, y: 0 },
): FaceNProject => {
  const at = (i: number): DecodedBitmap | undefined => bitmaps[i]
  let element: FNEl
  switch (kind) {
    case 'Image':
      element = { kind: 'Image', eType: 0, x: position.x, y: position.y, img: emptyFaceNImgRef(at(0)) }
      break
    case 'TimeHand-Hour':
    case 'TimeHand-Minute':
    case 'TimeHand-Second': {
      const hType = kind === 'TimeHand-Hour' ? 0 : kind === 'TimeHand-Minute' ? 1 : 2
      element = {
        kind: 'TimeHand', eType: 10, hType,
        pivotX: 120, pivotY: 120,
        img: emptyFaceNImgRef(at(0)),
        x: position.x, y: position.y,
      }
      break
    }
    case 'Dash':
      element = { kind: 'Dash', eType: 35, img: emptyFaceNImgRef(at(0)) }
      break
    case 'DayName':
      element = {
        kind: 'DayName', eType: 4, nType: 0,
        x: position.x, y: position.y,
        imgs: Array.from({ length: 7 }, (_, i) => emptyFaceNImgRef(at(i))),
      }
      break
    case 'BatteryFill':
      element = {
        kind: 'BatteryFill', eType: 5,
        x: position.x, y: position.y,
        bgImg: emptyFaceNImgRef(at(0)),
        x1: 0, y1: 0, x2: 0, y2: 0,
        unknown0: 0, unknown1: 0,
        img1: emptyFaceNImgRef(at(1)),
        img2: emptyFaceNImgRef(at(2)),
      }
      break
    case 'BarDisplay': {
      const count = Math.max(1, bitmaps.length || 5)
      element = {
        kind: 'BarDisplay', eType: 18, bType: 0, count,
        x: position.x, y: position.y,
        imgs: Array.from({ length: count }, (_, i) => emptyFaceNImgRef(at(i))),
      }
      break
    }
    case 'Weather': {
      const count = Math.max(1, bitmaps.length || 10)
      element = {
        kind: 'Weather', eType: 27, count,
        x: position.x, y: position.y,
        imgs: Array.from({ length: count }, (_, i) => emptyFaceNImgRef(at(i))),
      }
      break
    }
  }
  return { ...project, face: { ...project.face, elements: [...project.face.elements, element] } }
}

// ---------- FaceN digit set helpers ----------

export const insertFaceNDigitSet = (
  project: FaceNProject,
  digits: DecodedBitmap[],
): { project: FaceNProject; setIdx: number } => {
  if (digits.length !== 10) {
    throw new Error(`Digit set needs exactly 10 bitmaps; got ${digits.length}.`)
  }
  const setIdx = project.face.digitSets.length
  const newSet = {
    digitSet: setIdx,
    unknown: 0,
    digits: digits.map((d) => ({
      offset: 0,
      width: d.width,
      height: d.height,
      rawSize: d.width * d.height * 3,
      rgba: d.rgba,
    })),
  }
  return {
    project: { ...project, face: { ...project.face, digitSets: [...project.face.digitSets, newSet] } },
    setIdx,
  }
}

export const insertFaceNDigitElement = (
  project: FaceNProject,
  kind: FaceNDigitDependentKind,
  digitSetIdx: number,
  position: { x: number; y: number },
  align: 'L' | 'R' | 'C' = 'C',
): FaceNProject => {
  const set = project.face.digitSets[digitSetIdx]
  if (!set) throw new Error(`Digit set ${digitSetIdx} doesn't exist.`)
  const digitW = set.digits[0]?.width ?? 16
  let element: FNEl
  switch (kind) {
    case 'TimeNum': {
      const gap = Math.max(2, Math.floor(digitW * 0.3))
      const xys = [
        { x: position.x, y: position.y },
        { x: position.x + digitW + gap, y: position.y },
        { x: position.x + 2 * digitW + 2 * gap + digitW, y: position.y },
        { x: position.x + 3 * digitW + 3 * gap + digitW, y: position.y },
      ] as [
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
      ]
      element = {
        kind: 'TimeNum', eType: 2,
        digitSets: [digitSetIdx, digitSetIdx, digitSetIdx, digitSetIdx],
        xys,
        padding: new Uint8Array(12),
      }
      break
    }
    case 'HeartRateNum':
      element = { kind: 'HeartRateNum', eType: 6, digitSet: digitSetIdx, align, x: position.x, y: position.y }
      break
    case 'StepsNum':
      element = { kind: 'StepsNum', eType: 7, digitSet: digitSetIdx, align, x: position.x, y: position.y }
      break
    case 'KCalNum':
      element = { kind: 'KCalNum', eType: 9, digitSet: digitSetIdx, align, x: position.x, y: position.y }
      break
    case 'DayNum':
      element = {
        kind: 'DayNum', eType: 13, digitSet: digitSetIdx, align,
        xys: [
          { x: position.x, y: position.y },
          { x: position.x + digitW + 2, y: position.y },
        ],
      }
      break
    case 'MonthNum':
      element = {
        kind: 'MonthNum', eType: 15, digitSet: digitSetIdx, align,
        xys: [
          { x: position.x, y: position.y },
          { x: position.x + digitW + 2, y: position.y },
        ],
      }
      break
  }
  return { ...project, face: { ...project.face, elements: [...project.face.elements, element] } }
}

export const regenerateFaceNDigitSet = (
  project: FaceNProject,
  setIdx: number,
  digits: DecodedBitmap[],
): FaceNProject => {
  if (digits.length !== 10) {
    throw new Error(`Digit set needs exactly 10 bitmaps; got ${digits.length}.`)
  }
  const set = project.face.digitSets[setIdx]
  if (!set) throw new Error(`Digit set ${setIdx} doesn't exist.`)
  const newSet = {
    ...set,
    digits: digits.map((d) => ({
      offset: 0,
      width: d.width,
      height: d.height,
      rawSize: d.width * d.height * 3,
      rgba: d.rgba,
    })),
  }
  const digitSets = project.face.digitSets.map((s, i) => (i === setIdx ? newSet : s))
  return { ...project, face: { ...project.face, digitSets } }
}

// ---------- FaceN element patcher (kind-specific scalar fields) ----------

export const patchFaceNElement = (
  project: FaceNProject,
  idx: number,
  patch: Partial<FNEl>,
): FaceNProject => {
  const elements = project.face.elements.map((el, i) => {
    if (i !== idx) return el
    return { ...el, ...patch } as FNEl
  })
  return { ...project, face: { ...project.face, elements } }
}

/** Patch arbitrary x/y on the Type C layer. */
export const patchTypeCLayer = (
  project: TypeCProject,
  idx: number,
  patch: Partial<TypeCLayer>,
): TypeCProject => ({
  ...project,
  layers: project.layers.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
})

// ---------- digit-set inspection (FaceN) ----------

export type DigitSetView = {
  setIdx: number
  digits: AssetView[]
}

export const listDigitSets = (project: EditorProject): DigitSetView[] => {
  if (project.format !== 'faceN') return []
  return project.face.digitSets.map((set, setIdx) => ({
    setIdx,
    digits: set.digits.map((d, digitIdx) => ({
      ref: { tag: 'faceN-digit', setIdx, digitIdx },
      label: String(digitIdx),
      width: d.width,
      height: d.height,
      rgba: d.rgba,
    })),
  }))
}

void swapImgRef

// ===================================================================
// Renderer-accurate bbox for the selection overlay
// ===================================================================

const DIGIT_SPACING = 2

type Align = 'L' | 'C' | 'R'

const typeCAlignFor = (type: number): Align | null => {
  switch (type) {
    case 0x11: case 0x6b: case 0x30: case 0x6c: case 0x12:
    case 0x62: case 0x72: case 0x76: case 0x65: case 0x82:
    case 0x68: case 0x92: case 0xa2: case 0xd2:
      return 'L'
    case 0x63: case 0x73: case 0x66: case 0x83:
    case 0x93: case 0xa3: case 0xd3:
      return 'C'
    case 0x64: case 0x74: case 0x67: case 0x84:
    case 0x94: case 0xa4: case 0xd4:
      return 'R'
  }
  return null
}

const typeCValueFor = (
  type: number,
  dummy: DummyState,
): { value: number; padTo: number } | null => {
  switch (type) {
    case 0x11: case 0x6b: return { value: dummy.month, padTo: 2 }
    case 0x30: case 0x6c: return { value: dummy.day, padTo: 2 }
    case 0x12: return { value: dummy.year % 100, padTo: 2 }
    case 0x62: case 0x63: case 0x64:
    case 0x72: case 0x73: case 0x74:
      return { value: dummy.steps, padTo: 1 }
    case 0x76: return { value: 10000, padTo: 1 }
    case 0x65: case 0x66: case 0x67:
    case 0x82: case 0x83: case 0x84:
      return { value: dummy.hr, padTo: 1 }
    case 0x68: case 0x92: case 0x93: case 0x94:
      return { value: dummy.kcal, padTo: 1 }
    case 0xa2: case 0xa3: case 0xa4:
      return { value: dummy.distance, padTo: 1 }
    case 0xd2: case 0xd3: case 0xd4:
      return { value: dummy.battery, padTo: 1 }
  }
  return null
}

const typeCDigitsBbox = (
  layer: TypeCLayer,
  set: AssetSet,
  dummy: DummyState,
): { x: number; y: number; w: number; h: number } | null => {
  const align = typeCAlignFor(layer.type)
  const info = typeCValueFor(layer.type, dummy)
  if (!align || !info) return null
  const s = String(Math.max(0, Math.floor(info.value))).padStart(info.padTo, '0')
  const totalW = s.length * set.width + (s.length - 1) * DIGIT_SPACING
  let startX: number
  switch (align) {
    case 'L': startX = layer.x; break
    case 'R': startX = layer.x - totalW; break
    case 'C': startX = layer.x - Math.floor(totalW / 2); break
  }
  return { x: startX, y: layer.y, w: totalW, h: set.height }
}

/** The (x, y) anchor stored on the layer/element — what `setLayerPosition`
 *  reads and writes. For Type C multi-digit kinds this differs from
 *  `computeLayerBbox().x` (alignment shifts the bbox left/right of the
 *  anchor), so drag handlers must use this, not the bbox. Returns null for
 *  kinds whose position can't be moved as a single unit. */
export const getLayerAnchor = (
  project: EditorProject,
  layerIdx: number,
): { x: number; y: number } | null => {
  if (project.format === 'typeC') {
    const l = project.layers[layerIdx]
    return l ? { x: l.x, y: l.y } : null
  }
  const el = project.face.elements[layerIdx]
  if (!el) return null
  switch (el.kind) {
    case 'Image':
    case 'TimeHand':
    case 'BatteryFill':
    case 'DayName':
    case 'BarDisplay':
    case 'Weather':
    case 'HeartRateNum':
    case 'StepsNum':
    case 'KCalNum':
      return { x: el.x, y: el.y }
    case 'DayNum':
    case 'MonthNum':
    case 'TimeNum':
      // Multi-slot kinds — anchor at the first slot. `setLayerXY` handles
      // shifting the rest as a group.
      return { x: el.xys[0].x, y: el.xys[0].y }
    case 'Dash':
    case 'Unknown29':
    case 'Unknown':
      return null
  }
}

/** Reverse-iterate layers and return the index of the topmost one whose
 *  bbox contains `(nx, ny)` in native 240×240 space. Returns `null` if the
 *  point misses every layer or every layer reports a null bbox. Used by
 *  the canvas to convert a click into a selection. */
export const hitTestLayer = (
  project: EditorProject,
  nx: number,
  ny: number,
  dummy: DummyStateN,
): number | null => {
  const count =
    project.format === 'typeC'
      ? project.layers.length
      : project.face.elements.length
  for (let i = count - 1; i >= 0; i--) {
    const bb = computeLayerBbox(project, i, dummy)
    if (!bb) continue
    if (nx >= bb.x && nx < bb.x + bb.w && ny >= bb.y && ny < bb.y + bb.h) {
      return i
    }
  }
  return null
}

export const computeLayerBbox = (
  project: EditorProject,
  layerIdx: number,
  dummy: DummyStateN,
): { x: number; y: number; w: number; h: number } | null => {
  if (project.format === 'typeC') {
    const layer = project.layers[layerIdx]
    if (!layer) return null
    const set = project.assetSets.find((s) => s.id === layer.assetSetId)
    if (!set) return null
    const digits = typeCDigitsBbox(layer, set, dummy)
    if (digits) return digits
    if (set.width > 0 && set.height > 0) {
      return { x: layer.x, y: layer.y, w: set.width, h: set.height }
    }
    return null
  }
  const el = project.face.elements[layerIdx]
  if (!el) return null
  switch (el.kind) {
    case 'Image':
      return { x: el.x, y: el.y, w: el.img.width, h: el.img.height }
    case 'DayName': {
      const img = el.imgs[dummy.dow] ?? el.imgs[0]
      if (!img) return null
      return { x: el.x, y: el.y, w: img.width, h: img.height }
    }
    case 'BatteryFill':
      return { x: el.x, y: el.y, w: el.bgImg.width, h: el.bgImg.height }
    case 'TimeHand':
      return { x: el.x, y: el.y, w: el.img.width, h: el.img.height }
    case 'Dash':
      return el.img.width > 0 ? { x: 0, y: 0, w: el.img.width, h: el.img.height } : null
    case 'BarDisplay':
    case 'Weather': {
      const img = el.imgs[0]
      if (!img) return null
      return { x: el.x, y: el.y, w: img.width, h: img.height }
    }
    case 'HeartRateNum':
    case 'StepsNum':
    case 'KCalNum':
    case 'DayNum':
    case 'MonthNum':
    case 'TimeNum':
    case 'Unknown29':
    case 'Unknown':
      return null
  }
}

// ---------- guides: CRUD helpers ----------

/** Append a new guide at `position` on the given axis. Returns the new
 *  project plus the new guide's id so callers can put it straight into
 *  `selectedGuideIds`. */
export const addGuide = (
  project: EditorProject,
  axis: 'H' | 'V',
  position: number,
): { project: EditorProject; id: string } => {
  const id = nextId('guide')
  const guide: GuideLine = {
    id,
    axis,
    position: clampGuidePosition(position),
    visible: true,
  }
  return {
    project: withGuides(project, [...project.guides, guide]),
    id,
  }
}

export const moveGuide = (
  project: EditorProject,
  id: string,
  position: number,
): EditorProject => {
  const next = project.guides.map((g) =>
    g.id === id ? { ...g, position: clampGuidePosition(position) } : g,
  )
  return withGuides(project, next)
}

export const removeGuide = (
  project: EditorProject,
  id: string,
): EditorProject => withGuides(project, project.guides.filter((g) => g.id !== id))

export const removeGuides = (
  project: EditorProject,
  ids: string[],
): EditorProject => {
  if (ids.length === 0) return project
  const set = new Set(ids)
  return withGuides(project, project.guides.filter((g) => !set.has(g.id)))
}

export const setGuideVisible = (
  project: EditorProject,
  id: string,
  visible: boolean,
): EditorProject =>
  withGuides(
    project,
    project.guides.map((g) => (g.id === id ? { ...g, visible } : g)),
  )

export const setAllGuidesVisible = (
  project: EditorProject,
  visible: boolean,
): EditorProject =>
  withGuides(
    project,
    project.guides.map((g) => ({ ...g, visible })),
  )

const withGuides = (project: EditorProject, guides: GuideLine[]): EditorProject =>
  project.format === 'typeC'
    ? { ...project, guides }
    : { ...project, guides }

const clampGuidePosition = (n: number): number => {
  // Clamp to native canvas + round to integer pixel so guides land on the
  // same pixel grid as layers (otherwise a half-pixel guide drifts visually).
  const clamped = Math.max(0, Math.min(240, n))
  return Math.round(clamped)
}

// ---------- snap candidates ----------

/** A single snap candidate line in native space. `axis: 'V'` means the line
 *  is vertical (constant x) and only matches horizontal-axis snap targets.
 *  `kind` drives the smart-guide color/label; `sourceId` lets the renderer
 *  highlight the originating guide/layer. */
export type SnapCandidate = {
  axis: 'H' | 'V'
  position: number
  kind: 'guide' | 'canvas-edge' | 'canvas-center' | 'layer-edge' | 'layer-center'
  sourceId?: string
}

const NATIVE_SIZE = 240
const CANVAS_CENTER = 120

/** Build the snap-target line list for the current project state. Pass
 *  `excludeLayerIdxs` so the items being dragged don't snap to themselves;
 *  `excludeGuideIds` is the analogous knob for guide-on-guide drag. */
export const computeSnapCandidates = (
  project: EditorProject,
  dummy: DummyStateN,
  excludeLayerIdxs: number[],
  excludeGuideIds: string[],
): SnapCandidate[] => {
  const candidates: SnapCandidate[] = []
  // Canvas frame: 4 edges + 2 centerlines. Cheap; always included.
  candidates.push(
    { axis: 'V', position: 0, kind: 'canvas-edge' },
    { axis: 'V', position: NATIVE_SIZE, kind: 'canvas-edge' },
    { axis: 'H', position: 0, kind: 'canvas-edge' },
    { axis: 'H', position: NATIVE_SIZE, kind: 'canvas-edge' },
    { axis: 'V', position: CANVAS_CENTER, kind: 'canvas-center' },
    { axis: 'H', position: CANVAS_CENTER, kind: 'canvas-center' },
  )
  // Visible, non-dragging guides.
  const skipGuides = new Set(excludeGuideIds)
  for (const g of project.guides) {
    if (!g.visible) continue
    if (skipGuides.has(g.id)) continue
    candidates.push({
      axis: g.axis === 'H' ? 'H' : 'V',
      position: g.position,
      kind: 'guide',
      sourceId: g.id,
    })
  }
  // Non-dragging layers' bbox edges + centers. Skip layers without a
  // resolvable bbox (FaceN digit-dependent kinds, etc.).
  const skipLayers = new Set(excludeLayerIdxs)
  const layerCount =
    project.format === 'typeC'
      ? project.layers.length
      : project.face.elements.length
  for (let i = 0; i < layerCount; i++) {
    if (skipLayers.has(i)) continue
    const bb = computeLayerBbox(project, i, dummy)
    if (!bb) continue
    const id =
      project.format === 'typeC'
        ? project.layers[i].id
        : `el:${i}`
    const cx = bb.x + bb.w / 2
    const cy = bb.y + bb.h / 2
    candidates.push(
      { axis: 'V', position: bb.x, kind: 'layer-edge', sourceId: id },
      { axis: 'V', position: bb.x + bb.w, kind: 'layer-edge', sourceId: id },
      { axis: 'V', position: cx, kind: 'layer-center', sourceId: id },
      { axis: 'H', position: bb.y, kind: 'layer-edge', sourceId: id },
      { axis: 'H', position: bb.y + bb.h, kind: 'layer-edge', sourceId: id },
      { axis: 'H', position: cy, kind: 'layer-center', sourceId: id },
    )
  }
  return candidates
}

/** Try to snap an axis value (a bbox edge or center) to the nearest
 *  candidate within `threshold`. Returns the snapped position and the
 *  matching candidate, or null when nothing's in range. */
export const findSnap = (
  value: number,
  axis: 'H' | 'V',
  candidates: SnapCandidate[],
  threshold: number,
): { position: number; candidate: SnapCandidate } | null => {
  let best: { position: number; candidate: SnapCandidate; dist: number } | null = null
  for (const c of candidates) {
    if (c.axis !== axis) continue
    const d = Math.abs(c.position - value)
    if (d > threshold) continue
    if (!best || d < best.dist) {
      best = { position: c.position, candidate: c, dist: d }
    }
  }
  if (!best) return null
  return { position: best.position, candidate: best.candidate }
}

/** Wraps a layer drag: given the *raw* candidate dx/dy (rounded native px)
 *  and the bbox of the layer/group being moved, find the best snap on each
 *  axis and return the adjusted (dx, dy) plus the matched candidates so the
 *  canvas can render smart-guide overlays. Operates on the group's union
 *  bbox so multi-select drag snaps coherently. */
export const resolveSnap = (
  groupBbox: { x: number; y: number; w: number; h: number },
  rawDx: number,
  rawDy: number,
  candidates: SnapCandidate[],
  threshold: number,
): {
  dx: number
  dy: number
  matchedV: SnapCandidate | null
  matchedH: SnapCandidate | null
} => {
  // For each axis, probe three positions on the moved bbox: leading edge,
  // center, trailing edge. Pick the closest snap across all three.
  const probeX = [
    groupBbox.x + rawDx,
    groupBbox.x + groupBbox.w / 2 + rawDx,
    groupBbox.x + groupBbox.w + rawDx,
  ]
  const probeY = [
    groupBbox.y + rawDy,
    groupBbox.y + groupBbox.h / 2 + rawDy,
    groupBbox.y + groupBbox.h + rawDy,
  ]
  let snapDx = rawDx
  let snapDy = rawDy
  let matchedV: SnapCandidate | null = null
  let matchedH: SnapCandidate | null = null
  let bestVDist = Infinity
  let bestHDist = Infinity
  for (const v of probeX) {
    const snap = findSnap(v, 'V', candidates, threshold)
    if (!snap) continue
    const delta = snap.position - v
    if (Math.abs(delta) < bestVDist) {
      bestVDist = Math.abs(delta)
      snapDx = rawDx + delta
      matchedV = snap.candidate
    }
  }
  for (const v of probeY) {
    const snap = findSnap(v, 'H', candidates, threshold)
    if (!snap) continue
    const delta = snap.position - v
    if (Math.abs(delta) < bestHDist) {
      bestHDist = Math.abs(delta)
      snapDy = rawDy + delta
      matchedH = snap.candidate
    }
  }
  return {
    dx: Math.round(snapDx),
    dy: Math.round(snapDy),
    matchedV,
    matchedH,
  }
}
