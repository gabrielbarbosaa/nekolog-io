import type { AlertState, AlertWindow } from './alert-rule.ts'

export const ALERT_CHANNEL_KINDS = ['email', 'slack', 'discord', 'webhook'] as const
export type AlertChannelKind = (typeof ALERT_CHANNEL_KINDS)[number]

export const MAX_ALERT_CHANNELS_PER_PROJECT = 20
export const ALERT_LOCALES = ['en', 'pt-BR', 'es'] as const
export type AlertLocale = (typeof ALERT_LOCALES)[number]

export interface AlertChannel {
  id: string
  projectId: string
  name: string
  kind: AlertChannelKind
  target: string
  sealedSecret: string | null
  locale: string
}

export interface PendingAlert {
  ruleId: string
  projectId: string
  environmentId: string
  environmentName: string
  ruleName: string
  state: AlertState
  measured: number
  threshold: number | null
  window: AlertWindow
  query: string
  type: string
  channels: readonly string[]
  changedAt: number
}

export interface AlertChannelStore {
  byIds(projectId: string, ids: readonly string[]): Promise<ReadonlyArray<AlertChannel>>
}

export interface AlertNoticeStore {
  awaitingNotice(limit: number): Promise<ReadonlyArray<PendingAlert>>
  markNotified(ruleId: string, at: number, forChangeAt: number): Promise<void>
}
