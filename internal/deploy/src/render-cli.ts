import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { readJsonObject } from './config.ts'
import { placeholdersIn, renderForEnvironment } from './render.ts'

const USAGE = `
render --config <arquivo> --environment <dev|qa|prod> --out <arquivo>

Lê a configuração do wrangler, mantém só o ambiente pedido, preenche os
\${PLACEHOLDERS} com o que estiver no ambiente do processo e escreve o
resultado. Falha dizendo o que falta, em vez de publicar um Worker sem binding.
`.trimStart()

function required(value: string | boolean | undefined, name: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`Faltou ${name}.\n\n${USAGE}`)
  }
  return value
}

function main(): void {
  const { values } = parseArgs({
    options: {
      config: { type: 'string' },
      environment: { type: 'string' },
      out: { type: 'string' },
      help: { type: 'boolean' },
    },
  })

  if (values.help === true) {
    process.stdout.write(USAGE)
    return
  }

  const configPath = resolve(required(values.config, '--config'))
  const environment = required(values.environment, '--environment')
  const outPath = resolve(required(values.out, '--out'))

  const config = readJsonObject(configPath)
  const rendered = renderForEnvironment(config, {
    environment,
    lookup: (name) => process.env[name],
  })

  writeFileSync(outPath, `${JSON.stringify(rendered, null, 2)}\n`, 'utf8')

  const filled = placeholdersIn(config).join(', ')
  process.stdout.write(`${environment}: ${outPath}\n`)
  process.stdout.write(`valores preenchidos: ${filled === '' ? 'nenhum' : filled}\n`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
