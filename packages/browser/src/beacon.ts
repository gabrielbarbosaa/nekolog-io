import { type FetchLike, type FetchResponseLike, utf8ByteLength } from '@nekolog-io/core'
import { pageIsHiding } from './hidden.ts'

export const KEY_QUERY_PARAM = 'key'
export const BEACON_MAX_BYTES: number = 60 * 1024

export type SendBeaconLike = (url: string, body: string) => boolean

export type SenderOptions = {
  apiKey: string
  fetch?: FetchLike
  sendBeacon?: SendBeaconLike | false
  hiding?: () => boolean
}

const QUEUED: FetchResponseLike = {
  ok: true,
  status: 202,
  headers: { get: () => null },
  text: () => Promise.resolve(''),
}

export function keyedUrl(url: string, apiKey: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${KEY_QUERY_PARAM}=${encodeURIComponent(apiKey)}`
}

function globalFetch(): FetchLike | undefined {
  return (globalThis as { fetch?: FetchLike }).fetch
}

function globalSendBeacon(): SendBeaconLike | undefined {
  const navigator = (globalThis as { navigator?: { sendBeacon?: SendBeaconLike } }).navigator
  const send = navigator?.sendBeacon
  return typeof send === 'function' ? (url, body) => send.call(navigator, url, body) : undefined
}

export function createSender(options: SenderOptions): FetchLike {
  const hiding = options.hiding ?? pageIsHiding

  return async (url, init) => {
    const beacon =
      options.sendBeacon === false ? undefined : (options.sendBeacon ?? globalSendBeacon())

    if (beacon !== undefined && hiding() && utf8ByteLength(init.body) <= BEACON_MAX_BYTES) {
      let queued = false
      try {
        queued = beacon(keyedUrl(url, options.apiKey), init.body)
      } catch {
        queued = false
      }
      if (queued) {
        return QUEUED
      }
    }

    const send = options.fetch ?? globalFetch()
    if (send === undefined) {
      throw new Error('This runtime has no fetch, so nekolog cannot send anything')
    }
    return send(url, { ...init, keepalive: true })
  }
}
