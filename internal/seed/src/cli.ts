import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  type ApiKeyKind,
  parseRedactionRules,
  REDACTION_PATTERNS,
  type RedactionRules,
} from '@nekolog-io/adapters'
import {
  keyHint,
  parseSeedDocument,
  type SeedDocument,
  type SeedEnvironmentEntry,
  serialiseSeedDocument,
  toDocument,
} from './document.ts'
import {
  ensureOrganization,
  FIND_ACCOUNT,
  hashInviteToken,
  mailWillReach,
  makeOwner,
  newInviteToken,
  openInvite,
  organizationOf,
  readInviteEmail,
  readRole,
  signupLink,
} from './invite.ts'
import {
  buildSeed,
  DEFAULT_ENVIRONMENTS,
  DEFAULT_RETENTION_DAYS,
  type EnvironmentSettings,
  mintKey,
  NEW_PROJECT_REDACTION,
  settingsFrom,
} from './model.ts'
import { seedStatements } from './postgres.ts'
import { keyRecordsFor } from './records.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

export const DEFAULT_SEED_FILE = '.nekolog-seed.json'

const USAGE = `
pnpm seed init     cria organização, projeto, ambientes e keys
pnpm seed add-key  gera mais uma key para um ambiente que já existe
pnpm seed set      muda nível mínimo, amostragem e redação de um ambiente
pnpm seed show     mostra o que existe, sem segredo nenhum
pnpm seed sync-db  escreve a organização, o projeto, os ambientes e os hashes
                   das keys no Postgres de DATABASE_URL, sem segredo nenhum
pnpm seed invite   abre o convite da primeira conta e imprime o link de cadastro;
                   rodado de novo depois do cadastro, torna a pessoa owner

  --email <endereço>         para o invite
  --role <admin|member|viewer>  para o invite; padrão: admin. Um convite nunca
                             concede owner — o esquema recusa
  --organization <nome>      padrão: NekoLog
  --project <nome>           padrão: nekolog
  --environments <lista>     padrão: ${DEFAULT_ENVIRONMENTS.join(',')}
  --retention-days <n>       padrão: ${DEFAULT_RETENTION_DAYS}
  --origins <lista>          origens permitidas das keys públicas; padrão: qualquer uma
  --min-level <nível>        descarta o que for mais baixo; padrão: trace
  --sample-rate <0..1>       fração guardada; error e fatal nunca são sorteados
  --redact <lista|all|none>  padrões a apagar no servidor; padrão de projeto novo:
                             ${NEW_PROJECT_REDACTION.patterns.join(', ')}
                             todos: ${REDACTION_PATTERNS.join(', ')}
  --redact-attributes <l>    atributos a apagar pelo nome, ou por prefixo com *
  --replacement <texto>      o que entra no lugar; padrão: [redacted]
  --environment <nome>       para o add-key e o set; sem ele, o set vale para todos
  --kind <public|secret>     para o add-key; padrão: secret
  --file <caminho>           padrão: ${DEFAULT_SEED_FILE}
  --force                    deixa o init sobrescrever um arquivo que já existe
`.trimStart()

function write(line = ''): void {
  process.stdout.write(`${line}\n`)
}

