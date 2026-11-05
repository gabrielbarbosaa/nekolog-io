import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SBOM_DIR } from './sbom.ts'
import { verifySboms } from './verify.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

export const USAGE = `pnpm sbom:check [--dir <directory>] [--json]

Checks that one CycloneDX SBOM was written for every published package, at the
version that package is about to be released as. The default directory is ${SBOM_DIR}/.

--json prints what was found, so a release job can attach each document to the
release of the package it describes without guessing at a file name.`

export function directoryFrom(argv: readonly string[]): string {
  const at = argv.indexOf('--dir')
  if (at === -1) {
    return SBOM_DIR
  }
  const value = argv[at + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`--dir needs a directory.\n\n${USAGE}`)
  }
  return value
}

function main(argv: readonly string[]): void {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${USAGE}\n`)
    return
  }
  const directory = resolve(ROOT, directoryFrom(argv))
  const documents = verifySboms(ROOT, directory)
  const sorted = [...documents].sort((a, b) => a.name.localeCompare(b.name))

  if (argv.includes('--json')) {
    const listed = sorted.map(({ name, version, file }) => ({ name, version, file }))
    process.stdout.write(`${JSON.stringify(listed)}\n`)
    return
  }

  for (const document of sorted) {
    const count = document.components.length
    process.stdout.write(
      `${document.name.padEnd(28)} ${document.version.padEnd(10)} ${count} ${count === 1 ? 'dependency' : 'dependencies'}\n`,
    )
  }
  process.stdout.write(`${documents.length} SBOMs in ${directory}\n`)
}

try {
  main(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
