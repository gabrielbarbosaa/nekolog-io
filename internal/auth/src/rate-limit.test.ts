import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_ATTEMPTS,
  ATTEMPT_WINDOW_SECONDS,
  BACKOFF_MINUTES,
  IP_ATTEMPTS,
  limitKey,
  waitAfter,
} from './rate-limit.ts'

describe('the numbers section 11.6 writes down', () => {
  it('are five per account and twenty per address, in fifteen minutes', () => {
    expect(ACCOUNT_ATTEMPTS).toBe(5)
    expect(IP_ATTEMPTS).toBe(20)
    expect(ATTEMPT_WINDOW_SECONDS).toBe(900)
  })

  it('grow the wait one, two, four, eight, fifteen', () => {
    expect([...BACKOFF_MINUTES]).toEqual([1, 2, 4, 8, 15])
  })

  it('names the key section 11.7 lists', () => {
    expect(limitKey('login', 'account', 'usr_1')).toBe('rl:login:account:usr_1')
    expect(limitKey('login', 'ip', '203.0.113.7')).toBe('rl:login:ip:203.0.113.7')
  })
})

describe('how long someone waits', () => {
  it('is nothing at all for the four failures before the fifth', () => {
    for (let failures = 0; failures < 5; failures += 1) {
      expect(waitAfter(failures, ACCOUNT_ATTEMPTS), `${failures} failures`).toBe(0)
    }
  })

  it('starts at the fifth failure, which is what "5 activate a wait" means', () => {
    expect(waitAfter(5, ACCOUNT_ATTEMPTS)).toBe(60)
  })

  it('grows with each failure after it, in the order the plan gives', () => {
    expect(waitAfter(6, ACCOUNT_ATTEMPTS)).toBe(120)
    expect(waitAfter(7, ACCOUNT_ATTEMPTS)).toBe(240)
    expect(waitAfter(8, ACCOUNT_ATTEMPTS)).toBe(480)
    expect(waitAfter(9, ACCOUNT_ATTEMPTS)).toBe(900)
  })

  it('stops growing at fifteen minutes rather than running away', () => {
    for (const failures of [10, 50, 1_000]) {
      expect(waitAfter(failures, ACCOUNT_ATTEMPTS), `${failures} failures`).toBe(900)
    }
  })

  it('counts the address allowance separately, and it is larger', () => {
    expect(waitAfter(19, IP_ATTEMPTS)).toBe(0)
    expect(waitAfter(20, IP_ATTEMPTS)).toBe(60)
  })
})
