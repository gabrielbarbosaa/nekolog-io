---
title: nekolog init
description: Um comando que detecta o framework, instala o SDK certo e escreve o .env.
---

:::caution[Ainda não está no npm]
Os pacotes `@nekolog-io/*` ainda não foram publicados. Esta página descreve o
comportamento que o código já tem, para a forma da API ficar clara.
:::

```bash
npx @nekolog-io/cli init
npx @nekolog-io/cli init --key nekolog_pk_… --no-install
```

Ele lê o `package.json` do projeto, escolhe o SDK, instala com o gerenciador que
o lockfile indicar e escreve as variáveis de ambiente.

| | |
|---|---|
| `--key <key>` | a key a escrever, `nekolog_pk_…` ou `nekolog_sk_…` |
| `--no-install` | escreve o `.env` e **imprime** o comando de instalação, em vez de rodar |
| `--cwd <path>` | onde está o projeto |
| `--env <file>` | qual arquivo escrever (padrão `.env`) |

## O que ele escolhe, e por quê

A ordem importa, porque projeto de verdade tem mais de uma dessas:

| Achou | Instala |
|---|---|
| `next` | `@nekolog-io/next` |
| `@nestjs/core` | `@nekolog-io/nestjs` |
| `fastify` / `hono` / `express` | o pacote do framework mais o `@nekolog-io/node` |
| `react` | `@nekolog-io/react` |
| `vite` sem react | `@nekolog-io/browser` |
| nada disso | `@nekolog-io/node` |

`next` ganha de `react` e `@nestjs/core` ganha de `express` porque nos dois
casos o de fora é quem manda. Ele sempre diz **por que** escolheu.

O gerenciador vem do lockfile: `pnpm-lock.yaml`, `bun.lock`, `yarn.lock`,
`package-lock.json`. Sem lockfile, `npm`.

## Quatro coisas que ele recusa

**Não sobrescreve variável que já existe.** Se o `.env` já tem `NEKOLOG_KEY`,
ele passa reto e diz que passou. A sua key de verdade não é trocada por um
marcador — nem pela key que você acabou de passar no `--key`.

**Não escreve key secreta em variável pública.** Num projeto Next ele pede as
duas: `NEKOLOG_KEY` para o servidor e `NEXT_PUBLIC_NEKOLOG_KEY` para o
navegador. Um `--key nekolog_sk_…` preenche só a primeira; a pública fica com o
marcador, porque uma key secreta numa variável `NEXT_PUBLIC_` vai direto para o
bundle.

**Não escreve nada se a key não parece uma key.** A validação acontece *antes*
da primeira escrita, então um `--key` errado não deixa meio arquivo para trás.

**Não roda nada por shell.** O gerenciador é chamado com a lista de argumentos e
`shell: false`.

Ele também recusa uma pasta sem `package.json` em vez de inventar um projeto. Se
a instalação falhar, o `.env` **continua escrito** e a mensagem diz o que falta
rodar.

## Registrando uma release

```bash
npx @nekolog-io/cli releases create 1.4.2 --commit "$(git rev-parse HEAD)"
```

Ele lê a key de `--key` ou de `NEKOLOG_KEY`, e a key já diz a que projeto e a
que ambiente a release pertence — você nunca passa nenhum dos dois.

| | |
|---|---|
| `--key <key>` | a key **secreta** do ambiente (padrão: `$NEKOLOG_KEY`) |
| `--commit <sha>` | 7 a 40 caracteres hexadecimais minúsculos |
| `--at <momento>` | quando saiu, ISO 8601 (padrão: agora) |
| `--api <url>` | onde a API pública responde (padrão: `https://api.nekolog.io`) |

Coloque no fim do job de deploy. Ele é **idempotente**: rodar de novo para a
mesma versão não muda nada, mantém o momento em que a versão saiu pela primeira
vez e nunca descarta um commit que já conhece — então repetir um pipeline é
inofensivo e o código de saída continua significando o que diz.

Três coisas ele recusa **antes de abrir um socket**, para que um engano nunca
coloque a sua key na rede:

- **uma key pública**, porque ela vai em todo bundle de browser;
- **um commit que não é o que o `git rev-parse` imprime** — maiúsculo, curto
  demais ou não hexadecimal;
- **HTTP puro para qualquer lugar que não seja esta máquina.** Key secreta em
  claro é key secreta entregue. Aponte o `--api` para `https://…`, ou ponha um
  proxy reverso com certificado na frente do seu self-host. `http://localhost`
  é permitido, porque nada sai da máquina.

## Subindo source maps

```bash
npx @nekolog-io/cli sourcemaps upload 1.4.2 --dir dist
```

Registre a release antes — o upload recusa uma versão que este ambiente nunca
viu, para a contagem na release continuar verdadeira. Depois ele percorre o
`--dir`, pega todo `.map` que achar e manda um por um. Caminho aninhado vira um
nome só (`assets/index.mjs.map` vira `assets-index.mjs.map`), e `node_modules`
e pastas com ponto ficam de fora porque não são o seu build.

| | |
|---|---|
| `--key <key>` | a key **secreta** do ambiente (padrão: `$NEKOLOG_KEY`) |
| `--dir <path>` | a saída do build a percorrer (padrão: `dist`) |
| `--api <url>` | onde a API pública responde |

Subir o mesmo nome de novo substitui e **não** aumenta a contagem, então repetir
é tão inofensivo quanto repetir o `releases create`. Um mapa acima de 8 MB é
**pulado e nomeado**, não descartado em silêncio, e um upload que o servidor
recusar para a rodada inteira dizendo o arquivo e o motivo que o servidor deu.

:::note[Por que o servidor não lê o seu mapa inteiro]
Ele confere a forma — os primeiros kilobytes precisam abrir um objeto JSON e
nomear `mappings` ou `sections`, e um `version` declarado precisa ser 3 — e
guarda o resto sem ler. Fazer o parse de megabytes de JSON não cabe no orçamento
de CPU de um Worker, e o mapa é lido onde de fato é usado.
:::

Se o seu build e o seu deploy são o mesmo job, o
[plugin de bundler](/docs/pt-br/guides/bundler-plugin/) faz as duas coisas de
dentro do build, e aí ninguém precisa lembrar de rodar nada.

## Depois de rodar

Abra o guia do que ele instalou: [Browser](/docs/pt-br/guides/browser/),
[React](/docs/pt-br/guides/react/), [Next.js](/docs/pt-br/guides/next/),
[Node.js](/docs/pt-br/guides/node/), [Express](/docs/pt-br/guides/express/),
[Fastify](/docs/pt-br/guides/fastify/), [Hono](/docs/pt-br/guides/hono/) ou
[NestJS](/docs/pt-br/guides/nestjs/).
