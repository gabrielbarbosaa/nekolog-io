import 'server-only'
import {
  type CodeFor,
  codeEmail,
  findAccountById,
  type NoticeFor,
  noticeEmail,
} from '@internal/auth'
import { after } from 'next/server'
import { loginDeps, mail } from './auth'
import { countryOf, deviceOf } from './request'

type Recipient = { email: string; locale: string }

async function send(to: string, message: { subject: string; html: string; text: string }) {
  await mail().send({ to, subject: message.subject, html: message.html, text: message.text })
}

export function codeLater(purpose: CodeFor, to: Recipient, secret: string, headers: Headers): void {
  const message = codeEmail({
    purpose,
    code: secret,
    locale: to.locale,
    device: deviceOf(headers),
    country: countryOf(headers),
    at: Date.now(),
  })

  after(async () => {
    try {
      await send(to.email, message)
    } catch (error) {
      console.error(`the ${purpose} message could not be sent`, error)
    }
  })
}

export function noticeLater(purpose: NoticeFor, to: Recipient, headers: Headers): void {
  const message = noticeEmail({
    purpose,
    locale: to.locale,
    device: deviceOf(headers),
    country: countryOf(headers),
    at: Date.now(),
  })

  after(async () => {
    try {
      await send(to.email, message)
    } catch (error) {
      console.error(`the ${purpose} notice could not be sent`, error)
    }
  })
}

export function warnAboutReuse(userId: string, headers: Headers): void {
  const device = deviceOf(headers)
  const country = countryOf(headers)
  const at = Date.now()

  try {
    after(async () => {
      try {
        const account = await findAccountById(loginDeps().run, userId)
        if (account === undefined) {
          return
        }
        const message = noticeEmail({
          purpose: 'token-reused',
          locale: account.locale,
          device,
          country,
          at,
        })
        await send(account.email, message)
      } catch (error) {
        console.error('the reuse warning could not be sent', error)
      }
    })
  } catch (error) {
    console.error('the reuse warning could not be scheduled', error)
  }
}
