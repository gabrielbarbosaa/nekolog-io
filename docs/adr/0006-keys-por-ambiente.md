# ADR 0006 — Keys públicas e secretas por ambiente

- **Status:** aceita
- **Data:** 2026-10-29
- **Plano:** seções 1 e 6

## Contexto

O SDK precisa dizer à ingestão de qual projeto e de qual ambiente o log veio. A
forma comum é uma key de projeto mais uma opção `environment` no SDK — e é
exatamente aí que acontece o acidente clássico: alguém sobe para produção com
`environment: 'staging'` esquecido na configuração, ou o contrário, e os dados
se misturam.

Além disso, o SDK de browser roda em código que qualquer pessoa pode ler. A key
que ele usa é pública por definição.

## Decisão

A hierarquia é **Organização → Projeto → Ambiente → Keys**. Cada ambiente tem
suas próprias keys, de dois tipos:

- `nekolog_pk_…` — **pública**, só escreve logs, usada no front-end.
- `nekolog_sk_…` — **secreta**, usada no back-end, com escopos
  (`logs:write`, `logs:read`).

**A key define o ambiente.** O SDK não tem opção `environment`, então uma key de
staging não consegue gravar em produção nem por engano.

Só o hash SHA-256 da key é guardado. A key aparece uma única vez, na criação.

A `pk` pode ir na URL (`/v1/logs?key=pk_…`), porque o `sendBeacon` do browser
não envia headers. A `sk` **só** no header `Authorization` — key secreta na URL
é recusada com erro próprio (`secret_key_in_url`), porque URLs aparecem em log
de proxy, histórico e referer.

## Consequências

- **Mais keys para gerenciar.** Um projeto com três ambientes tem no mínimo três
  keys, e rotacionar significa mexer em cada ambiente. Em troca, o raio de
  alcance de um vazamento fica limitado a um ambiente.
- **A key pública é visível, e isso é por design.** Qualquer pessoa pode extrair
  a `pk` de um site e mandar logs falsos. As defesas são a lista de origens
  permitidas por ambiente, o rate limit e a cota — não o segredo da key.
- **Só o hash guardado significa que uma key perdida é irrecuperável.** Só
  resta criar outra. É o comportamento correto, mas precisa estar claro na
  interface no momento da criação.
- **Revogação não é instantânea.** A config vive no KV com cache de 60 s no
  Worker, então revogar leva até ~60 s para valer em todo lugar.
- **O "último uso" exige escrita.** Mostrar isso no dashboard custa uma escrita
  por key, e o KV tem 1.000 escritas/dia no plano gratuito — precisa ser
  agregado, não gravado a cada request.

## Alternativas consideradas

- **Uma key por projeto + opção `environment` no SDK.** O padrão da indústria.
  Descartada justamente pelo modo de falha que ela permite: configuração errada
  mistura dados de produção com dados de teste, e não há como o servidor
  detectar isso.
- **Só keys secretas, sem tipo público.** Impossível: o SDK de browser precisa
  de uma credencial que fica exposta. Fingir que ela é secreta seria pior do que
  tratá-la como pública e defender com origem e cota.
- **JWT assinado em vez de key opaca.** Permitiria embutir escopos sem consulta.
  Descartada: rotação e revogação ficam difíceis, e o SDK teria que lidar com
  expiração — complexidade que não se paga aqui.
