export type HttpError = Error & { status: number }

export function httpError(status: number, message: string): HttpError {
  const error = new Error(message) as HttpError
  error.status = status
  return error
}

export function statusOf(error: unknown): number {
  const status = (error as { status?: unknown } | null | undefined)?.status
  if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599) {
    return status
  }
  return 500
}

export function publicMessageOf(error: unknown, status: number): string {
  if (status >= 500) {
    return 'Internal Server Error'
  }
  const message = (error as { message?: unknown } | null | undefined)?.message
  return typeof message === 'string' && message !== '' ? message : 'Bad Request'
}
