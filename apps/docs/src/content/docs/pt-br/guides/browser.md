---
title: Browser
description: Instale o SDK de browser, pegue os erros que ninguém pegou e mantenha dado de usuário fora do log.
---

:::caution[Ainda não está no npm]
Os pacotes `@nekolog-io/*` ainda não foram publicados. Esta página descreve o
comportamento que o código já tem, para a forma da API ficar clara.
:::

```bash
npm install @nekolog-io/browser
```

```ts
import { init } from '@nekolog-io/browser'

const nekolog = init({
  apiKey: import.meta.env.VITE_NEKOLOG_KEY,
  service: 'checkout-web',
  release: '1.4.2',
})

nekolog.logger.info('Checkout aberto', { step: 'payment' })
```

O `init` faz quatro coisas de uma vez: cria o logger, instala os dois handlers
globais, instala os coletores de breadcrumb e dá flush no lote quando a página
vai embora. Cada peça também é exportada separadamente (`createLogger`,
`installGlobalHandlers`, `installFlushOnHide`, `installBreadcrumbs`), e cada
`install*` devolve a função que desfaz.

## Use a key pública

Uma `nekolog_sk_…` numa página é uma credencial publicada — qualquer pessoa com
o "ver código-fonte" tem ela. O SDK **recusa**, avisa pelo `onError`, cai no
console e não manda nada. Ele não joga exceção: derrubar a aplicação de quem
configurou errado é pior do que não mandar log.

Use a `nekolog_pk_…` do ambiente. É ela que diz projeto e ambiente, e ela só
escreve.

## O que você ganha sem escrever código

| Evento | Vira |
|---|---|
| `error` na `window` | log `error` com `error.kind=uncaught`, mais origem, linha e coluna |
| `unhandledrejection` | log `error` com `error.kind=unhandledrejection` |
| um clique | breadcrumb — `button#pay`, nunca o texto do elemento |
| uma navegação | breadcrumb com o endereço novo e o anterior |
| um `fetch` | breadcrumb com método, endereço, status e duração |

O browser continua reportando por conta dele: instalamos listener, nunca
trocamos o `window.onerror`, e nunca chamamos `preventDefault()`.

Os breadcrumbs ficam na memória — uma fila de 20 — e viajam **só com log de
`error` e `fatal`**, como um único atributo de 4 KB. Grudar 4 KB em cada uma das
500 linhas de um lote daria um lote que a ingestão recusa inteiro.

```ts
init({ breadcrumbs: { attachFrom: 'info', max: 40 } })
init({ breadcrumbs: false })
```

## A sessão, e quem é o usuário

Cada aba tem uma sessão: um UUID no `sessionStorage`, que recomeça depois de 30
minutos sem log e sobrevive a um reload.

```ts
nekolog.setUser('u_42')   // depois do login
nekolog.setUser(null)     // depois do logout
nekolog.resetSession()    // no logout também
```

O `setUser` aceita um identificador e mais nada. **Não existe onde colocar nome
ou e-mail**, de propósito: o dashboard não precisa deles para agrupar, e um
campo livre de usuário é exatamente por onde dado pessoal vaza para dentro de um
log. Se você precisa de mais, `logger.child({ attributes: … })` passa pelo
filtro de remoção.

## O endereço da página perde a query string

Todo evento leva `page.url`, e por padrão **sem query string e sem fragmento** —
é neles que viajam token de reset, código de convite e cupom. Um `?token=…` num
log é um vazamento que ninguém vai procurar.

```ts
init({ page: 'full' })   // com a query, se você souber o que tem lá
init({ page: false })    // sem endereço nenhum
```

## Saindo da página

`pagehide` é o último evento que uma página recebe de forma confiável — e é
justamente aí que um `fetch` normal pode ser morto junto com a aba. Então o lote
vai por `navigator.sendBeacon`, que o browser entrega depois de a página já ter
morrido.

O `sendBeacon` não manda header nenhum, e é por isso, e só por isso, que **a key
vai na URL** nesse caminho (`/v1/logs?key=nekolog_pk_…`); em todo outro envio
ela continua no `Authorization`. Duas consequências: o lote do browser é
limitado a 60 KB, que é a cota do beacon, e um beacon recusado cai para o
`fetch` com `keepalive` em vez de perder o lote.

## Offline

Um lote que não conseguiu sair — metrô, avião, wifi de hotel — é guardado no
IndexedDB e reenviado quando a rede volta, **e também na visita seguinte**, sem
esperar evento nenhum. O erro que aconteceu offline e fechou a aba chega quando
a pessoa abre o site de novo.

```ts
init({ offline: { maxBatches: 50, maxBytes: 2 * 1024 * 1024, maxAgeMs: 7 * 86_400_000 } })
init({ offline: false })
```

Só **falha de transporte** é guardada. Um `400` é uma recusa que o servidor vai
repetir, então aquele lote é descartado em vez de ficar voltando para sempre. O
registro guardado tem só `{at, url, body}` — o `Authorization` é montado de novo
com a key que está valendo, porque key num banco do navegador é credencial em
repouso por nada.

## Renderizado no servidor

O pacote não toca em `window`, `document` ou `sessionStorage` na importação, e
protege cada acesso. Um componente compartilhado entre servidor e cliente pode
importar e logar dos dois lados; no servidor os `install*` não instalam nada e a
sessão fica em memória.

## Próximos passos

- [Trace distribuído](/docs/pt-br/guides/tracing/) — ligar o clique desta página
  à request que ele causou, e o header que o seu back-end precisa liberar no
  CORS.
- [React](/docs/pt-br/guides/react/) — provider, `useLogger` e um error
  boundary.
