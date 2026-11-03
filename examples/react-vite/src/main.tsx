import { NekologProvider } from '@nekolog-io/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'

const root = document.getElementById('root')
if (root === null) {
  throw new Error('index.html has no #root to render into')
}

createRoot(root).render(
  <StrictMode>
    <NekologProvider
      apiKey={import.meta.env.VITE_NEKOLOG_KEY}
      service="example-react-vite"
      release={import.meta.env.VITE_NEKOLOG_RELEASE}
      transport={{ endpoint: import.meta.env.VITE_NEKOLOG_ENDPOINT }}
      trace={{ targets: [import.meta.env.VITE_API_ORIGIN ?? ''] }}
    >
      <App />
    </NekologProvider>
  </StrictMode>,
)
