// Bulk-download every watch face from the MoYoung v2 catalogue for a given
// model (tpls) + firmware (fv). Resumable: existing <id>.bin files are skipped.
//
// Uses the legacy v2 endpoint (`api.moyoung.com/v2/faces`) because the UI's
// "All" tab also uses it — it returns the full file URL inline, so we don't
// need a per-face face-detail round-trip. v3 list responses only include a
// host-only file field, hence the v2 preference here.
//
// Pairs with extract-watchfaces.ts — run that after this finishes to decode
// the corpus into watchface.txt + corpus-wide stats.
//
// Usage:
//   node --experimental-strip-types scripts/download-faces.ts \
//        [--tpls 38] [--fv MOY-GKE5-2.2.7] \
//        [--out ./faces] [--concurrency 4] [--limit 0]

import { mkdirSync, existsSync, writeFileSync, createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'

const LEGACY = 'https://api.moyoung.com'

type Args = {
  tpls: string
  fv: string
  out: string
  concurrency: number
  limit: number
}

const parseArgs = (): Args => {
  const args: Args = {
    tpls: '38',
    fv: 'MOY-GKE5-2.2.7',
    out: './faces',
    concurrency: 4,
    limit: 0,
  }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') {
      console.log(`Usage: download-faces.ts [--tpls 38] [--fv MOY-GKE5-2.2.7] [--out ./faces] [--concurrency 4] [--limit 0]`)
      process.exit(0)
    }
    const next = (): string => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`Missing value for ${a}`)
      return v
    }
    switch (a) {
      case '--tpls': args.tpls = next(); break
      case '--fv': args.fv = next(); break
      case '--out': args.out = next(); break
      case '--concurrency': args.concurrency = parseInt(next(), 10); break
      case '--limit': args.limit = parseInt(next(), 10); break
      default:
        throw new Error(`Unknown arg: ${a}`)
    }
  }
  return args
}

const args = parseArgs()
mkdirSync(args.out, { recursive: true })

// ---------- v2 API types (matches src/types/moyoung.ts) ----------

type MoyoungFace = {
  id: number
  tpl: number
  tpls: number[]
  firmware: string[]
  preview: string
  file: string
}
type MoyoungFacesResponse = {
  code: number
  message: string
  current_page: string
  per_page: string
  total: number
  count: number
  faces: MoyoungFace[]
}

const jsonGet = async <T>(url: string): Promise<T> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`)
  const body = (await res.json()) as { code: number; message: string } & T
  if (body.code !== 0) throw new Error(`API ${body.code}: ${body.message} (${url})`)
  return body as unknown as T
}

const listPage = (p: number): Promise<MoyoungFacesResponse> =>
  jsonGet<MoyoungFacesResponse>(
    `${LEGACY}/v2/faces?tpls=${args.tpls}&fv=${args.fv}&per_page=50&p=${p}`,
  )

const downloadFile = async (url: string, dest: string): Promise<void> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`)
  if (!res.body) throw new Error(`Empty body for ${url}`)
  await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(dest))
}

// ---------- 1. enumerate all faces across pages ----------

console.log(`Enumerating faces for tpls=${args.tpls} fv=${args.fv}…`)
const allFaces: MoyoungFace[] = []
let page = 1
let total = Infinity
while (allFaces.length < total) {
  const res = await listPage(page)
  total = res.total
  if (res.faces.length === 0) break
  allFaces.push(...res.faces)
  console.log(`  page ${page}: +${res.faces.length} (have ${allFaces.length} / ${total})`)
  page++
  if (page > 100) break // safety: 100*50 = 5000 faces
}

const targets = args.limit > 0 ? allFaces.slice(0, args.limit) : allFaces
console.log(`Will fetch ${targets.length} face(s) into ${args.out}`)

// ---------- 2. fan out downloads with bounded concurrency ----------

let done = 0
let skipped = 0
let failed = 0
const failures: { id: number; error: string }[] = []

const worker = async (face: MoyoungFace): Promise<void> => {
  const binName = `${face.id}.bin`
  const binPath = join(args.out, binName)
  const metaPath = binPath.replace(/\.bin$/, '.json')
  if (existsSync(binPath)) {
    skipped++
    return
  }
  try {
    if (!face.file || !/^https?:\/\//.test(face.file)) {
      throw new Error(`face has no usable file URL: ${JSON.stringify(face.file)}`)
    }
    await downloadFile(face.file, binPath)
    writeFileSync(metaPath, JSON.stringify(face, null, 2))
    done++
  } catch (err) {
    failed++
    failures.push({
      id: face.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// Simple bounded concurrency runner.
const queue = [...targets]
const runners: Promise<void>[] = []
const tick = () => {
  const remaining = targets.length - done - skipped - failed
  process.stdout.write(`\r  downloaded ${done}  skipped ${skipped}  failed ${failed}  remaining ${remaining}      `)
}
for (let c = 0; c < args.concurrency; c++) {
  runners.push(
    (async () => {
      while (queue.length > 0) {
        const face = queue.shift()!
        await worker(face)
        tick()
      }
    })(),
  )
}
await Promise.all(runners)
process.stdout.write('\n')

if (failures.length > 0) {
  const failPath = join(args.out, '_failures.json')
  writeFileSync(failPath, JSON.stringify(failures, null, 2))
  console.log(`Failures written to ${failPath}`)
}
console.log(`Done. ${done} new, ${skipped} already on disk, ${failed} failed.`)
