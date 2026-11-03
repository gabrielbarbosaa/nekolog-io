import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

export const DOCS_ORIGIN = process.env.DOCS_ORIGIN ?? 'https://docs.nekolog.io'

const nextConfig: NextConfig = {
  transpilePackages: ['@internal/security-headers'],
  async rewrites() {
    return [{ source: '/docs/:path*', destination: `${DOCS_ORIGIN}/docs/:path*` }]
  },
}

export default withNextIntl(nextConfig)
