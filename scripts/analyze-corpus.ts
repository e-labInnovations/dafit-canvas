// Deep analysis of the watch-face corpus. Designed to surface every pattern
// the editor should care about: dimensions per type, sharing whitelist,
// required types, unknown types, animation-frame ranges, etc.
//
// Usage:
//   node --experimental-strip-types scripts/analyze-corpus.ts <bin-folder>
//
// Outputs (alongside the .bin files):
//   _analysis.md       — human-readable findings
//   _type-defaults.json — proposed TYPE_TABLE additions + (w,h) defaults

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, relative } from 'node:path'
import { decodeFile, typeName } from '../src/lib/dawft.ts'
import type { FaceDataEntry } from '../src/lib/dawft.ts'

const inputDir = process.argv[2]
if (!inputDir) {
  console.error('Usage: analyze-corpus.ts <bin-folder>')
  process.exit(1)
}

const collectBins = (dir: string): string[] => {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...collectBins(full))
    else if (extname(name).toLowerCase() === '.bin') out.push(full)
  }
  return out
}

const bins = collectBins(inputDir)

type Face = {
  file: string
  fileID: number
  faceNumber: number
  animationFrames: number
  blobCount: number
  fileSize: number
  entries: FaceDataEntry[]
}

const faces: Face[] = []
const failed: { file: string; error: string }[] = []

for (const file of bins) {
  try {
    const data = new Uint8Array(readFileSync(file))
    if (data.byteLength < 1900) continue
    const { header } = decodeFile(data)
    if (header.dataCount === 0 || header.dataCount > 39) continue
    faces.push({
      file: relative(inputDir, file),
      fileID: header.fileID,
      faceNumber: header.faceNumber,
      animationFrames: header.animationFrames,
      blobCount: header.blobCount,
      fileSize: data.byteLength,
      entries: header.faceData.slice(0, header.dataCount),
    })
  } catch (err) {
    failed.push({ file: relative(inputDir, file), error: err instanceof Error ? err.message : String(err) })
  }
}

const hex = (n: number) => `0x${n.toString(16).padStart(2, '0')}`

// ---------- 1. TYPE_TABLE coverage ----------

// Known types come from src/lib/dawft.ts. Re-derive here to keep the analysis
// honest — anything we see in the wild but don't have a name for is flagged.
const KNOWN_TYPES = new Set([
  0x00, 0x01, 0x10, 0x11, 0x12, 0x30,
  0x40, 0x41, 0x43, 0x44, 0x45, 0x46,
  0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x6b, 0x6c,
  0x70, 0x71, 0x72, 0x73, 0x74, 0x76,
  0x80, 0x81, 0x82, 0x83, 0x84,
  0x90, 0x91, 0x92, 0x93, 0x94,
  0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6,
  0xc0, 0xc1,
  0xce, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd7, 0xd8, 0xd9, 0xda,
  0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
])

const typeFaces = new Map<number, Set<string>>() // type → set of file names
const typeDims = new Map<number, Map<string, number>>() // type → "WxH" → count
const typeCounts = new Map<number, Map<number, number>>() // type → blob-count → freq
const typePositions = new Map<number, { x: number[]; y: number[] }>() // type → all x/y values

for (const f of faces) {
  // Per-type blob count is inferred from consecutive entry idx differences.
  // For each entry, count = (next non-same-idx entry's idx) - this idx, or
  // total blobCount - this idx for the last one.
  const sortedByIdx = [...f.entries].sort((a, b) => a.idx - b.idx)
  const uniqueIdxs = [...new Set(sortedByIdx.map((e) => e.idx))].sort((a, b) => a - b)
  const countForIdx = new Map<number, number>()
  for (let i = 0; i < uniqueIdxs.length; i++) {
    const start = uniqueIdxs[i]
    const end = i + 1 < uniqueIdxs.length ? uniqueIdxs[i + 1] : f.blobCount
    countForIdx.set(start, end - start)
  }

  for (const e of f.entries) {
    if (!typeFaces.has(e.type)) typeFaces.set(e.type, new Set())
    typeFaces.get(e.type)!.add(f.file)

    const dimKey = `${e.w}x${e.h}`
    if (!typeDims.has(e.type)) typeDims.set(e.type, new Map())
    typeDims.get(e.type)!.set(dimKey, (typeDims.get(e.type)!.get(dimKey) ?? 0) + 1)

    const count = countForIdx.get(e.idx) ?? 1
    if (!typeCounts.has(e.type)) typeCounts.set(e.type, new Map())
    typeCounts.get(e.type)!.set(count, (typeCounts.get(e.type)!.get(count) ?? 0) + 1)

    if (!typePositions.has(e.type)) typePositions.set(e.type, { x: [], y: [] })
    typePositions.get(e.type)!.x.push(e.x)
    typePositions.get(e.type)!.y.push(e.y)
  }
}

