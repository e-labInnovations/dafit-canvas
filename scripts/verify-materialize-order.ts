// Sanity-check the new materializeTypeC ordering against a real project.json
// + a known-good reference .bin (the one the watch actually renders correctly).
// Usage:
//   node --experimental-strip-types scripts/verify-materialize-order.ts \
//     <project.json> <reference.bin>
//
// Prints the per-layer idx values our materializer now assigns vs the
// reference. We don't expect a perfect match (the reference packer may have
// its own tiebreak rules), but the count-grouping should be the same.

import { readFileSync } from 'node:fs'
import { decodeFile } from '../src/lib/dawft.ts'

const [, , projectJsonPath, refBinPath] = process.argv
if (!projectJsonPath || !refBinPath) {
  console.error('Usage: verify-materialize-order.ts <project.json> <reference.bin>')
  process.exit(1)
}

// Re-load the project as if the user re-imported it from ZIP.
type V1 = {
  version: 1
  format: 'typeC'
  faceNumber: number
  fileID: number
  animationFrames: number
  layers: { type: number; assetSetId: string }[]
  assetSets: { id: string; count: number; width: number; height: number }[]
}
const json = JSON.parse(readFileSync(projectJsonPath, 'utf8')) as V1

// We can't run materializeTypeC directly without a full project (slot bytes),
// but the ORDER it emits depends only on assetSets[].count + their first
// consumer's type. Replicate the sort here so we can preview the assigned
// idx values. Keep this in sync with the implementation in projectIO.ts.
const PROGBAR_TYPES = new Set([0x70, 0x80, 0x90, 0xa0])
const consumed = json.assetSets.filter((s) =>
  json.layers.some((l) => l.assetSetId === s.id),
)
const firstConsumerType = (setId: string): number | null =>
  json.layers.find((l) => l.assetSetId === setId)?.type ?? null
const categoryFor = (count: number, type: number | null): number => {
  if (type !== null && PROGBAR_TYPES.has(type)) return 0
  if (count > 1) return 1
  return 2
}
const sorted = [...consumed]
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

const setStartIdx = new Map<string, number>()
let cursor = 0
for (const s of sorted) {
  setStartIdx.set(s.id, cursor)
  cursor += s.count
}

// Pull the reference .bin's faceData for side-by-side comparison.
const refData = new Uint8Array(readFileSync(refBinPath))
const { header: refHeader } = decodeFile(refData)

console.log(`Layers (${json.layers.length}) — new materializer idx vs reference idx:`)
console.log(`${'i'.padEnd(3)} ${'type'.padEnd(10)} ${'set count'.padEnd(10)} ${'new idx'.padEnd(8)} ${'ref idx'.padEnd(8)}  ${'match?'}`)
let mismatches = 0
json.layers.forEach((layer, i) => {
  const set = json.assetSets.find((s) => s.id === layer.assetSetId)!
  const newIdx = setStartIdx.get(layer.assetSetId)!
  const refIdx = refHeader.faceData[i]?.idx
  const match = newIdx === refIdx ? '✓' : '✗ DIFF'
  if (newIdx !== refIdx) mismatches++
  const t = `0x${layer.type.toString(16).padStart(2, '0')}`
  console.log(
    `[${String(i).padStart(2)}] ${t.padEnd(10)} ${String(set.count).padEnd(10)} ${String(newIdx).padEnd(8)} ${String(refIdx).padEnd(8)}  ${match}`,
  )
})

console.log(`\nMatches: ${json.layers.length - mismatches}/${json.layers.length}`)
console.log(`Total blob count emitted: ${cursor} (reference: ${refHeader.blobCount})`)

