import { check } from 'k6'
import http from 'k6/http'
import { Rate } from 'k6/metrics'

const BASE = __ENV.TARGET_URL
const KEY = __ENV.NEKOLOG_KEY

const admitted = new Rate('requests_admitted')

const ROUTES = [
  { name: 'GET /v1/logs', path: '/v1/logs?limit=100' },
  { name: 'GET /v1/logs?q', path: '/v1/logs?limit=100&q=level%3Aerror' },
  { name: 'GET /v1/histogram', path: '/v1/histogram?bucket=15m' },
  { name: 'GET /v1/issues', path: '/v1/issues?limit=50' },
]

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
  for (const route of ROUTES) {
    const response = http.get(`${BASE}${route.path}`, {
      headers: { authorization: `Bearer ${KEY}`, accept: 'application/json' },
      tags: { name: route.name },
      responseCallback: http.expectedStatuses(200, 429),
    })

    admitted.add(response.status === 200)

    check(response, {
      'answers 200 or 429': (one) => one.status === 200 || one.status === 429,
      'answers json': (one) => {
        try {
          return typeof JSON.parse(one.body) === 'object'
        } catch {
          return false
        }
      },
      'a 429 says when to come back': (one) =>
        one.status !== 429 || Number(one.headers['Retry-After']) > 0,
    })
  }
}
