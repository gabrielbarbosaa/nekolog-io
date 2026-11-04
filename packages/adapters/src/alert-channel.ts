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
  cooldownMinutes: number
  lastFiringNoticeAt: number | null
}

export const ALERT_SUPPRESSIONS = ['cooldown', 'no_channel'] as const
export type AlertSuppression = (typeof ALERT_SUPPRESSIONS)[number]

export const ALERT_HISTORY_DAYS = 90
export const MAX_PRUNED_EVENTS_PER_RUN = 500

export interface NoticeOutcome {
  notifiedAt: number | null
  channelsSent: number
  suppressed: AlertSuppression | null
}

export interface AlertChannelStore {
  byIds(projectId: string, ids: readonly string[]): Promise<ReadonlyArray<AlertChannel>>
}

export interface AlertNoticeStore {
  awaitingNotice(limit: number): Promise<ReadonlyArray<PendingAlert>>
  markNotified(ruleId: string, at: number, forChangeAt: number): Promise<void>
  recordOutcome(ruleId: string, changedAt: number, outcome: NoticeOutcome): Promise<void>
  prune(before: number, limit: number): Promise<number>
}
