import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import type { ApiKeyKind } from '@internal/adapters'
import {
  keyHint,
  parseSeedDocument,
  type SeedDocument,
  serialiseSeedDocument,
  toDocument,
} from './document.ts'
import { buildSeed, DEFAULT_ENVIRONMENTS, DEFAULT_RETENTION_DAYS, mintKey } from './model.ts'
import { keyRecordsFor } from './records.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

export const DEFAULT_SEED_FILE = '.nekolog-seed.json'

const USAGE = `
pnpm seed init     cria organização, projeto, ambientes e keys
pnpm seed add-key  gera mais uma key para um ambiente que já existe
pnpm seed show     mostra o que existe, sem segredo nenhum

  --organization <nome>   padrão: NekoLog
  --project <nome>        padrão: nekolog
  --environments <lista>  padrão: ${DEFAULT_ENVIRONMENTS.join(',')}
  --retention-days <n>    padrão: ${DEFAULT_RETENTION_DAYS}
  --origins <lista>       origens permitidas das keys públicas; padrão: qualquer uma
  --environment <nome>    para o add-key
  --kind <public|secret>  para o add-key; padrão: secret
  --file <caminho>        padrão: ${DEFAULT_SEED_FILE}
  --force                 deixa o init sobrescrever um arquivo que já existe
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
  writeFileSync(file, serialiseSeedDocument(document), 'utf8')
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

  const seed = await buildSeed({
    organization: String(values.organization ?? 'NekoLog'),
    project: String(values.project ?? 'nekolog'),
    ...(environments === undefined ? {} : { environments }),
    ...(origins === undefined ? {} : { originAllowlist: origins }),
    ...(retentionDays === undefined ? {} : { retentionDays: Number(retentionDays) }),
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
  write(`${keyRecordsFor(document).length} registros de key escritos em ${file}`)
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

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      organization: { type: 'string' },
      project: { type: 'string' },
      environments: { type: 'string' },
      'retention-days': { type: 'string' },
      origins: { type: 'string' },
      environment: { type: 'string' },
      kind: { type: 'string' },
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
  if (command === 'show') {
    summarise(readDocument(resolve(ROOT, String(values.file ?? DEFAULT_SEED_FILE))))
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