// ---------- 2. Sharing patterns ----------

// For each face, find groups of entries that share the same idx.
// Build the multiset of TYPES per shared group → frequency across corpus.
type ShareGroup = { combo: string; types: number[]; count: number; example: string }
const shareCounts = new Map<string, ShareGroup>()
let facesWithSharing = 0
for (const f of faces) {
  const byIdx = new Map<number, number[]>()
  for (const e of f.entries) {
    if (!byIdx.has(e.idx)) byIdx.set(e.idx, [])
    byIdx.get(e.idx)!.push(e.type)
  }
  let saw = false
  for (const [, types] of byIdx) {
    if (types.length <= 1) continue
    saw = true
    const sorted = [...types].sort((a, b) => a - b)
    const key = sorted.map(hex).join('+')
    if (!shareCounts.has(key)) {
      shareCounts.set(key, { combo: key, types: sorted, count: 0, example: f.file })
    }
    shareCounts.get(key)!.count++
  }
  if (saw) facesWithSharing++
}

// ---------- 3. Sequence patterns + co-occurrence ----------

const sequenceFreq = new Map<string, { count: number; example: string }>()
for (const f of faces) {
  const seq = f.entries.map((e) => hex(e.type)).join(' ')
  if (!sequenceFreq.has(seq)) sequenceFreq.set(seq, { count: 0, example: f.file })
  sequenceFreq.get(seq)!.count++
}

// Pairs that co-occur: for each pair of types, in how many faces do both appear?
const cooccur = new Map<string, number>()
for (const f of faces) {
  const present = [...new Set(f.entries.map((e) => e.type))].sort((a, b) => a - b)
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const key = `${hex(present[i])}+${hex(present[j])}`
      cooccur.set(key, (cooccur.get(key) ?? 0) + 1)
    }
  }
}

// ---------- 4. Animation frames, fileID, faceNumber distributions ----------

const animBucket = new Map<string, number>() // "0", "1-100", "100-1k", "1k+"
for (const f of faces) {
  const a = f.animationFrames
  const k = a === 0 ? '0' : a < 100 ? '1-99' : a < 1000 ? '100-999' : a < 10000 ? '1000-9999' : '10000+'
  animBucket.set(k, (animBucket.get(k) ?? 0) + 1)
}
const fileIDs = new Map<number, number>()
for (const f of faces) fileIDs.set(f.fileID, (fileIDs.get(f.fileID) ?? 0) + 1)

// ---------- 5. dataCount and blobCount distributions ----------

const dataCounts: number[] = faces.map((f) => f.entries.length)
const blobCounts: number[] = faces.map((f) => f.blobCount)
const fileSizes: number[] = faces.map((f) => f.fileSize)

const percentile = (arr: number[], p: number): number => {
  const sorted = [...arr].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length * p)]
}

const median = (xs: number[]): number => percentile(xs, 0.5)

// ---------- 6. Idx ordering (do faceData entries ever go backward?) ----------

let withBackward = 0
const backwardFiles: string[] = []
for (const f of faces) {
  let saw = false
  for (let i = 1; i < f.entries.length; i++) {
    // Allow same-idx (sharing); only flag strictly-smaller jumps.
    if (f.entries[i].idx < f.entries[i - 1].idx) {
      saw = true
      break
    }
  }
  if (saw) {
    withBackward++
    if (backwardFiles.length < 10) backwardFiles.push(f.file)
  }
}

// ---------- 7. Per-position-pair sharing whitelist ----------

// For each shared idx, which (sortedTypes) combos are observed AT ALL?
// This is the "safe to share" list the editor should enforce on rebind.
const safeShareCombos = [...shareCounts.values()].sort((a, b) => b.count - a.count)

// ---------- Write reports ----------

const lines: string[] = []
const push = (s: string = '') => lines.push(s)

