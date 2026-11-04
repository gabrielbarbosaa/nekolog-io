import { type LocalApiConfig, type LocalApiEnv, localApiConfigFrom } from './local.ts'

export const DEFAULT_SELF_HOST_HOST = '0.0.0.0'

export type SelfHostApiEnv = LocalApiEnv

export type SelfHostApiConfig = LocalApiConfig

export function selfHostApiConfigFrom(env: SelfHostApiEnv): SelfHostApiConfig {
  return localApiConfigFrom({
    ...env,
    API_HOST:
      env.API_HOST === undefined || env.API_HOST === '' ? DEFAULT_SELF_HOST_HOST : env.API_HOST,
  })
}
