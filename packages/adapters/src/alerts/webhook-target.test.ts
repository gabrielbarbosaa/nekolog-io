import { describe, expect, it } from 'vitest'
import {
  ALLOWED_WEBHOOK_PORTS,
  assertWebhookTarget,
  isPrivateIpv4,
  isPrivateIpv6,
  isWebhookTargetAllowed,
  looksLikeAnIpAddress,
  MAX_WEBHOOK_URL_CHARS,
  WebhookTargetError,
} from './webhook-target.ts'

describe('the limits', () => {
  it('allow one port and one scheme, which is the whole point', () => {
    expect([...ALLOWED_WEBHOOK_PORTS]).toEqual([443])
    expect(MAX_WEBHOOK_URL_CHARS).toBe(2000)
  })
})

describe('private IPv4', () => {
  it.each([
    ['0.0.0.0', 'this host'],
    ['10.0.0.1', 'private class A'],
    ['10.255.255.255', 'private class A, far end'],
    ['127.0.0.1', 'loopback'],
    ['127.1.2.3', 'loopback, anywhere in the block'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['100.127.255.255', 'carrier-grade NAT, far end'],
    ['169.254.169.254', 'the cloud metadata address'],
    ['172.16.0.1', 'private class B'],
    ['172.31.255.255', 'private class B, far end'],
    ['192.168.1.1', 'private class C'],
    ['192.0.0.1', 'IETF protocol assignments'],
    ['192.0.2.1', 'documentation'],
    ['192.88.99.1', '6to4 relay anycast'],
    ['198.18.0.1', 'benchmarking'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
  ])('refuses %s (%s)', (address) => {
    expect(isPrivateIpv4(address)).toBe(true)
    expect(isWebhookTargetAllowed(`https://${address}/hook`)).toBe(false)
  })

  it.each(['8.8.8.8', '1.1.1.1', '203.0.113.1', '172.32.0.1', '100.128.0.1', '11.0.0.1'])(
    'allows the public address %s',
    (address) => {
      expect(isPrivateIpv4(address)).toBe(false)
    },
  )

  it('treats an octet out of range as private rather than as a public address', () => {
    expect(isPrivateIpv4('999.1.1.1')).toBe(true)
    expect(isPrivateIpv4('8.300.1.1')).toBe(true)
    expect(isPrivateIpv4('8.8.8.256')).toBe(true)
  })

  it('does not mistake a hostname for an address', () => {
    expect(isPrivateIpv4('hooks.slack.com')).toBe(false)
    expect(looksLikeAnIpAddress('hooks.slack.com')).toBe(false)
  })
})

describe('private IPv6', () => {
  it.each(['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1'])(
    'refuses %s',
    (address) => {
      expect(isPrivateIpv6(address)).toBe(true)
      expect(isWebhookTargetAllowed(`https://[${address}]/hook`)).toBe(false)
    },
  )

  it('allows a public v6 address', () => {
    expect(isPrivateIpv6('2606:4700:4700::1111')).toBe(false)
  })
})

describe('assertWebhookTarget', () => {
  it('accepts an ordinary https endpoint', () => {
    const url = assertWebhookTarget('https://hooks.slack.com/services/T000/B000/XXXX')

    expect(url.hostname).toBe('hooks.slack.com')
  })

  it('accepts the default port written out', () => {
    expect(isWebhookTargetAllowed('https://hooks.slack.com:443/x')).toBe(true)
  })

  it('refuses http, so the payload is never sent in clear', () => {
    expect(() => assertWebhookTarget('http://hooks.slack.com/x')).toThrow(/only https/)
  })

  it.each(['file:///etc/passwd', 'gopher://a.test/', 'ftp://a.test/', 'javascript:alert(1)'])(
    'refuses the scheme in %s',
    (value) => {
      expect(() => assertWebhookTarget(value)).toThrow(WebhookTargetError)
    },
  )

  it('refuses a port that is not the https one', () => {
    for (const port of [80, 22, 6379, 5432, 8123, 9200, 11211]) {
      expect(() => assertWebhookTarget(`https://a.test:${port}/x`)).toThrow(/is not one an https/)
    }
  })

  it('refuses credentials in the address, which belong in the channel secret', () => {
    expect(() => assertWebhookTarget('https://user:pass@a.test/x')).toThrow(/credentials/)
    expect(() => assertWebhookTarget('https://user@a.test/x')).toThrow(/credentials/)
  })

  it.each(['localhost', 'metadata.google.internal', 'metadata.goog', 'instance-data'])(
    'refuses the host %s outright',
    (host) => {
      expect(() => assertWebhookTarget(`https://${host}/x`)).toThrow(WebhookTargetError)
    },
  )

  it.each([
    'a.localhost',
    'db.local',
    'vault.internal',
    'wiki.intranet',
    'printer.lan',
    'x.home.arpa',
    '1.0.0.127.in-addr.arpa',
  ])('refuses the internal-looking host %s', (host) => {
    expect(() => assertWebhookTarget(`https://${host}/x`)).toThrow(WebhookTargetError)
  })

  it('refuses a bare name with no dot, which can only live on this network', () => {
    expect(() => assertWebhookTarget('https://redis/x')).toThrow(/has no dot/)
    expect(() => assertWebhookTarget('https://clickhouse/x')).toThrow(/has no dot/)
  })

  it('does not care about the case of the host', () => {
    expect(() => assertWebhookTarget('https://LOCALHOST/x')).toThrow(WebhookTargetError)
    expect(() => assertWebhookTarget('https://Metadata.Google.Internal/x')).toThrow(
      WebhookTargetError,
    )
  })

  it('refuses an address longer than any endpoint has reason to be', () => {
    const long = `https://a.test/${'x'.repeat(MAX_WEBHOOK_URL_CHARS)}`

    expect(() => assertWebhookTarget(long)).toThrow(/longer than an address/)
  })

  it('refuses something that is not an address at all', () => {
    for (const bad of ['', 'hooks.slack.com', 'https://', '   ']) {
      expect(() => assertWebhookTarget(bad)).toThrow(WebhookTargetError)
    }
  })

  it('names why it refused, so the dashboard can say something useful', () => {
    try {
      assertWebhookTarget('https://169.254.169.254/latest/meta-data/')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(WebhookTargetError)
      expect((error as WebhookTargetError).reason).toContain('private or reserved')
    }
  })
})
