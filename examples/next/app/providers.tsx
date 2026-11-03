'use client'

import { ErrorBoundary, NekologProvider } from '@nekolog-io/next/client'
import type { ReactElement, ReactNode } from 'react'

export function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <NekologProvider
      apiKey={process.env.NEXT_PUBLIC_NEKOLOG_KEY}
      service="example-next"
      transport={{ endpoint: process.env.NEXT_PUBLIC_NEKOLOG_ENDPOINT }}
    >
      <ErrorBoundary name="app" fallback={<p>Algo deu errado.</p>}>
        {children}
      </ErrorBoundary>
    </NekologProvider>
  )
}
