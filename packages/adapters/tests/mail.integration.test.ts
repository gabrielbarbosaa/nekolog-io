import { createTransport, type Transporter } from 'nodemailer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Mailer } from '../src/index.ts'
import { EmailRefused, smtpMailer } from '../src/index.ts'

const SMTP = process.env.SMTP_TEST_URL ?? 'smtp://localhost:1025'
const API = process.env.MAILPIT_TEST_URL ?? 'http://localhost:8025'

type MailpitMessage = {
  ID: string
  To: Array<{ Address: string }>
  Subject: string
}

async function answers(): Promise<boolean> {
  try {
    const response = await fetch(`${API}/api/v1/info`)
    return response.ok
  } catch {
    return false
  }
}

const reachable = await answers()

if (!reachable) {
  if (process.env.MAILPIT_TEST_REQUIRED === '1') {
    throw new Error(
      `MAILPIT_TEST_REQUIRED is set but nothing answered at ${API}. These tests must not be skipped here.`,
    )
  }
  process.stderr.write(
    `\nSkipping Mailpit integration tests: nothing answered at ${API}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

const run = `run-${process.pid}`
let transport: Transporter
let mailer: Mailer

async function search(query: string): Promise<MailpitMessage[]> {
  const response = await fetch(`${API}/api/v1/search?query=${encodeURIComponent(query)}`)
  const body = (await response.json()) as { messages?: MailpitMessage[] }
  return body.messages ?? []
}

async function bodyOf(id: string): Promise<{ HTML: string; Text: string }> {
  const response = await fetch(`${API}/api/v1/message/${id}`)
  return (await response.json()) as { HTML: string; Text: string }
}

beforeAll(() => {
  transport = createTransport(SMTP)
  mailer = smtpMailer({ transport, from: 'no-reply@nekolog.test' })
})

afterAll(async () => {
  for (const query of [run, 'evil@example.test']) {
    for (const found of await search(query)) {
      await fetch(`${API}/api/v1/message/${found.ID}`, { method: 'DELETE' })
    }
  }
  transport?.close()
})

describe.skipIf(!reachable)('the SMTP mailer against a real server', () => {
  it('delivers a message that arrives with the sender, the recipient and the body', async () => {
    const subject = `${run} delivered`

    await mailer.send({
      to: 'Ada@Example.test',
      subject,
      html: '<p>your code is 123456</p>',
      text: 'your code is 123456',
    })

    const [found] = await search(subject)
    expect(found).toBeDefined()
    expect(found?.To[0]?.Address).toBe('ada@example.test')

    const body = await bodyOf(found?.ID ?? '')
    expect(body.HTML).toContain('123456')
    expect(body.Text).toContain('123456')
  })

  it('never delivers a second recipient smuggled through a header', async () => {
    const subject = `${run} smuggled`

    await expect(
      mailer.send({
        to: 'ada@example.test\nbcc: evil@example.test',
        subject,
        html: '<p>x</p>',
      }),
    ).rejects.toThrow(EmailRefused)

    expect(
      await search(subject),
      'the guard let a message through, and the smuggled recipient went with it',
    ).toHaveLength(0)
  })
})
