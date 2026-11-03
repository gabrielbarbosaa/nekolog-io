# examples/react-vite

Uma SPA de React com Vite usando o
[`@nekolog-io/react`](../../packages/react/README.md): provider,
`useLogger`, `ErrorBoundary`, `setUser` e um breadcrumb escrito à mão.

```bash
pnpm --filter @examples/react-vite dev
```

As variáveis vêm do Vite, com o prefixo que ele exige para chegar ao bundle:

| | |
|---|---|
| `VITE_NEKOLOG_KEY` | a key **pública** do ambiente |
| `VITE_NEKOLOG_ENDPOINT` | onde está a ingestão |
| `VITE_API_ORIGIN` | o domínio que recebe o `traceparent` |

A key vai no bundle, que é público — é por isso que só a `nekolog_pk_` serve
aqui, e o SDK recusa a secreta em vez de mandar.

## O que o teste cobre, e o que não cobre

O teste renderiza o app com React de verdade, clica nos botões de verdade e
confere o que foi logado: o login, o cupom com o código como atributo, e o
componente que quebra caindo no `ErrorBoundary` com `react.boundary=checkout`.

O que ele **não** cobre é o browser: `pagehide`, `sendBeacon`, IndexedDB e o
`traceparent` numa request real só aparecem num Chromium, num Firefox e num
WebKit. Isso é a matriz da etapa 3.12, e é onde este exemplo vira e2e de
verdade.
