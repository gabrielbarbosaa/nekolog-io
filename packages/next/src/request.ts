export const PATH_ATTRIBUTE = 'http.path'
export const METHOD_ATTRIBUTE = 'http.method'
export const ROUTER_ATTRIBUTE = 'next.router'
export const ROUTE_ATTRIBUTE = 'next.route'
export const RENDER_SOURCE_ATTRIBUTE = 'next.render_source'
export const REVALIDATE_REASON_ATTRIBUTE = 'next.revalidate_reason'

export const MAX_PATH_CHARS = 512

export type ErrorRequest = {
  path?: unknown
  method?: unknown
  headers?: unknown
}

export type ErrorContext = {
  routerKind?: unknown
  routePath?: unknown
  routeType?: unknown
  renderSource?: unknown
  revalidateReason?: unknown
}

function text(value: unknown, limit = MAX_PATH_CHARS): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed.slice(0, limit)
}

export function pathWithoutQuery(value: unknown): string | undefined {
  const raw = text(value)
  if (raw === undefined) {
    return undefined
  }
  const cut = raw.search(/[?#]/)
  return cut === -1 ? raw : raw.slice(0, cut)
}

export function attributesFor(
  request: ErrorRequest | undefined,
  context: ErrorContext | undefined,
): Record<string, string> {
  const attributes: Record<string, string> = {}

  const path = pathWithoutQuery(request?.path)
  if (path !== undefined) {
    attributes[PATH_ATTRIBUTE] = path
  }

  const method = text(request?.method, 16)
  if (method !== undefined) {
    attributes[METHOD_ATTRIBUTE] = method.toUpperCase()
  }

  const pairs: Array<[string, unknown]> = [
    [ROUTER_ATTRIBUTE, context?.routerKind],
    [ROUTE_ATTRIBUTE, context?.routePath],
    [RENDER_SOURCE_ATTRIBUTE, context?.renderSource],
    [REVALIDATE_REASON_ATTRIBUTE, context?.revalidateReason],
  ]

  for (const [key, value] of pairs) {
    const found = text(value)
    if (found !== undefined) {
      attributes[key] = found
    }
  }

  return attributes
}
