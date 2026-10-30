// @ts-check
import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import { SOURCE_LOCALE, starlightLocales } from './locales.mjs'

// English is the source language and lives at the root; the other locales get
// a path prefix (docs/PLANO.md section 13). The locale list lives in
// locales.mjs so the i18n parity test enforces exactly what is configured here.
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
      ],
    }),
  ],
})