push(`# Watch-face corpus analysis`)
push(`Faces analyzed: **${faces.length}** (failed: ${failed.length})`)
push(`Source: \`${inputDir}\``)
push()

push(`## 1. File-level distributions`)
push()
push(`| Metric | min | p50 | p90 | max |`)
push(`|---|---|---|---|---|`)
push(`| dataCount (faceData entries) | ${Math.min(...dataCounts)} | ${percentile(dataCounts, 0.5)} | ${percentile(dataCounts, 0.9)} | ${Math.max(...dataCounts)} |`)
push(`| blobCount | ${Math.min(...blobCounts)} | ${percentile(blobCounts, 0.5)} | ${percentile(blobCounts, 0.9)} | ${Math.max(...blobCounts)} |`)
push(`| file size (bytes) | ${Math.min(...fileSizes)} | ${percentile(fileSizes, 0.5).toLocaleString()} | ${percentile(fileSizes, 0.9).toLocaleString()} | ${Math.max(...fileSizes).toLocaleString()} |`)
push()

push(`### fileID values`)
for (const [id, n] of [...fileIDs.entries()].sort((a, b) => b[1] - a[1])) {
  push(`- ${hex(id)}: ${n} faces`)
}
push()

push(`### animationFrames buckets`)
for (const [k, n] of [...animBucket.entries()].sort()) push(`- ${k}: ${n} faces`)
push()

push(`## 2. Types observed`)
push()
push(`${typeFaces.size} distinct types appear across the corpus. Sorted by face count:`)
push()
push(`| Type | Name | Faces using | Most common dim | Most common count |`)
push(`|---|---|---|---|---|`)
const sortedTypes = [...typeFaces.entries()].sort((a, b) => b[1].size - a[1].size)
for (const [type, files] of sortedTypes) {
  const dims = typeDims.get(type)!
  const topDim = [...dims.entries()].sort((a, b) => b[1] - a[1])[0]
  const counts = typeCounts.get(type)!
  const topCount = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  const name = KNOWN_TYPES.has(type) ? typeName(type) : '**UNKNOWN**'
  push(`| ${hex(type)} | ${name} | ${files.size} | ${topDim[0]} (${topDim[1]}×) | ${topCount[0]} (${topCount[1]}×) |`)
}
push()

push(`## 3. Unknown types (not in TYPE_TABLE)`)
const unknownTypes = sortedTypes.filter(([t]) => !KNOWN_TYPES.has(t))
if (unknownTypes.length === 0) {
  push(`None — every type seen is already in TYPE_TABLE.`)
} else {
  push()
  push(`These types appear in the wild but aren't in [TYPE_TABLE](src/lib/dawft.ts). Each row lists the most common count and dimensions:`)
  push()
  push(`| Type | Faces | Most-common count | Most-common dim | Example |`)
  push(`|---|---|---|---|---|`)
  for (const [type, files] of unknownTypes) {
    const dims = typeDims.get(type)!
    const topDim = [...dims.entries()].sort((a, b) => b[1] - a[1])[0]
    const counts = typeCounts.get(type)!
    const topCount = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    const example = [...files][0]
    push(`| ${hex(type)} | ${files.size} | ${topCount[0]} | ${topDim[0]} | ${example} |`)
  }
}
push()

push(`## 4. Sharing patterns (which type combos share blob idx)`)
push()
push(`Faces with any sharing: **${facesWithSharing} / ${faces.length}** (${((facesWithSharing / faces.length) * 100).toFixed(1)}%)`)
push()
push(`### Observed share combos (the editor's "safe to share" whitelist)`)
push()
push(`| Combo | Faces | Example |`)
push(`|---|---|---|`)
for (const g of safeShareCombos) {
  push(`| \`${g.combo}\` | ${g.count} | ${g.example} |`)
}
push()

