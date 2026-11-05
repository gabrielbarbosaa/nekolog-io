import {
  COMMIT_PATTERN,
  ISSUE_STATUSES,
  MAX_ISSUE_ROWS,
  MAX_SOURCE_MAP_BYTES,
  MAX_VERSION_CHARS,
  SOURCE_MAP_HEAD_BYTES,
  SOURCE_MAP_NAME,
} from '@nekolog-io/adapters'
import {
  DEFAULT_HISTOGRAM_BUCKET,
  DEFAULT_SEARCH_ROWS,
  HISTOGRAM_BUCKETS,
  LOG_COLUMNS,
  MAX_SEARCH_ROWS,
} from '@nekolog-io/clickhouse/search'
import { API_ERROR_CODES, STATUS_FOR_CODE } from './errors.ts'
import { MAX_PERIOD_MS } from './period.ts'

export const OPENAPI_VERSION = '3.1.0'

const MAX_PERIOD_DAYS = MAX_PERIOD_MS / (24 * 60 * 60 * 1000)

const errorResponse = (description: string): Record<string, unknown> => ({
  description,
  content: {
    'application/json': { schema: { $ref: '#/components/schemas/Error' } },
  },
})

const moment = (name: string, description: string): Record<string, unknown> => ({
  name,
  in: 'query',
  required: false,
  description,
  schema: { type: 'string' },
  examples: {
    iso: { value: '2026-11-04T12:00:00.000Z' },
    epochMilliseconds: { value: '1793793600000' },
  },
})

const PERIOD = [
  moment('from', `The start of the period, inclusive. Defaults to one hour before \`to\`.`),
  moment('to', 'The end of the period, exclusive. Defaults to now.'),
]

const SEARCH = {
  name: 'q',
  in: 'query',
  required: false,
  description:
    'A search in the NekoLog query language (specification 4). `env:` is refused here: a secret key already names exactly one environment, and the server injects that scope into every query.',
  schema: { type: 'string' },
  example: 'level:error service:api @status>=500 "timeout"',
}

