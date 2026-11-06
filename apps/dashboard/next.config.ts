import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const nextConfig: NextConfig = {
  ...(process.env.NEXT_STANDALONE === '1' ? { output: 'standalone' as const } : {}),
  transpilePackages: ['@internal/security-headers'],
}

export default withNextIntl(nextConfig)
