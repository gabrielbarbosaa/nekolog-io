import type { ExportNotice } from '@nekolog-io/adapters'

export const EMAIL_LOCALES = ['en', 'pt-BR', 'es'] as const
export type EmailLocale = (typeof EMAIL_LOCALES)[number]

export const DEFAULT_EMAIL_LOCALE: EmailLocale = 'en'

type Copy = {
  subject: (cadence: string) => string
  heading: string
  period: string
  rows: string
  size: string
  until: string
  open: string
  noAttachment: string
  cadences: Record<string, string>
}

const COPY: Readonly<Record<EmailLocale, Copy>> = {
  en: {
    subject: (cadence) => `Your ${cadence} log export is ready`,
    heading: 'Your log export is ready',
    period: 'Period',
    rows: 'Logs',
    size: 'Size',
    until: 'Available until',
    open: 'Open the export',
    noAttachment:
      'The file is not attached. Logs can carry personal data, so the download asks you to sign in and checks your permission on the environment first.',
    cadences: { daily: 'daily', weekly: 'weekly', '': 'log' },
  },
  'pt-BR': {
    subject: (cadence) => `Sua exportação ${cadence} de logs está pronta`,
    heading: 'Sua exportação de logs está pronta',
    period: 'Período',
    rows: 'Logs',
    size: 'Tamanho',
    until: 'Disponível até',
    open: 'Abrir a exportação',
    noAttachment:
      'O arquivo não vai anexado. Logs podem conter dados pessoais, então o download pede login e confere sua permissão no ambiente antes de liberar.',
    cadences: { daily: 'diária', weekly: 'semanal', '': 'de logs' },
  },
  es: {
    subject: (cadence) => `Tu exportación ${cadence} de registros está lista`,
    heading: 'Tu exportación de registros está lista',
    period: 'Período',
    rows: 'Registros',
    size: 'Tamaño',
    until: 'Disponible hasta',
    open: 'Abrir la exportación',
    noAttachment:
      'El archivo no va adjunto. Los registros pueden contener datos personales, así que la descarga pide iniciar sesión y comprueba tu permiso en el entorno antes de entregarlo.',
    cadences: { daily: 'diaria', weekly: 'semanal', '': 'de registros' },
  },
}

export function localeFor(value: string): EmailLocale {
  return (EMAIL_LOCALES as readonly string[]).includes(value)
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

export function exportUrl(dashboardUrl: string, exportId: string): string {
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9._~\-/]*)?$/.test(dashboardUrl)) {
    throw new Error('Refusing to build an export link on something that is not an https address')
  }
  if (!/^exp_[0-9A-HJKMNP-TV-Z]{26}$/.test(exportId)) {
    throw new Error(`Refusing to build an export link for ${JSON.stringify(exportId)}`)
  }
  let base = dashboardUrl.length
  while (base > 0 && dashboardUrl[base - 1] === '/') {
    base -= 1
  }
  return `${dashboardUrl.slice(0, base)}/exports/${exportId}`
}

function day(at: number): string {
  return new Date(at).toISOString().slice(0, 10)
}

function size(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} kB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export type ExportEmail = {
  subject: string
  html: string
  text: string
}

export function exportReadyEmail(notice: ExportNotice, dashboardUrl: string): ExportEmail {
  const copy = COPY[localeFor(notice.locale)]
  const url = exportUrl(dashboardUrl, notice.id)
  const cadence = copy.cadences[notice.cadence ?? ''] ?? copy.cadences['']

  const facts: Array<[string, string]> = [
    [copy.period, `${day(notice.rangeFrom)} — ${day(notice.rangeTo)}`],
    [copy.rows, notice.rowCount.toLocaleString('en-US')],
    [copy.size, size(notice.byteSize)],
    [copy.until, day(notice.expiresAt)],
  ]

  const text = [
    copy.heading,
    '',
    ...facts.map(([label, value]) => `${label}: ${value}`),
    '',
    `${copy.open}: ${url}`,
    '',
    copy.noAttachment,
  ].join('\n')

  const html = [
    '<!doctype html><html><body>',
    `<h1>${escapeHtml(copy.heading)}</h1>`,
    '<ul>',
    ...facts.map(([label, value]) => `<li>${escapeHtml(label)}: ${escapeHtml(value)}</li>`),
    '</ul>',
    `<p><a href="${escapeHtml(url)}">${escapeHtml(copy.open)}</a></p>`,
    `<p>${escapeHtml(copy.noAttachment)}</p>`,
    '</body></html>',
  ].join('')

  return { subject: copy.subject(cadence ?? ''), html, text }
}