function list(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

function readDocument(file: string): SeedDocument {
  if (!existsSync(file)) {
    throw new Error(`Não achei ${file}. Rode "pnpm seed init" antes.`)
  }
  return parseSeedDocument(readFileSync(file, 'utf8'))
}

function save(file: string, document: SeedDocument): void {
  const scratch = `${file}.writing-${Math.random().toString(36).slice(2)}`
  writeFileSync(scratch, serialiseSeedDocument(document), 'utf8')
  renameSync(scratch, file)
}

type Values = Record<string, string | boolean | undefined>

function patternsFrom(value: string): string[] {
  const named = list(value) ?? []
  if (named.length === 1 && named[0] === 'none') {
    return []
  }
  if (named.length === 1 && named[0] === 'all') {
    return [...REDACTION_PATTERNS]
  }
  return named
}

function redactionFrom(values: Values, current: RedactionRules): RedactionRules | undefined {
  const patterns = values.redact
  const attributes = values['redact-attributes']
  const replacement = values.replacement
  if (patterns === undefined && attributes === undefined && replacement === undefined) {
    return undefined
  }
  return parseRedactionRules({
    patterns: patterns === undefined ? [...current.patterns] : patternsFrom(String(patterns)),
    attributes:
      attributes === undefined ? [...current.attributes] : (list(String(attributes)) ?? []),
    replacement: replacement === undefined ? current.replacement : String(replacement),
  })
}

function settingsFromFlags(values: Values, fallback: EnvironmentSettings): EnvironmentSettings {
  const minLevel = values['min-level']
  const sampleRate = values['sample-rate']
  const redaction = redactionFrom(values, fallback.redaction)
  return settingsFrom({
    ...(minLevel === undefined ? {} : { minLevel: String(minLevel) }),
    ...(sampleRate === undefined ? {} : { sampleRate: Number(sampleRate) }),
    ...(redaction === undefined ? {} : { redaction }),
    fallback,
  })
}

function describeRedaction(rules: RedactionRules): string {
  const patterns = rules.patterns.length === 0 ? 'nenhum padrão' : rules.patterns.join(', ')
  const attributes =
    rules.attributes.length === 0 ? '' : `, atributos ${rules.attributes.join(', ')}`
  return `${patterns}${attributes} → ${rules.replacement}`
}

function announceSecret(environment: string, kind: ApiKeyKind, value: string): void {
  write(`  ${environment.padEnd(14)} ${kind.padEnd(7)} ${value}`)
}

function summarise(document: SeedDocument): void {
  write(`organização: ${document.organization.name}  ${document.organization.id}`)
  write(`projeto:     ${document.project.name}  ${document.project.id}`)
  write('')
  for (const environment of document.environments) {
    const origins =
      environment.originAllowlist === null
        ? 'qualquer origem'
        : environment.originAllowlist.join(', ') || 'nenhuma origem'
    write(`${environment.name}  ${environment.id}`)
    write(`  retenção ${environment.retentionDays} dias, ${origins}`)
    write(
      `  nível mínimo ${environment.minLevel}, amostragem ${environment.sampleRate}, ` +
        `redação ${describeRedaction(environment.redaction)}`,
    )
    for (const key of environment.keys) {
      write(`  ${key.kind.padEnd(7)} ${key.hint}  ${key.id}`)
    }
    write('')
  }
}

function warnAboutOrigins(document: SeedDocument): void {
  if (document.environments.some((environment) => environment.originAllowlist === null)) {
    write(
      'Atenção: as keys públicas aceitam qualquer origem. Defina --origins antes de usar em produção.',
    )
  }
}

function warnAboutRedaction(document: SeedDocument): void {
  const bare = document.environments.filter(
    (environment) =>
      environment.redaction.patterns.length === 0 && environment.redaction.attributes.length === 0,
  )
  if (bare.length > 0) {
    write(
      'Atenção: sem redação no servidor em ' +
        `${bare.map((environment) => environment.name).join(', ')} — ` +
        'o log é gravado como chega. ' +
        'Ligue com "pnpm seed set --redact all" se algum log puder carregar dado pessoal.',
    )
  }
}

async function init(values: Record<string, string | boolean | undefined>): Promise<void> {
  const file = resolve(ROOT, String(values.file ?? DEFAULT_SEED_FILE))
  if (existsSync(file) && values.force !== true) {
    throw new Error(
      `${file} já existe. Sobrescrever perderia os hashes que o KV e o ClickHouse já usam; ` +
        'rode "pnpm seed add-key" para mais uma key, ou --force se é mesmo o que você quer.',
    )
  }

  const environments = list(values.environments as string | undefined)
  const origins = list(values.origins as string | undefined)
  const retentionDays = values['retention-days']
  const settings = settingsFromFlags(values, {
    minLevel: 'trace',
    sampleRate: 1,
    redaction: NEW_PROJECT_REDACTION,
  })

  const seed = await buildSeed({
    organization: String(values.organization ?? 'NekoLog'),
    project: String(values.project ?? 'nekolog'),
    ...(environments === undefined ? {} : { environments }),
    ...(origins === undefined ? {} : { originAllowlist: origins }),
    ...(retentionDays === undefined ? {} : { retentionDays: Number(retentionDays) }),
    minLevel: settings.minLevel,
    sampleRate: settings.sampleRate,
    redaction: settings.redaction,
  })

  const document = toDocument(seed)
  save(file, document)

  summarise(document)
  write('Estas keys aparecem uma única vez. Copie agora.')
  write('')
  for (const environment of seed.environments) {
    for (const key of environment.keys) {
      announceSecret(environment.name, key.kind, key.value)
    }
  }
  write('')
  warnAboutOrigins(document)
  warnAboutRedaction(document)
  write(`${keyRecordsFor(document).length} registros de key escritos em ${file}`)
}

function environmentsToChange(document: SeedDocument, name: unknown): SeedEnvironmentEntry[] {
  if (name === undefined) {
    return document.environments
  }
  const found = document.environments.find((entry) => entry.name === name)
  if (found === undefined) {
    const known = document.environments.map((entry) => entry.name).join(', ')
    throw new Error(`Não existe o ambiente "${String(name)}". Existem: ${known}`)
  }
  return [found]
}

async function set(values: Values): Promise<void> {
  const file = resolve(ROOT, String(values.file ?? DEFAULT_SEED_FILE))
  const document = readDocument(file)
  const chosen = environmentsToChange(document, values.environment)

  if (
    values['min-level'] === undefined &&
    values['sample-rate'] === undefined &&
    values.redact === undefined &&
    values['redact-attributes'] === undefined &&
    values.replacement === undefined
  ) {
    throw new Error(
      'Diga o que mudar: --min-level, --sample-rate, --redact, --redact-attributes ou --replacement.',
    )
  }

  for (const environment of chosen) {
    const settings = settingsFromFlags(values, {
      minLevel: environment.minLevel,
      sampleRate: environment.sampleRate,
      redaction: environment.redaction,
    })
    environment.minLevel = settings.minLevel
    environment.sampleRate = settings.sampleRate
    environment.redaction = settings.redaction
  }
  save(file, document)

  for (const environment of chosen) {
    write(
      `${environment.name}: nível mínimo ${environment.minLevel}, ` +
        `amostragem ${environment.sampleRate}, redação ${describeRedaction(environment.redaction)}`,
    )
  }
  write('')
  write('A ingestão relê o arquivo sozinha. Rode "pnpm seed sync-db" para o Postgres saber também.')
}

async function addKey(values: Record<string, string | boolean | undefined>): Promise<void> {
  const file = resolve(ROOT, String(values.file ?? DEFAULT_SEED_FILE))
  const document = readDocument(file)

  const name = values.environment
  if (typeof name !== 'string' || name === '') {
    throw new Error('Diga para qual ambiente: --environment production')
  }
  const environment = document.environments.find((entry) => entry.name === name)
  if (environment === undefined) {
    const known = document.environments.map((entry) => entry.name).join(', ')
    throw new Error(`Não existe o ambiente "${name}". Existem: ${known}`)
  }

  const kind = values.kind === 'public' ? 'public' : 'secret'
  const minted = await mintKey(kind, Date.now())

  environment.keys.push({
    id: minted.id,
    kind: minted.kind,
    hash: minted.hash,
    hint: keyHint(minted.value),
    scopes: [...minted.scopes],
    createdAt: minted.createdAt,
  })
  save(file, document)

  write(`Key nova em ${environment.name}. Ela aparece uma única vez:`)
  write('')
  announceSecret(environment.name, minted.kind, minted.value)
  write('')
  write('A key antiga continua valendo — revogue quando tiver trocado tudo que a usa.')
}

async function syncDb(values: Record<string, string | boolean | undefined>): Promise<void> {
  const document = readDocument(resolve(ROOT, String(values.file ?? DEFAULT_SEED_FILE)))
  const url = process.env.DATABASE_URL
  if (url === undefined || url === '') {
    throw new Error('Preciso de DATABASE_URL para escrever no Postgres.')
  }

  const { default: postgres } = await import('postgres')
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  try {
    for (const statement of seedStatements(document)) {
      await sql.unsafe(statement.text, statement.params as never[])
    }
  } finally {
    await sql.end({ timeout: 5 })
  }

  const keys = document.environments.reduce((total, entry) => total + entry.keys.length, 0)
  write(
    `${document.environments.length} ambientes e ${keys} hashes de key escritos no Postgres. ` +
      'Nenhuma key em claro saiu daqui.',
  )
  warnAboutRedaction(document)
}

async function invite(values: Record<string, string | boolean | undefined>): Promise<void> {
  const url = process.env.DATABASE_URL
  if (url === undefined || url === '') {
    throw new Error('Preciso de DATABASE_URL para abrir um convite.')
  }
  const appUrl = process.env.APP_URL
  if (appUrl === undefined || appUrl === '') {
    throw new Error('Preciso de APP_URL para montar o link de cadastro.')
  }

  const email = readInviteEmail(typeof values.email === 'string' ? values.email : undefined)
  const role = readRole(typeof values.role === 'string' ? values.role : undefined)
  const file = resolve(ROOT, String(values.file ?? DEFAULT_SEED_FILE))
  const document = existsSync(file) ? parseSeedDocument(readFileSync(file, 'utf8')) : undefined
  const organization = organizationOf(document, 'NekoLog')

  const { default: postgres } = await import('postgres')
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  try {
    const ensure = ensureOrganization(organization)
    await sql.unsafe(ensure.text, ensure.params as never[])

    const found = (await sql.unsafe(FIND_ACCOUNT, [email] as never[])) as unknown as Array<{
      id: string
    }>
    const account = found[0]

    if (account !== undefined) {
      const promote = makeOwner(organization.id, account.id)
      await sql.unsafe(promote.text, promote.params as never[])
      write(`${email} já tem conta e agora é owner de "${organization.name}".`)
      write(`Entre em ${new URL('/login', appUrl).toString()}`)
      return
    }

    const token = newInviteToken()
    const opened = openInvite({
      organizationId: organization.id,
      email,
      role,
      tokenHash: hashInviteToken(token),
    })
    const rows = await sql.unsafe(opened.text, opened.params as never[])
    if (rows.length === 0) {
      write(`${email} já é membro de "${organization.name}". Nada a fazer.`)
      return
    }

    write(`Convite aberto para ${email} como ${role} em "${organization.name}".`)
    write('')
    write(signupLink(appUrl, token))
    write('')
    if (!mailWillReach(email, process.env)) {
      write(
        `Atenção: ${email} não está em EMAIL_ALLOWLIST, então o código de confirmação ` +
          'não vai ser enviado e ninguém consegue terminar o cadastro. Acrescente o ' +
          `domínio em .env:  EMAIL_ALLOWLIST=...,${email.slice(email.indexOf('@'))}`,
      )
      write('')
    }
    write('O link vale por 7 dias e só pode ser gasto uma vez.')
    write('Depois de se cadastrar, rode este comando de novo para virar owner:')
    write(`  pnpm seed invite --email ${email}`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      organization: { type: 'string' },
      project: { type: 'string' },
      environments: { type: 'string' },
      'retention-days': { type: 'string' },
      origins: { type: 'string' },
      'min-level': { type: 'string' },
      'sample-rate': { type: 'string' },
      redact: { type: 'string' },
      'redact-attributes': { type: 'string' },
      replacement: { type: 'string' },
      environment: { type: 'string' },
      kind: { type: 'string' },
      email: { type: 'string' },
      role: { type: 'string' },
      file: { type: 'string' },
      force: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  })

  const command = positionals[0] ?? 'init'
  if (values.help === true || command === 'help') {
    write(USAGE)
    return
  }

  if (command === 'init') {
    await init(values)
    return
  }
  if (command === 'add-key') {
    await addKey(values)
    return
  }
  if (command === 'set') {
    await set(values)
    return
  }
  if (command === 'show') {
    const document = readDocument(resolve(ROOT, String(values.file ?? DEFAULT_SEED_FILE)))
    summarise(document)
    warnAboutRedaction(document)
    return
  }
  if (command === 'sync-db') {
    await syncDb(values)
    return
  }
  if (command === 'invite') {
    await invite(values)
    return
  }

  write(USAGE)
  throw new Error(`Não conheço o comando "${command}"`)
}

try {
  await main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
