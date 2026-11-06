import { formatCode } from '../codes.ts'

export const EMAIL_LOCALES = ['en', 'pt-BR', 'es'] as const
export type EmailLocale = (typeof EMAIL_LOCALES)[number]

export const DEFAULT_EMAIL_LOCALE: EmailLocale = 'en'

type Copy = {
  subject: string
  heading: string
  lead: string
  validity: string
  device: string
  country: string
  when: string
  warning: string
  noLink: string
}

const COPY: Readonly<Record<EmailLocale, Copy>> = {
  en: {
    subject: 'Your sign-in code',
    heading: 'Your sign-in code',
    lead: 'Type this code in the tab you started from. It only works there.',
    validity: 'It stops working in 10 minutes.',
    device: 'Browser',
    country: 'Country',
    when: 'Asked for at',
    warning: 'If this was not you, change your password now.',
    noLink: 'This message has no link that signs you in. We will never send one.',
  },
  'pt-BR': {
    subject: 'Seu código de entrada',
    heading: 'Seu código de entrada',
    lead: 'Digite este código na aba onde você começou. Ele só funciona lá.',
    validity: 'Ele para de valer em 10 minutos.',
    device: 'Navegador',
    country: 'País',
    when: 'Pedido em',
    warning: 'Se não foi você, troque sua senha agora.',
    noLink: 'Esta mensagem não tem link que faz login. Nunca vamos mandar um.',
  },
  es: {
    subject: 'Tu código de acceso',
    heading: 'Tu código de acceso',
    lead: 'Escribe este código en la pestaña donde empezaste. Solo funciona ahí.',
    validity: 'Deja de valer en 10 minutos.',
    device: 'Navegador',
    country: 'País',
    when: 'Pedido el',
    warning: 'Si no fuiste tú, cambia tu contraseña ahora.',
    noLink: 'Este mensaje no tiene ningún enlace que inicie sesión. Nunca enviaremos uno.',
  },
}

export function localeFor(value: string | undefined): EmailLocale {
  return EMAIL_LOCALES.includes(value as EmailLocale)
    ? (value as EmailLocale)
    : DEFAULT_EMAIL_LOCALE
}

export function escapeHtml(value: string): string {
  return value
    .split('&')
    .join('&amp;')
    .split('<')
    .join('&lt;')
    .split('>')
    .join('&gt;')
    .split('"')
    .join('&quot;')
    .split("'")
    .join('&#39;')
}

const DEVICE = /^[A-Za-z0-9 ().-]{0,60}$/
const COUNTRY = /^[A-Z]{2}$/

export function describeDevice(value: string): string {
  return DEVICE.test(value) ? value : 'unknown'
}

export function describeCountry(value: string): string {
  return COUNTRY.test(value) ? value : '??'
}

export type CodeNotice = {
  code: string
  locale: string | undefined
  device: string
  country: string
  at: number
}

export type CodeEmail = { subject: string; html: string; text: string }

export function loginCodeEmail(notice: CodeNotice): CodeEmail {
  const copy = COPY[localeFor(notice.locale)]
  const shown = formatCode(notice.code)
  const facts: Array<[string, string]> = [
    [copy.device, describeDevice(notice.device)],
    [copy.country, describeCountry(notice.country)],
    [copy.when, new Date(notice.at).toISOString().replace('T', ' ').slice(0, 16)],
  ]

  const rows = facts
    .map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`)
    .join('')

  const html = [
    `<h1>${escapeHtml(copy.heading)}</h1>`,
    `<p>${escapeHtml(copy.lead)}</p>`,
    `<p style="font-size:28px;letter-spacing:4px"><strong>${escapeHtml(shown)}</strong></p>`,
    `<p>${escapeHtml(copy.validity)}</p>`,
    `<table>${rows}</table>`,
    `<p><strong>${escapeHtml(copy.warning)}</strong></p>`,
    `<p>${escapeHtml(copy.noLink)}</p>`,
  ].join('')

  const text = [
    copy.heading,
    '',
    copy.lead,
    '',
    shown,
    '',
    copy.validity,
    '',
    ...facts.map(([label, value]) => `${label}: ${value}`),
    '',
    copy.warning,
    copy.noLink,
  ].join('\n')

  return { subject: copy.subject, html, text }
}
