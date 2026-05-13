// Size thresholds for a Type C `.bin`, derived from the 387-face corpus.
//
// Corpus stats (bytes):
//   min     28,296   (27.6 KB)
//   median  97,703   (95.4 KB)
//   p75    144,382   (141  KB)
//   p90    206,811   (202  KB)
//   p95    253,903   (248  KB)
//   p99    378,329   (369  KB)
//   max    520,707   (508  KB)
//
// Rounded to the nearest power-of-2 KiB so the chips read cleanly.

/** Soft warning — face is larger than ~95% of real watch faces. Most watches
 *  still accept it but you're near the upper end of what's been seen. */
export const FACE_SIZE_WARN_BYTES = 256 * 1024

/** Hard warning — face exceeds the largest in the entire corpus (~508 KB).
 *  Flash may fail or the watch may render garbage. */
export const FACE_SIZE_DANGER_BYTES = 512 * 1024

export type FaceSizeLevel = 'ok' | 'warn' | 'danger'

export const classifyFaceSize = (bytes: number): FaceSizeLevel => {
  if (bytes >= FACE_SIZE_DANGER_BYTES) return 'danger'
  if (bytes >= FACE_SIZE_WARN_BYTES) return 'warn'
  return 'ok'
}

export const formatFaceSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** Long-form tooltip text for the size chip. */
export const faceSizeHint = (bytes: number): string => {
  const size = formatFaceSize(bytes)
  switch (classifyFaceSize(bytes)) {
    case 'danger':
      return `${size} — exceeds the largest face in our 387-face corpus (508 KB). The watch may reject this or render garbage.`
    case 'warn':
      return `${size} — larger than 95% of real watch faces (250 KB). Most watches still accept this but you're near the upper end.`
    case 'ok':
    default:
      return `${size} — within typical range (corpus median 95 KB, 95th percentile 250 KB).`
  }
}

/** Short headline used in confirm prompts. */
export const faceSizeWarnSummary = (bytes: number): string => {
  const size = formatFaceSize(bytes)
  switch (classifyFaceSize(bytes)) {
    case 'danger':
      return `This face is ${size} — larger than any of the 387 real watch faces we sampled. The watch may reject the upload or render the face incorrectly.`
    case 'warn':
      return `This face is ${size} — larger than 95% of real watch faces. It should still flash, but you're approaching the upper limit.`
    default:
      return `This face is ${size}.`
  }
}
