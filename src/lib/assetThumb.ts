import type { AssetSet } from '../types/face'

/** Render an AssetSet's first non-empty slot as a PNG data URL for use
 *  as a thumbnail in lists. Returns '' when the set has no decodable
 *  preview (empty library, zero-dim, mismatched rgba) — call sites
 *  should fall back to the existing "empty" placeholder in that case.
 *
 *  Browser-only: uses `<canvas>`. Cheap enough to call inline during
 *  render — a 240×240 background runs in ~1 ms — but keep an eye on
 *  large lists; memoise via `useMemo` if you start scrolling hundreds. */
export const assetSetThumbDataUrl = (set: AssetSet): string => {
  const slot = set.slots.find((s) => s.rgba) ?? set.slots[0]
  if (!slot?.rgba || set.width === 0 || set.height === 0) return ''
  if (slot.rgba.length !== set.width * set.height * 4) return ''
  const c = document.createElement('canvas')
  c.width = set.width
  c.height = set.height
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(set.width, set.height)
  img.data.set(slot.rgba)
  ctx.putImageData(img, 0, 0)
  return c.toDataURL('image/png')
}
