import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stampAll } from './stamp.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

try {
  const stamped = stampAll(ROOT)
  for (const version of stamped) {
    process.stdout.write(
      `${version.package}  ${version.declared} → ${version.expected}  ${relative(ROOT, version.file)}\n`,
    )
  }
  process.stdout.write(
    stamped.length === 0
      ? 'every SDK already reports the version of its own package\n'
      : `${stamped.length} SDK versions stamped\n`,
  )
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
