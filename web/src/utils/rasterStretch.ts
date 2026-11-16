/**
 * Display range for a single-band raster preview.
 *
 * A plain min–max range draws skewed data (population counts, rainfall…) almost
 * all at the dark end: a few huge values stretch the scale. So the range is the
 * 2nd–98th percentile of the valid pixels, the usual GIS default; values
 * outside it are clamped by the renderers.
 */

/** Whether a pixel holds no data: the raster's NoData value, NaN or ±∞. */
export function isNoData(value: number, noData: number | null): boolean {
  return !Number.isFinite(value) || (noData !== null && value === noData)
}

/**
 * The 2–98% range of the valid pixels, widened by 1 when flat. `null` when
 * there's no valid pixel.
 */
export function stretchRange(
  values: ArrayLike<number>,
  noData: number | null
): { min: number; max: number } | null {
  const valid: number[] = []
  for (let i = 0; i < values.length; i++) {
    if (!isNoData(values[i], noData)) valid.push(values[i])
  }
  if (valid.length === 0) return null
  valid.sort((a, b) => a - b)

  const at = (q: number) => valid[Math.round(q * (valid.length - 1))]
  let min = at(0.02)
  let max = at(0.98)
  if (max === min) {
    // Mostly one value: fall back to the full range, then widen a flat one.
    min = valid[0]
    max = valid[valid.length - 1]
  }
  if (max === min) max = min + 1
  return { min, max }
}
