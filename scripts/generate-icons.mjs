// Rasterise the SVGs in public/ to the PNGs that browsers, iOS, Android, and
// social-card scrapers expect. Run via:  npm run icons

import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(here, '..', 'public')

/** SVG → PNG jobs. `maskable` adds Android adaptive-icon safe-zone padding
 *  on a solid brand-color background so launcher masks don't crop the dial. */
const jobs = [
  { src: 'og-image.svg', dest: 'og-image.png',          width: 1200, height: 630 },
  { src: 'logo.svg',     dest: 'apple-touch-icon.png',  width: 180,  height: 180 },
  { src: 'favicon.svg',  dest: 'favicon-32x32.png',     width: 32,   height: 32  },
  { src: 'favicon.svg',  dest: 'favicon-16x16.png',     width: 16,   height: 16  },
  { src: 'logo.svg',     dest: 'icon-192.png',          width: 192,  height: 192 },
  { src: 'logo.svg',     dest: 'icon-512.png',          width: 512,  height: 512 },
  {
    src: 'logo.svg',
    dest: 'icon-512-maskable.png',
    width: 512,
    height: 512,
    maskable: { paddingRatio: 0.1, background: '#aa3bff' },
  },
]

const fmtBytes = (n) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(2)} MB`

async function rasterise(job) {
  const src = resolve(publicDir, job.src)
  const dest = resolve(publicDir, job.dest)

  if (job.maskable) {
    const inner = Math.round(job.width * (1 - 2 * job.maskable.paddingRatio))
    const innerBuf = await sharp(src, { density: 1024 })
      .resize(inner, inner, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer()

    await sharp({
      create: {
        width: job.width,
        height: job.height,
        channels: 4,
        background: job.maskable.background,
      },
    })
      .composite([{ input: innerBuf, gravity: 'center' }])
      .png({ compressionLevel: 9 })
      .toFile(dest)
  } else {
    await sharp(src, { density: 1024 })
      .resize(job.width, job.height, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9 })
      .toFile(dest)
  }
}

async function main() {
  console.log(`Generating ${jobs.length} PNGs in ${publicDir}\n`)
  for (const job of jobs) {
    const start = Date.now()
    await rasterise(job)
    const { size } = await (await import('node:fs/promises')).stat(
      resolve(publicDir, job.dest),
    )
    const tag = job.maskable ? ' (maskable)' : ''
    console.log(
      `  ✓ ${job.dest.padEnd(28)} ${`${job.width}×${job.height}`.padEnd(10)} ${fmtBytes(size).padStart(8)}  ${Date.now() - start}ms${tag}`,
    )
  }
  console.log('\nDone.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
