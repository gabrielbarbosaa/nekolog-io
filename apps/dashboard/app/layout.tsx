import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { ThemeProvider } from 'next-themes'
import type { ReactNode } from 'react'
import { NONCE_HEADER } from '@/lib/nonce'
import './globals.css'

export const metadata: Metadata = {
  title: 'NekoLog',
  description: 'Read what your applications logged.',
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale()
  const messages = await getMessages()
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined

  return (
    <html
      lang={locale}
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem nonce={nonce}>
          <NextIntlClientProvider locale={locale} messages={messages}>
            {children}
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
