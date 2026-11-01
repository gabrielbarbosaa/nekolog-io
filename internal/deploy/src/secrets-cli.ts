import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { type JsonObject, parseJsonObject } from './config.ts'
import { readSecretManifest, secretNamesFor, secretValues } from './secrets.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

export const DEFAULT_MANIFEST = join(ROOT, 'deploy', 'workers', 'secrets.json')

const USAGE = `
secrets --app <ingest|jobs> --out <arquivo> [--manifest <arquivo>]

Lê na entrada padrão um objeto JSON com todos os segredos disponíveis, escolhe
os que o app declara em deploy/workers/secrets.json e escreve o arquivo que o
"wrangler secret bulk" espera. Nenhum valor é impresso, nem em erro.
`.trimStart()

function required(value: string | boolean | undefined, name: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`Faltou ${name}.\n\n${USAGE}`)
  }
  return value
}

function readAvailable(source: string): JsonObject {
  try {
    return parseJsonObject(source, 'a entrada padrão')
  } catch {
    throw new Error('A entrada padrão não é um objeto JSON com os segredos.')
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      app: { type: 'string' },
      out: { type: 'string' },
      manifest: { type: 'string' },
      help: { type: 'boolean' },
    },
  })

  if (values.help === true) {
    process.stdout.write(USAGE)
    return
  }

  const app = required(values.app, '--app')
  const outPath = resolve(required(values.out, '--out'))
  const manifestPath =
    typeof values.manifest === 'string' && values.manifest !== ''
      ? resolve(values.manifest)
      : DEFAULT_MANIFEST

  const names = secretNamesFor(readSecretManifest(manifestPath), app)
  const available = readAvailable(await readStdin())
  const chosen = secretValues(names, (name) => {
    const value = available[name]
    return typeof value === 'string' ? value : undefined
  })

  writeFileSync(outPath, `${JSON.stringify(chosen, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  process.stdout.write(`${names.length} segredos de ${app} escritos em ${outPath}\n`)
}

try {
  await main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
