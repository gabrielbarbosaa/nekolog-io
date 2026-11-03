import type { ReactNode } from 'react'

export type Rendered = {
  container: HTMLElement
  unmount: () => void
  html: () => string
}

export async function render(node: ReactNode): Promise<Rendered> {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(node)
  })

  return {
    container,
    html: () => container.innerHTML,
    unmount: () => {
      void act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}
