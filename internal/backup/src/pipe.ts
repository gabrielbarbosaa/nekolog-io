import { spawn } from 'node:child_process'
import type { Command } from './commands.ts'
import { BackupRefused } from './plan.ts'

export const MAX_STDERR_CHARS = 2000

export type PipelineResult = {
  stdout: string
  stderr: string
}

export type PipelineOptions = {
  signal?: AbortSignal
  cwd?: string
}

export type StepFailure = {
  step: string
  code: number | null
  stderr: string
}

export function describeFailures(failures: readonly StepFailure[]): string {
  return failures
    .map(
      (one) =>
        `"${one.step}" exited ${one.code === null ? 'without a code' : String(one.code)}` +
        (one.stderr.trim() === '' ? '' : `: ${one.stderr.trim()}`),
    )
    .join('; ')
}

export class PipelineFailed extends Error {
  readonly failures: readonly StepFailure[]

  constructor(failures: readonly StepFailure[]) {
    super(describeFailures(failures))
    this.name = 'PipelineFailed'
    this.failures = failures
  }
}

function tail(text: string): string {
  return text.length > MAX_STDERR_CHARS ? text.slice(-MAX_STDERR_CHARS) : text
}

export async function runPipeline(
  steps: readonly Command[],
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  if (steps.length === 0) {
    throw new BackupRefused('there is nothing to run')
  }

  const children = steps.map((step) =>
    spawn(step.file, step.args, {
      shell: false,
      env: { ...process.env, ...step.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    }),
  )

  const errors = children.map(() => '')
  let output = ''

  const stop = (): void => {
    for (const child of children) {
      child.kill('SIGTERM')
    }
  }

  options.signal?.addEventListener('abort', stop, { once: true })

  children.forEach((child, index) => {
    child.stderr?.on('data', (chunk: Buffer) => {
      errors[index] = tail((errors[index] ?? '') + chunk.toString('utf8'))
    })
    child.stdin?.on('error', () => undefined)

    const next = children[index + 1]
    if (next === undefined) {
      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8')
      })
    } else {
      child.stdout?.pipe(next.stdin as NodeJS.WritableStream)
    }
  })

  children[0]?.stdin?.end()

  const finished = children.map(
    (child, index) =>
      new Promise<StepFailure | null>((resolve) => {
        const step = steps[index]?.file ?? 'a step'
        child.on('error', (error) => {
          stop()
          resolve({ step, code: null, stderr: error.message })
        })
        child.on('close', (code) => {
          if (code === 0) {
            resolve(null)
            return
          }
          stop()
          resolve({ step, code, stderr: errors[index] ?? '' })
        })
      }),
  )

  let settled: Array<StepFailure | null>
  try {
    settled = await Promise.all(finished)
  } finally {
    options.signal?.removeEventListener('abort', stop)
  }

  const failures = settled.filter((one): one is StepFailure => one !== null)
  if (failures.length > 0) {
    throw new PipelineFailed(failures)
  }

  return { stdout: output, stderr: errors.join('') }
}
