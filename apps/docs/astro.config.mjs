// @ts-check
import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'

// English is the source language and lives at the root; the other locales get
// a path prefix (docs/PLANO.md section 13).
export default defineConfig({
  site: 'https://nekolog.io',
  base: '/docs',
  integrations: [
    starlight({
      title: 'NekoLog',
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        'pt-br': { label: 'Português', lang: 'pt-BR' },
        es: { label: 'Español', lang: 'es' },
      },
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
