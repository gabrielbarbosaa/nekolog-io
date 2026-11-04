import type { Flavour } from './detect.ts'

export const PLACEHOLDER_SECRET = 'nekolog_sk_replace_me'
export const PLACEHOLDER_PUBLIC = 'nekolog_pk_replace_me'

export type EnvEntry = { name: string; value: string; note: string }

const SERVER: readonly EnvEntry[] = [
  { name: 'NEKOLOG_KEY', value: PLACEHOLDER_SECRET, note: 'the secret key of this environment' },
  { name: 'NEKOLOG_SERVICE', value: 'my-service', note: 'what this service is called' },
]

const BROWSER: readonly EnvEntry[] = [
  {
    name: 'VITE_NEKOLOG_KEY',
    value: PLACEHOLDER_PUBLIC,
    note: 'the public key — it ships in the bundle',
  },
]

const NEXT: readonly EnvEntry[] = [
  { name: 'NEKOLOG_KEY', value: PLACEHOLDER_SECRET, note: 'the secret key, server side only' },
  {
    name: 'NEXT_PUBLIC_NEKOLOG_KEY',
    value: PLACEHOLDER_PUBLIC,
    note: 'the public key — it ships in the bundle',
  },
  { name: 'NEKOLOG_SERVICE', value: 'my-service', note: 'what this service is called' },
]

export function entriesFor(flavour: Flavour, key?: string): EnvEntry[] {
  const chosen =
    flavour === 'next' ? NEXT : flavour === 'react' || flavour === 'browser' ? BROWSER : SERVER

  if (key === undefined || key === '') {
    return chosen.map((entry) => ({ ...entry }))
  }

  const secret = key.startsWith('nekolog_sk_')
  return chosen.map((entry) => {
    const wantsPublic = entry.value === PLACEHOLDER_PUBLIC
    const wantsSecret = entry.value === PLACEHOLDER_SECRET
    if ((wantsPublic && secret) || (wantsSecret && !secret)) {
      return { ...entry }
    }
    return wantsPublic || wantsSecret ? { ...entry, value: key } : { ...entry }
  })
}

export function namesIn(contents: string): Set<string> {
  const names = new Set<string>()
  for (const line of contents.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue
    }
    const divider = trimmed.indexOf('=')
    if (divider > 0) {
      names.add(
        trimmed
          .slice(0, divider)
          .replace(/^export\s+/, '')
          .trim(),
      )
    }
  }
  return names
}

export type EnvPlan = {
  added: EnvEntry[]
  kept: string[]
  contents: string
}

export function planEnv(current: string, entries: readonly EnvEntry[]): EnvPlan {
  const present = namesIn(current)
  const added = entries.filter((entry) => !present.has(entry.name))
  const kept = entries.filter((entry) => present.has(entry.name)).map((entry) => entry.name)

  if (added.length === 0) {
    return { added, kept, contents: current }
  }

  const written = added.map((entry) => `# ${entry.note}\n${entry.name}=${entry.value}`).join('\n')
  const head = current === '' ? '' : current.endsWith('\n') ? `${current}\n` : `${current}\n\n`

  return { added, kept, contents: `${head}# nekolog\n${written}\n` }
}
