import type { InitOptions } from '@nekolog-io/browser'
import type { Logger } from '@nekolog-io/core'
import type { ReactElement, ReactNode } from 'react'
import { nekologClient } from './client.ts'
import { LoggerContext } from './context.ts'

export type NekologProviderProps = InitOptions & {
  children?: ReactNode
  logger?: Logger
}

export function NekologProvider(props: NekologProviderProps): ReactElement {
  const { children, logger, ...options } = props
  const value = logger ?? nekologClient(options).logger

  return <LoggerContext.Provider value={value}>{children}</LoggerContext.Provider>
}
