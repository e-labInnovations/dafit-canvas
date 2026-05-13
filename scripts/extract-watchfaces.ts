// Walk a folder of .bin watch face files, decode each as Type C, and emit a
// sibling <name>.watchface.txt. Aggregates type-usage and shared-idx patterns
// across the whole corpus so we can learn which faceData layouts MoYoung
// firmware actually accepts.
//
// Usage:
//   node --experimental-strip-types scripts/extract-watchfaces.ts <bin-folder>
//
// Outputs:
//   <bin-folder>/<name>.watchface.txt      — one per decoded .bin
//   <bin-folder>/_summary.csv              — one CSV row per faceData entry
//   <bin-folder>/_stats.txt                — type frequency + sharing report

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, relative } from 'node:path'
import { decodeFile, buildWatchfaceTxt, typeName } from '../src/lib/dawft.ts'

const inputDir = process.argv[2]
if (!inputDir) {
  console.error('Usage: extract-watchfaces.ts <bin-folder>')
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

type FaceSummary = {
  file: string
  fileID: number
  blobCount: number
  dataCount: number
  faceNumber: number
  animationFrames: number
  entries: { type: number; idx: number; x: number; y: number; w: number; h: number }[]
}

const bins = collectBins(inputDir)
console.log(`Found ${bins.length} .bin file(s) under ${inputDir}`)

const summaries: FaceSummary[] = []
const failed: { file: string; error: string }[] = []
const skipped: string[] = []

for (const file of bins) {
  const rel = relative(inputDir, file)
  try {
    const data = new Uint8Array(readFileSync(file))
    // Type C fileID is conventionally 0x80..0x84; FaceN starts with different magic.
    // Use a loose check — decodeFile will throw on truly bogus input.
    if (data.byteLength < 1900) {
      skipped.push(`${rel} (too small to be Type C)`)
      continue
    }
    const { header, blobs } = decodeFile(data)
    if (header.dataCount === 0 || header.dataCount > 39) {
      skipped.push(`${rel} (dataCount=${header.dataCount}, not Type C)`)
      continue
    }
    const txt = buildWatchfaceTxt(header, blobs)
    const txtPath = file.replace(/\.bin$/i, '.watchface.txt')
    writeFileSync(txtPath, txt)
    summaries.push({
      file: rel,
      fileID: header.fileID,
      blobCount: header.blobCount,
      dataCount: header.dataCount,
      faceNumber: header.faceNumber,
      animationFrames: header.animationFrames,
      entries: header.faceData.slice(0, header.dataCount).map((fd) => ({
        type: fd.type,
        idx: fd.idx,
        x: fd.x,
        y: fd.y,
        w: fd.w,
        h: fd.h,
      })),
    })
  } catch (err) {
    failed.push({ file: rel, error: err instanceof Error ? err.message : String(err) })
  }
}

console.log(`Extracted: ${summaries.length}  Failed: ${failed.length}  Skipped: ${skipped.length}`)

// ---------- aggregate stats ----------

const hex = (n: number) => `0x${n.toString(16).padStart(2, '0')}`

const typeFreq = new Map<number, number>()
for (const s of summaries) {
  for (const e of s.entries) typeFreq.set(e.type, (typeFreq.get(e.type) ?? 0) + 1)
}

// Sharing: faces where 2+ faceData entries point at the same blob idx.
// We report which TYPE COMBOS share — i.e., which type-pairs the firmware
// accepts as sharing the same blob range in the wild.
const shareCombos = new Map<string, number>()
const shareExamples = new Map<string, string>()
let facesWithSharing = 0
for (const s of summaries) {
  const byIdx = new Map<number, number[]>()
  for (const e of s.entries) {
    if (!byIdx.has(e.idx)) byIdx.set(e.idx, [])
    byIdx.get(e.idx)!.push(e.type)
  }
  let sawAny = false
  for (const [, types] of byIdx) {
    if (types.length <= 1) continue
    sawAny = true
    const key = types
      .slice()
      .sort((a, b) => a - b)
      .map(hex)
      .join('+')
    shareCombos.set(key, (shareCombos.get(key) ?? 0) + 1)
    if (!shareExamples.has(key)) shareExamples.set(key, s.file)
  }
  if (sawAny) facesWithSharing++
}

// faceData ORDER patterns: how often does a given (type-sequence) appear?
// We dump only the top-10 most common sequences so the user can eyeball them.
const sequenceFreq = new Map<string, number>()
const sequenceExample = new Map<string, string>()
for (const s of summaries) {
  const seq = s.entries.map((e) => hex(e.type)).join(' ')
  sequenceFreq.set(seq, (sequenceFreq.get(seq) ?? 0) + 1)
  if (!sequenceExample.has(seq)) sequenceExample.set(seq, s.file)
}

// ---------- write stats.txt ----------

const lines: string[] = []
lines.push(`# Watch-face corpus stats`)
lines.push(`Total .bin files found:  ${bins.length}`)
lines.push(`Decoded successfully:    ${summaries.length}`)
lines.push(`Failed:                  ${failed.length}`)
lines.push(`Skipped (non-Type-C):    ${skipped.length}`)
lines.push('')

lines.push(`## Type frequency (how many faces use each type)`)
const sortedTypes = [...typeFreq.entries()].sort((a, b) => b[1] - a[1])
for (const [type, count] of sortedTypes) {
  lines.push(`  ${hex(type)}  ${typeName(type).padEnd(20)}  ${count}`)
}
lines.push('')

lines.push(`## Shared blob idx (multiple faceData entries → same idx)`)
lines.push(`Faces with ANY sharing:  ${facesWithSharing} / ${summaries.length}`)
lines.push('')
const sortedShares = [...shareCombos.entries()].sort((a, b) => b[1] - a[1])
for (const [combo, count] of sortedShares) {
  lines.push(`  ${combo.padEnd(30)}  ${count} faces   e.g. ${shareExamples.get(combo)}`)
}
lines.push('')

lines.push(`## Most common faceData type sequences (top 20)`)
const sortedSeqs = [...sequenceFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
for (const [seq, count] of sortedSeqs) {
  lines.push(`  ${count}×  ${seq}   e.g. ${sequenceExample.get(seq)}`)
}
lines.push('')

if (failed.length > 0) {
  lines.push(`## Failures`)
  for (const f of failed) lines.push(`  ${f.file}: ${f.error}`)
  lines.push('')
}

writeFileSync(join(inputDir, '_stats.txt'), lines.join('\n'))

// ---------- write summary.csv (one row per faceData entry) ----------

let csv = 'file,faceNumber,dataCount,blobCount,fdIndex,type,typeName,idx,x,y,w,h\n'
for (const s of summaries) {
  s.entries.forEach((e, i) => {
    csv += `"${s.file}",${s.faceNumber},${s.dataCount},${s.blobCount},${i},${hex(e.type)},${typeName(e.type)},${e.idx},${e.x},${e.y},${e.w},${e.h}\n`
  })
}
writeFileSync(join(inputDir, '_summary.csv'), csv)

console.log(`Wrote ${inputDir}/_stats.txt`)
console.log(`Wrote ${inputDir}/_summary.csv`)
