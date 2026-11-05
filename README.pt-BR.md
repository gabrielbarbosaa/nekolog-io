# NekoLog

> Log para aplicações JavaScript e TypeScript, no front e no back.
>
> Leia em [English](README.md) ou [Español](README.es.md).

[![CI](https://github.com/gabrielbarbosaa/nekolog-io/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/gabrielbarbosaa/nekolog-io/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/gabrielbarbosaa/nekolog-io/badge)](https://scorecard.dev/viewer/?uri=github.com/gabrielbarbosaa/nekolog-io)
[![Licença: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

O NekoLog pega os logs que a sua aplicação já escreve, agrupa em lote, tira o
que nunca deveria sair do seu processo e guarda num lugar onde dá para buscar.
SDKs para o navegador e para Node, uma API de ingestão, ClickHouse para
armazenar, jobs em segundo plano para alertas e agrupamento de erros, e uma API
HTTP para ler tudo de volta.

## Situação

**Versão 1.0, e honesto sobre o que isso quer dizer.**

- Tudo neste repositório funciona e tem teste: os SDKs, a ingestão, os jobs, a
  API pública de leitura, o site da documentação. O `pnpm test` roda, e o CI
  roda contra um ClickHouse de verdade, um Postgres de verdade, um Redis de
  verdade e um servidor SMTP de verdade em cada pull request.
- **Nada foi publicado no npm ainda** e **não existe serviço hospedado.** O
  workflow de publicação está pronto e espera uma variável de repositório que
  não existe; a infraestrutura está escrita em OpenTofu e nunca foi aplicada.
  Não há conta para criar.
- **O que dá para fazer hoje é rodar por conta própria.** O `deploy/self-host`
  sobe a plataforma inteira com um comando, e é para esse caminho que este
  repositório existe.
- **O dashboard é fechado** e não faz parte deste repositório. Veja
  [O que é aberto e o que não é](#o-que-é-aberto-e-o-que-não-é).

É um projeto pessoal, feito para rodar inteiro em serviços de nuvem gratuitos.
O único custo é o domínio.

## Rodar

```bash
git clone https://github.com/gabrielbarbosaa/nekolog-io
cd nekolog-io/deploy/self-host
./up.sh
```

Um comando sobe ClickHouse, Postgres, a ingestão, a API de leitura e os jobs.
Ele gera os próprios segredos, aplica as migrações, cria um projeto com uma API
key e diz onde essa key foi escrita. Guia completo:
[Rodar o NekoLog por conta própria](https://nekolog.io/docs/pt-br/self-host/install/).

Depois é só mandar alguma coisa:

```ts
import { createLogger } from '@nekolog-io/node'

const log = createLogger({ apiKey: process.env.NEKOLOG_KEY })

log.info('pedido criado', { orderId: 'ord_7f3a91', total: 219.9 })
log.error('pagamento falhou', new Error('gateway timeout'))
```

E ler de volta, sem dashboard nenhum no meio:

```bash
curl -H "Authorization: Bearer $NEKOLOG_KEY" \
  "http://localhost:8789/v1/logs?q=level:error&limit=20"
```

O `q` é uma linguagem de busca, não um "contém":
`level:error service:api @status>=500 "timeout"`. Está descrita por inteiro em
[a linguagem de busca](https://nekolog.io/docs/pt-br/api/search/).

## Os SDKs

| Pacote | Para |
|---|---|
| [`@nekolog-io/browser`](packages/browser) | o navegador: erro não tratado, promise rejeitada, breadcrumbs, fila offline |
| [`@nekolog-io/node`](packages/node) | Node: contexto por request, exceção não tratada, hooks de processo |
| [`@nekolog-io/react`](packages/react) | provider, `useLogger`, error boundary |
| [`@nekolog-io/next`](packages/next) | `register()` para o `instrumentation.ts`, `onRequestError`, entrada de cliente |
| [`@nekolog-io/express`](packages/express) · [`fastify`](packages/fastify) · [`hono`](packages/hono) · [`nestjs`](packages/nestjs) | middleware de request, sobre uma implementação só |
| [`@nekolog-io/pino`](packages/pino) · [`winston`](packages/winston) | pontes para o logger que você já usa |
| [`@nekolog-io/cli`](packages/cli) | `nekolog init`, releases, envio de source map |
| [`@nekolog-io/bundler-plugin`](packages/bundler-plugin) | Vite, Rollup, webpack e esbuild: sobe os mapas de dentro do build |

Se você já roda OpenTelemetry, não precisa de nenhum deles: a ingestão aceita
[OTLP/HTTP](https://nekolog.io/docs/pt-br/api/otlp/) em `POST /v1/otlp/logs`.

## Como as peças se encaixam

```
SDKs (browser / node) ──► lote por HTTPS, com gzip
         │
         ▼
   ingest (Hono, Cloudflare Workers ou Node)
         │   valida · remove dado sensível · fingerprint · amostragem
         ├─► Workers KV            key → projeto, ambiente, cota
         └─► ClickHouse            os logs
                 ▲
   jobs (cron, a cada minuto) ─────┘
         alertas · agrupamento de erros · uso e cota · exportação
         └─► e-mail, Discord, webhook

   api (só leitura)  busca · histograma · issues · releases · source maps
```

A ingestão não faz I/O além da escrita. O que precisa de uma segunda chamada de
rede — avaliar alerta, montar issue, resolver source map — roda no Worker de
jobs. A ingestão nunca encosta em Postgres nem em Redis, então um banco frio não
tem como somar latência ao caminho em que a sua aplicação está esperando.

## O que é aberto e o que não é

Este repositório é MIT e tem os SDKs, a ingestão, os jobs, a API pública de
leitura, a landing page e a documentação. **O dashboard — as telas — é
fechado**, mora num repositório privado separado e só roda no serviço
hospedado.

Essa é a linha do open-core, e ela está onde está de propósito: tudo que encosta
nos seus dados, no seu processo e nos seus logs é aberto e auditável. O
self-host te dá ingestão, armazenamento, busca, agrupamento de erros e alertas
por uma API HTTP; o que ele não te dá é uma tela para olhar para isso. O
raciocínio está no [docs/PLANO.md](docs/PLANO.md) seção 1 e na
[ADR 0016](docs/adr/0016-pacotes-compartilhados-no-npm.md).

## O que ele faz com os seus dados

- **O endereço IP nunca é gravado.** Nem com hash, nem truncado. A linha carrega
  o país, lido de um cabeçalho e validado como dois caracteres. Um teste manda
  `CF-Connecting-IP` e `X-Forwarded-For` e falha se algum dos dois chegar ao
  armazenamento.
- **Dado sensível sai de dentro do seu processo**, antes de qualquer envio: por
  chave (`password`, `token`, `authorization`, `secret`, `cpf`, campos de cartão,
  em qualquer profundidade) e por valor dentro do texto (cartão que passa no
  Luhn, CPF com dígito válido, JWT, credencial `Bearer`, key do NekoLog). Isso
  roda **depois** do seu `beforeSend`, então o hook não tem como desfazer.
- **E de novo no servidor**, a partir de uma lista fechada de padrões por
  ambiente. Você não pode mandar uma expressão regular — a regex de terceiro num
  Worker com 10 ms de CPU é uma negação de serviço que você escreve sozinho.
- Um breadcrumb de clique registra `button#pay`, nunca o texto do elemento; a
  `page.url` perde a query string, porque é lá que mora token de recuperação de
  senha.

[O que fica guardado](https://nekolog.io/docs/pt-br/reference/privacy/) conta
isso por inteiro.

## Números medidos, não prometidos

- **O `@nekolog-io/core` tem zero dependências de runtime**, por contrato — e
  desde a 1.0 isso não é mais prosa: todo pacote publicado sai com um inventário
  CycloneDX construído do lockfile, e uma dependência chegando em `core`, `cli`
  ou `adapters` falha a release.
- **O SDK de navegador não cumpre o próprio orçamento de tamanho.** A meta era
  5 kB com gzip; o `init` está em **12,05 kB** e só o `createLogger` em
  **9,4 kB**. A maior parte disso é o filtro de privacidade, que não é opcional.
  Os números estão presos pelo `size-limit` para não crescerem sozinhos, e a
  meta não cumprida está escrita no [docs/PLANO.md](docs/PLANO.md) seção 9 em
  vez de arredondada para longe.
- **O maior lote que o protocolo permite não cabia num Worker gratuito.** 500
  eventos com 20% de erro e todas as regras de remoção ligadas custavam
  **10,8 ms** de CPU contra um limite de 10 ms — invisível para um teste de
  carga, que mede latência. Memoizar o fingerprint por lote e baixar o lote
  padrão do cliente para 200 eventos levou isso a 9,1 ms e 2,1 ms. O
  `apps/ingest/src/budget.test.ts` vigia isso no CI.
- Node 22, 24 e 26, Bun, Deno, Chromium, Firefox e WebKit rodam a suíte em cada
  pull request — contra o pacote **construído**, não contra o fonte, porque é o
  construído que você instala.

## Documentação

[nekolog.io/docs/pt-br](https://nekolog.io/docs/pt-br/) — guia de cada SDK, a
referência da API, a linguagem de busca, OTLP, alertas, o que fica guardado e a
instalação do self-host, em português, inglês e espanhol.

Dentro do repositório, três documentos são a fonte da verdade:

- [docs/PLANO.md](docs/PLANO.md) — o quê e o porquê: arquitetura, modelo de
  dados, APIs, segurança, operação.
- [docs/ETAPAS.md](docs/ETAPAS.md) — a ordem em que foi construído, uma etapa
  por branch por pull request.
- [docs/ESPECIFICACOES.md](docs/ESPECIFICACOES.md) — os contratos que valem:
  payload, variáveis de ambiente, migrações, gramática da busca, fingerprint,
  regras de alerta.

Mais [docs/adr/](docs/adr/README.md) para o porquê de cada decisão e do que se
abriu mão nela, [docs/security/](docs/security/README.md) para o modelo de ameaças e
o checklist do ASVS, e [docs/runbooks/](docs/runbooks/README.md) para o que
fazer quando algo quebra.

## Contribuir

O [CONTRIBUTING.md](CONTRIBUTING.md) tem o setup, as convenções e o que uma
mudança precisa carregar para ser mergeada. O
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) vale em todo o projeto.

Achou uma vulnerabilidade? Não abra issue — o [SECURITY.md](SECURITY.md) tem o
caminho de reporte privado.

## Licença

[MIT](LICENSE).