push(`## 5. Common type-co-occurrence (do two types tend to appear together?)`)
push()
push(`Top 30 co-occurring pairs:`)
push()
push(`| Pair | Faces |`)
push(`|---|---|`)
const sortedCo = [...cooccur.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
for (const [pair, n] of sortedCo) push(`| ${pair} | ${n} |`)
push()

push(`## 6. Backward idx jumps`)
push()
push(`A backward jump is when faceData[i].idx < faceData[i-1].idx. The editor's current materializer can produce this when assets are iterated in a different order than they're referenced.`)
push()
push(`Faces with at least one backward jump: **${withBackward} / ${faces.length}** (${((withBackward / faces.length) * 100).toFixed(1)}%)`)
push(`Examples: ${backwardFiles.slice(0, 5).join(', ')}`)
push()

push(`## 7. Most common faceData sequences (top 25)`)
push()
const topSeqs = [...sequenceFreq.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 25)
for (const [seq, info] of topSeqs) {
  push(`- **${info.count}×** \`${seq}\` _(e.g. ${info.example})_`)
}
push()

// ---------- 8. Per-type position medians + top-3 dimensions ----------

push(`## 8. Per-type position medians + dimension histograms`)
push()
push(`Useful as Insert defaults. Position median is across all faces; "alt dims" lists the runner-up dimensions seen.`)
push()
push(`| Type | Name | Faces | Median (x, y) | Most common dim | Other observed dims (top 3) |`)
push(`|---|---|---|---|---|---|`)
for (const [type, files] of sortedTypes) {
  const pos = typePositions.get(type)!
  const mx = median(pos.x)
  const my = median(pos.y)
  const dims = typeDims.get(type)!
  const sortedDims = [...dims.entries()].sort((a, b) => b[1] - a[1])
  const topDim = sortedDims[0]
  const altDims = sortedDims.slice(1, 4).map(([d, n]) => `${d} (${n}×)`).join(', ') || '—'
  const name = KNOWN_TYPES.has(type) ? typeName(type) : 'UNKNOWN'
  push(`| ${hex(type)} | ${name} | ${files.size} | (${mx}, ${my}) | ${topDim[0]} (${topDim[1]}×) | ${altDims} |`)
}
push()

// ---------- 9. "Required" types — types in many/most faces ----------

push(`## 9. Required types (in ≥10% of faces)`)
push()
push(`If a type appears in this fraction of the corpus, the editor should make it easy to add. A "starter template" probably wants to include the >50% types.`)
push()
push(`| Type | Name | Faces | Coverage |`)
push(`|---|---|---|---|`)
const threshold = Math.ceil(faces.length * 0.1)
for (const [type, files] of sortedTypes) {
  if (files.size < threshold) break
  const pct = ((files.size / faces.length) * 100).toFixed(1)
  const name = KNOWN_TYPES.has(type) ? typeName(type) : 'UNKNOWN'
  push(`| ${hex(type)} | ${name} | ${files.size} | ${pct}% |`)
}
push()

if (failed.length > 0) {
  push(`## 8. Failed to decode`)
  for (const f of failed) push(`- ${f.file}: ${f.error}`)
}

writeFileSync(join(inputDir, '_analysis.md'), lines.join('\n'))

// ---------- type-defaults JSON for editor consumption ----------

const typeDefaults: Record<string, {
  count: number
  dim: { w: number; h: number }
  pos: { x: number; y: number }
  name?: string
  faces: number
  altDims: { w: number; h: number; n: number }[]
}> = {}
for (const [type, files] of sortedTypes) {
  const dims = typeDims.get(type)!
  const sortedDims = [...dims.entries()].sort((a, b) => b[1] - a[1])
  const [topW, topH] = sortedDims[0][0].split('x').map((s) => parseInt(s, 10))
  const counts = typeCounts.get(type)!
  const topCount = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const pos = typePositions.get(type)!
  typeDefaults[hex(type)] = {
    count: topCount,
    dim: { w: topW, h: topH },
    pos: { x: median(pos.x), y: median(pos.y) },
    name: KNOWN_TYPES.has(type) ? typeName(type) : undefined,
    faces: files.size,
    altDims: sortedDims.slice(1, 4).map(([d, n]) => {
      const [w, h] = d.split('x').map((s) => parseInt(s, 10))
      return { w, h, n }
    }),
  }
}
const safeShareList = safeShareCombos.map((g) => ({
  combo: g.combo,
  types: g.types,
  count: g.count,
  example: g.example,
}))
writeFileSync(
  join(inputDir, '_type-defaults.json'),
  JSON.stringify({ typeDefaults, safeShareList, generatedAt: new Date().toISOString(), facesAnalyzed: faces.length }, null, 2),
)

console.log(`Analyzed ${faces.length} faces (failed: ${failed.length})`)
console.log(`Wrote ${join(inputDir, '_analysis.md')}`)
console.log(`Wrote ${join(inputDir, '_type-defaults.json')}`)
