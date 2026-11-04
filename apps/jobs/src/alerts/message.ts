import type { AlertLocale, PendingAlert } from '@nekolog-io/adapters'
import { ALERT_LOCALES } from '@nekolog-io/adapters'

export const DEFAULT_ALERT_LOCALE: AlertLocale = 'en'

type Copy = {
  firing: string
  resolved: string
  environment: string
  measured: string
  threshold: string
  window: string
  open: string
  types: Record<string, string>
}

const COPY: Readonly<Record<AlertLocale, Copy>> = {
  en: {
    firing: 'Alert firing',
    resolved: 'Alert resolved',
    environment: 'Environment',
    measured: 'Measured',
    threshold: 'Threshold',
    window: 'Window',
    open: 'Open in the Explorer',
    types: {
      threshold: 'count above the threshold',
      error_rate: 'error rate above the threshold',
      new_issue: 'a new issue appeared',
      issue_regression: 'a resolved issue came back',
      absence: 'no logs arrived',
    },
  },
  'pt-BR': {
    firing: 'Alerta disparado',
    resolved: 'Alerta resolvido',
    environment: 'Ambiente',
    measured: 'Medido',
    threshold: 'Limite',
    window: 'Janela',
    open: 'Abrir no Explorer',
    types: {
      threshold: 'contagem acima do limite',
      error_rate: 'taxa de erro acima do limite',
      new_issue: 'apareceu uma issue nova',
      issue_regression: 'uma issue resolvida voltou',
      absence: 'nenhum log chegou',
    },
  },
  es: {
    firing: 'Alerta disparada',
    resolved: 'Alerta resuelta',
    environment: 'Entorno',
    measured: 'Medido',
    threshold: 'Umbral',
    window: 'Ventana',
    open: 'Abrir en el Explorer',
    types: {
      threshold: 'conteo por encima del umbral',
      error_rate: 'tasa de error por encima del umbral',
      new_issue: 'apareció una incidencia nueva',
      issue_regression: 'una incidencia resuelta volvió',
      absence: 'no llegó ningún registro',
    },
  },
}

export function alertLocaleFor(value: string): AlertLocale {
  return (ALERT_LOCALES as readonly string[]).includes(value)
    ? (value as AlertLocale)
    : DEFAULT_ALERT_LOCALE
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

export function explorerUrl(dashboardUrl: string, alert: PendingAlert): string {
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9._~\-/]*)?$/.test(dashboardUrl)) {
    throw new Error('Refusing to build an alert link on something that is not an https address')
  }
  if (!/^env_[0-9A-HJKMNP-TV-Z]{26}$/.test(alert.environmentId)) {
    throw new Error(`Refusing to build an alert link for ${JSON.stringify(alert.environmentId)}`)
  }

  let end = dashboardUrl.length
  while (end > 0 && dashboardUrl[end - 1] === '/') {
    end -= 1
  }

  const base = `${dashboardUrl.slice(0, end)}/explorer`
  const search = alert.query === '' ? '' : `&q=${encodeURIComponent(alert.query)}`
  return `${base}?env=${encodeURIComponent(alert.environmentId)}&window=${encodeURIComponent(alert.window)}${search}`
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

export type AlertMessage = {
  subject: string
  lines: ReadonlyArray<[string, string]>
  text: string
  html: string
  url: string
  locale: AlertLocale
}

export function alertMessage(
  alert: PendingAlert,
  dashboardUrl: string,
  rawLocale: string,
): AlertMessage {
  const locale = alertLocaleFor(rawLocale)
  const copy = COPY[locale]
  const url = explorerUrl(dashboardUrl, alert)
  const headline = alert.state === 'firing' ? copy.firing : copy.resolved

  const lines: Array<[string, string]> = [
    [copy.environment, alert.environmentName],
    [copy.measured, round(alert.measured)],
  ]
  if (alert.threshold !== null) {
    lines.push([copy.threshold, round(alert.threshold)])
  }
  lines.push([copy.window, alert.window])

  const subject = `[${headline}] ${alert.ruleName} — ${copy.types[alert.type] ?? alert.type}`

  const text = [
    subject,
    '',
    ...lines.map(([label, value]) => `${label}: ${value}`),
    '',
    `${copy.open}: ${url}`,
  ].join('\n')

  const html = [
    '<!doctype html><html><body>',
    `<h1>${escapeHtml(subject)}</h1>`,
    '<ul>',
    ...lines.map(([label, value]) => `<li>${escapeHtml(label)}: ${escapeHtml(value)}</li>`),
    '</ul>',
    `<p><a href="${escapeHtml(url)}">${escapeHtml(copy.open)}</a></p>`,
    '</body></html>',
  ].join('')

  return { subject, lines, text, html, url, locale }
}
