import { describe, expect, it } from 'vitest'
import { EmailRefused } from './address.ts'
import { memoryMailer } from './memory-mailer.ts'
import { suppressedMailer } from './suppressed.ts'

const MESSAGE = { to: 'ada@example.test', subject: 'your code', html: '<p>123456</p>' }

function listOf(addresses: string[]) {
  return { has: (address: string) => Promise.resolve(addresses.includes(address)) }
}

describe('suppressedMailer', () => {
  it('sends to an address nobody suppressed', async () => {
    const inner = memoryMailer()

    await suppressedMailer(inner, listOf([])).send(MESSAGE)

    expect(inner.sent).toHaveLength(1)
  })

  it('refuses an address that bounced, and nothing reaches the mailer', async () => {
    const inner = memoryMailer()

    await expect(
      suppressedMailer(inner, listOf(['ada@example.test'])).send(MESSAGE),
    ).rejects.toThrow(EmailRefused)
    expect(inner.sent).toHaveLength(0)
  })

  it('looks the address up normalised, so a capital letter does not slip past', async () => {
    const inner = memoryMailer()

    await expect(
      suppressedMailer(inner, listOf(['ada@example.test'])).send({
        ...MESSAGE,
        to: 'Ada@Example.test',
      }),
    ).rejects.toThrow(EmailRefused)
    expect(inner.sent).toHaveLength(0)
  })

  it('sends nothing when it cannot tell, instead of assuming nobody is suppressed', async () => {
    const inner = memoryMailer()
    const broken = { has: () => Promise.reject(new Error('the database is down')) }

    await expect(suppressedMailer(inner, broken).send(MESSAGE)).rejects.toThrow(EmailRefused)
    expect(inner.sent).toHaveLength(0)
  })

  it('still refuses a forged header before it ever asks the list', async () => {
    const inner = memoryMailer()
    let asked = false
    const list = {
      has: () => {
        asked = true
        return Promise.resolve(false)
      },
    }

    await expect(
      suppressedMailer(inner, list).send({
        ...MESSAGE,
        to: 'ada@example.test\nbcc: evil@example.test',
      }),
    ).rejects.toThrow(EmailRefused)
    expect(asked).toBe(false)
    expect(inner.sent).toHaveLength(0)
  })
})
