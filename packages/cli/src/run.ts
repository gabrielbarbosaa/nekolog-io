import { spawn } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, InitRefused, init, type Runner, type Workspace } from './init.ts'
import { createRelease, DEFAULT_API_URL, describeRelease, ReleaseRefused } from './releases.ts'
import { describeUpload, uploadSourceMaps } from './sourcemaps.ts'

export const USAGE: string = `nekolog init — detect the framework, install the sdk and write the .env

  --key <key>     the key to write, nekolog_pk_… or nekolog_sk_…
  --no-install    write the .env and print the install command instead of running it
  --cwd <path>    where the project is (default: here)
  --env <file>    which file to write (default: .env)

nekolog releases create <version> — record that a version went out

  --key <key>     the secret key of the environment (default: $NEKOLOG_KEY)
  --commit <sha>  7 to 40 lowercase hex characters, from \`git rev-parse HEAD\`
  --at <moment>   when it went out, ISO 8601 (default: now)
  --api <url>     where the public api answers (default: ${DEFAULT_API_URL})

nekolog sourcemaps upload <version> — upload every .map of a build

  --key <key>     the secret key of the environment (default: $NEKOLOG_KEY)
  --dir <path>    the build output to walk (default: dist)
  --api <url>     where the public api answers (default: ${DEFAULT_API_URL})
`

export type Parsed = {
  command: string
  subcommand?: string
  positional: string[]
  key?: string
  install: boolean
  cwd: string
  env?: string
  commit?: string
  at?: string
  api?: string
  dir?: string
}

const WITH_VALUE = ['--key', '--cwd', '--env', '--commit', '--at', '--api', '--dir'] as const

export function parseArgs(argv: readonly string[]): Parsed {
  const parsed: Parsed = { command: argv[0] ?? '', install: true, cwd: '.', positional: [] }

  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index] as string
    if (flag === '--no-install') {
      parsed.install = false
      continue
    }
    if (!flag.startsWith('--')) {
      parsed.positional.push(flag)
      continue
    }

    const value = argv[index + 1]
    if (!(WITH_VALUE as readonly string[]).includes(flag) || value === undefined) {
      continue
    }
    index += 1

    if (flag === '--key') {
      parsed.key = value
    } else if (flag === '--cwd') {
      parsed.cwd = value
    } else if (flag === '--env') {
      parsed.env = value
    } else if (flag === '--commit') {
      parsed.commit = value
    } else if (flag === '--at') {
      parsed.at = value
    } else if (flag === '--api') {
      parsed.api = value
    } else if (flag === '--dir') {
      parsed.dir = value
    }
  }

  if (parsed.command === 'releases' || parsed.command === 'sourcemaps') {
    parsed.subcommand = parsed.positional[0]
    parsed.positional = parsed.positional.slice(1)
  }

  return parsed
}

export function workspaceAt(root: string): Workspace {
  return {
    async read(file) {
      try {
        return await readFile(join(root, file), 'utf8')
      } catch {
        return null
      }
    },
    async write(file, contents) {
      await writeFile(join(root, file), contents, 'utf8')
    },
    async list() {
      try {
        return await readdir(root)
      } catch {
        return []
      }
    },
  }
}

export function runnerAt(root: string): Runner {
  return (file, args) =>
    new Promise((settle) => {
      const child = spawn(file, [...args], { cwd: root, stdio: 'inherit', shell: false })
      child.once('error', () => settle(127))
      child.once('exit', (code) => settle(code ?? 1))
    })
}

async function recordRelease(parsed: Parsed): Promise<number> {
  if (parsed.subcommand !== 'create') {
    process.stdout.write(USAGE)
    return 1
  }

  try {
    const recorded = await createRelease({
      key: parsed.key ?? process.env.NEKOLOG_KEY,
      version: parsed.positional[0],
      commit: parsed.commit,
      releasedAt: parsed.at,
      apiUrl: parsed.api ?? process.env.NEKOLOG_API_URL,
    })
    for (const line of describeRelease(recorded)) {
      process.stdout.write(`${line}\n`)
    }
    return 0
  } catch (error) {
    const message = error instanceof ReleaseRefused ? error.message : String(error)
    process.stderr.write(`nekolog releases create: ${message}\n`)
    return 1
  }
}

async function pushSourceMaps(parsed: Parsed): Promise<number> {
  if (parsed.subcommand !== 'upload') {
    process.stdout.write(USAGE)
    return 1
  }

  const version = parsed.positional[0] ?? ''
  try {
    const report = await uploadSourceMaps({
      key: parsed.key ?? process.env.NEKOLOG_KEY,
      version,
      dir: parsed.dir,
      apiUrl: parsed.api ?? process.env.NEKOLOG_API_URL,
    })
    for (const line of describeUpload(report, version)) {
      process.stdout.write(`${line}\n`)
    }
    return 0
  } catch (error) {
    const message = error instanceof ReleaseRefused ? error.message : String(error)
    process.stderr.write(`nekolog sourcemaps upload: ${message}\n`)
    return 1
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv)

  if (parsed.command === 'releases') {
    return recordRelease(parsed)
  }

  if (parsed.command === 'sourcemaps') {
    return pushSourceMaps(parsed)
  }

  if (parsed.command !== 'init') {
    process.stdout.write(USAGE)
    return parsed.command === '' || parsed.command === '--help' ? 0 : 1
  }

  const root = resolve(parsed.cwd)

  try {
    const report = await init({
      workspace: workspaceAt(root),
      run: runnerAt(root),
      key: parsed.key,
      install: parsed.install,
      envFile: parsed.env,
    })
    for (const line of describe(report)) {
      process.stdout.write(`${line}\n`)
    }
    return 0
  } catch (error) {
    const message = error instanceof InitRefused ? error.message : String(error)
    process.stderr.write(`nekolog init: ${message}\n`)
    return 1
  }
}
