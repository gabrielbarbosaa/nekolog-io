---
title: React
description: Provider, useLogger y un error boundary que reporta lo que se rompió.
---

```bash
npm install @nekolog-io/react
```

```tsx
import { ErrorBoundary, NekologProvider, useLogger } from '@nekolog-io/react'

export function App() {
  return (
    <NekologProvider apiKey={import.meta.env.VITE_NEKOLOG_KEY} service="checkout-web">
      <ErrorBoundary name="checkout" fallback={<p>Algo salió mal.</p>}>
        <Checkout />
      </ErrorBoundary>
    </NekologProvider>
  )
}

function Checkout() {
  const log = useLogger()
  log.info('Checkout abierto', { step: 'payment' })
}
```

Todo lo de la [guía del navegador](/docs/es/guides/browser/) vale aquí: sesión,
breadcrumbs, cola sin conexión, `traceparent`, `setUser`, el vaciado en
`pagehide`. Este paquete solo añade lo que es de React.

## Un SDK por página, no uno por provider

`NekologProvider` no crea un cliente por montaje: toma el cliente de la página,
que existe una sola vez. Dos providers anidados, el modo estricto de React
renderizando todo dos veces, una ruta que se desmonta y se vuelve a montar — en
todos esos casos es el mismo cliente, con los mismos manejadores globales
instalados una sola vez.

Por eso desmontar el provider **no cierra nada**. La página sigue siendo la
página, y los manejadores de error global y el vaciado en `pagehide` siguen
vigentes. Quien quiera cerrar de verdad llama a `closeClient()`, que es lo que
hacen las pruebas entre un caso y otro.

```tsx
<NekologProvider logger={miLogger}>…</NekologProvider>
```

Con la prop `logger` el provider usa el que le pases y no crea ningún cliente.
Es el camino para las pruebas, y para quien ya monta el logger en otro sitio.

## `useLogger` fuera de un provider no tumba la app

Devuelve un logger que escribe en la consola y **avisa una vez** por `onError`.
La convención de React sería lanzar una excepción; el contrato de este SDK es
no lanzar nunca en la app de quien lo usa, y un provider olvidado no puede ser
el motivo de que una página en producción quede en blanco. El aviso es
suficientemente alto.

## `ErrorBoundary`

| | |
|---|---|
| `fallback` | qué renderizar en su lugar — un nodo, o una función `({ error, reset })` |
| `name` | va en el atributo `react.boundary`, para saber qué parte de la pantalla cayó |
| `onError` | tu propio manejador, que **siempre** se ejecuta, aunque el log falle |

El error se convierte en un log `error` con `react.component_stack` — la pila de
componentes que React entrega, cortada en 2000 caracteres para que una sola pila
no se coma todo el presupuesto de atributo. Sin `fallback` no renderiza nada, en
vez de dejar que React tire abajo el árbol entero.

```tsx
export default withErrorBoundary(Checkout, { fallback: <Ups /> })
```

## React Server Components

`useLogger` y `NekologProvider` son componentes de cliente: usan contexto y
estado de página. En una app con Server Components, marca el archivo con
`'use client'`. Para el lado del servidor, usa
[`@nekolog-io/next`](/docs/es/guides/next/), que conecta el logger por
`instrumentation.ts`.
