import { readFileSync, writeFileSync } from 'node:fs'
import { CONFIG, configFor, DIST, inlineInDist, serialise } from './headers.ts'

const write = process.argv.includes('--write')
const wanted = serialise(configFor(await inlineInDist(DIST)))
const current = readFileSync(CONFIG, 'utf8')

if (wanted === current) {
  process.stdout.write('vercel.json already covers every inline script in dist/\n')
} else if (write) {
  writeFileSync(CONFIG, wanted)
  process.stdout.write(`${CONFIG} rewritten\n`)
} else {
  process.stderr.write(
    `${CONFIG} no longer matches what the build produces.\n` +
      'An inline script that no hash covers is a blank page in the browser, not a warning.\n' +
      'Run `pnpm --filter @apps/docs headers:write` and commit the result.\n',
  )
  process.exitCode = 1
}
