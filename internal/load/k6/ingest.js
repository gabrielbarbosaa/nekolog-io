import { check } from 'k6'
import http from 'k6/http'
import { Counter, Rate } from 'k6/metrics'

const BODY = open('./fixtures/ingest-batch.json')
const EVENTS = Number(__ENV.EVENTS)
const BASE = __ENV.TARGET_URL
const KEY = __ENV.NEKOLOG_KEY
const FIXTURE_BATCH_ID = __ENV.FIXTURE_BATCH_ID

function hex(digits) {
  let out = ''
  while (out.length < digits) {
    out += Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, '0')
  }
  return out.slice(0, digits)
}

function freshBatchId() {
  const stamp = Date.now().toString(16).padStart(12, '0').slice(-12)
  const variant = '89ab'[Math.floor(Math.random() * 4)]
  return `${stamp.slice(0, 8)}-${stamp.slice(8, 12)}-7${hex(3)}-${variant}${hex(3)}-${hex(12)}`
}

const accepted = new Counter('events_accepted')
const rateLimited = new Counter('events_rate_limited')
const admitted = new Rate('batches_admitted')

export const options = {
  vus: Number(__ENV.VUS),
  duration: __ENV.DURATION,
  thresholds: {
    http_req_failed: [`rate<${__ENV.FAILURE_RATE}`],
    'http_req_duration{expected_response:true}': [`p(95)<${__ENV.P95_MS}`],
    checks: [`rate>${__ENV.CHECK_RATE}`],
  },
}

export default function run() {
  const body = BODY.replace(FIXTURE_BATCH_ID, freshBatchId())

  const response = http.post(`${BASE}/v1/logs`, body, {
    headers: {
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
    },
    tags: { name: 'POST /v1/logs' },
    responseCallback: http.expectedStatuses(202, 429),
  })

  const ok = check(response, {
    'answers 202 or 429': (one) => one.status === 202 || one.status === 429,
    'a 202 accepts every event': (one) => {
      if (one.status !== 202) {
        return true
      }
      try {
        return JSON.parse(one.body).accepted === EVENTS
      } catch {
        return false
      }
    },
    'a 429 says when to come back': (one) =>
      one.status !== 429 || Number(one.headers['Retry-After']) > 0,
  })

  admitted.add(response.status === 202)

  if (ok && response.status === 202) {
    accepted.add(EVENTS)
  } else if (response.status === 429) {
    rateLimited.add(EVENTS)
  }
}
