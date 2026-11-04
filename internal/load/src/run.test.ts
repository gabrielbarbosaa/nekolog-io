import { describe, expect, it } from 'vitest'
import { parseArgs } from './drive.ts'
import {
  assertTargetIsUp,
  DOCKER_HOST_NAME,
  K6_IMAGE,
  k6Command,
  LoadRefused,
  reachableFromDocker,
} from './run.ts'

const ENV = { TARGET_URL: 'http://localhost:8787', NEKOLOG_KEY: 'nekolog_sk_x', VUS: '10' }

describe('the k6 command', () => {
  it('runs the installed binary against the script in this package', () => {
    const command = k6Command({
      runner: 'k6',
      script: 'ingest.js',
      scriptsDir: '/repo/k6',
      env: ENV,
    })

    expect(command.file).toBe('k6')
    expect(command.args[0]).toBe('run')
    expect(command.args.at(-1)).toBe('/repo/k6/ingest.js')
    expect(command.args).toContain('TARGET_URL=http://localhost:8787')
  })

  it('mounts the scripts read-only when it goes through docker', () => {
    const command = k6Command({
      runner: 'docker',
      script: 'api.js',
      scriptsDir: '/repo/k6',
      env: ENV,
    })

    expect(command.file).toBe('docker')
    expect(command.args).toContain('--rm')
    expect(command.args).toContain('/repo/k6:/scripts:ro')
    expect(command.args).toContain(K6_IMAGE)
    expect(command.args.at(-1)).toBe('/scripts/api.js')
  })

  it('pins the image, so a run today and a run next month measure the same k6', () => {
    expect(K6_IMAGE).toMatch(/^grafana\/k6:\d+\.\d+\.\d+$/)
  })

  it('tells the container how to reach a target on this machine', () => {
    const command = k6Command({
      runner: 'docker',
      script: 'ingest.js',
      scriptsDir: '/repo/k6',
      env: ENV,
    })

    expect(command.args).toContain(`${DOCKER_HOST_NAME}:host-gateway`)
    expect(command.args).toContain(`TARGET_URL=http://${DOCKER_HOST_NAME}:8787`)
  })

  it('leaves an address that is not on this machine alone', () => {
    expect(reachableFromDocker('https://ingest.nekolog.io')).toBe('https://ingest.nekolog.io')
    expect(reachableFromDocker('http://127.0.0.1:8787')).toBe(`http://${DOCKER_HOST_NAME}:8787`)
    expect(reachableFromDocker('not a url')).toBe('not a url')
  })

  it('never starts a shell, and never takes a path as a script name', () => {
    for (const script of ['../../etc/passwd', 'a/b.js', 'C:\\k6\\x.js']) {
      expect(
        () => k6Command({ runner: 'k6', script, scriptsDir: '/repo/k6', env: {} }),
        script,
      ).toThrow(LoadRefused)
    }
  })
})

describe('before it measures anything', () => {
  it('refuses a target that is not answering, instead of reporting 100% errors', async () => {
    await expect(
      assertTargetIsUp('http://localhost:9', async () => {
        throw new Error('ECONNREFUSED')
      }),
    ).rejects.toThrow(/Nothing answered/)
  })

  it('refuses a target that answers badly', async () => {
    await expect(
      assertTargetIsUp('http://localhost:8787', async () => new Response('no', { status: 503 })),
    ).rejects.toThrow(/503/)
  })

  it('asks the health route, not the route it is about to hammer', async () => {
    const asked: string[] = []
    await assertTargetIsUp('http://localhost:8787', async (input) => {
      asked.push(String(input))
      return new Response('{}', { status: 200 })
    })

    expect(asked).toEqual(['http://localhost:8787/health'])
  })

  it('refuses something that is not a URL at all', async () => {
    await expect(assertTargetIsUp('localhost:8787')).rejects.toThrow(LoadRefused)
  })
})

describe('the arguments', () => {
  it('reads the target and every flag that takes a value', () => {
    expect(
      parseArgs([
        'ingest',
        '--url',
        'http://localhost:1',
        '--key',
        'k',
        '--vus',
        '50',
        '--duration',
        '2m',
        '--events',
        '500',
        '--runner',
        'docker',
        '--service',
        'load-run-1',
      ]),
    ).toEqual({
      target: 'ingest',
      url: 'http://localhost:1',
      key: 'k',
      vus: '50',
      duration: '2m',
      events: '500',
      runner: 'docker',
      service: 'load-run-1',
    })
  })

  it('ignores a flag it does not know and a flag with nothing after it', () => {
    expect(parseArgs(['api', '--nope', 'x', '--key'])).toStrictEqual({ target: 'api' })
  })
})
