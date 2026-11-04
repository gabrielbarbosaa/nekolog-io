import {
  assertApiUrl,
  assertReleaseCommit,
  assertReleaseVersion,
  assertSecretKey,
  COMMIT_PATTERN,
  ReleaseRefused,
} from '@nekolog-io/cli'

export const KEY_VARIABLE = 'NEKOLOG_KEY'
export const RELEASE_VARIABLE = 'NEKOLOG_RELEASE'
export const API_VARIABLE = 'NEKOLOG_API_URL'
export const COMMIT_VARIABLES: readonly string[] = [
  'NEKOLOG_COMMIT',
  'GITHUB_SHA',
  'VERCEL_GIT_COMMIT_SHA',
  'CI_COMMIT_SHA',
]

export type NekologPluginOptions = {
  key?: string | undefined
  release?: string | undefined
  commit?: string | undefined
  dir?: string | undefined
  apiUrl?: string | undefined
  deleteAfterUpload?: boolean | undefined
  disable?: boolean | undefined
  silent?: boolean | undefined
}

export type Environment = Record<string, string | undefined>

export type ResolvedUpload = {
  key: string
  release: string
  commit: string | null
  dir: string | undefined
  apiUrl: string | undefined
  deleteAfterUpload: boolean
  silent: boolean
}

export type Resolution = { run: true; upload: ResolvedUpload } | { run: false; reason: string }

export const DISABLED_REASON = 'the plugin is turned off by its own disable option'
export const NO_KEY_REASON: string = `no key, so nothing was uploaded. Set ${KEY_VARIABLE} or pass key to the plugin where you build for production.`

function pick(given: string | undefined, fromEnvironment: string | undefined): string {
  const chosen = given ?? fromEnvironment ?? ''
  return chosen.trim()
}

export function commitFrom(options: NekologPluginOptions, env: Environment): string | null {
  if (options.commit !== undefined) {
    return assertReleaseCommit(options.commit.trim() === '' ? undefined : options.commit)
  }
  for (const variable of COMMIT_VARIABLES) {
    const candidate = (env[variable] ?? '').trim()
    if (COMMIT_PATTERN.test(candidate)) {
      return candidate
    }
  }
  return null
}

export function resolveOptions(options: NekologPluginOptions, env: Environment): Resolution {
  if (options.disable === true) {
    return { run: false, reason: DISABLED_REASON }
  }

  const key = pick(options.key, env[KEY_VARIABLE])
  if (key === '') {
    return { run: false, reason: NO_KEY_REASON }
  }

  assertSecretKey(key)

  const release = pick(options.release, env[RELEASE_VARIABLE])
  if (release === '') {
    throw new ReleaseRefused(
      `I have a key but no release to attach the source maps to. Pass release to the plugin or set ${RELEASE_VARIABLE}.`,
    )
  }
  assertReleaseVersion(release)

  const apiUrl = pick(options.apiUrl, env[API_VARIABLE])
  assertApiUrl(apiUrl === '' ? undefined : apiUrl)

  return {
    run: true,
    upload: {
      key,
      release,
      commit: commitFrom(options, env),
      dir: options.dir,
      apiUrl: apiUrl === '' ? undefined : apiUrl,
      deleteAfterUpload: options.deleteAfterUpload === true,
      silent: options.silent === true,
    },
  }
}
