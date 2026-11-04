---
title: Trace distribuído
description: Ligue um clique no browser à request que ele causou — e o header do CORS que torna isso possível.
---

:::caution[Ainda não está no npm]
Os pacotes `@nekolog-io/*` ainda não foram publicados. Esta página descreve o
comportamento que o código já tem, para a forma da API ficar clara.
:::

Todo log de uma página leva o mesmo `trace`, e toda request sai com um header
`traceparent` do W3C — um span filho por request. O back-end continua esse trace
em vez de começar outro, e o clique no front e a request no back terminam na
mesma linha do tempo.

```
00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
   └ versão        └ id do trace           └ id do span └ flags
```

## No browser

```ts
init({ trace: { targets: ['api.shop.test', '.servicos.interno'] } })
init({ trace: { sameOrigin: false, targets: [/^https:\/\/api\./] } })
init({ trace: false })
```

**Por padrão, só a própria origem.** O `traceId` é identificador interno: mandar
para um terceiro é vazamento pequeno mas de graça, e um header a mais numa
request entre domínios vira preflight e pode simplesmente quebrar a chamada. A
ingestão também não recebe — ela não tem o que fazer com ele.

## O casamento é estrito de propósito

| Entrada | Casa com |
|---|---|
| `api.shop.test` | só esse host |
| `.shop.test` | o domínio e os subdomínios |
| `shop.test/api` ou `https://shop.test/api` | esse host, nesse caminho ou abaixo dele |
| `/^https:\/\/api\./` | o que a expressão disser |

Host que só **começa** igual (`api.shop.test.evil.test`) não casa: a comparação
é de origem inteira e host inteiro, nunca prefixo de texto. Porta diferente é
origem diferente. `http:` não é `https:`. Entrada com caminho tem que casar numa
fronteira de segmento. Esquema que não seja `http`/`https` nunca recebe o
header.

Somar o header nunca quebra a request. `Headers`, lista de pares, objeto simples
e um `Request` pronto são cada um estendido, não substituído — e se qualquer
coisa der errado na hora de montar, a request sai **sem** o header em vez de não
sair.

## No servidor

Cada middleware ([Express](/docs/pt-br/guides/express/),
[Fastify](/docs/pt-br/guides/fastify/), [Hono](/docs/pt-br/guides/hono/),
[NestJS](/docs/pt-br/guides/nestjs/)) já lê o `traceparent` que chegou, continua
o trace com um span novo, prende no contexto da request e responde com
`traceparent` e `x-request-id`. Um `traceparent` inválido não derruba a request:
vira trace novo.

Para as chamadas que o seu serviço **faz**:

```ts
import { installTracePropagation } from '@nekolog-io/node'

installTracePropagation({ targets: ['pedidos.interno', '.servicos.interno'] })
```

O `targets` é **obrigatório, e não existe padrão**. No browser "a própria
origem" é um padrão seguro e óbvio; num servidor não existe origem própria, e
mandar o id de trace interno para o gateway de pagamento não é o que ninguém
queria. Se você não listar, não propaga — e isso é preferível a propagar para
todo mundo em silêncio.

O trace sai do contexto da request, e cada chamada leva um span filho, nunca o
span da própria request. Fora de uma request não há trace, e então não vai
header nenhum.

## CORS: a parte que morde

O `traceparent` não é um header da lista segura do CORS. No momento em que o
browser o acrescenta a uma request **entre origens**, aquela request deixa de
ser simples e ganha um preflight — e se a sua API não responder esse preflight
liberando o header, a chamada falha antes de o seu handler ver qualquer coisa.

Dois headers importam, e eles fazem coisas diferentes:

| Header de resposta | O que ele compra |
|---|---|
| `Access-Control-Allow-Headers: traceparent` | deixa a request levar o header **para dentro**. Sem ele, a chamada falha |
| `Access-Control-Expose-Headers: traceparent, x-request-id` | deixa a página **ler** o que voltou. Sem ele, a chamada funciona e os valores só ficam invisíveis para o JavaScript |

Só o primeiro é obrigatório. O segundo é o que permite mostrar um id de request
numa tela de erro, para alguém colar num chamado de suporte.

```http
Access-Control-Allow-Origin: https://shop.test
Access-Control-Allow-Headers: content-type, authorization, traceparent
Access-Control-Expose-Headers: traceparent, x-request-id
```

Cada guia de servidor tem o trecho do seu framework:
[Express](/docs/pt-br/guides/express/), [Fastify](/docs/pt-br/guides/fastify/),
[Hono](/docs/pt-br/guides/hono/), [NestJS](/docs/pt-br/guides/nestjs/),
[Next.js](/docs/pt-br/guides/next/).

### Se você não pode mexer na API

Deixe aquele host fora do `targets`. A página mantém o trace dela, a request sai
intacta, e a única coisa que você perde é a ligação entre os dois lados naquela
chamada. É uma troca melhor do que um checkout quebrado.

## A amostragem não corta uma request ao meio

Com amostragem ligada e um `trace.traceId` no contexto, a decisão vem de um hash
do trace, não de um sorteio por evento: ou todos os logs daquela request entram,
ou nenhum. Meia request no dashboard não ajuda ninguém a depurar. Erro nunca é
descartado pela amostragem — o piso começa em `error`.
