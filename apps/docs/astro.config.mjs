// @ts-check
import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import { SOURCE_LOCALE, starlightLocales } from './locales.mjs'

export default defineConfig({
  site: 'https://nekolog.io',
  base: '/docs',
  integrations: [
    starlight({
      title: 'NekoLog',
      defaultLocale: SOURCE_LOCALE.key,
      locales: starlightLocales,
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/gabrielbarbosaa/nekolog-io',
        },
      ],
      sidebar: [
        {
          label: 'Start here',
          translations: { 'pt-BR': 'Comece aqui', es: 'Empieza aquí' },
          items: [{ slug: 'getting-started/introduction' }, { slug: 'getting-started/quickstart' }],
        },
        {
          label: 'Guides',
          translations: { 'pt-BR': 'Guias', es: 'Guías' },
          items: [
            { slug: 'guides/cli' },
            { slug: 'guides/bundler-plugin' },
            { slug: 'guides/browser' },
            { slug: 'guides/react' },
            { slug: 'guides/next' },
            { slug: 'guides/node' },
            { slug: 'guides/express' },
            { slug: 'guides/fastify' },
            { slug: 'guides/hono' },
            { slug: 'guides/nestjs' },
            { slug: 'guides/pino' },
            { slug: 'guides/winston' },
            { slug: 'guides/tracing' },
            { slug: 'guides/alerts' },
          ],
        },
        {
          label: 'API',
          translations: { 'pt-BR': 'API', es: 'API' },
          items: [{ slug: 'api/reference' }, { slug: 'api/search' }, { slug: 'api/otlp' }],
        },
        {
          label: 'Reference',
          translations: { 'pt-BR': 'Referência', es: 'Referencia' },
          items: [{ slug: 'reference/privacy' }, { slug: 'reference/versioning' }],
        },
        {
          label: 'Run it yourself',
          translations: { 'pt-BR': 'Rodar por conta própria', es: 'Ejecutarlo por tu cuenta' },
          items: [{ slug: 'self-host/install' }],
        },
      ],
    }),
  ],
})
