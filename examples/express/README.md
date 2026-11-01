# @examples/express

Uma API Express mínima que manda log de verdade para a ingestão do NekoLog,
usando só `@nekolog-io/node`. É o exemplo que fecha o marco M1: um `log.info()`
daqui vira uma linha no ClickHouse.

Ainda **não** existe o pacote `@nekolog-io/express` (etapa 3.7). Tudo que está em
`src/middleware.ts` é o que aquele pacote vai passar a fazer sozinho — aqui está
escrito à mão de propósito, para mostrar o que acontece.

```
GET  /health          não gera log nenhum
GET  /orders/:id      um log de negócio mais a linha de acesso
POST /orders          contexto de sessão, atributos e remoção de dado pessoal
GET  /boom            estoura: o cliente vê 500, o log vê o stack inteiro
```

## Rodando ponta a ponta

Precisa de três coisas de pé: o ClickHouse, umas keys e a ingestão.

```bash
cp .env.example .env         # na raiz do repositório
pnpm dev:infra               # ClickHouse em :8123
pnpm ch:migrate              # cria logs, logs_per_minute, usage_per_minute…
pnpm seed init               # imprime as keys uma única vez — copie uma secreta
```

Cole a key secreta em `NEKOLOG_KEY`, no `.env` da raiz. Então, em dois terminais:

```bash
pnpm --filter @apps/ingest serve        # ingestão local em :8787
pnpm --filter @examples/express start   # a API em :3100
```

```bash
curl localhost:3100/orders/ord_7f3a91
```

E a linha está lá:

```sql
SELECT timestamp, level, message, attributes
FROM nekolog_dev.logs
WHERE service = 'example-express'
ORDER BY timestamp DESC LIMIT 10
```

**Sem `NEKOLOG_KEY` o exemplo continua rodando** — o SDK cai no sink de console
quando não tem key, então dá para ver o formato do evento sem subir nada.

## O que este exemplo mostra

### Uma requisição, um trace

`withLogContext` põe um `traceId` e um `spanId` no `AsyncLocalStorage` antes de
qualquer handler. Todo log daquela requisição sai com eles, sem ninguém precisar
passar nada adiante.

O `traceparent` que o chamador mandou é **entrada não confiável**: o parser aceita
só o formato W3C exato — versão diferente de `ff`, 32 e 16 dígitos hexadecimais
minúsculos, nenhum dos dois todo zero. Se não bate, começa um trace novo em vez
de propagar lixo. O `traceId` do chamador é mantido, mas o `spanId` é nosso: o
dele vira o atributo `trace.parentSpanId`, que é o que o W3C pede.

A resposta devolve o `traceparent` novo, então quem chamou consegue achar as
linhas no dashboard.

### A linha de acesso sai no fim, com o que o handler acrescentou

`withAccessLog` registra o listener de `finish` dentro do contexto, com
`bindContext`. Isso importa: um listener de evento **não** herda o
`AsyncLocalStorage` de quem o registrou, então sem o `bindContext` a linha de
acesso sairia sem trace nenhum.

E como o `addContext` do SDK altera o objeto que está no store, o que a rota
acrescentou no meio do caminho (`order.id`, o usuário da sessão) aparece na linha
de acesso que só é escrita no fim.

### O que vai para o log não é o que o cliente digitou

O `http.route` é o padrão que casou (`/orders/:id`), não o caminho que veio na
URL — senão cada requisição viraria um valor distinto numa coluna
`LowCardinality`, e qualquer um poderia encher o log com o texto que quisesse.

O `x-request-id` do chamador é aceito, mas só até 64 caracteres e só com letras,
dígitos, `.`, `:`, `-` e `_`. Um `\n` ali dentro forjaria uma segunda linha de
log; o exemplo troca por um id gerado.

### O cliente não lê o erro, nós lemos

`/boom` estoura com uma mensagem que cita um endereço interno. O cliente recebe
`Internal Server Error` e nada mais; o log recebe tipo, mensagem e stack. Erro
de cliente (4xx) é o contrário: a mensagem ajuda, e é devolvida.

### Dado pessoal não chega no banco

A lista de chaves sensíveis do SDK não conhece o seu domínio. `src/logger.ts`
acrescenta `email`, `phone` e `address` — o `customer.email` sai `[redacted]`
antes de virar requisição HTTP, não no servidor.

Cuidado ao acrescentar: a comparação é por **substring** do segmento da chave.
`ip` na lista apagaria `recipient` e `zipCode` junto. O teste exige pelo menos
cinco caracteres por chave justamente por isso.

### O SDK não derruba a aplicação

Tem teste: com um sink que estoura em toda emissão, a rota continua respondendo
200. O erro vai para o `onError`, e só.

## Variáveis

| Variável | O que faz |
| --- | --- |
| `NEKOLOG_KEY` | a key da ingestão; vazia, cai no console |
| `NEKOLOG_ENDPOINT` | a URL da ingestão, sem `/v1/logs` |
| `NEKOLOG_SERVICE` | padrão `example-express` |
| `NEKOLOG_RELEASE` | versão, aparece na coluna `release` |
| `NEKOLOG_LEVEL` | nível mínimo, padrão `info` |
| `NEKOLOG_FLUSH_INTERVAL_MS` | só deste exemplo: encurta o envio em lote (padrão do SDK: 5s) |
| `PORT` | padrão 3100; `0` pede uma porta ao sistema |

## Testes

```bash
pnpm --filter @examples/express test
```

`src/*.test.ts` sobe a aplicação de verdade numa porta e fala HTTP com ela.
`tests/clickhouse.integration.test.ts` vai até o fim: sobe a ingestão, roda
`src/server.ts` num processo separado, faz requisições e confere as linhas no
ClickHouse. Sem ClickHouse de pé ele avisa no stderr e pula — menos no CI, que
define `CLICKHOUSE_TEST_REQUIRED=1`.

O teste de flush no `SIGTERM` **não roda no Windows**: lá o sinal termina o
processo em vez de chegar no listener. No CI, que é Linux, roda.
