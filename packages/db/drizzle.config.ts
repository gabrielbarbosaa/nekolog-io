import { defineConfig } from 'drizzle-kit'

const MISSING = 'postgres://set-DATABASE_URL-first@localhost:5432/nekolog'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/index.ts',
  out: './migrations',
  strict: true,
  verbose: true,
  dbCredentials: { url: process.env.DATABASE_URL || MISSING },
})
