import {
  chooseFlavour,
  choosePackageManager,
  installCommand,
  type Manifest,
  type PackageManager,
} from './detect.ts'
import { type EnvPlan, entriesFor, planEnv } from './env.ts'

export const ENV_FILE = '.env'
export const MANIFEST_FILE = 'package.json'

export class InitRefused extends Error {}

export type Workspace = {
  read(file: string): Promise<string | null>
  write(file: string, contents: string): Promise<void>
  list(): Promise<string[]>
}

export type Runner = (file: string, args: readonly string[]) => Promise<number>

export type InitOptions = {
  workspace: Workspace
  run?: Runner
  key?: string
  install?: boolean
  envFile?: string
}

export type InitReport = {
  flavour: string
  because: string
  packages: readonly string[]
  manager: PackageManager
  install: { file: string; args: string[] } | null
  env: EnvPlan
  envFile: string
}

async function manifestIn(workspace: Workspace): Promise<Manifest> {
  const raw = await workspace.read(MANIFEST_FILE)
  if (raw === null) {
    throw new InitRefused(
      `There is no ${MANIFEST_FILE} here, so this is not the root of a project. Run nekolog init where your ${MANIFEST_FILE} is.`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new InitRefused(`${MANIFEST_FILE} is not valid JSON, so nothing was changed.`)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new InitRefused(`${MANIFEST_FILE} is not an object, so nothing was changed.`)
  }

  return parsed as Manifest
}

export function assertKey(key: string | undefined): string | undefined {
  if (key === undefined) {
    return undefined
  }
  const trimmed = key.trim()
  if (trimmed === '') {
    return undefined
  }
  if (!/^nekolog_(pk|sk)_[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new InitRefused(
      'A key looks like nekolog_pk_… or nekolog_sk_…. Nothing was written, so no half key is left behind.',
    )
  }
  return trimmed
}

export async function init(options: InitOptions): Promise<InitReport> {
  const { workspace } = options
  const key = assertKey(options.key)
  const manifest = await manifestIn(workspace)
  const choice = chooseFlavour(manifest)
  const manager = choosePackageManager(await workspace.list())
  const envFile = options.envFile ?? ENV_FILE

  const current = (await workspace.read(envFile)) ?? ''
  const env = planEnv(current, entriesFor(choice.flavour, key))
  if (env.added.length > 0) {
    await workspace.write(envFile, env.contents)
  }

  let ran: { file: string; args: string[] } | null = null
  if (options.install !== false) {
    const command = installCommand(manager, choice.packages)
    const code = await (options.run ?? neverRuns)(command.file, command.args)
    if (code !== 0) {
      throw new InitRefused(
        `${command.file} ${command.args.join(' ')} exited with ${code}. The ${envFile} was written; install the packages yourself and you are done.`,
      )
    }
    ran = command
  }

  return {
    flavour: choice.flavour,
    because: choice.because,
    packages: choice.packages,
    manager,
    install: ran,
    env,
    envFile,
  }
}

function neverRuns(): Promise<number> {
  return Promise.reject(new InitRefused('This build has no way to run a package manager'))
}

export function describe(report: InitReport): string[] {
  const lines = [
    `Found a ${report.flavour} project, because ${report.because}.`,
    `Package manager: ${report.manager}.`,
  ]

  lines.push(
    report.install === null
      ? `Install it yourself: ${installCommand(report.manager, report.packages).file} ${installCommand(report.manager, report.packages).args.join(' ')}`
      : `Installed ${report.packages.join(' and ')}.`,
  )

  if (report.env.added.length > 0) {
    lines.push(
      `Wrote ${report.env.added.map((entry) => entry.name).join(', ')} to ${report.envFile}.`,
    )
  }
  if (report.env.kept.length > 0) {
    lines.push(`Left ${report.env.kept.join(', ')} alone — they were already there.`)
  }

  lines.push('Put your key in that file, then read https://nekolog.io/docs to wire it up.')
  return lines
}
