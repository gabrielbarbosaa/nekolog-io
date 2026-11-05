import { readFileSync } from 'node:fs'
import { glob } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashSource, securityHeaders } from '@internal/security-headers'
import { inlineAssets, sha256 } from '@internal/security-headers/inline'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export const DIST = join(ROOT, 'dist')
export const CONFIG = join(ROOT, 'vercel.json')

export type Inline = {
  kind: 'script' | 'style'
  digest: string
  sample: string
}

export async function inlineInDist(dist: string): Promise<Inline[]> {
  const found = new Map<string, Inline>()

  for await (const entry of glob('**/*.html', { cwd: dist })) {
    for (const asset of inlineAssets(readFileSync(join(dist, entry), 'utf8'))) {
      const digest = sha256(asset.content)
      found.set(`${asset.kind}:${digest}`, {
        kind: asset.kind,
        digest,
        sample: asset.content.trim().slice(0, 60),
      })
    }
  }

  return [...found.values()].sort((one, other) => one.digest.localeCompare(other.digest))
}

export const UNSAFE_INLINE = "'unsafe-inline'"

export class InlineStyleElement extends Error {
  constructor(sample: string) {
    super(
      'A <style> element appeared in the built site. A hash in style-src makes the browser ' +
        "ignore 'unsafe-inline', and Starlight writes hundreds of style attributes that only " +
        `'unsafe-inline' allows — so the two cannot be combined. Move it into a stylesheet: ${sample}`,
    )
    this.name = 'InlineStyleElement'
  }
}

export function configFor(inline: readonly Inline[]): unknown {
  const headers = headersFor(inline)

  return {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    headers: [
      {
        source: '/(.*)',
        headers: Object.entries(headers).map(([key, value]) => ({ key, value })),
      },
    ],
  }
}

export function headersFor(inline: readonly Inline[]): Record<string, string> {
  const style = inline.find((asset) => asset.kind === 'style')
  if (style !== undefined) {
    throw new InlineStyleElement(style.sample)
  }

  return securityHeaders({
    scriptSources: inline
      .filter((asset) => asset.kind === 'script')
      .map((asset) => hashSource(asset.digest)),
    styleSources: [UNSAFE_INLINE],
  })
}

export function caddyHeaders(headers: Record<string, string>): string {
  const quoted = (value: string): string =>
    `"${value.split('\\').join('\\\\').split('"').join('\\"')}"`

  return `header {\n${Object.entries(headers)
    .map(([name, value]) => `\t${name} ${quoted(value)}`)
    .join('\n')}\n}\n`
}

export function readConfig(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function headerValue(config: unknown, name: string): string | null {
  const rules = (config as { headers?: Array<{ headers?: Array<{ key: string; value: string }> }> })
    .headers
  for (const rule of rules ?? []) {
    for (const header of rule.headers ?? []) {
      if (header.key.toLowerCase() === name.toLowerCase()) {
        return header.value
      }
    }
  }
  return null
}

export function serialise(config: unknown): string {
  return `${JSON.stringify(config, null, 2)}\n`
}
