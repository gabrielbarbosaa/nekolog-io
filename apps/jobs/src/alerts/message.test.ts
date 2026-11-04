import type { PendingAlert } from '@nekolog-io/adapters'
import { ALERT_LOCALES } from '@nekolog-io/adapters'
import { describe, expect, it } from 'vitest'
import {
  alertLocaleFor,
  alertMessage,
  DEFAULT_ALERT_LOCALE,
  escapeHtml,
  explorerUrl,
} from './message.ts'

const DASHBOARD = 'https://app.nekolog.io'
const ENVIRONMENT = 'env_01JBQ8R4T7V2WXYZ0123456789'

function alert(overrides: Partial<PendingAlert> = {}): PendingAlert {
  return {
    ruleId: 'alr_01JBQ8R4T7V2WXYZ0123456789',
    projectId: 'prj_1',
    environmentId: ENVIRONMENT,
    environmentName: 'production',
    ruleName: 'too many errors',
    state: 'firing',
    measured: 99,
    threshold: 50,
    window: '5m',
    query: 'level:error',
    type: 'threshold',
    channels: ['ch_01JBQ8R4T7V2WXYZ0123456789'],
    changedAt: Date.UTC(2026, 10, 4, 12, 0, 0),
    ...overrides,
  }
}

describe('the locales', () => {
  it('are the three the channel column allows, falling back to English', () => {
    expect([...ALERT_LOCALES]).toEqual(['en', 'pt-BR', 'es'])
    expect(DEFAULT_ALERT_LOCALE).toBe('en')
    expect(alertLocaleFor('es')).toBe('es')
    expect(alertLocaleFor('de')).toBe('en')
  })

  it('writes a different message in each one', () => {
    const texts = ALERT_LOCALES.map((locale) => alertMessage(alert(), DASHBOARD, locale).text)

    expect(new Set(texts).size).toBe(ALERT_LOCALES.length)
  })

  it('leaves no English label inside a translation', () => {
    for (const locale of ['pt-BR', 'es'] as const) {
      const message = alertMessage(alert(), DASHBOARD, locale)

      expect(message.text).not.toContain('Environment:')
      expect(message.text).not.toContain('Measured:')
      expect(message.text).not.toContain('Open in the Explorer')
    }
  })

  it('gives every rule type its own phrase, in every locale', () => {
    const types = ['threshold', 'error_rate', 'new_issue', 'issue_regression', 'absence']

    for (const locale of ALERT_LOCALES) {
      const subjects = types.map((type) => alertMessage(alert({ type }), DASHBOARD, locale).subject)

      expect(new Set(subjects).size).toBe(types.length)
    }
  })

  it('never leaks the raw enum name into what a person reads', () => {
    for (const locale of ALERT_LOCALES) {
      for (const type of ['error_rate', 'new_issue', 'issue_regression']) {
        expect(alertMessage(alert({ type }), DASHBOARD, locale).subject).not.toContain(type)
      }
    }
  })

  it('falls back to the raw name rather than writing undefined for a type it never met', () => {
    const subject = alertMessage(alert({ type: 'something_new' }), DASHBOARD, 'en').subject

    expect(subject).toContain('something_new')
    expect(subject).not.toContain('undefined')
  })
})

describe('the link', () => {
  it('points at the Explorer with the environment, the window and the search', () => {
    const url = explorerUrl(DASHBOARD, alert())

    expect(url.startsWith(`${DASHBOARD}/explorer?`)).toBe(true)
    expect(url).toContain(`env=${ENVIRONMENT}`)
    expect(url).toContain('window=5m')
    expect(url).toContain('q=level%3Aerror')
  })

  it('leaves the search out when the rule has none', () => {
    expect(explorerUrl(DASHBOARD, alert({ query: '' }))).not.toContain('q=')
  })

  it('escapes whatever the reader put in the search', () => {
    const url = explorerUrl(DASHBOARD, alert({ query: 'a&b="c"' }))

    expect(url).not.toContain('&b=')
    expect(url).toContain(encodeURIComponent('a&b="c"'))
  })

  it('refuses a base that is not an https address', () => {
    for (const base of ['http://app.nekolog.io', 'javascript:alert(1)', 'app.nekolog.io', '']) {
      expect(() => explorerUrl(base, alert())).toThrow(/Refusing/)
    }
  })

  it('refuses an environment id that is not one of ours', () => {
    for (const environmentId of ['../../admin', 'env_short', '"><script>', '']) {
      expect(() => explorerUrl(DASHBOARD, alert({ environmentId }))).toThrow(/Refusing/)
    }
  })

  it('does not double the slash when the base carries one', () => {
    expect(explorerUrl(`${DASHBOARD}///`, alert())).toContain(`${DASHBOARD}/explorer?`)
  })
})

describe('escaping', () => {
  it('turns every character that could open a tag or close an attribute', () => {
    expect(escapeHtml(`<a href="x" title='y'>&`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;',
    )
  })
})

describe('the message', () => {
  it('says whether the alert fired or resolved', () => {
    expect(alertMessage(alert(), DASHBOARD, 'en').subject).toContain('Alert firing')
    expect(alertMessage(alert({ state: 'ok' }), DASHBOARD, 'en').subject).toContain(
      'Alert resolved',
    )
  })

  it('carries the measured value and the threshold, as specification 6 asks', () => {
    const message = alertMessage(alert(), DASHBOARD, 'en')

    expect(message.text).toContain('99')
    expect(message.text).toContain('50')
    expect(message.text).toContain('production')
  })

  it('leaves the threshold out of a rule that has none', () => {
    const message = alertMessage(
      alert({ type: 'new_issue', threshold: null, measured: 2 }),
      DASHBOARD,
      'en',
    )

    expect(message.lines.map(([label]) => label)).not.toContain('Threshold')
  })

  it('rounds a rate instead of printing every digit of a division', () => {
    const message = alertMessage(alert({ measured: 33.333333333 }), DASHBOARD, 'en')

    expect(message.text).toContain('33.33')
    expect(message.text).not.toContain('33.333333')
  })

  it('escapes a rule name somebody chose, in the html part', () => {
    const message = alertMessage(alert({ ruleName: '<script>alert(1)</script>' }), DASHBOARD, 'en')

    expect(message.html).not.toContain('<script>')
    expect(message.html).toContain('&lt;script&gt;')
  })

  it('writes a whole html document and a plain text part', () => {
    const message = alertMessage(alert(), DASHBOARD, 'en')

    expect(message.html.startsWith('<!doctype html>')).toBe(true)
    expect(message.text.length).toBeGreaterThan(0)
    expect(message.url).toContain('/explorer')
  })
})
