export const ROW_HEIGHT = 30

export const OVERSCAN = 12

export type Window = {
  first: number
  last: number
  above: number
  below: number
}

export type WindowOptions = {
  scrollTop: number
  viewport: number
  count: number
  rowHeight?: number
  overscan?: number
}

export function windowFor({
  scrollTop,
  viewport,
  count,
  rowHeight = ROW_HEIGHT,
  overscan = OVERSCAN,
}: WindowOptions): Window {
  if (count <= 0 || rowHeight <= 0) {
    return { first: 0, last: -1, above: 0, below: 0 }
  }

  const top = Math.max(0, scrollTop)
  const height = Math.max(0, viewport)

  const firstSeen = Math.floor(top / rowHeight)
  const lastSeen = Math.ceil((top + height) / rowHeight) - 1

  const first = Math.max(0, Math.min(count - 1, firstSeen - overscan))
  const last = Math.max(first, Math.min(count - 1, lastSeen + overscan))

  return {
    first,
    last,
    above: first * rowHeight,
    below: (count - 1 - last) * rowHeight,
  }
}

export function reachedTheEnd(
  scrollTop: number,
  viewport: number,
  total: number,
  within = ROW_HEIGHT * 8,
): boolean {
  return scrollTop + viewport >= total - within
}
