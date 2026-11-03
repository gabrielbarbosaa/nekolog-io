import type { Logger } from '@nekolog-io/core'
import { type DocumentLike, type EventTargetLike, globalDocument, globalWindow } from './globals.ts'
import { markHiding, markVisible } from './hidden.ts'

export type FlushOnHideOptions = {
  target?: EventTargetLike
  document?: DocumentLike | false
}

export function installFlushOnHide(logger: Logger, options: FlushOnHideOptions = {}): () => void {
  const target = options.target ?? globalWindow()
  if (target === undefined) {
    return () => undefined
  }

  const page = options.document === false ? undefined : (options.document ?? globalDocument())

  const hide = (): void => {
    markHiding()
    void logger.flush()
  }

  const onPageHide = (): void => hide()
  const onPageShow = (): void => markVisible()
  const onVisibilityChange = (): void => {
    if (page?.visibilityState === 'hidden') {
      hide()
      return
    }
    markVisible()
  }

  target.addEventListener('pagehide', onPageHide)
  target.addEventListener('pageshow', onPageShow)
  page?.addEventListener('visibilitychange', onVisibilityChange)

  return () => {
    target.removeEventListener('pagehide', onPageHide)
    target.removeEventListener('pageshow', onPageShow)
    page?.removeEventListener('visibilitychange', onVisibilityChange)
  }
}
