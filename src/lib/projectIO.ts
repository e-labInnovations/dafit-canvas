// Project ↔ binary / zip plumbing for the editor. Sits between the editor
// store (rich format-parsed shape) and the on-disk Type C / FaceN encoders.

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
  type Compression,
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
import type {
  EditorProject,
  FaceNProject,
  TypeCProject,
  WatchFormat,
} from '../types/face'

type DecodedBitmap = { width: number; height: number; rgba: Uint8ClampedArray }

// ---------- empty projects (for "New") ----------

const blankFaceData = (): FaceDataEntry => ({
  type: 0,
  idx: 0,
  x: 0,
  y: 0,
  w: 0,
  h: 0,
})

export const emptyTypeCProject = (faceNumber = 50001): TypeCProject => ({
  format: 'typeC',
  fileName: null,
  header: {
    fileID: 0x81,
    dataCount: 0,
    blobCount: 0,
    faceNumber,
    faceData: Array.from({ length: 39 }, blankFaceData),
    offsets: Array.from({ length: 250 }, () => 0),
    sizes: Array.from({ length: 250 }, () => 0),
    animationFrames: 0,
  },
  blobs: [],
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
})

export const emptyProject = (format: WatchFormat): EditorProject =>
  format === 'typeC' ? emptyTypeCProject() : emptyFaceNProject()

// ---------- import: bin ----------

export const importBin = async (file: File): Promise<EditorProject> => {
  const data = new Uint8Array(await file.arrayBuffer())
  const fmt = detectFormat(data)
  if (fmt === 'typeC') {
    const { header, blobs } = decodeFile(data)
    return { format: 'typeC', fileName: file.name, header, blobs }
  }
  if (fmt === 'faceN') {
    const face = parseFaceN(data)
    return { format: 'faceN', fileName: file.name, face }
  }
  throw new Error(
    `Unrecognized .bin format. First byte 0x${data[0]?.toString(16).padStart(2, '0')}.`,
  )
}

// ---------- import: zip ----------

/** Load every BMP + RAW entry in the ZIP, keyed by both basename and by the
 *  trailing-number index (so dump-style "057.bmp" works alongside the FaceN
 *  filename scheme like "digit_0_3.bmp"). */
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
    const { header, blobs } = decodeFile(bin)
    return { format: 'typeC', fileName: file.name, header, blobs }
  }

  // FaceN branch
  const txt = await jsonEntry!.async('string')
  const config = parseWatchfaceJson(txt)
  const bin = packFaceN({ config, bitmaps: assets.byName })
  const face = parseFaceN(bin)
  return { format: 'faceN', fileName: file.name, face }
}

// ---------- export: Type C bin / zip ----------

/** Re-pack a Type C project to a fresh .bin. Re-uses the FaceHeader fields the
 *  editor mutates (faceData positions, faceNumber, etc.). */
