import { defineCollection } from 'astro:content'
import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders'
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema'

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  // Starlight ships its own UI strings for en, pt-BR, and es. This collection
  // only needs entries in src/content/i18n/ when we want to override one.
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
}
