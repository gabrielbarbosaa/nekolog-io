import { createHash } from 'node:crypto'

export type InlineAsset = {
  kind: 'script' | 'style'
  attributes: string
  content: string
  nonce: string | null
}

const KINDS = ['script', 'style'] as const

function attributeValue(attributes: string, name: string): string | null {
  const at = attributes.indexOf(`${name}=`)
  if (at === -1) {
    return null
  }
  const rest = attributes.slice(at + name.length + 1)
  const quote = rest[0]
  if (quote !== '"' && quote !== "'") {
    const end = rest.search(/[\s>]/)
    return end === -1 ? rest : rest.slice(0, end)
  }
  const end = rest.indexOf(quote, 1)
  return end === -1 ? null : rest.slice(1, end)
}

function hasAttribute(attributes: string, name: string): boolean {
  return attributeValue(attributes, name) !== null
}

function assetsOfKind(html: string, kind: (typeof KINDS)[number]): InlineAsset[] {
  const found: InlineAsset[] = []
  const open = `<${kind}`
  const close = `</${kind}`
  let from = 0

  while (from < html.length) {
    const start = html.indexOf(open, from)
    if (start === -1) {
      return found
    }
    const after = html[start + open.length]
    if (after !== undefined && after !== '>' && after !== ' ' && after !== '\n' && after !== '\t') {
      from = start + open.length
      continue
    }
    const openEnd = html.indexOf('>', start)
    if (openEnd === -1) {
      return found
    }
    const closeStart = html.indexOf(close, openEnd)
    if (closeStart === -1) {
      return found
    }
    const attributes = html.slice(start + open.length, openEnd)
    const content = html.slice(openEnd + 1, closeStart)
    if (content.trim().length > 0 && !hasAttribute(attributes, 'src')) {
      found.push({ kind, attributes, content, nonce: attributeValue(attributes, 'nonce') })
    }
    from = closeStart + close.length
  }

  return found
}

export function inlineAssets(html: string): InlineAsset[] {
  return KINDS.flatMap((kind) => assetsOfKind(html, kind))
}

export type ScriptTag = {
  src: string | null
  nonce: string | null
}

export function scriptTags(html: string): ScriptTag[] {
  const found: ScriptTag[] = []
  let from = 0

  while (from < html.length) {
    const start = html.indexOf('<script', from)
    if (start === -1) {
      return found
    }
    const openEnd = html.indexOf('>', start)
    if (openEnd === -1) {
      return found
    }
    const attributes = html.slice(start + 7, openEnd)
    found.push({
      src: attributeValue(attributes, 'src'),
      nonce: attributeValue(attributes, 'nonce'),
    })
    from = openEnd + 1
  }

  return found
}

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('base64')
}
