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
      ],
    }),
  ],
})
