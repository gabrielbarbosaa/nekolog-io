interface ImportMetaEnv {
  readonly VITE_NEKOLOG_KEY?: string
  readonly VITE_NEKOLOG_ENDPOINT?: string
  readonly VITE_NEKOLOG_RELEASE?: string
  readonly VITE_API_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
