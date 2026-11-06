#!/usr/bin/env node
import { countOf, parseListing, refusalsIn } from './licences.ts'

const chunks: Buffer[] = []

for await (const chunk of process.stdin) {
  chunks.push(chunk as Buffer)
}

const text = Buffer.concat(chunks).toString('utf8')

if (text.trim().length === 0) {
  console.error('nothing arrived on stdin: pipe `pnpm -r licenses list --json` into this')
  process.exitCode = 1
} else {
  const listing = parseListing(text)
  const refusals = refusalsIn(listing)

  console.log(`${countOf(listing)} packages, ${Object.keys(listing).length} distinct licences`)

  for (const licence of Object.keys(listing).sort()) {
    console.log(`  ${String(listing[licence]?.length).padStart(4)}  ${licence}`)
  }

  if (refusals.length === 0) {
    process.exitCode = 0
  } else {
    console.error('')
    console.error('A licence this product may not ship inside it:')

    for (const refusal of refusals) {
      console.error(`  ${refusal.name}@${refusal.versions.join(',')} — ${refusal.licence}`)
    }

    process.exitCode = 1
  }
}
