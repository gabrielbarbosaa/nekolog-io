import { sanitiseEvent } from './event.ts'
import { createKeyMatcher, type RedactionPolicy, scrubEvent, toGlobalPattern } from './redact.ts'
import {
  normaliseAlwaysSampleFrom,
  normaliseSampleRate,
  type SamplingPolicy,
  shouldSample,
} from './sampling.ts'
import type { BeforeSend, LogEvent, LoggerOptions } from './types.ts'

export const BEFORE_SEND_NO_RETURN =
  'beforeSend returned nothing, so the log was dropped. Return the event to keep it, or null to drop it on purpose.'

export const BEFORE_SEND_NOT_AN_EVENT =
  'beforeSend returned something that is not a valid log event, so the log was dropped.'

export function samplingPolicyFrom(options: LoggerOptions): SamplingPolicy {
  return {
    rate: normaliseSampleRate(options.sampling?.rate),
    alwaysFrom: normaliseAlwaysSampleFrom(options.sampling?.alwaysFrom),
  }
}

export function redactionPolicyFrom(options: LoggerOptions): RedactionPolicy | null {
  const privacy = options.privacy
  if (privacy?.enabled === false) {
    return null
  }
  return {
    matchesKey: createKeyMatcher(privacy?.extraKeys ?? [], privacy?.skipKeys ?? []),
    patterns: (privacy?.extraPatterns ?? [])
      .filter((pattern): pattern is RegExp => pattern instanceof RegExp)
      .map(toGlobalPattern),
    scrubText: privacy?.scrubText !== false,
  }
}

export type PipelineOptions = {
  sampling: SamplingPolicy
  redaction: RedactionPolicy | null
  beforeSend?: BeforeSend
  random: () => number
  onError: (error: unknown) => void
}

export type Pipeline = (event: LogEvent) => LogEvent | null

export function createPipeline(options: PipelineOptions): Pipeline {
  const { sampling, redaction, beforeSend, random, onError } = options
  let warned = false

  const warnOnce = (message: string): null => {
    if (!warned) {
      warned = true
      onError(new Error(message))
    }
    return null
  }

  const runBeforeSend = (hook: BeforeSend, event: LogEvent): LogEvent | null => {
    let returned: unknown
    try {
      returned = hook(event)
    } catch (error) {
      onError(error)
      return null
    }

    if (returned === null || returned === false) {
      return null
    }
    if (returned === undefined) {
      return warnOnce(BEFORE_SEND_NO_RETURN)
    }
    if (typeof returned !== 'object') {
      return warnOnce(BEFORE_SEND_NOT_AN_EVENT)
    }

    return sanitiseEvent(returned, event) ?? warnOnce(BEFORE_SEND_NOT_AN_EVENT)
  }

  return (event) => {
    if (!shouldSample(sampling, event.level, event.trace?.traceId, random)) {
      return null
    }

    const kept = beforeSend === undefined ? event : runBeforeSend(beforeSend, event)
    if (kept === null) {
      return null
    }

    return redaction === null ? kept : scrubEvent(kept, redaction)
  }
}
