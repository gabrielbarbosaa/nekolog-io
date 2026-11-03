# @nekolog-io/browser

SDK do NekoLog para o browser: tudo do
[`@nekolog-io/core`](../core/README.md) mais erro global, promise rejeitada,
sessão por aba, `setUser` e o envio no `pagehide` via `sendBeacon`.

```ts
import { init } from '@nekolog-io/browser'

const nekolog = init({
  apiKey: 'nekolog_pk_…',
  service: 'checkout-web',
  release: '1.4.2',
})

nekolog.setUser('u_42')
nekolog.logger.info('Checkout aberto', { step: 'payment' })
```

`init` cria o logger, instala os dois handlers globais e o flush no `pagehide`.
Se você preferir montar as peças na mão, `createLogger`,
`installGlobalHandlers` e `installFlushOnHide` são exportados separadamente, e
cada `install*` devolve a função que desfaz.

## A key secreta não entra aqui

Uma `nekolog_sk_…` numa página é uma credencial publicada: qualquer pessoa com o
"ver código-fonte" tem ela. Então o SDK **recusa**, avisa pelo `onError` e cai
no console — não manda nada. Ele não joga exceção, porque derrubar o app de
quem configurou errado é pior do que não mandar log; o aviso é alto o
suficiente.

Use a key pública do ambiente. É ela que diz projeto e ambiente, e ela só
escreve.

## Por que o `pagehide` manda de outro jeito

`pagehide` é o último evento que uma página recebe de forma confiável — e é
justamente aí que um `fetch` normal pode ser morto junto com a aba. Então, com a
página saindo, o lote vai por `navigator.sendBeacon`, que o browser entrega
depois da página já ter morrido.

`sendBeacon` não manda header nenhum. É por isso, e só por isso, que **a key vai
na URL** (`/v1/logs?key=nekolog_pk_…`) nesse caminho; no envio normal ela
continua no `Authorization`. O corpo vai como `text/plain`, que é o que faz a
request ser simples de CORS — um `application/json` pediria preflight, e
preflight durante o descarregamento da página não acontece.

Duas consequências práticas:

- O lote do browser é limitado a **60 KB**, porque esse é o teto do
  `sendBeacon`. Um `maxBatchBytes` maior que isso é reduzido, não aceito.
- Se o browser recusar o beacon (cota estourada), o SDK **cai para o `fetch`
  com `keepalive`** em vez de perder o lote.

Também damos flush quando a aba fica escondida (`visibilitychange`), porque em
alguns celulares esse é o único evento que chega antes do app ser suspenso. E no
`pageshow` voltamos ao envio normal, para a página restaurada do cache de
voltar/avançar não continuar mandando por beacon.

## Sessão

Cada aba tem uma sessão, um UUID guardado no `sessionStorage`. Ela recomeça
depois de **30 minutos** sem nenhum log, e sobrevive a um reload.

Três cuidados que valem mais do que a descrição:

- **O que está guardado não é confiável.** Qualquer script da mesma origem
  escreve no `sessionStorage`. O SDK só aceita de volta um UUID com a forma
  exata; qualquer outra coisa vira sessão nova, em vez de ir parar num evento.
- **Relógio para trás também é motivo de recomeçar.** Um carimbo de tempo no
  futuro é tão suspeito quanto um velho demais.
- **Storage pode simplesmente não existir.** No modo privativo do Safari o
  acesso levanta exceção. A sessão continua funcionando, só em memória.

`sessionId()` devolve a atual e `resetSession()` começa outra — é o que você
chama num logout.

## `setUser`

```ts
nekolog.setUser('u_42')  // depois do login
nekolog.setUser(null)    // depois do logout
```

Só o identificador. **Não existe onde colocar nome ou e-mail**, e isso é de
propósito: o dashboard não precisa deles para agrupar, e um campo livre de
usuário é exatamente por onde PII vaza para dentro de um log. Se você precisa de
mais, `logger.child({ attributes: … })` passa pelo filtro de dados sensíveis do
core.

O usuário vale a partir da chamada — eventos anteriores não são reescritos.

## O endereço da página

Todo evento leva `page.url`. Por padrão vai **sem query string e sem
fragmento**, porque é neles que viajam token de reset, código de convite e
cupom. Um `?token=…` num log é um vazamento silencioso que ninguém procura.

```ts
init({ page: 'full' })  // com query, se você souber o que tem lá
init({ page: false })   // sem endereço nenhum
```

Endereço que não seja `http:`, `https:` ou `file:` não vira atributo.

## Erro que ninguém pegou

| Evento | O que vira |
|---|---|
| `error` | log `error` com `error.kind=uncaught`, mais `error.source`, `error.line` e `error.column` |
| `unhandledrejection` | log `error` com `error.kind=unhandledrejection` |

