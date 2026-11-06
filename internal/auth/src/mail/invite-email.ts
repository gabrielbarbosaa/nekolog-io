import { type EmailLocale, escapeHtml, localeFor } from './code-email.ts'

type Copy = {
  subject: (organization: string) => string
  heading: (organization: string) => string
  lead: (inviter: string) => string
  action: string
  validity: (days: number) => string
  ignore: string
}

const COPY: Readonly<Record<EmailLocale, Copy>> = {
  en: {
    subject: (organization) => `You were invited to ${organization}`,
    heading: (organization) => `Join ${organization} on NekoLog`,
    lead: (inviter) => `${inviter} invited you to read the logs with them.`,
    action: 'Open this link to set a password and join:',
    validity: (days) => `The link stops working in ${days} days.`,
    ignore:
      'If you were not expecting this, ignore the message. Nothing happens until you open it.',
  },
  'pt-BR': {
    subject: (organization) => `Você foi convidado para ${organization}`,
    heading: (organization) => `Entre em ${organization} no NekoLog`,
    lead: (inviter) => `${inviter} convidou você para ler os logs junto.`,
    action: 'Abra este link para definir uma senha e entrar:',
    validity: (days) => `O link para de valer em ${days} dias.`,
    ignore: 'Se você não esperava isto, ignore a mensagem. Nada acontece até você abrir.',
  },
  es: {
    subject: (organization) => `Te invitaron a ${organization}`,
    heading: (organization) => `Entra en ${organization} en NekoLog`,
    lead: (inviter) => `${inviter} te invitó a leer los logs con él.`,
    action: 'Abre este enlace para poner una contraseña y entrar:',
    validity: (days) => `El enlace deja de valer en ${days} días.`,
    ignore: 'Si no esperabas esto, ignora el mensaje. No pasa nada hasta que lo abras.',
  },
}

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/

export function inviteLink(appUrl: string, token: string): string {
  if (!TOKEN.test(token)) {
    throw new Error('that is not an invite token')
  }
  const base = new URL(appUrl)
  if (base.protocol !== 'https:' && base.protocol !== 'http:') {
    throw new Error(`an invite link cannot be built on ${base.protocol}`)
  }
  return `${base.origin}/signup?invite=${token}`
}

export type InviteNotice = {
  organization: string
  inviter: string
  locale: string | undefined
  appUrl: string
  token: string
  days: number
}

export type InviteEmail = { subject: string; html: string; text: string }

export function inviteEmail(notice: InviteNotice): InviteEmail {
  const copy = COPY[localeFor(notice.locale)]
  const link = inviteLink(notice.appUrl, notice.token)

  const html = [
    `<h1>${escapeHtml(copy.heading(notice.organization))}</h1>`,
    `<p>${escapeHtml(copy.lead(notice.inviter))}</p>`,
    `<p>${escapeHtml(copy.action)}</p>`,
    `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
    `<p>${escapeHtml(copy.validity(notice.days))}</p>`,
    `<p>${escapeHtml(copy.ignore)}</p>`,
  ].join('')

  const text = [
    copy.heading(notice.organization),
    '',
    copy.lead(notice.inviter),
    '',
    copy.action,
    link,
    '',
    copy.validity(notice.days),
    copy.ignore,
  ].join('\n')

  return { subject: copy.subject(notice.organization), html, text }
}
