export const K6_IMAGE = 'grafana/k6:1.3.0'
export const DOCKER_HOST_NAME = 'host.docker.internal'
export const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]', '::1']

export type Runner = 'k6' | 'docker'

export type K6Request = {
  runner: Runner
  script: string
  scriptsDir: string
  env: Record<string, string>
}

export class LoadRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LoadRefused'
  }
}

export function reachableFromDocker(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return value
  }
  if (!LOOPBACK_HOSTS.includes(url.hostname)) {
    return value
  }
  url.hostname = DOCKER_HOST_NAME
  return url.toString().replace(/\/$/, '')
}

export function k6Command(request: K6Request): { file: string; args: string[] } {
  if (request.script.includes('/') || request.script.includes('\\')) {
    throw new LoadRefused(`${request.script} is a path, not a script name.`)
  }

  if (request.runner === 'k6') {
    const args = ['run']
    for (const [name, value] of Object.entries(request.env)) {
      args.push('--env', `${name}=${value}`)
    }
    args.push(`${request.scriptsDir}/${request.script}`)
    return { file: 'k6', args }
  }

  const args = [
    'run',
    '--rm',
    '-i',
    '--add-host',
    `${DOCKER_HOST_NAME}:host-gateway`,
    '-v',
    `${request.scriptsDir}:/scripts:ro`,
  ]
  for (const [name, value] of Object.entries(request.env)) {
    args.push('-e', `${name}=${reachableFromDocker(value)}`)
  }
  args.push(K6_IMAGE, 'run', `/scripts/${request.script}`)
  return { file: 'docker', args }
}

export async function assertTargetIsUp(baseUrl: string, probe = fetch): Promise<void> {
  let health: URL
  try {
    health = new URL('/health', baseUrl)
  } catch {
    throw new LoadRefused(`${JSON.stringify(baseUrl)} is not a URL.`)
  }

  let response: Response
  try {
    response = await probe(health, { method: 'GET' })
  } catch (error) {
    throw new LoadRefused(
      `Nothing answered at ${health}. Start the target first. (${error instanceof Error ? error.message : String(error)})`,
    )
  }

  if (!response.ok) {
    throw new LoadRefused(`${health} answered ${response.status}, so there is nothing to measure.`)
  }
}
