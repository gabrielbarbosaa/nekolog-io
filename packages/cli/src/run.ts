import { spawn } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, InitRefused, init, type Runner, type Workspace } from './init.ts'

export const USAGE = `nekolog init — detect the framework, install the sdk and write the .env

  --key <key>     the key to write, nekolog_pk_… or nekolog_sk_…
  --no-install    write the .env and print the install command instead of running it
  --cwd <path>    where the project is (default: here)
  --env <file>    which file to write (default: .env)
`

export type Parsed = {
  command: string
  key?: string
  install: boolean
  cwd: string
  env?: string
}

export function parseArgs(argv: readonly string[]): Parsed {
  const parsed: Parsed = { command: argv[0] ?? '', install: true, cwd: '.' }

  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--no-install') {
      parsed.install = false
      continue
    }
    const value = argv[index + 1]
    if (flag === '--key' && value !== undefined) {
      parsed.key = value
      index += 1
      continue
    }
    if (flag === '--cwd' && value !== undefined) {
      parsed.cwd = value
      index += 1
      continue
    }
    if (flag === '--env' && value !== undefined) {
      parsed.env = value
      index += 1
    }
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

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv)

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
