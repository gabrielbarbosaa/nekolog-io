# @nekolog-io/cli

```bash
npx @nekolog-io/cli init
```

Olha o seu `package.json`, descobre o framework, instala o SDK certo e escreve
as variáveis no `.env`.

| | |
|---|---|
| `--key <key>` | a key a escrever, `nekolog_pk_…` ou `nekolog_sk_…` |
| `--no-install` | escreve o `.env` e **imprime** o comando de instalação, em vez de rodar |
| `--cwd <path>` | onde está o projeto |
| `--env <file>` | qual arquivo escrever (padrão `.env`) |

```bash
npx @nekolog-io/cli releases create 1.4.2 --commit "$(git rev-parse HEAD)"
```

Registra que uma versão saiu, na API pública. A key diz a que projeto e ambiente
ela pertence, então nenhum dos dois é argumento.

| | |
|---|---|
| `--key <key>` | a key **secreta** do ambiente (padrão `$NEKOLOG_KEY`) |
| `--commit <sha>` | 7 a 40 hexadecimais minúsculos |
| `--at <momento>` | quando saiu, ISO 8601 (padrão: agora) |
| `--api <url>` | onde a API responde (padrão `https://api.nekolog.io`) |

É **idempotente**: a mesma versão de novo não muda nada, mantém o momento da
primeira vez e não descarta um commit já conhecido. Repetir o pipeline é de
graça.

E recusa três coisas **antes de abrir o socket**, para a key nunca ir para a
rede por engano: key pública, commit que não é o que o `git rev-parse` imprime,
e HTTP puro para fora desta máquina.

```bash
npx @nekolog-io/cli sourcemaps upload 1.4.2 --dir dist
```

Percorre o build, pega todo `.map`, achata caminho aninhado num nome só e manda
um por um. Pula `node_modules` e pastas com ponto. Registre a release antes: o
upload recusa uma versão que o ambiente nunca viu.

| | |
|---|---|
| `--key <key>` | a key **secreta** do ambiente (padrão `$NEKOLOG_KEY`) |
| `--dir <path>` | a saída do build (padrão `dist`) |
| `--api <url>` | onde a API responde |

Mapa acima de 8 MB é **pulado e nomeado**, não descartado em silêncio. Subir o
mesmo nome de novo substitui e não aumenta a contagem.

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

## O que ele nunca faz

**Não sobrescreve variável que já existe.** Se o `.env` já tem `NEKOLOG_KEY`,
ele passa reto e diz que passou. A sua key de verdade não é trocada por um
`replace_me` — nem pela key que você acabou de passar no `--key`.

**Não escreve key secreta em variável pública.** Num projeto Next ele pede as
duas: `NEKOLOG_KEY` para o servidor e `NEXT_PUBLIC_NEKOLOG_KEY` para o
navegador. Um `--key nekolog_sk_…` preenche só a primeira; a outra fica com o
marcador. Uma key secreta num `NEXT_PUBLIC_` ia direto para o bundle.

**Não escreve nada se a key não parece uma key.** A validação acontece
*antes* de qualquer escrita, então um `--key` errado não deixa meio arquivo
para trás.

**Não roda nada por shell.** O gerenciador é chamado com a lista de
argumentos, `shell: false`. Tem teste passando um argumento com `&` no meio e
conferindo que ele chega inteiro do outro lado.

**Não cria `package.json`.** Pasta sem um é pasta errada, e ele diz isso em
vez de inventar um projeto.

Se a instalação falhar, o `.env` **continua escrito** e a mensagem diz o que
falta rodar.
