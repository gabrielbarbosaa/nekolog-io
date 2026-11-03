import type { ReactElement, ReactNode } from 'react'
import { Providers } from './providers'

export const metadata = { title: 'NekoLog no Next' }

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="pt-BR">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
