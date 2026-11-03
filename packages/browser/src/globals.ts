export type EventTargetLike = {
  addEventListener(type: string, listener: (event: Event) => void): void
  removeEventListener(type: string, listener: (event: Event) => void): void
}

export type DocumentLike = EventTargetLike & {
  readonly visibilityState?: string
}

export function globalWindow(): EventTargetLike | undefined {
  return (globalThis as { window?: EventTargetLike }).window
}

export function globalDocument(): DocumentLike | undefined {
  return (globalThis as { document?: DocumentLike }).document
}

export function globalHref(): string | undefined {
  return (globalThis as { location?: { href?: string } }).location?.href
}