export function openApiDocument(servers: ReadonlyArray<{ url: string; description?: string }>): {
  readonly [key: string]: unknown
} {
  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: 'NekoLog public read API',
      version: '1.0.0',
      summary: 'Search logs, read their histogram and list issues with a secret key.',
      description:
        'Every route is scoped on the server to the project and the environment the key belongs to. A key carries the `logs:read` scope or it reads nothing, and it travels in `Authorization: Bearer`, never in the URL.',
      license: { name: 'MIT', identifier: 'MIT' },
    },
    servers: servers.map((server) => ({ ...server })),
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'logs', description: 'Reading what was ingested.' },
      { name: 'issues', description: 'Errors grouped by fingerprint.' },
      { name: 'releases', description: 'What is deployed, and when it went out.' },
      { name: 'service', description: 'Whether this deployment is up.' },
    ],
    paths: {
      '/health': {
        get: {
          tags: ['service'],
          operationId: 'health',
          summary: 'Answer whether this deployment came up with everything it needs.',
          security: [],
          responses: {
            '200': {
              description: 'The API is up.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['status', 'service', 'version'],
                    properties: {
                      status: { type: 'string', const: 'ok' },
                      service: { type: 'string', const: 'api' },
                      version: { type: 'string', example: '1.0.0' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/openapi.json': {
        get: {
          tags: ['service'],
          operationId: 'openapi',
          summary: 'This document.',
          security: [],
          responses: {
            '200': {
              description: 'The OpenAPI document this deployment serves.',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            '404': errorResponse('This deployment serves no OpenAPI document.'),
          },
        },
      },
      '/v1/logs': {
        get: {
          tags: ['logs'],
          operationId: 'searchLogs',
          summary: 'Search the logs of this key’s environment.',
          description: `At most ${MAX_PERIOD_DAYS} days per request. The rows have no identity of their own, so paginate by narrowing \`to\` to the oldest \`timestamp\` of the page you just read, and drop the rows you have already seen: two rows written in the same millisecond cannot be told apart.`,
          parameters: [
            SEARCH,
            ...PERIOD,
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: {
                type: 'integer',
                minimum: 1,
                maximum: MAX_SEARCH_ROWS,
                default: DEFAULT_SEARCH_ROWS,
              },
            },
            {
              name: 'order',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['newest', 'oldest'], default: 'newest' },
            },
          ],
          responses: {
            '200': {
              description: 'The matching rows.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['logs', 'period', 'limit', 'order'],
                    properties: {
                      logs: { type: 'array', items: { $ref: '#/components/schemas/Log' } },
                      period: { $ref: '#/components/schemas/Period' },
                      limit: { type: 'integer' },
                      order: { type: 'string', enum: ['newest', 'oldest'] },
                    },
                  },
                },
              },
            },
            '400': errorResponse('The search, the period or a count was not usable.'),
            '401': errorResponse('No key, an unknown key, or a key in the URL.'),
            '403': errorResponse('The key does not carry `logs:read`.'),
            '429': errorResponse('Too many requests for this key.'),
            '503': errorResponse('The log store did not answer.'),
          },
        },
      },
      '/v1/histogram': {
        get: {
          tags: ['logs'],
          operationId: 'logHistogram',
          summary: 'Count the matching logs per bucket and per level.',
          parameters: [
            SEARCH,
            ...PERIOD,
            {
              name: 'bucket',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: [...HISTOGRAM_BUCKETS],
                default: DEFAULT_HISTOGRAM_BUCKET,
              },
            },
          ],
          responses: {
            '200': {
              description: 'One row per bucket and level that has any event.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['buckets', 'bucket', 'period'],
                    properties: {
                      buckets: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: ['at', 'level', 'events'],
                          properties: {
                            at: { type: 'string' },
                            level: { type: 'string' },
                            events: { type: 'integer' },
                          },
                        },
                      },
                      bucket: { type: 'string', enum: [...HISTOGRAM_BUCKETS] },
                      period: { $ref: '#/components/schemas/Period' },
                    },
                  },
                },
              },
            },
            '400': errorResponse('The bucket would produce more points than this API returns.'),
            '401': errorResponse('No key, an unknown key, or a key in the URL.'),
            '403': errorResponse('The key does not carry `logs:read`.'),
            '429': errorResponse('Too many requests for this key.'),
            '503': errorResponse('The log store did not answer.'),
          },
        },
      },
      '/v1/issues': {
        get: {
          tags: ['issues'],
          operationId: 'listIssues',
          summary: 'List the issues seen in this key’s environment, most recent first.',
          description:
            'An issue has an id, so this is paginated by cursor: pass back the `nextCursor` of the page you just read. A `null` cursor means there is no further page.',
          parameters: [
            {
              name: 'status',
              in: 'query',
              required: false,
              description: 'Repeatable, or comma-separated. Defaults to every status.',
              schema: { type: 'string', enum: [...ISSUE_STATUSES] },
            },
            moment('since', 'Only issues last seen at or after this moment.'),
            moment('until', 'Only issues last seen before this moment.'),
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, maximum: MAX_ISSUE_ROWS, default: 50 },
            },
            {
              name: 'cursor',
              in: 'query',
              required: false,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'A page of issues.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['issues', 'nextCursor'],
                    properties: {
                      issues: { type: 'array', items: { $ref: '#/components/schemas/Issue' } },
                      nextCursor: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
            '400': errorResponse('An unknown status, an unreadable moment or a foreign cursor.'),
            '401': errorResponse('No key, an unknown key, or a key in the URL.'),
            '403': errorResponse('The key does not carry `logs:read`.'),
            '404': errorResponse('This deployment serves no issues.'),
            '429': errorResponse('Too many requests for this key.'),
          },
        },
      },
      '/v1/releases': {
        post: {
          tags: ['releases'],
          operationId: 'recordRelease',
          summary: 'Record that a version went out to this key’s environment.',
          description:
            'The only route here that writes, and it needs a key carrying `logs:write`. It is **idempotent**: sending the same version again returns the row that already exists with `created: false`, keeps the earliest `releasedAt` and never drops a commit it already knows. That is what makes it safe to call from a CI job that reruns.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['version'],
                  properties: {
                    version: { type: 'string', minLength: 1, maxLength: MAX_VERSION_CHARS },
                    commit: {
                      type: ['string', 'null'],
                      pattern: COMMIT_PATTERN.source,
                      description: '7 to 40 lowercase hexadecimal characters, or nothing.',
                    },
                    releasedAt: {
                      type: 'string',
                      description:
                        'When it went out, ISO 8601 or epoch milliseconds. Defaults to now.',
                    },
                  },
                },
                example: { version: '1.4.2', commit: '9f3a1c7' },
              },
            },
          },
          responses: {
            '201': {
              description: 'The release, whether this call created it or found it.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['release', 'created'],
                    properties: {
                      release: { $ref: '#/components/schemas/Release' },
                      created: { type: 'boolean' },
                    },
                  },
                },
              },
            },
            '400': errorResponse('The version, the commit or the moment was not usable.'),
            '401': errorResponse('No key, an unknown key, or a key in the URL.'),
            '403': errorResponse('The key does not carry `logs:write`.'),
            '404': errorResponse('This deployment records no releases.'),
            '413': errorResponse('The body is over 4 KB.'),
            '415': errorResponse('The body was not declared as `application/json`.'),
            '429': errorResponse('Too many requests for this key.'),
          },
        },
      },
      '/v1/sourcemaps': {
        post: {
          tags: ['releases'],
          operationId: 'uploadSourceMap',
          summary: 'Upload one source map against a release that already exists.',
          description: `Needs a key carrying \`logs:write\`. The body is the map itself, at most ${MAX_SOURCE_MAP_BYTES} bytes. The release must have been recorded first, so the count on it stays true. Uploading the same name again replaces it and does not raise the count.\n\nThe shape is checked, not parsed: the first ${SOURCE_MAP_HEAD_BYTES} bytes must open a JSON object and name \`mappings\` or \`sections\`, and a declared \`version\` must be 3. Parsing megabytes of JSON would not fit a Worker's CPU budget, and the map is parsed where it is used.`,
          parameters: [
            {
              name: 'release',
              in: 'query',
              required: true,
              description: 'The version, exactly as it was recorded.',
              schema: { type: 'string' },
              example: '1.4.2',
            },
            {
              name: 'name',
              in: 'query',
              required: true,
              description:
                'The file name, one segment ending in `.map`. No directories: a name carrying a slash, a backslash or `..` is refused.',
              schema: { type: 'string', pattern: SOURCE_MAP_NAME.source },
              example: 'app.js.map',
            },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          responses: {
            '201': {
              description: 'The map was stored, with the release’s new count.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['sourceMap', 'release'],
                    properties: {
                      sourceMap: {
                        type: 'object',
                        required: ['name', 'bytes'],
                        properties: {
                          name: { type: 'string' },
                          bytes: { type: 'integer' },
                        },
                      },
                      release: {
                        type: 'object',
                        required: ['id', 'version', 'sourcemapCount'],
                        properties: {
                          id: { type: 'string' },
                          version: { type: 'string' },
                          sourcemapCount: { type: 'integer' },
                        },
                      },
                    },
                  },
                },
              },
            },
            '400': errorResponse('The name, the release or the body was not usable.'),
            '401': errorResponse('No key, an unknown key, or a key in the URL.'),
            '403': errorResponse('The key does not carry `logs:write`.'),
            '404': errorResponse('No such release here, or this deployment stores no source maps.'),
            '413': errorResponse(`The map is over ${MAX_SOURCE_MAP_BYTES} bytes.`),
            '429': errorResponse('Too many requests for this key.'),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'A secret key, `nekolog_sk_…`, carrying the `logs:read` scope. A public key is refused: it is published to browsers.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message', 'retryAfter'],
              properties: {
                code: { type: 'string', enum: [...API_ERROR_CODES] },
                message: { type: 'string' },
                retryAfter: { type: ['integer', 'null'] },
              },
            },
          },
        },
        Period: {
          type: 'object',
          required: ['from', 'to'],
          properties: {
            from: { type: 'string', format: 'date-time' },
            to: { type: 'string', format: 'date-time' },
          },
        },
        Log: {
          type: 'object',
          description: 'One row of the logs table, with the column names ClickHouse returns.',
          properties: Object.fromEntries(
            LOG_COLUMNS.map((column) => [
              column,
              column === 'attributes'
                ? { type: 'object', additionalProperties: { type: 'string' } }
                : { type: 'string' },
            ]),
          ),
        },
        Release: {
          type: 'object',
          required: [
            'id',
            'projectId',
            'environmentId',
            'version',
            'commit',
            'sourcemapCount',
            'releasedAt',
            'createdAt',
          ],
          properties: {
            id: { type: 'string' },
            projectId: { type: 'string' },
            environmentId: { type: 'string' },
            version: { type: 'string' },
            commit: { type: ['string', 'null'] },
            sourcemapCount: { type: 'integer' },
            releasedAt: { type: 'string', format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Issue: {
          type: 'object',
          required: [
            'id',
            'fingerprint',
            'status',
            'title',
            'errorType',
            'service',
            'events',
            'firstSeen',
            'lastSeen',
            'resolvedAt',
            'regressedAt',
          ],
          properties: {
            id: { type: 'string' },
            fingerprint: {
              type: 'string',
              description:
                'A decimal string, never a number: it is a UInt64 and does not fit in a JavaScript number.',
            },
            status: { type: 'string', enum: [...ISSUE_STATUSES] },
            title: { type: 'string' },
            errorType: { type: 'string' },
            service: { type: 'string' },
            events: { type: 'integer' },
            firstSeen: { type: 'string', format: 'date-time' },
            lastSeen: { type: 'string', format: 'date-time' },
            resolvedAt: { type: ['string', 'null'], format: 'date-time' },
            regressedAt: { type: ['string', 'null'], format: 'date-time' },
          },
        },
      },
    },
    'x-nekolog-error-status': { ...STATUS_FOR_CODE },
  }
}
