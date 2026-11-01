import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { environmentConfig, type JsonObject, readJsonObject } from './config.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function read(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), 'utf8')
}

const PLANO = read('docs', 'PLANO.md')
const ENVIRONMENT_MODULE = read('infra', 'modules', 'environment', 'main.tf')
const VM_ROOT = read('infra', 'vm', 'main.tf')
const COMPOSE = read('deploy', 'vm', 'docker-compose.yml')
const CLOUD_INIT = read('deploy', 'vm', 'cloud-init.yaml.tftpl')

const INGEST = readJsonObject(join(ROOT, 'apps', 'ingest', 'wrangler.json'))
const JOBS = readJsonObject(join(ROOT, 'apps', 'jobs', 'wrangler.json'))

const OPEN = '${'

function ref(name: string): string {
  return `${OPEN}${name}}`
}

const HOSTNAMES: Record<string, string> = {
  dev: 'ingest-dev.nekolog.io',
  qa: 'ingest-qa.nekolog.io',
  prod: 'ingest.nekolog.io',
}

function composeService(name: string): string {
  const found = new RegExp(`^ {2}${name}:\\n([\\s\\S]*?)(?=^ {2}\\S|^\\S)`, 'm').exec(COMPOSE)
  if (found === null) {
    throw new Error(`There is no service called ${name} in deploy/vm/docker-compose.yml.`)
  }
  return found[1] ?? ''
}

describe('the hostnames the SDKs will send to', () => {
  it.each(Object.entries(HOSTNAMES))('is what the plan says for %s', (_environment, hostname) => {
    expect(PLANO).toContain(hostname)
  })

  it('builds the production one without a prefix and the others with one', () => {
    const zone = ref('var.zone_name')
    const environment = ref('var.environment')

    expect(ENVIRONMENT_MODULE).toContain(
      `var.environment == "prod" ? "ingest.${zone}" : "ingest-${environment}.${zone}"`,
    )
  })

  it('points the custom domain at the Worker wrangler deploys', () => {
    expect(ENVIRONMENT_MODULE).toContain(`service    = "nekolog-ingest-${ref('var.environment')}"`)

    for (const environment of Object.keys(HOSTNAMES)) {
      expect(environmentConfig(INGEST, environment).name).toBe(`nekolog-ingest-${environment}`)
    }
  })

  it('gives the jobs Worker no hostname, in the plan or anywhere else', () => {
    expect(ENVIRONMENT_MODULE).not.toContain('nekolog-jobs')
    expect(JSON.stringify(JOBS)).not.toContain('nekolog.io')
  })
})

describe('the tunnels on the machine', () => {
  it('sends each environment to ClickHouse and nothing else', () => {
    expect(VM_ROOT).toContain('service     = "http://clickhouse:8123"')
  })

  it('sends the fourth one to the host sshd, not into the container network', () => {
    expect(VM_ROOT).toContain('service     = "ssh://host.docker.internal:22"')
  })

  it('writes whatever service the tunnel declares, instead of assuming ClickHouse', () => {
    expect(CLOUD_INIT).toContain(`service: ${ref('tunnel.service')}`)
    expect(CLOUD_INIT).not.toContain('service: http://clickhouse:8123')
  })
})

describe('what the machine publishes', () => {
  it('still opens no port to the host', () => {
    expect(COMPOSE).not.toMatch(/^\s*ports:/m)
  })

  it('keeps the ssh tunnel off the network ClickHouse trusts', () => {
    const block = composeService('tunnel-ssh')

    expect(block).toContain('- outside')
    expect(block).not.toContain('- inside')
    expect(block).toContain('host.docker.internal:host-gateway')
  })

  it('lets the ssh tunnel come up even when ClickHouse is down, which is when it is needed', () => {
    expect(composeService('tunnel-ssh')).not.toContain('depends_on')
    expect(composeService('tunnel-prod')).toContain('depends_on')
  })
})

describe('the shape of both Worker configurations', () => {
  it.each([
    ['ingest', INGEST],
    ['jobs', JOBS],
  ])('leaves no placeholder unnamed in %s', (_app, config: JsonObject) => {
    expect(JSON.stringify(config)).not.toMatch(/\$\{[^A-Z]/)
  })
})