Dois cuidados:

- **O browser continua reportando.** Instalamos listener, não trocamos o
  `window.onerror`, e nunca chamamos `preventDefault()` — o erro continua
  aparecendo no console de quem está depurando.
- **Não dá para entrar em laço.** Se o próprio envio levantar um erro, o
  handler se recusa a reentrar; senão uma falha de rede viraria uma página
  travada.

Erro de carregamento de recurso (uma imagem 404) **não** vira log aqui: ele não
sobe até a `window` sem captura, e é assunto da etapa de breadcrumbs.

## Breadcrumbs

O que a pessoa fez antes do erro: clique, navegação e request. Fica numa fila de
20 na memória, e **só viaja junto com log de `error` ou `fatal`**.

```ts
nekolog.addBreadcrumb('cupom aplicado', { code: 'WELCOME' })
```

| Coletor | O que vira |
|---|---|
| clique | `button#pay.primary` ou `button[data-testid=checkout-pay]` |
| navegação | o endereço novo, com o anterior em `data.from` |
| fetch | `POST https://api.test/orders`, com `status` e `ms` |

### Por que só no erro

A especificação 1 não tem campo para breadcrumb, então a trilha vai como **um
atributo**, `breadcrumbs`, em JSON. Atributo tem teto de 4 KB e o lote tem teto
de 512 KB: grudar 4 KB em cada uma das 500 linhas de um lote daria 2 MB e o
lote seria recusado inteiro. Num `error` o custo se paga; num `info` não.

`breadcrumbs: { attachFrom: 'info' }` muda o nível, `attachFrom: false`
desliga, e `max` muda o tamanho da fila.

A trilha é cortada **pelo começo** até caber nos 4 KB — nunca no meio de um
registro, então o que chega é sempre JSON válido. Se nem um registro couber,
não vai atributo nenhum.

### O que a trilha nunca leva

- **O texto do elemento clicado.** "Pagar como Ada Lovelace" é o nome de uma
  pessoa; `button#pay` não é. Também não lemos `value`, então o que foi digitado
  não sai daqui.
- **Query string.** Endereço de navegação e de request passam pela mesma regra
  do `page.url`: sem query, sem fragmento. Um `?token=…` num breadcrumb é o
  mesmo vazamento, só que mais escondido.
- **Corpo e header do request.** O `Authorization` e o que foi postado não são
  lidos — só método, endereço, status e duração.
- **O lote que estamos mandando.** O request do próprio SDK é ignorado; senão
  cada flush viraria breadcrumb do flush seguinte.

A trilha passa pelo filtro de dados sensíveis do core como qualquer outro
atributo (cartão, CPF, `Bearer …`, key do NekoLog). **E-mail não está nesse
filtro** — é uma decisão do core, não um esquecimento deste pacote.

### O horário é texto, e isso não é enfeite

`at` vai em ISO-8601, não em milissegundos. Milissegundo desde 1970 tem 13
dígitos, e **mais ou menos 1 em cada 10 passa no teste de Luhn** — o filtro de
cartão do core trocava o número por `[redacted]`, fora das aspas, e o JSON da
trilha inteira deixava de ser JSON. Com 20 registros, quebrar era quase certo.
Tem teste que percorre 2000 milissegundos seguidos nas duas formas: com texto
nenhum quebra, com número alguns quebram.

### Os remendos

Dois: `window.fetch` e `history.pushState`/`replaceState`. Os dois chamam o
original e devolvem exatamente o que ele devolveu — inclusive a rejeição, que é
relançada, não engolida. O `close()` desfaz os dois, e **só** se ninguém tiver
remendado depois de nós; se outra biblioteca entrou por cima, a dela fica.

`clicks: false`, `navigation: false` ou `fetch: false` desligam cada coletor.
XHR **não** é remendado: `fetch` é o que a etapa 3.2 pede, e um remendo a mais
é uma chance a mais de quebrar o app de alguém.

## Renderizado no servidor

O pacote não toca em `window`, `document` ou `sessionStorage` na importação, e
cada acesso é protegido. Um componente compartilhado entre servidor e cliente
pode importar e logar dos dois lados; no servidor os `install*` não instalam
nada e a sessão fica em memória.

## O que ainda não está aqui

Fila offline no IndexedDB e propagação de `traceparent` são as etapas 3.3 e
3.4. O orçamento de 5 KB gzip é verificado a partir da 3.12.

Os testes rodam contra um DOM de verdade (happy-dom), com `ErrorEvent`,
`pagehide`, `visibilitychange` e clique despachados de verdade. Browser de
verdade — Chromium, Firefox e WebKit — é a matriz da etapa 3.12.