export const exportTypeCBin = (project: TypeCProject): Uint8Array => {
  const { header, blobs } = project
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

export const exportTypeCZip = async (project: TypeCProject): Promise<Blob> => {
  const { header, blobs } = project
  const zip = new JSZip()
  zip.file('watchface.txt', buildWatchfaceTxt(header, blobs))
  for (const b of blobs) {
    const name = padIdx(b.index)
    if (b.rgba && b.width !== null && b.height !== null) {
      zip.file(`${name}.bmp`, encodeBmpRgb565(b.rgba, b.width, b.height))
    } else {
      zip.file(`${name}.raw`, b.raw)
    }
  }
  return zip.generateAsync({ type: 'blob' })
}

// ---------- export: FaceN bin / zip ----------

/** Convert an in-memory FaceN (binary-parsed) to a ParsedWatchfaceJson + the
 *  bitmap map needed by packFaceN. Filenames come from `collectBlobs` so the
 *  config + bitmaps always line up. */
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
        // Unknown elements can't be re-encoded; skip with a placeholder.
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

// ---------- unified export helpers (the editor calls these) ----------

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
    // Copy into a fresh ArrayBuffer-backed view so the Blob constructor accepts
    // it under TS6's stricter `BlobPart` typing (which rejects ArrayBufferLike).
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

// ---------- layer helpers (shared between LayerList and PropertyPanel) ----------

export type LayerView = {
  /** Index into the project's element array. */
  index: number
  /** Human-readable label. */
  name: string
  /** Top-left x position. null for kinds without a meaningful single x. */
  x: number | null
  y: number | null
  /** Inferred bounding box width/height. null if not directly stored. */
  w: number | null
  h: number | null
}

/** Surface every editable layer in a project as a uniform list. For Type C we
 *  walk `header.faceData[0..dataCount]`; for FaceN we walk `face.elements`.
 *  Used by LayerList and PropertyPanel so they're format-agnostic. */
export const listLayers = (project: EditorProject): LayerView[] => {
  if (project.format === 'typeC') {
    return project.header.faceData
      .slice(0, project.header.dataCount)
      .map((fd, i) => ({
        index: i,
        name: typeNameLabel(fd),
        x: fd.x,
        y: fd.y,
        w: fd.w,
        h: fd.h,
      }))
  }
  return project.face.elements.map((el, i) => {
    const pos = elementPosition(el)
    return {
      index: i,
      name: faceNElementLabel(el, i),
      x: pos.x,
      y: pos.y,
      w: pos.w,
      h: pos.h,
    }
  })
}

const typeNameLabel = (fd: FaceDataEntry): string => {
  const hex = fd.type.toString(16).padStart(2, '0')
  return `${typeName(fd.type)} (0x${hex})`
}

const elementPosition = (
  el: FaceN['elements'][number],
): { x: number | null; y: number | null; w: number | null; h: number | null } => {
  switch (el.kind) {
    case 'Image':
      return { x: el.x, y: el.y, w: el.img.width, h: el.img.height }
    case 'TimeNum':
      // TimeNum has 4 per-digit XYs; surface the first as a reference point.
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

const faceNElementLabel = (
  el: FaceN['elements'][number],
  i: number,
): string => `${i}. ${el.kind}`

// ---------- mutation helpers ----------

/** Patch x/y on the selected layer regardless of format. Returns a new project
 *  with the mutation applied. */
export const movLayer = (
  project: EditorProject,
  index: number,
  dx: number,
  dy: number,
): EditorProject => {
  if (project.format === 'typeC') {
    const faceData = project.header.faceData.map((fd, i) =>
      i === index ? { ...fd, x: fd.x + dx, y: fd.y + dy } : fd,
    )
    return { ...project, header: { ...project.header, faceData } }
  }
  const elements = project.face.elements.map((el, i) => {
    if (i !== index) return el
    return shiftElement(el, dx, dy)
  })
  return { ...project, face: { ...project.face, elements } }
}

/** Set absolute x/y on the selected layer (no-op for kinds without xy). */
export const setLayerXY = (
  project: EditorProject,
  index: number,
  x: number,
  y: number,
): EditorProject => {
  if (project.format === 'typeC') {
    const faceData = project.header.faceData.map((fd, i) =>
      i === index ? { ...fd, x, y } : fd,
    )
    return { ...project, header: { ...project.header, faceData } }
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
      return {
        ...el,
        xys: [xys[0], xys[1], xys[2], xys[3]],
      }
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
    case 'TimeNum': {
      // Snap all 4 digit XYs by the delta from the first one (preserves spacing).
      const dx = x - el.xys[0].x
      const dy = y - el.xys[0].y
      return shiftElement(el, dx, dy)
    }
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

/** Reorder a layer in the underlying array (Type C: faceData; FaceN: elements). */
export const reorderLayer = (
  project: EditorProject,
  index: number,
  direction: 'up' | 'down',
): EditorProject => {
  if (project.format === 'typeC') {
    const list = [...project.header.faceData]
    const limit = project.header.dataCount
    const target = direction === 'up' ? index + 1 : index - 1
    if (target < 0 || target >= limit) return project
    ;[list[index], list[target]] = [list[target], list[index]]
    return { ...project, header: { ...project.header, faceData: list } }
  }
  const list = [...project.face.elements]
  const target = direction === 'up' ? index + 1 : index - 1
  if (target < 0 || target >= list.length) return project
  ;[list[index], list[target]] = [list[target], list[index]]
  return { ...project, face: { ...project.face, elements: list } }
}

/** Remove a layer entirely. For Type C we shrink dataCount so the freed slot
 *  is treated as unused (but blob payloads are kept — they're indexed by blob
 *  number, not by faceData slot). For FaceN we splice elements. */
export const deleteLayer = (
  project: EditorProject,
  index: number,
): EditorProject => {
  if (project.format === 'typeC') {
    const list = [...project.header.faceData]
    list.splice(index, 1)
    list.push(blankFaceData())
    return {
      ...project,
      header: {
        ...project.header,
        faceData: list,
        dataCount: Math.max(0, project.header.dataCount - 1),
      },
    }
  }
  const elements = [...project.face.elements]
  elements.splice(index, 1)
  return { ...project, face: { ...project.face, elements } }
}

// ---------- preview rebuilder (round-trip preview through the encoder) ----------

/** Pack the current Type C project and decode it back, so the preview is
 *  driven by exactly the bytes that would ship. Catches encoder bugs early. */
export const rebuildTypeCPreview = (
  project: TypeCProject,
): { header: FaceHeader; blobs: DecodedBlob[] } | null => {
  if (project.header.dataCount === 0 || project.header.blobCount === 0) return null
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
// Phase 2: asset enumeration + replace + insert
// ===================================================================

/** A pointer to a single replaceable image slot inside a project. The tag lets
 *  callers patch the right field without re-walking the project tree. */
export type AssetRef =
  | { tag: 'typeC-blob'; blobIdx: number }
  | { tag: 'faceN-preview' }
  | { tag: 'faceN-digit'; setIdx: number; digitIdx: number }
  | { tag: 'faceN-elem'; elementIdx: number; slotIdx: number }

export type AssetView = {
  ref: AssetRef
  /** Short human-readable label (e.g. "0 (TIME_H1)", "Mon", "bg"). */
  label: string
  width: number
  height: number
  rgba: Uint8ClampedArray | null
}

const dayNameLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const batteryFillLabels = ['bg', 'fill', 'mask']

/** Return every replaceable asset owned by the given layer. Empty for kinds
 *  whose pixel data lives in a shared digit set (TimeNum, *Num). */
export const listLayerAssets = (
  project: EditorProject,
  layerIdx: number,
): AssetView[] => {
  if (project.format === 'typeC') {
    const fd = project.header.faceData[layerIdx]
    if (!fd) return []
    const count = blobCountForType(fd.type, project.header.animationFrames)
    const out: AssetView[] = []
    for (let i = 0; i < count; i++) {
      const blobIdx = fd.idx + i
      const blob = project.blobs[blobIdx]
      out.push({
        ref: { tag: 'typeC-blob', blobIdx },
        label: `${blobIdx}${count > 1 ? ` (${i})` : ''}`,
        width: blob?.width ?? 0,
        height: blob?.height ?? 0,
        rgba: blob?.rgba ?? null,
      })
    }
    return out
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
      // These reference a shared digit set; no per-layer assets.
      return []
  }
}

// ---------- BMP file → DecodedBitmap helper ----------

/** Read a BMP file from disk and decode to RGBA. Throws on non-BMP. */
export const decodeBmpFile = async (file: File): Promise<DecodedBitmap> => {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const bmp = decodeBmp(bytes)
  return { width: bmp.width, height: bmp.height, rgba: bmp.rgba }
}

// ---------- asset replace ----------

export type ReplaceOpts = {
  /** If true, require the new BMP's dimensions to match the existing slot's
   *  width/height. Set false when replacing an empty (w=h=0) slot. */
  requireDimMatch: boolean
}

const buildEmptyDecodedBlob = (
  index: number,
  bitmap: DecodedBitmap,
  compression: Compression,
  type: number | null,
  faceDataIdx: number | null,
): DecodedBlob => ({
  index,
  faceDataIdx,
  type,
  typeName: type !== null ? typeName(type) : 'UNKNOWN',
  width: bitmap.width,
  height: bitmap.height,
  compression,
  rawSize: bitmap.width * bitmap.height * 2,
  rgba: bitmap.rgba,
  raw: new Uint8Array(0),
})

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

/** Replace the pixel data at an AssetRef with a new BMP. Resizes the slot to
 *  the new bitmap's dimensions when the slot was previously empty (w=h=0);
 *  otherwise (with `requireDimMatch: true`) enforces an exact match. */
export const replaceAsset = (
  project: EditorProject,
  ref: AssetRef,
  bitmap: DecodedBitmap,
  opts: ReplaceOpts = { requireDimMatch: true },
): EditorProject => {
  if (project.format === 'typeC' && ref.tag === 'typeC-blob') {
    const existing = project.blobs[ref.blobIdx]
    if (existing && opts.requireDimMatch) {
      requireMatch(
        {
          width: existing.width ?? 0,
          height: existing.height ?? 0,
        },
        bitmap,
        `blob ${ref.blobIdx}`,
      )
    }
    const next = buildEmptyDecodedBlob(
      ref.blobIdx,
      bitmap,
      existing?.compression ?? 'RLE_LINE',
      existing?.type ?? null,
      existing?.faceDataIdx ?? null,
    )
    const blobs = project.blobs.slice()
    blobs[ref.blobIdx] = next
    // Also patch the matching faceData width/height if the slot was empty.
    let header = project.header
    if (existing?.faceDataIdx != null) {
      const faceData = header.faceData.map((fd, i) =>
        i === existing.faceDataIdx && (fd.w === 0 || fd.h === 0)
          ? { ...fd, w: bitmap.width, h: bitmap.height }
          : fd,
      )
      header = { ...header, faceData }
    }
    return { ...project, header, blobs }
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
      return slotIdx === 0
        ? { ...el, img: swapImgRef(el.img, bmp, opts, 'image') }
        : el
    case 'DayName': {
      const imgs = el.imgs.map((img, i) =>
        i === slotIdx
          ? swapImgRef(img, bmp, opts, `${dayNameLabels[i] ?? i}`)
          : img,
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
      return slotIdx === 0
        ? { ...el, img: swapImgRef(el.img, bmp, opts, 'hand') }
        : el
    case 'BarDisplay':
    case 'Weather': {
      const imgs = el.imgs.map((img, i) =>
        i === slotIdx ? swapImgRef(img, bmp, opts, String(i)) : img,
      )
      return { ...el, imgs }
    }
    case 'Dash':
      return slotIdx === 0
        ? { ...el, img: swapImgRef(el.img, bmp, opts, 'dash') }
        : el
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

// ---------- insert (simple kinds only — Phase 2) ----------

/** Type C kinds we can insert in Phase 2. All consume exactly 1 blob, so the
 *  user picks a single BMP and we wire it up. Digit-set kinds (10 blobs each)
 *  are deferred to Phase 3's font generator. */
export const TYPEC_INSERTABLE: { type: number; name: string }[] = [
  { type: 0x01, name: 'BACKGROUND' },
  { type: 0x45, name: 'TIME_AM' },
  { type: 0x46, name: 'TIME_PM' },
  { type: 0x71, name: 'STEPS_LOGO' },
  { type: 0x81, name: 'HR_LOGO' },
  { type: 0x91, name: 'KCAL_LOGO' },
  { type: 0xa1, name: 'DIST_LOGO' },
  { type: 0xa5, name: 'DIST_KM' },
  { type: 0xa6, name: 'DIST_MI' },
  { type: 0xc0, name: 'BTLINK_UP' },
  { type: 0xc1, name: 'BTLINK_DOWN' },
  { type: 0xce, name: 'BATT_IMG' },
  { type: 0xd1, name: 'BATT_IMG_C' },
  { type: 0xf0, name: 'SEPERATOR' },
  { type: 0xf1, name: 'HAND_HOUR' },
  { type: 0xf2, name: 'HAND_MINUTE' },
  { type: 0xf3, name: 'HAND_SEC' },
  { type: 0xf4, name: 'HAND_PIN_UPPER' },
  { type: 0xf5, name: 'HAND_PIN_LOWER' },
]

/** Insert a 1-blob Type C layer at the end of faceData, appending the bitmap
 *  to the blob array. */
export const insertTypeCLayer = (
  project: TypeCProject,
  type: number,
  bitmap: DecodedBitmap,
  position: { x: number; y: number } = { x: 0, y: 0 },
): TypeCProject => {
  const newBlobIdx = project.header.blobCount
  const newFaceDataIdx = project.header.dataCount
  if (newFaceDataIdx >= 39) {
    throw new Error('Type C supports at most 39 faceData entries.')
  }

  const newBlob = buildEmptyDecodedBlob(
    newBlobIdx,
    bitmap,
    'RLE_LINE',
    type,
    newFaceDataIdx,
  )
  const blobs = [...project.blobs, newBlob]

  const faceData = project.header.faceData.slice()
  faceData[newFaceDataIdx] = {
    type,
    idx: newBlobIdx,
    x: position.x,
    y: position.y,
    w: bitmap.width,
    h: bitmap.height,
  }
  return {
    ...project,
    header: {
      ...project.header,
      dataCount: project.header.dataCount + 1,
      blobCount: project.header.blobCount + 1,
      faceData,
    },
    blobs,
  }
}

/** FaceN kinds we can insert in Phase 2. Each maps to a builder that takes the
 *  user-provided BMPs and produces a fresh FNEl. */
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

export const FACEN_INSERTABLE: { kind: FaceNInsertableKind; label: string; imageCount: number }[] = [
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

const emptyImgRef = (bmp?: DecodedBitmap): FaceN['preview'] => ({
  offset: 0,
  width: bmp?.width ?? 0,
  height: bmp?.height ?? 0,
  rawSize: bmp ? bmp.width * bmp.height * 3 : 0,
  rgba: bmp?.rgba ?? null,
})

/** Insert a FaceN element at the end of `face.elements`. `bitmaps` provides one
 *  bitmap per asset slot; pass an empty array (or fewer than required) to add
 *  the element with blank slots that the user fills in via Replace. */
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
      element = { kind: 'Image', eType: 0, x: position.x, y: position.y, img: emptyImgRef(at(0)) }
      break
    case 'TimeHand-Hour':
    case 'TimeHand-Minute':
    case 'TimeHand-Second': {
      const hType = kind === 'TimeHand-Hour' ? 0 : kind === 'TimeHand-Minute' ? 1 : 2
      element = {
        kind: 'TimeHand',
        eType: 10,
        hType,
        pivotX: 120,
        pivotY: 120,
        img: emptyImgRef(at(0)),
        x: position.x,
        y: position.y,
      }
      break
    }
    case 'Dash':
      element = { kind: 'Dash', eType: 35, img: emptyImgRef(at(0)) }
      break
    case 'DayName':
      element = {
        kind: 'DayName',
        eType: 4,
        nType: 0,
        x: position.x,
        y: position.y,
        imgs: Array.from({ length: 7 }, (_, i) => emptyImgRef(at(i))),
      }
      break
    case 'BatteryFill':
      element = {
        kind: 'BatteryFill',
        eType: 5,
        x: position.x,
        y: position.y,
        bgImg: emptyImgRef(at(0)),
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 0,
        unknown0: 0,
        unknown1: 0,
        img1: emptyImgRef(at(1)),
        img2: emptyImgRef(at(2)),
      }
      break
    case 'BarDisplay': {
      const count = Math.max(1, bitmaps.length || 5)
      element = {
        kind: 'BarDisplay',
        eType: 18,
        bType: 0,
        count,
        x: position.x,
        y: position.y,
        imgs: Array.from({ length: count }, (_, i) => emptyImgRef(at(i))),
      }
      break
    }
    case 'Weather': {
      const count = Math.max(1, bitmaps.length || 10)
      element = {
        kind: 'Weather',
        eType: 27,
        count,
        x: position.x,
        y: position.y,
        imgs: Array.from({ length: count }, (_, i) => emptyImgRef(at(i))),
      }
      break
    }
  }
  return {
    ...project,
    face: {
      ...project.face,
      elements: [...project.face.elements, element],
    },
  }
}

// ---------- generic patch (kind-specific scalar fields) ----------

/** Patch arbitrary scalar fields on the selected FaceN element. The patcher
 *  has to know which fields are valid for each kind; callers should pass only
 *  fields that exist on the discriminated subtype. */
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

/** Patch arbitrary fields on a Type C faceData entry. */
export const patchTypeCFaceData = (
  project: TypeCProject,
  idx: number,
  patch: Partial<FaceDataEntry>,
): TypeCProject => {
  const faceData = project.header.faceData.map((fd, i) =>
    i === idx ? { ...fd, ...patch } : fd,
  )
  return { ...project, header: { ...project.header, faceData } }
}

// ---------- digit-set inspection (read-only for Phase 2) ----------

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

/** Suppress the "unused" warning on `swapImgRef` (TS6 lint catches the
 *  intermediate helper). It's exported indirectly via patchElementAsset. */
void swapImgRef
