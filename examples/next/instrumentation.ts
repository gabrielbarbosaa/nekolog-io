import { type RegisterOptions, register as startNekolog } from '@nekolog-io/next'

export const options: RegisterOptions = {
  service: 'example-next',
  privacy: { extraKeys: ['email'] },
}

export function register(): void {
  startNekolog(options)
}

export { onRequestError } from '@nekolog-io/next'
