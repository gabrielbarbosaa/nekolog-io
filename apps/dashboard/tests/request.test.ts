import { describe, expect, it } from 'vitest'
import {
  addressOf,
  booleanField,
  countryOf,
  deviceOf,
  stringField,
  UNKNOWN_IP,
} from '../lib/request.ts'

function headers(values: Record<string, string>): Headers {
  return new Headers(values)
}

describe('the address a request came from', () => {
  it('trusts what Cloudflare says first', () => {
    expect(
      addressOf(headers({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4' })),
    ).toBe('203.0.113.7')
  })

  it('takes the last hop when there is no Cloudflare header', () => {
    expect(addressOf(headers({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('takes the last hop because the earlier ones are whatever the client typed', () => {
    expect(addressOf(headers({ 'x-forwarded-for': 'not-an-address, 203.0.113.7' }))).toBe(
      '203.0.113.7',
    )
  })

  it('has an answer when there is no header at all', () => {
    expect(addressOf(headers({}))).toBe(UNKNOWN_IP)
    expect(addressOf(headers({ 'x-forwarded-for': ' , ' }))).toBe(UNKNOWN_IP)
  })
})

describe('the browser a request came from', () => {
  it.each([
    ['Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/133.0', 'Firefox on Linux x86_64'],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
      'Chrome on Win64',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
      'Safari on Intel Mac OS X 10_15_7',
    ],
  ])('reads %s', (agent, expected) => {
    expect(deviceOf(headers({ 'user-agent': agent }))).toBe(expected)
  })

  it('says unknown rather than guessing when there is no user agent', () => {
    expect(deviceOf(headers({}))).toBe('unknown')
    expect(deviceOf(headers({ 'user-agent': 'curl/8.0' }))).toBe('unknown')
  })
})

describe('the country a request came from', () => {
  it('takes the two letters Cloudflare adds', () => {
    expect(countryOf(headers({ 'cf-ipcountry': 'BR' }))).toBe('BR')
  })

  it('refuses anything that is not two capitals', () => {
    expect(countryOf(headers({ 'cf-ipcountry': 'XX1' }))).toBe('??')
    expect(countryOf(headers({ 'cf-ipcountry': 'br' }))).toBe('??')
    expect(countryOf(headers({}))).toBe('??')
  })
})

describe('reading a field out of a body', () => {
  it('gives an empty string for anything that is not one', () => {
    expect(stringField({ email: 'a@b.test' }, 'email')).toBe('a@b.test')
    expect(stringField({ email: 42 }, 'email')).toBe('')
    expect(stringField({}, 'email')).toBe('')
  })

  it('treats only a real true as true, not a string or a number', () => {
    expect(booleanField({ remember: true }, 'remember')).toBe(true)
    expect(booleanField({ remember: 'true' }, 'remember')).toBe(false)
    expect(booleanField({ remember: 1 }, 'remember')).toBe(false)
  })
})
