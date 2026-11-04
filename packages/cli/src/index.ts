export type { Choice, Flavour, Manifest, PackageManager } from './detect.ts'
export {
  chooseFlavour,
  choosePackageManager,
  dependenciesOf,
  installCommand,
  LOCKFILES,
} from './detect.ts'
export type { EnvEntry, EnvPlan } from './env.ts'
export { entriesFor, namesIn, PLACEHOLDER_PUBLIC, PLACEHOLDER_SECRET, planEnv } from './env.ts'
export type { InitOptions, InitReport, Runner, Workspace } from './init.ts'
export { assertKey, describe, ENV_FILE, InitRefused, init, MANIFEST_FILE } from './init.ts'
export type { Parsed } from './run.ts'
export { main, parseArgs, runnerAt, USAGE, workspaceAt } from './run.ts'
