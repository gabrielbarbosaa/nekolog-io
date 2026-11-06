export const PLACEHOLDER = /^dev-only-fake/

export type Filler =
  | { kind: 'secret'; bytes: number }
  | { kind: 'private-key' }
  | { kind: 'public-key' }

export type Generated = {
  secret: (bytes: number) => string
  privateKey: string
  publicKey: string
}

export const FILLED: Readonly<Record<string, Filler>> = {
  AUTH_JWT_PRIVATE_KEY: { kind: 'private-key' },
  AUTH_JWT_PUBLIC_KEY: { kind: 'public-key' },
  AUTH_OTP_SECRET: { kind: 'secret', bytes: 32 },
  ENCRYPTION_KEY: { kind: 'secret', bytes: 32 },
  NEKOLOG_SELF_KEY: { kind: 'secret', bytes: 24 },
}

export type EnvLine = { name: string; value: string } | { raw: string }

export function parseEnv(text: string): EnvLine[] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  return body.split(/\r?\n/).map((line) => {
    const found = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    return found === null ? { raw: line } : { name: found[1] as string, value: found[2] as string }
  })
}

export function valuesOf(lines: ReadonlyArray<EnvLine>): Record<string, string> {
  const found: Record<string, string> = {}
  for (const line of lines) {
    if ('name' in line) {
      found[line.name] = line.value
    }
  }
  return found
}

export function escapePem(pem: string): string {
  return pem.trimEnd().replace(/\r?\n/g, '\\n')
}

export function needsFilling(name: string, value: string | undefined): boolean {
  if (FILLED[name] === undefined) {
    return false
  }
  return value === undefined || value.trim() === '' || PLACEHOLDER.test(value.trim())
}

function fill(filler: Filler, generated: Generated): string {
  if (filler.kind === 'private-key') {
    return escapePem(generated.privateKey)
  }
  if (filler.kind === 'public-key') {
    return escapePem(generated.publicKey)
  }
  return generated.secret(filler.bytes)
}

export type Written = {
  text: string
  generated: string[]
  added: string[]
  kept: string[]
}

export function renderDevEnv(example: string, current: string, generated: Generated): Written {
  const existing = valuesOf(parseEnv(current))
  const result: Written = { text: '', generated: [], added: [], kept: [] }

  const lines = parseEnv(example).map((line) => {
    if (!('name' in line)) {
      return line.raw
    }

    const held = existing[line.name]

    if (needsFilling(line.name, held)) {
      result.generated.push(line.name)
      return `${line.name}=${fill(FILLED[line.name] as Filler, generated)}`
    }

    if (held === undefined) {
      result.added.push(line.name)
      return `${line.name}=${line.value}`
    }

    result.kept.push(line.name)
    return `${line.name}=${held}`
  })

  const known = new Set(result.generated.concat(result.added, result.kept))
  const extra = Object.entries(existing).filter(([name]) => !known.has(name))

  if (extra.length > 0) {
    lines.push('', '# --- Kept from the .env that was already here ---')
    for (const [name, value] of extra) {
      lines.push(`${name}=${value}`)
      result.kept.push(name)
    }
  }

  result.text = `${lines.join('\n').replace(/\n+$/, '')}\n`
  return result
}
